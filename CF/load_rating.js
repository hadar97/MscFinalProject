/**
 * Loads goodbooks-10k ratings into the table `dataset_ratings`, for CF.
 *
 * - Each rating in ratings.csv points to a goodbooks book_id. It is mapped to
 *   books.id through books.goodbooks_id. Ratings of books that are not in the
 *   books table (non-English, deleted as wrongly enriched...) are skipped.
 * - dataset_ratings is ONLY the training data from goodbooks. Ratings of real
 *   app users belong in a separate table (so the ids never collide).
 * - The full file is ~5.9M ratings (~470MB in Postgres). That can be too big
 *   for a small Neon plan, so --users N loads a random sample of N users
 *   (all ratings of each chosen user). The sample is the same on every run.
 *
 * Default is a DRY RUN: reads the file, prints statistics and the estimated
 * size, changes nothing.
 *
 * Run:
 *   node load-ratings.js ./data/ratings.csv                       dry run, all users
 *   node load-ratings.js ./data/ratings.csv --users 15000         dry run, sample
 *   node load-ratings.js ./data/ratings.csv --users 15000 --apply load the sample
 *
 * Safe to re-run: existing (user, book) pairs are skipped.
 */

const fs = require("fs");
const readline = require("readline");
const { Pool } = require("pg");
require("dotenv").config();

const CSV_PATH = process.argv.find((a) => a.endsWith(".csv")) || "./data/ratings.csv";
const APPLY = process.argv.includes("--apply");
const usersArg = process.argv.indexOf("--users");
const SAMPLE_USERS = usersArg > -1 ? parseInt(process.argv[usersArg + 1], 10) : null;
const BATCH_SIZE = 20000;
const BYTES_PER_ROW = 80; // table row + primary key + book_id index, roughly
const SEED = 42;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Reads ratings.csv line by line (6M lines - no need to hold the text in memory).
// Finds the columns by the header, so both the GitHub and the Kaggle versions work.
async function forEachRating(onRating) {
  if (!fs.existsSync(CSV_PATH)) throw new Error(`File not found: ${CSV_PATH}`);
  const rl = readline.createInterface({ input: fs.createReadStream(CSV_PATH) });
  let cols = null;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const parts = line.replace(/^﻿/, "").split(",");
    if (!cols) {
      cols = {
        user: parts.indexOf("user_id"),
        book: parts.indexOf("book_id"),
        rating: parts.indexOf("rating"),
      };
      if (cols.user < 0 || cols.book < 0 || cols.rating < 0) {
        throw new Error(`Unexpected header: ${line}`);
      }
      continue;
    }
    await onRating(
      parseInt(parts[cols.user], 10),
      parseInt(parts[cols.book], 10),
      parseInt(parts[cols.rating], 10)
    );
  }
}

// Small seeded random generator, so the user sample is the same on every run
function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function pickUsers(userIds, n) {
  const ids = [...userIds].sort((a, b) => a - b);
  if (!n || n >= ids.length) return new Set(ids);
  const rand = seededRandom(SEED);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return new Set(ids.slice(0, n));
}

async function createTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dataset_ratings (
      user_id INT NOT NULL,                                        -- goodbooks user id
      book_id INT NOT NULL REFERENCES books(id) ON DELETE CASCADE, -- books.id
      rating  SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
      PRIMARY KEY (user_id, book_id)
    );`);
}

async function insertBatch(users, books, ratings) {
  const res = await pool.query(
    `INSERT INTO dataset_ratings (user_id, book_id, rating)
     SELECT * FROM unnest($1::int[], $2::int[], $3::smallint[])
     ON CONFLICT DO NOTHING;`,
    [users, books, ratings]
  );
  return res.rowCount;
}

function mb(rows) {
  return Math.round((rows * BYTES_PER_ROW) / 1024 / 1024);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Missing DATABASE_URL in .env file");
    process.exit(1);
  }

  // goodbooks id -> books.id
  const { rows } = await pool.query(
    `SELECT id, goodbooks_id FROM books WHERE goodbooks_id IS NOT NULL;`
  );
  const bookMap = new Map(rows.map((r) => [r.goodbooks_id, r.id]));
  console.log(`Books with ratings possible (goodbooks_id set): ${bookMap.size}`);

  // Pass 1: statistics
  console.log(`Reading ${CSV_PATH} (pass 1: statistics)...`);
  let total = 0;
  let kept = 0;
  const perUser = new Map();
  await forEachRating((u, b) => {
    total++;
    if (!bookMap.has(b)) return;
    kept++;
    perUser.set(u, (perUser.get(u) || 0) + 1);
  });

  const chosen = pickUsers(perUser.keys(), SAMPLE_USERS);
  let chosenRatings = 0;
  for (const u of chosen) chosenRatings += perUser.get(u);

  console.log("\n================ RATINGS ================");
  console.log(`Ratings in file:                 ${total.toLocaleString()}`);
  console.log(`  on books in your table:        ${kept.toLocaleString()}  (~${mb(kept)} MB)`);
  console.log(`Users:                           ${perUser.size.toLocaleString()}`);
  console.log(`Users to load:                   ${chosen.size.toLocaleString()}${SAMPLE_USERS ? " (random sample)" : " (all)"}`);
  console.log(`Ratings to load:                 ${chosenRatings.toLocaleString()}  (~${mb(chosenRatings)} MB)`);
  console.log("=========================================");

  if (!APPLY) {
    console.log("\nDRY RUN - nothing was changed.");
    console.log("Check your storage limit in the Neon dashboard. To load fewer ratings, add --users <N>.");
    await pool.end();
    return;
  }

  // Pass 2: load
  await createTable();
  console.log("\nLoading (pass 2)...");
  let users = [], books = [], ratings = [];
  let inserted = 0;
  const flush = async () => {
    if (!users.length) return;
    const [u, b, r] = [users, books, ratings];
    users = []; books = []; ratings = [];
    inserted += await insertBatch(u, b, r);
    console.log(`  inserted ${inserted.toLocaleString()} / ${chosenRatings.toLocaleString()}`);
  };

  await forEachRating(async (u, b, r) => {
    if (!chosen.has(u)) return;
    const bookId = bookMap.get(b);
    if (!bookId) return;
    users.push(u); books.push(bookId); ratings.push(r);
    if (users.length >= BATCH_SIZE) await flush();
  });
  await flush();

  await pool.query(`CREATE INDEX IF NOT EXISTS dataset_ratings_book_idx ON dataset_ratings (book_id);`);

  // Summary for the report
  const { rows: s } = await pool.query(`
    SELECT count(*)::int AS ratings,
           count(DISTINCT user_id)::int AS users,
           count(DISTINCT book_id)::int AS books,
           round(avg(rating), 2) AS avg_rating
    FROM dataset_ratings;`);
  const st = s[0];
  const density = (st.ratings / (st.users * st.books)) * 100;
  console.log("\n================ LOADED ================");
  console.log(`Ratings:  ${st.ratings.toLocaleString()}`);
  console.log(`Users:    ${st.users.toLocaleString()}`);
  console.log(`Books:    ${st.books.toLocaleString()}`);
  console.log(`Average rating: ${st.avg_rating}`);
  console.log(`Matrix density: ${density.toFixed(2)}%  (sparsity ${(100 - density).toFixed(2)}%)`);
  console.log("========================================");
  await pool.end();
}

main().catch(async (err) => {
  console.error("Fatal error:", err.message);
  await pool.end();
  process.exit(1);
});