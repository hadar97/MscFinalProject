/**
 * Compute sentence embeddings for books, for CBF (Content-Based Filtering)
 *
 * Uses all-MiniLM-L6-v2 (384 dims) via @xenova/transformers - runs locally
 * in Node, no external API needed. Stores the vector in a pgvector column on
 * the books table in Neon.
 *
 * Two text versions:
 *   v1 - title + description                      (the original)
 *   v2 - title + genres + description             (as in the proposal:
 *        "title, description, genre"). Genres = the `categories` column ONLY:
 *        for 10K books it holds the Goodreads genres already translated to
 *        Google's categories (GENRE_TO_GOOGLE in build-books.js), so Google
 *        books and 10K books are described with the SAME words. The raw
 *        goodreads_genres are NOT used - Google books do not have them, and
 *        extra words on one side only would push the two sources apart.
 *        The genres come BEFORE the description so they are never cut off.
 *        RESULT: slightly WORSE than v1 (Google categories are too general -
 *        almost every novel got "Fiction, Young Adult Fiction").
 *   v3 - title + genres + description, where genres = goodreads_genres when
 *        the book has them (10K books: specific - fantasy, mystery...),
 *        otherwise `categories` (Google books). Hyphens become spaces
 *        ("young-adult" -> "young adult").
 *
 * Safe testing: v2/v3 is written to a NEW column (embedding_v2), so the current
 * `embedding` column - which the app and content_similarity use - is not
 * touched. evaluate.js --emb embedding_v2 compares the two. Only if v2 wins,
 * we switch (see the message for the SQL).
 *
 * Runs only on books whose column is still empty, so it can be stopped and
 * started again.
 *
 * Run:
 *   node CBF/embed-books.js                                   new books, v1, into `embedding`
 *   node CBF/embed-books.js --column embedding_v2 --text v2   test version with genres
 *   node CBF/embed-books.js --column embedding_v3 --text v3   test version with 10K genres
 *   node CBF/embed-books.js --column embedding_v2 --text v2 --preview 5
 *                                       only print the text of 5 books, nothing saved
 */

const { Pool } = require("pg");
require("dotenv").config();

const BATCH_SIZE = 50;
const DEFAULT_TEXT = "v1"; // after switching to v2, change this to "v2" so new books match

function strArg(name, def) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : def;
}
const COLUMN = strArg("--column", "embedding");
const TEXT_VERSION = strArg("--text", DEFAULT_TEXT);
const PREVIEW = Number(strArg("--preview", 0));

if (!/^[a-z_][a-z0-9_]*$/.test(COLUMN)) {
  console.error(`Bad column name: ${COLUMN}`);
  process.exit(1);
}
if (!["v1", "v2", "v3"].includes(TEXT_VERSION)) {
  console.error(`--text must be v1, v2 or v3`);
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function ensureVectorSetup() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector;`);
  await pool.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS ${COLUMN} vector(384);`);
}

async function getBooksNeedingEmbedding(limit) {
  const result = await pool.query(
    `SELECT id, title, description, categories, goodreads_genres
     FROM books
     WHERE ${COLUMN} IS NULL
     ORDER BY id
     LIMIT $1;`,
    [limit]
  );
  return result.rows;
}

// Genres, without duplicates (case-insensitive), in order.
//   v2: `categories` (Google's vocabulary, for all books)
//   v3: goodreads_genres if the book has any (10K books), else `categories`
function genresOf(book) {
  const goodreads = book.goodreads_genres || [];
  const source = TEXT_VERSION === "v3" && goodreads.length ? goodreads : book.categories || [];
  const seen = new Set();
  const out = [];
  for (const g of source) {
    const clean = String(g || "").replace(/-/g, " ").trim();
    const key = clean.toLowerCase();
    if (clean && !seen.has(key)) {
      seen.add(key);
      out.push(clean);
    }
  }
  return out;
}

function buildText(book) {
  const desc = book.description ? book.description.slice(0, 1000) : "";
  if (TEXT_VERSION === "v1") return desc ? book.title + ". " + desc : book.title;

  const genres = genresOf(book);
  let text = book.title + ".";
  if (genres.length) text += " Genres: " + genres.join(", ") + ".";
  if (desc) text += " " + desc;
  return text;
}

function toVectorLiteral(floatArray) {
  return "[" + Array.from(floatArray).join(",") + "]";
}

// One UPDATE per batch instead of one per book (much faster on Neon)
async function saveEmbeddings(ids, vectors) {
  await pool.query(
    `UPDATE books b SET ${COLUMN} = v.vec::vector
     FROM unnest($1::int[], $2::text[]) AS v(id, vec)
     WHERE b.id = v.id;`,
    [ids, vectors]
  );
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Missing DATABASE_URL in .env file");
    process.exit(1);
  }
  console.log(`Column: ${COLUMN}, text version: ${TEXT_VERSION}`);

  if (PREVIEW) {
    // Show the exact text that would be embedded - nothing is saved
    const { rows } = await pool.query(
      `(SELECT id, title, description, categories, goodreads_genres FROM books
        WHERE goodbooks_id IS NOT NULL ORDER BY id LIMIT $1)
       UNION ALL
       (SELECT id, title, description, categories, goodreads_genres FROM books
        WHERE goodbooks_id IS NULL ORDER BY id LIMIT $1);`,
      [PREVIEW]
    );
    for (const b of rows) console.log(`\n[${b.id}] ${buildText(b).slice(0, 300)}...`);
    await pool.end();
    return;
  }

  console.log("Loading embeddings model (first run downloads it - may take a while)...");
  const { pipeline } = await import("@xenova/transformers");
  const extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");

  await ensureVectorSetup();
  const { rows: todo } = await pool.query(`SELECT count(*)::int AS n FROM books WHERE ${COLUMN} IS NULL;`);
  console.log(`Books to embed: ${todo[0].n}`);

  let totalProcessed = 0;
  const t0 = Date.now();

  while (true) {
    const books = await getBooksNeedingEmbedding(BATCH_SIZE);
    if (books.length === 0) break;

    const ids = [];
    const vectors = [];
    for (const book of books) {
      const output = await extractor(buildText(book), { pooling: "mean", normalize: true });
      ids.push(book.id);
      vectors.push(toVectorLiteral(output.data));
    }
    await saveEmbeddings(ids, vectors);
    totalProcessed += books.length;

    const sec = (Date.now() - t0) / 1000;
    const left = Math.round(((todo[0].n - totalProcessed) * sec) / totalProcessed / 60);
    console.log(`Processed ${totalProcessed} / ${todo[0].n} books (about ${left} min left)...`);
  }

  console.log(`\nDone. Computed embeddings for ${totalProcessed} books into ${COLUMN}.`);
  await pool.end();
}

main().catch(async (err) => {
  console.error("Fatal error:", err);
  await pool.end();
  process.exit(1);
});