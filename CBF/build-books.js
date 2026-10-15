/**
 * Builds the combined `books` table:
 *   - ALL English goodbooks-10k books (from books_enriched.csv) -> WITH ratings
 *   - Google books ONLY from genres that goodbooks-10k lacks      -> WITHOUT ratings
 *
 * Source of the goodbooks data: books_enriched.csv from goodbooks-10k-extended
 *   https://github.com/malcolmosh/goodbooks-10k-extended
 *
 * Google books that are kept:
 *   - have at least one category in KEEP_GOOGLE_CATEGORIES, AND
 *   - are NOT also a goodbooks book. Same book =
 *       1. same ISBN-10 or ISBN-13, or
 *       2. exactly the same title AND the same author (see titleKey and
 *          authorsMatch: "J.R.R. Tolkien" == "John Ronald Reuel Tolkien").
 *     If a book is in both, the goodbooks version is used (it has ratings).
 * All other Google books stay only in google_books.
 *
 * Columns of the goodbooks rows (same columns as the Google rows):
 *   description      <- description
 *   categories       <- genres mapped to Google's categories (GENRE_TO_GOOGLE)
 *   goodreads_genres <- original genres, unchanged (NULL for Google rows)
 *   authors          <- Google's style ("J.K. Rowling" -> "J. K. Rowling")
 *   google_id        <- "gr:<goodreads id>" (column is NOT NULL)
 *   search_term      <- "goodbooks-10k"
 *   goodbooks_id     <- book_id, the key ratings.csv uses (NULL for Google rows)
 *
 * Tables after --apply:
 *   google_books - the current Google table, renamed and NOT changed (all 6,908)
 *   books        - the new combined table that every model uses
 *
 * Default is a DRY RUN: prints the plan, writes data/build-review.csv, changes
 * nothing. With --apply everything happens in ONE transaction: if anything
 * fails, nothing changes. Re-running --apply rebuilds books from google_books.
 * Afterwards run: node embed-books.js (only the goodbooks books need it -
 * the Google books keep their embeddings).
 *
 * Run:
 *   node build-books.js ./data/books_enriched.csv
 *   node build-books.js ./data/books_enriched.csv --apply
 */

const fs = require("fs");
const { parse } = require("csv-parse");
const { Pool } = require("pg");
require("dotenv").config();

const CSV_PATH = process.argv.find((a) => a.endsWith(".csv")) || "./data/books_enriched.csv";
const APPLY = process.argv.includes("--apply");
const SOURCE_TAG = "goodbooks-10k";
const BATCH_SIZE = 200;
const REVIEW_PATH = "./data/build-review.csv";

// Google categories that goodbooks-10k (almost) does not have.
// Google books in these categories are kept, as the unrated books.
const KEEP_GOOGLE_CATEGORIES = [
  "Education", "Juvenile Fiction", "Medical", "Computers", "Architecture",
  "Drama", "Literary Criticism", "Mathematics", "Law", "Family & Relationships",
  "Social Science", "Nature", "Language Arts & Disciplines", "Political Science",
  "Gardening", "Health & Fitness", "Juvenile Nonfiction", "Reference",
  "Photography", "Design", "Crafts & Hobbies", "True Crime",
  "Technology & Engineering", "Performing Arts", "Foreign Language Study",
];

// Goodreads genre -> the category Google Books uses (top-level BISAC subjects)
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
  "gay-and-lesbian": "Social Science",
  "nonfiction": null,
  "books": null,
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

