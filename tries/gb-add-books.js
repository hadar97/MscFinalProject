/**
 * Adds goodbooks books to the `books` table WITHOUT Google Books.
 *
 * Source: books_enriched.csv from goodbooks-10k-extended
 *   https://github.com/malcolmosh/goodbooks-10k-extended
 * Same 10,000 books and the same book_id (1 = The Hunger Games) as the
 * goodbooks-10k you already loaded, plus a description and genres per book.
 *
 * What it does:
 *   - First links existing books that are goodbooks books but were missed in
 *     step 1. Match, in this order:
 *       1. same ISBN-10 or ISBN-13 (step 1 only compared ISBN-10)
 *       2. same title + first author, ignoring case/spaces/punctuation
 *          ("J.R.R. Tolkien" == "J. R. R. Tolkien")
 *   - Picks the TARGET_NEW_BOOKS most-rated English books that are not yet
 *     linked (books.goodbooks_id), so books you already have are skipped.
 *   - Inserts them into `books` with the same columns as the existing rows:
 *       description  <- description
 *       categories   <- genres mapped to Google's categories (GENRE_TO_GOOGLE),
 *                       e.g. fantasy -> "Fiction", memoir -> "Biography & Autobiography"
 *       goodreads_genres <- NEW column: the original genres, unchanged
 *                       (also filled for books that were already linked)
 *       authors      <- written in Google's style ("J.K. Rowling" -> "J. K. Rowling")
 *       google_id    <- "gr:<goodreads id>" (the column is NOT NULL; the "gr:"
 *                       prefix shows the book did not come from Google)
 *       search_term  <- "goodbooks-10k"
 *       goodbooks_id <- book_id (the key that ratings.csv uses)
 *
 * Default is a DRY RUN: prints what would be inserted and changes nothing.
 * Add --apply to really insert. Then run embed-books.js as usual.
 *
 * Run:
 *   node gb-add-books-extended.js ./data/books_enriched.csv
 *   node gb-add-books-extended.js ./data/books_enriched.csv --apply
 */

const fs = require("fs");
const { parse } = require("csv-parse");
const { Pool } = require("pg");
require("dotenv").config();

const CSV_PATH = process.argv.find((a) => a.endsWith(".csv")) || "./data/books_enriched.csv";
const APPLY = process.argv.includes("--apply");
const TARGET_NEW_BOOKS = 9000;
const SOURCE_TAG = "goodbooks-10k";
const BATCH_SIZE = 200;

// Goodreads genre -> the category Google Books uses for such books
// (Google's top-level BISAC subjects), so new books share the same category
// vocabulary as the books imported from Google. null = no matching category.
const GENRE_TO_GOOGLE = {
  "fiction": "Fiction",
  "fantasy": "Fiction",
  "romance": "Fiction",
  "contemporary": "Fiction",
  "mystery": "Fiction",
  "thriller": "Fiction",
  "crime": "Fiction",
  "suspense": "Fiction",
  "science-fiction": "Fiction",
  "paranormal": "Fiction",
  "chick-lit": "Fiction",
  "horror": "Fiction",
  "historical-fiction": "Fiction",
  "classics": "Fiction",
  "young-adult": "Young Adult Fiction",
  "history": "History",
  "biography": "Biography & Autobiography",
  "memoir": "Biography & Autobiography",
  "philosophy": "Philosophy",
  "psychology": "Psychology",
  "religion": "Religion",
  "christian": "Religion",
  "spirituality": "Religion",
  "graphic-novels": "Comics & Graphic Novels",
  "comics": "Comics & Graphic Novels",
  "manga": "Comics & Graphic Novels",
  "science": "Science",
  "self-help": "Self-Help",
  "poetry": "Poetry",
  "business": "Business & Economics",
  "art": "Art",
  "travel": "Travel",
  "music": "Music",
  "sports": "Sports & Recreation",
  "cookbooks": "Cooking",
  "humor-and-comedy": "Humor",
  "nonfiction": null,
  "books": null,
  "gay-and-lesbian": "Social Science",
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ---------- helpers ----------

// "['Suzanne Collins', \"Madeleine L'Engle\"]" (Python list as text) -> array
function parseList(text) {
  if (!text) return [];
  const out = [];
  const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(text))) out.push((m[1] ?? m[2]).trim());
  return out.filter(Boolean);
}

