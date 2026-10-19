/**
 * Trains the ALS model on ALL ratings (dataset_ratings) and saves it:
 *   als_item_factors(book_id, factors vector(128))  - one vector per rated book
 *   als_model(...)                                   - settings + Y^T Y, needed to
 *                                                      compute a new user's vector
 *
 * The hybrid recommender reads these tables. Settings were chosen on the
 * validation set (evaluate.js, 2,000 users): 128 factors, alpha 10, lambda 0.1.
 *
 * Re-run after loading more ratings. Replaces both tables (only these two).
 * Takes a few minutes (10 iterations).
 *
 * Run:
 *   node CF/train-als.js
 *   node CF/train-als.js --factors 64 --alpha 5     (other settings)
 */

const { Pool } = require("pg");
require("dotenv").config();
const { DEFAULTS, trainALS, gram, toVectorLiteral } = require("./als");

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i > -1 ? Number(process.argv[i + 1]) : def;
}
const OPTS = {
  factors: arg("--factors", DEFAULTS.factors),
  alpha: arg("--alpha", DEFAULTS.alpha),
  reg: arg("--reg", DEFAULTS.reg),
  iters: arg("--iters", DEFAULTS.iters),
};
const PAGE = 200000;
const BATCH = 500;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
pool.on("error", (err) => console.warn(`(database connection closed: ${err.message} - ignored)`));

async function loadRatings() {
  const rows = [];
  let lastUser = -1, lastBook = -1;
  for (;;) {
    const { rows: page } = await pool.query({
      text: `SELECT user_id, book_id, rating FROM dataset_ratings
             WHERE (user_id, book_id) > ($1, $2)
             ORDER BY user_id, book_id LIMIT $3;`,
      values: [lastUser, lastBook, PAGE],
      rowMode: "array",
    });
    if (!page.length) break;
    for (const r of page) rows.push(r);
    [lastUser, lastBook] = page[page.length - 1];
    console.log(`  read ${rows.length.toLocaleString()} ratings...`);
  }
  return rows;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Missing DATABASE_URL in .env file");
    process.exit(1);
  }
  const t0 = Date.now();
  console.log(`ALS settings: ${OPTS.factors} factors, alpha ${OPTS.alpha}, lambda ${OPTS.reg}, ${OPTS.iters} iterations`);
  console.log("Reading ratings...");
  const ratings = await loadRatings();

  const userIds = [...new Set(ratings.map((r) => r[0]))];
  const bookIds = [...new Set(ratings.map((r) => r[1]))];
  const uIndex = new Map(userIds.map((id, i) => [id, i]));
  const bIndex = new Map(bookIds.map((id, i) => [id, i]));
  const uIdx = Int32Array.from(ratings, (r) => uIndex.get(r[0]));
  const bIdx = Int32Array.from(ratings, (r) => bIndex.get(r[1]));
  const vals = Float32Array.from(ratings, (r) => r[2]);
  console.log(`${userIds.length.toLocaleString()} users, ${bookIds.length.toLocaleString()} books`);

  console.log("Training (the database is not used during training)...");
  const { Y, f } = trainALS(uIdx, bIdx, vals, userIds.length, bookIds.length, {
    ...OPTS,
    onIteration: (it, ms) => console.log(`  iteration ${it}/${OPTS.iters} (${Math.round(ms / 1000)}s)`),
  });
  const YtY = gram(Y, bookIds.length, f);

  console.log("Saving...");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DROP TABLE IF EXISTS als_item_factors;`);
    await client.query(`DROP TABLE IF EXISTS als_model;`);
    await client.query(`
      CREATE TABLE als_item_factors (
        book_id INT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
        factors vector(${f}) NOT NULL
      );`);
    await client.query(`
      CREATE TABLE als_model (
        id INT PRIMARY KEY DEFAULT 1,
        factors INT NOT NULL,
        alpha REAL NOT NULL,
        reg REAL NOT NULL,
        iterations INT NOT NULL,
        users INT NOT NULL,
        yty DOUBLE PRECISION[] NOT NULL,     -- Y^T Y, f x f, row by row
        trained_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );`);
    for (let s = 0; s < bookIds.length; s += BATCH) {
      const ids = bookIds.slice(s, s + BATCH);
      const vecs = ids.map((_, k) => toVectorLiteral(Y.subarray((s + k) * f, (s + k + 1) * f)));
      await client.query(
        `INSERT INTO als_item_factors (book_id, factors)
         SELECT id, v::vector FROM unnest($1::int[], $2::text[]) AS t(id, v);`,
        [ids, vecs]
      );
    }
    await client.query(
      `INSERT INTO als_model (factors, alpha, reg, iterations, users, yty) VALUES ($1, $2, $3, $4, $5, $6);`,
      [f, OPTS.alpha, OPTS.reg, OPTS.iters, userIds.length, Array.from(YtY)]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // Sanity check: the books closest to Harry Potter 1 by ALS vectors
  const { rows: hp } = await pool.query(
    `WITH q AS (SELECT a.factors FROM als_item_factors a JOIN books b ON b.id = a.book_id
                WHERE b.title = 'Harry Potter and the Sorcerer''s Stone' AND b.goodbooks_id IS NOT NULL LIMIT 1)
     SELECT b.title FROM als_item_factors a JOIN books b ON b.id = a.book_id, q
     ORDER BY a.factors <=> q.factors LIMIT 6;`
  );
  if (hp.length) {
    console.log("Check - closest books to Harry Potter 1 (by ALS):");
    hp.forEach((r, i) => console.log(`  ${i + 1}. ${r.title}`));
  }
  console.log(`Saved ${bookIds.length.toLocaleString()} book vectors. Done in ${Math.round((Date.now() - t0) / 1000)}s.`);
  await pool.end();
}

main().catch(async (err) => {
  console.error("Fatal error:", err);
  await pool.end();
  process.exit(1);
});