function genresToCategories(genres) {
  const out = [];
  for (const g of genres) {
    const c = GENRE_TO_GOOGLE[g];
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

// "J.K. Rowling" -> "J. K. Rowling" (Google's style; the CBF bonus compares exactly)
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

// The csv's isbn13 lost its last digit (stored as float) - compute it from ISBN-10
function isbn10to13(isbn10) {
  if (!isbn10) return null;
  const core = "978" + isbn10.slice(0, 9);
  const sum = [...core].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return core + ((10 - (sum % 10)) % 10);
}

function isEnglish(code) {
  return !code || code.startsWith("en");
}

// Removes accents: "Émile" -> "Emile"
function stripAccents(s) {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// TITLE must be the same. Only these differences are ignored:
//   - upper/lower case and extra spaces
//   - curly vs straight quotes (’ vs ')
//   - the "(...)" at the end, e.g. Goodreads' "(The Hunger Games, #1)"
// Everything else (words, commas, subtitles) must be identical.
function titleKey(title) {
  return stripAccents(cleanTitle(title))
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

// "J.R.R. Tolkien" -> { given: ["j.", "r.", "r."], last: "tolkien" }
// A given name ending in "." is an initial. Spaces are ignored ("J.R.R." = "J. R. R.").
function splitName(name) {
  const tokens = stripAccents(name)
    .toLowerCase()
    .replace(/\./g, ". ")
    .replace(/[^a-z.\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return { given: tokens.slice(0, -1), last: tokens[tokens.length - 1] || "" };
}

const isInitial = (t) => /^[a-z]\.$/.test(t);

// AUTHOR is the same when:
//   - the full names are identical (ignoring case, spaces and dots), OR
//   - the last name is identical, there are the same number of given names,
//     and each given name matches: two full names must be identical, and an
//     initial ("J.") must be the first letter of the other name ("John").
//   "J.R.R. Tolkien" == "John Ronald Reuel Tolkien"   (J=John, R=Ronald, R=Reuel)
//   "Robert A. Heinlein" == "Robert Anson Heinlein"
//   "Stuart Moore" != "Alan Moore"   (Stuart != Alan)
//   "Dean Koontz" != "Dean Ray Koontz"   (different number of given names)
function authorsMatch(a, b) {
  const flat = (s) => stripAccents(s).toLowerCase().replace(/[^a-z]/g, "");
  if (flat(a) && flat(a) === flat(b)) return true;

  const x = splitName(a);
  const y = splitName(b);
  if (!x.last || x.last !== y.last || x.given.length !== y.given.length) return false;

  return x.given.every((gx, i) => {
    const gy = y.given[i];
    if (isInitial(gx) || isInitial(gy)) return gx[0] === gy[0];
    return gx === gy;
  });
}

function buildRow(r) {
  const isbn10 = padIsbn10(r.isbn);
  const year = toInt(r.original_publication_year);
  const genres = parseList(r.genres);
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
    categories: genresToCategories(genres),
    average_rating: null,
    ratings_count: null,
    language: "en",
    thumbnail_url: r.image_url || null,
    goodbooks_id: toInt(r.book_id),
    goodreads_genres: genres,
    _rawTitle: r.title,
    _rawAuthor: parseList(r.authors)[0] || "",
  };
}

async function readCsv() {
  if (!fs.existsSync(CSV_PATH)) throw new Error(`File not found: ${CSV_PATH}`);
  const rows = [];
  const parser = fs
    .createReadStream(CSV_PATH)
    .pipe(parse({ columns: true, bom: true, relax_quotes: true }));
  for await (const r of parser) rows.push(r);
  return rows;
}

async function tableExists(name) {
  const { rows } = await pool.query(`SELECT to_regclass($1) IS NOT NULL AS ok;`, [`public.${name}`]);
  return rows[0].ok;
}

// Before the build the Google books are in `books`; after it, in `google_books`
async function googleTableName() {
  return (await tableExists("google_books")) ? "google_books" : "books";
}

// ---------- the plan ----------

async function makePlan(csvRows) {
  const gbBooks = csvRows
    .filter((r) => isEnglish(r.language_code))
    .map(buildRow)
    .filter((b) => b.goodbooks_id && b.title && b.authors.length);

  // Lookup tables for "is this Google book also a goodbooks book?"
  const byIsbn = new Map();
  const byTitle = new Map(); // titleKey -> [goodbooks books with that exact title]
  for (const b of gbBooks) {
    if (b.isbn_10) {
      byIsbn.set(b.isbn_10, b);
      byIsbn.set(b.isbn_13, b);
    }
    const t = titleKey(b._rawTitle);
    if (!byTitle.has(t)) byTitle.set(t, []);
    byTitle.get(t).push(b);
  }

  const source = await googleTableName();
  const { rows: google } = await pool.query(
    `SELECT id, title, authors, categories, isbn_10, isbn_13 FROM ${source};`
  );

  const keep = [];
  const removeInGoodbooks = []; // { g, gb, by }
  const removeOtherGenre = [];

  for (const g of google) {
    const author = (g.authors || [])[0] || "";
    // 1. Same ISBN-10 or ISBN-13
    let gb = byIsbn.get(g.isbn_10) || byIsbn.get(g.isbn_13);
    let by = "isbn";
    // 2. Exactly the same title AND the same author (rules in authorsMatch)
    if (!gb) {
      const sameTitle = byTitle.get(titleKey(g.title)) || [];
      gb = sameTitle.find((b) => authorsMatch(author, b._rawAuthor)) || null;
      by = "title+author";
    }

    const inKeptGenre = (g.categories || []).some((c) => KEEP_GOOGLE_CATEGORIES.includes(c));

    if (gb) removeInGoodbooks.push({ g, gb, by });
    else if (inKeptGenre) keep.push(g);
    else removeOtherGenre.push(g);
  }

  return { gbBooks, keep, removeInGoodbooks, removeOtherGenre };
}

function writeReview(plan) {
  const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const lines = ["google_id_row,google_title,google_author,goodbooks_id,goodbooks_title,goodbooks_author,matched_by"];
  plan.removeInGoodbooks.forEach(({ g, gb, by }) =>
    lines.push([
      g.id, esc(g.title), esc((g.authors || [])[0]),
      gb.goodbooks_id, esc(gb._rawTitle), esc(gb._rawAuthor), by,
    ].join(","))
  );
  fs.mkdirSync("./data", { recursive: true });
  fs.writeFileSync(REVIEW_PATH, "﻿" + lines.join("\n"), "utf8");
}

// ---------- apply ----------

const COLUMNS = [
  "google_id", "title", "authors", "publisher", "published_date", "description",
  "isbn_10", "isbn_13", "page_count", "categories", "average_rating",
  "ratings_count", "language", "thumbnail_url", "search_term", "search_terms",
  "goodbooks_id", "goodreads_genres",
];

// Renames books -> google_books, together with its indexes, constraints and
// id sequence ("books_pkey" -> "google_books_pkey"...), so the names are free
// for the new `books` table. google_books itself is not changed in any way.
async function renameGoogleTable(client) {
  await client.query(`ALTER TABLE books RENAME TO google_books;`);

  const { rows: idx } = await client.query(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'google_books' AND indexname LIKE 'books%';`
  );
  for (const { indexname } of idx) {
    const newName = "google_" + indexname;
    // A constraint (primary key / unique) owns its index - rename via the constraint
    const { rows: con } = await client.query(
      `SELECT 1 FROM pg_constraint WHERE conname = $1 AND conrelid = 'google_books'::regclass;`,
      [indexname]
    );
    if (con.length) {
      await client.query(`ALTER TABLE google_books RENAME CONSTRAINT "${indexname}" TO "${newName}";`);
    } else {
      await client.query(`ALTER INDEX "${indexname}" RENAME TO "${newName}";`);
    }
  }

  const { rows: seq } = await client.query(
    `SELECT pg_get_serial_sequence('google_books', 'id') AS name;`
  );
  if (seq[0].name && seq[0].name.endsWith("books_id_seq")) {
    await client.query(`ALTER SEQUENCE ${seq[0].name} RENAME TO google_books_id_seq;`);
  }
  console.log("  renamed books -> google_books (with its indexes and sequence)");
}

async function apply(plan) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. books -> google_books (only on the first run)
    if (!(await tableExists("google_books"))) {
      await renameGoogleTable(client);
    } else if (await tableExists("books")) {
      // Re-run: google_books is the untouched source, books is rebuilt from it
      await client.query(`DROP TABLE books;`);
      console.log("  google_books already exists - rebuilding books from it");
    }

    // 2. The new books table: same columns as before + goodbooks_id, goodreads_genres
    await client.query(`
      CREATE TABLE books (
        id               SERIAL PRIMARY KEY,
        google_id        TEXT UNIQUE NOT NULL,
        title            TEXT NOT NULL,
        authors          TEXT[],
        publisher        TEXT,
        published_date   TEXT,
        description      TEXT,
        isbn_10          TEXT,
        isbn_13          TEXT,
        page_count       INTEGER,
        categories       TEXT[],
        average_rating   NUMERIC,
        ratings_count    INTEGER,
        language         TEXT,
        thumbnail_url    TEXT,
        search_term      TEXT,
        search_terms     TEXT[],
        created_at       TIMESTAMP DEFAULT NOW(),
        embedding        vector(384),
        goodbooks_id     INT UNIQUE,
        goodreads_genres TEXT[]
      );`);
    console.log("  created new books table");

    // 3. Copy the kept Google books, WITH their existing embeddings
    const keepIds = plan.keep.map((g) => g.id);
    const copied = await client.query(
      `INSERT INTO books (
         google_id, title, authors, publisher, published_date, description,
         isbn_10, isbn_13, page_count, categories, average_rating, ratings_count,
         language, thumbnail_url, search_term, search_terms, created_at, embedding)
       SELECT
         google_id, title, authors, publisher, published_date, description,
         isbn_10, isbn_13, page_count, categories, average_rating, ratings_count,
         language, thumbnail_url, search_term, search_terms, created_at, embedding
       FROM google_books
       WHERE id = ANY($1::int[]);`,
      [keepIds]
    );
    console.log(`  copied ${copied.rowCount} Google books (with embeddings)`);

    // 4. Insert the goodbooks books
    let inserted = 0;
    for (let i = 0; i < plan.gbBooks.length; i += BATCH_SIZE) {
      const batch = plan.gbBooks.slice(i, i + BATCH_SIZE);
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
    }
    console.log(`  inserted ${inserted} goodbooks books`);

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ---------- main ----------

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Missing DATABASE_URL in .env file");
    process.exit(1);
  }

  console.log(`Reading ${CSV_PATH}...`);
  const csvRows = await readCsv();
  const plan = await makePlan(csvRows);
  writeReview(plan);

  const googleTotal = plan.keep.length + plan.removeInGoodbooks.length + plan.removeOtherGenre.length;
  const withDesc = plan.gbBooks.filter((b) => b.description).length;

  console.log("\n================ PLAN ================");
  console.log(`Google books now:                       ${googleTotal}`);
  console.log(`  KEEP (genre missing in 10K, no ratings): ${plan.keep.length}`);
  console.log(`  remove - also in 10K (10K version used): ${plan.removeInGoodbooks.length}`);
  console.log(`  remove - genre already covered by 10K:   ${plan.removeOtherGenre.length}`);
  console.log(`goodbooks books to add (with ratings):  ${plan.gbBooks.length}  (${withDesc} with description)`);
  console.log(`TOTAL after build:                      ${plan.keep.length + plan.gbBooks.length}`);
  console.log("======================================");

  const counts = {};
  plan.keep.forEach((g) =>
    (g.categories || [])
      .filter((c) => KEEP_GOOGLE_CATEGORIES.includes(c))
      .forEach((c) => (counts[c] = (counts[c] || 0) + 1))
  );
  console.log("\nKept Google books by category:");
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([c, n]) => console.log(`  ${c.padEnd(28)} ${n}`));

  console.log(`\nGoogle books that are also in 10K were written to ${REVIEW_PATH}`);
  plan.removeInGoodbooks.slice(0, 5).forEach(({ g, gb, by }) =>
    console.log(`  - "${g.title}" (${(g.authors || [])[0]}) = goodbooks "${gb._rawTitle}" [${by}]`)
  );

  if (!APPLY) {
    console.log("\nDRY RUN - nothing was changed. Check the review file, then run again with --apply.");
    await pool.end();
    return;
  }

  console.log("\nApplying...");
  await apply(plan);
  const after = await pool.query(
    `SELECT count(*)::int AS total,
            count(goodbooks_id)::int AS with_ratings,
            count(*) FILTER (WHERE embedding IS NULL)::int AS need_embedding
     FROM books;`
  );
  const a = after.rows[0];
  console.log(`\nDone. books: ${a.total} total, ${a.with_ratings} with ratings, ${a.need_embedding} need embedding.`);
  console.log("Now run: node embed-books.js");
  await pool.end();
}

main().catch(async (err) => {
  console.error("Fatal error:", err.message);
  await pool.end();
  process.exit(1);
});