// "The Hunger Games (The Hunger Games, #1)" -> "The Hunger Games"
function cleanTitle(title) {
  return (title || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
}

// ['young-adult', 'fantasy', 'fiction'] -> ['Young Adult Fiction', 'Fiction']
function genresToCategories(genres) {
  const out = [];
  for (const g of genres) {
    const c = GENRE_TO_GOOGLE[g];
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

// Goodreads writes "J.K. Rowling", Google writes "J. K. Rowling".
// The CBF bonus compares author names exactly, so use Google's style.
function normalizeAuthor(name) {
  return name.replace(/\.(?=[A-Z])/g, ". ").replace(/\s+/g, " ").trim();
}

function toInt(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

// goodbooks stored ISBNs as numbers, so leading zeros were lost
function padIsbn10(isbn) {
  if (!isbn) return null;
  const s = String(isbn).trim().padStart(10, "0");
  return /^\d{9}[\dX]$/i.test(s) ? s.toUpperCase() : null;
}

// The isbn13 column in the csv lost its last digit (stored as a float),
// so we compute ISBN-13 from ISBN-10: "978" + 9 digits + new check digit
function isbn10to13(isbn10) {
  if (!isbn10) return null;
  const core = "978" + isbn10.slice(0, 9);
  const sum = [...core].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return core + ((10 - (sum % 10)) % 10);
}

function isEnglish(code) {
  return !code || code.startsWith("en");
}

function buildRow(r) {
  const isbn10 = padIsbn10(r.isbn);
  const year = toInt(r.original_publication_year);
  return {
    google_id: `gr:${r.goodreads_book_id}`,
    title: cleanTitle(r.title) || r.original_title || r.title,
    authors: parseList(r.authors).map(normalizeAuthor),
    publisher: null,
    published_date: year ? String(year) : null,
    description: r.description || null,
    isbn_10: isbn10,
    isbn_13: isbn10to13(isbn10),
    page_count: toInt(r.pages),
    categories: genresToCategories(parseList(r.genres)),
    goodreads_genres: parseList(r.genres), // original genres, as they came
    average_rating: null,
    ratings_count: null,
    language: "en",
    thumbnail_url: r.image_url || null,
    goodbooks_id: toInt(r.book_id),
    _ratings_count: toInt(r.ratings_count) || 0,
  };
}

// ---------- main steps ----------

async function readCsv() {
  if (!fs.existsSync(CSV_PATH)) throw new Error(`File not found: ${CSV_PATH}`);
  const rows = [];
  const parser = fs
    .createReadStream(CSV_PATH)
    .pipe(parse({ columns: true, bom: true, relax_quotes: true }));
  for await (const r of parser) rows.push(r);
  return rows;
}

// Match key that ignores case, punctuation and spaces, so that
// "J. R. R. Tolkien" (Google) == "J.R.R. Tolkien" (Goodreads).
function matchKey(title, author) {
  const t = cleanTitle(title).toLowerCase().replace(/[^a-z0-9]/g, "");
  const a = (author || "").toLowerCase().replace(/[^a-z]/g, "");
  return t && a ? `${t}|${a}` : null;
}

// Existing books (from Google) that ARE goodbooks books but were not linked
// in step 1, because the author was written differently ("J.R.R." vs "J. R. R.").
// Linking them prevents inserting the same book a second time.
async function findMissedLinks(csvRows) {
  const { rows: existing } = await pool.query(
    `SELECT id, title, authors[1] AS author, isbn_10, isbn_13
     FROM books WHERE goodbooks_id IS NULL;`
  );
  const { rows: linked } = await pool.query(
    `SELECT goodbooks_id FROM books WHERE goodbooks_id IS NOT NULL;`
  );
  const usedGb = new Set(linked.map((r) => r.goodbooks_id));

  const gbByIsbn = new Map(); // ISBN-10 and ISBN-13 -> goodbooks id
  const gbByKey = new Map();  // title|author -> goodbooks id
  for (const r of csvRows) {
    const gbId = toInt(r.book_id);
    if (!gbId || usedGb.has(gbId)) continue;
    const isbn10 = padIsbn10(r.isbn);
    if (isbn10) {
      gbByIsbn.set(isbn10, gbId);
      gbByIsbn.set(isbn10to13(isbn10), gbId);
    }
    const key = matchKey(r.title, parseList(r.authors)[0]);
    if (key && !gbByKey.has(key)) gbByKey.set(key, gbId);
  }

  const links = []; // { booksId, gbId, title, by }
  for (const b of existing) {
    // 1. Same ISBN (10 or 13) - exact same edition
    let gbId = gbByIsbn.get(b.isbn_10) || gbByIsbn.get(b.isbn_13);
    let by = "isbn";
    // 2. Same title + author - same book, another edition
    if (!gbId || usedGb.has(gbId)) {
      gbId = gbByKey.get(matchKey(b.title, b.author));
      by = "title+author";
    }
    if (gbId && !usedGb.has(gbId)) {
      links.push({ booksId: b.id, gbId, title: b.title, by });
      usedGb.add(gbId); // each goodbooks book is linked to one row only
    }
  }
  return links;
}

async function selectBooks(csvRows, missedLinks) {
  const { rows } = await pool.query(
    `SELECT goodbooks_id FROM books WHERE goodbooks_id IS NOT NULL;`
  );
  const alreadyLinked = new Set(rows.map((r) => r.goodbooks_id));
  missedLinks.forEach((l) => alreadyLinked.add(l.gbId));

  return csvRows
    .filter((r) => isEnglish(r.language_code))
    .map(buildRow)
    .filter((b) => b.goodbooks_id && !alreadyLinked.has(b.goodbooks_id))
    .filter((b) => b.title && b.authors.length)
    .sort((a, b) => b._ratings_count - a._ratings_count)
    .slice(0, TARGET_NEW_BOOKS);
}

const COLUMNS = [
  "google_id", "title", "authors", "publisher", "published_date", "description",
  "isbn_10", "isbn_13", "page_count", "categories", "average_rating",
  "ratings_count", "language", "thumbnail_url", "search_term", "search_terms",
  "goodbooks_id", "goodreads_genres",
];

// Books that were already linked (from Google) keep all their Google data;
// they only get the original Goodreads genres in the new column.
async function fillGenresForLinked(client, csvRows) {
  let updated = 0;
  for (const r of csvRows) {
    const res = await client.query(
      `UPDATE books SET goodreads_genres = $1
       WHERE goodbooks_id = $2 AND goodreads_genres IS NULL;`,
      [parseList(r.genres), toInt(r.book_id)]
    );
    updated += res.rowCount;
  }
  return updated;
}

async function insertAll(books, csvRows, missedLinks) {
  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query("BEGIN");
    await client.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS goodreads_genres TEXT[];`);

    for (const l of missedLinks) {
      await client.query(`UPDATE books SET goodbooks_id = $1 WHERE id = $2;`, [l.gbId, l.booksId]);
    }
    console.log(`  linked ${missedLinks.length} existing books (no duplicates inserted)`);

    for (let i = 0; i < books.length; i += BATCH_SIZE) {
      const batch = books.slice(i, i + BATCH_SIZE);
      const params = [];
      const tuples = batch.map((b, j) => {
        params.push(
          b.google_id, b.title, b.authors, b.publisher, b.published_date,
          b.description, b.isbn_10, b.isbn_13, b.page_count, b.categories,
          b.average_rating, b.ratings_count, b.language, b.thumbnail_url,
          SOURCE_TAG, [SOURCE_TAG], b.goodbooks_id, b.goodreads_genres
        );
        const base = j * COLUMNS.length;
        return `(${COLUMNS.map((_, k) => `$${base + k + 1}`).join(",")})`;
      });
      const res = await client.query(
        `INSERT INTO books (${COLUMNS.join(",")}) VALUES ${tuples.join(",")}
         ON CONFLICT (google_id) DO NOTHING;`,
        params
      );
      inserted += res.rowCount;
      console.log(`  inserted ${inserted}/${books.length}...`);
    }
    const genresFilled = await fillGenresForLinked(client, csvRows);
    console.log(`  goodreads_genres filled for ${genresFilled} books that were already linked`);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return inserted;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Missing DATABASE_URL in .env file");
    process.exit(1);
  }

  console.log(`Reading ${CSV_PATH}...`);
  const csvRows = await readCsv();
  const missedLinks = await findMissedLinks(csvRows);
  const books = await selectBooks(csvRows, missedLinks);

  const before = await pool.query(`SELECT count(*)::int AS n FROM books;`);
  const withDesc = books.filter((b) => b.description).length;

  const byIsbn = missedLinks.filter((l) => l.by === "isbn").length;
  console.log(`\nExisting books to LINK instead of adding again: ${missedLinks.length}`);
  console.log(`  by ISBN-10/13:      ${byIsbn}`);
  console.log(`  by title + author:  ${missedLinks.length - byIsbn}`);
  missedLinks.slice(0, 5).forEach((l) =>
    console.log(`  - id=${l.booksId} "${l.title}" -> goodbooks ${l.gbId} (${l.by})`)
  );

  console.log(`\nRows in csv:            ${csvRows.length}`);
  console.log(`Books selected to add:  ${books.length}`);
  console.log(`  with description:     ${withDesc}`);
  console.log(`Books in table now:     ${before.rows[0].n}`);
  console.log(`Books after adding:     ${before.rows[0].n + books.length}\n`);

  console.log("Examples:");
  books.slice(0, 3).forEach((b) => {
    console.log(`  - [goodbooks ${b.goodbooks_id}] ${b.title} | ${b.authors.join(", ")}`);
    console.log(`    categories:       ${b.categories.join(", ")}`);
    console.log(`    goodreads_genres: ${b.goodreads_genres.join(", ")}`);
    console.log(`    isbn_10: ${b.isbn_10}  isbn_13: ${b.isbn_13}  pages: ${b.page_count}`);
    console.log(`    description: ${(b.description || "").slice(0, 90)}...`);
  });

  if (!APPLY) {
    console.log("\nDRY RUN - nothing was changed. Run again with --apply to insert.");
    await pool.end();
    return;
  }

  console.log("\nInserting...");
  const inserted = await insertAll(books, csvRows, missedLinks);
  console.log(`\nDone. Inserted ${inserted} books. Now run: node embed-books.js`);
  await pool.end();
}

main().catch(async (err) => {
  console.error("Fatal error:", err.message);
  await pool.end();
  process.exit(1);
});