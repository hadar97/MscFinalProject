/**
 * Step 1 of the goodbooks-10k integration.
 *
 *   1. Loads goodbooks books.csv into a staging table `gb_books` (all TEXT).
 *   2. Links books you ALREADY have to goodbooks (sets books.goodbooks_id):
 *        pass 1 - by ISBN-10 (goodbooks dropped leading zeros, so we lpad)
 *        pass 2 - by title + first author, for books that have no ISBN
 *   3. Prints a report so we can decide how to fill up to TARGET_TOTAL.
 *
 * Safe to re-run: it recreates gb_books and only sets books.goodbooks_id.
 * It does NOT add or delete any book.
 *
 * Column naming note (Kaggle version of books.csv):
 *   csv "id"      (1..10000) -> gb_books.book_id            <- what ratings.csv uses
 *   csv "book_id" (Goodreads) -> gb_books.goodreads_book_id
 *
 * Setup: npm install csv-parse
 * Run:   node gb-import-books.js ./data/books.csv
 */

const fs = require("fs");
const { parse } = require("csv-parse");
const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const CSV_PATH = process.argv[2] || "./data/books.csv";
const TARGET_TOTAL = 7000;
const BATCH_SIZE = 500;

const COLUMNS = [
  "book_id", "goodreads_book_id", "best_book_id", "work_id", "books_count",
  "isbn", "isbn13", "authors", "original_publication_year", "original_title",
  "title", "language_code", "average_rating", "ratings_count",
  "work_ratings_count", "work_text_reviews_count",
  "ratings_1", "ratings_2", "ratings_3", "ratings_4", "ratings_5",
  "image_url", "small_image_url",
];

async function createStaging() {
  await pool.query(`DROP TABLE IF EXISTS gb_books;`);
  await pool.query(
    `CREATE TABLE gb_books (${COLUMNS.map((c) => `${c} TEXT`).join(", ")});`
  );
}

async function insertBatch(rows) {
  const params = [];
  const tuples = rows.map((row, i) => {
    const placeholders = COLUMNS.map((_, j) => `$${i * COLUMNS.length + j + 1}`);
    params.push(...row.map((v) => (v === "" ? null : v)));
    return `(${placeholders.join(",")})`;
  });
  await pool.query(
    `INSERT INTO gb_books (${COLUMNS.join(",")}) VALUES ${tuples.join(",")};`,
    params
  );
}

async function loadCsv() {
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`File not found: ${CSV_PATH}`);
  }

  const parser = fs.createReadStream(CSV_PATH).pipe(parse({ bom: true, trim: true }));

  let isHeader = true;
  let batch = [];
  let total = 0;

  for await (const record of parser) {
    if (isHeader) {
      if (record.length !== COLUMNS.length) {
        throw new Error(
          `Expected ${COLUMNS.length} columns, found ${record.length}. Header: ${record.join(", ")}`
        );
      }
      isHeader = false;
      continue;
    }
    batch.push(record);
    if (batch.length === BATCH_SIZE) {
      await insertBatch(batch);
      total += batch.length;
      batch = [];
      console.log(`  loaded ${total} rows...`);
    }
  }
  if (batch.length) {
    await insertBatch(batch);
    total += batch.length;
  }
  return total;
}

async function linkExistingBooks() {
  await pool.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS goodbooks_id INT;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS books_goodbooks_id_idx ON books (goodbooks_id);`);

  // Pass 1: ISBN-10
  const byIsbn = await pool.query(
    `UPDATE books b
     SET goodbooks_id = g.book_id::int
     FROM gb_books g
     WHERE b.goodbooks_id IS NULL
       AND g.isbn IS NOT NULL
       AND b.isbn_10 = lpad(g.isbn, 10, '0');`
  );

  // Pass 2: title (without the "(Series, #1)" suffix) + first author
  const byTitle = await pool.query(
    `UPDATE books b
     SET goodbooks_id = g.book_id::int
     FROM gb_books g
     WHERE b.goodbooks_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM books x WHERE x.goodbooks_id = g.book_id::int)
       AND lower(trim(b.title)) = lower(trim(regexp_replace(g.title, '\\s*\\([^)]*\\)\\s*$', '')))
       AND lower(trim(b.authors[1])) = lower(trim(split_part(g.authors, ',', 1)));`
  );

  return { byIsbn: byIsbn.rowCount, byTitle: byTitle.rowCount };
}

async function report() {
  const { rows } = await pool.query(
    `SELECT
       (SELECT count(*) FROM books)::int                                   AS total_books,
       (SELECT count(*) FROM books WHERE goodbooks_id IS NOT NULL)::int    AS linked,
       (SELECT count(*) FROM books WHERE goodbooks_id IS NULL)::int        AS not_linked,
       (SELECT count(*) FROM (
          SELECT goodbooks_id FROM books
          WHERE goodbooks_id IS NOT NULL
          GROUP BY goodbooks_id HAVING count(*) > 1) d)::int               AS duplicate_links,
       (SELECT count(*) FROM gb_books g
        WHERE NOT EXISTS (SELECT 1 FROM books b WHERE b.goodbooks_id = g.book_id::int)
          AND (g.language_code IS NULL OR g.language_code LIKE 'en%'))::int AS gb_english_available;`
  );
  const r = rows[0];
  const slotsLeft = Math.max(TARGET_TOTAL - r.total_books, 0);

  console.log("\n================ REPORT ================");
  console.log(`Books in table now:              ${r.total_books}`);
  console.log(`  linked to goodbooks (ratings): ${r.linked}`);
  console.log(`  not linked (CBF only):         ${r.not_linked}`);
  console.log(`goodbooks ids linked >1 time:    ${r.duplicate_links}`);
  console.log(`English goodbooks not yet in DB: ${r.gb_english_available}`);
  console.log(`Free slots up to ${TARGET_TOTAL}:          ${slotsLeft}`);
  console.log("========================================\n");
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Missing DATABASE_URL in .env file");
    process.exit(1);
  }

  console.log(`Loading ${CSV_PATH} into gb_books...`);
  await createStaging();
  const loaded = await loadCsv();
  console.log(`Loaded ${loaded} goodbooks rows.`);

  console.log("Linking existing books...");
  const linked = await linkExistingBooks();
  console.log(`  by ISBN-10:        ${linked.byIsbn}`);
  console.log(`  by title + author: ${linked.byTitle}`);

  await report();
  await pool.end();
}

main().catch(async (err) => {
  console.error("Fatal error:", err.message);
  await pool.end();
  process.exit(1);
});