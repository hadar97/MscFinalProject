/**
 * Builds the table `book_popularity`, used by the hybrid recommender:
 *   for every book that has ratings - how many ratings, and how many of them
 *   are 4-5 stars ("liked"). Popularity = liked_count.
 *
 * A book that is NOT in this table has no ratings at all (e.g. Google books).
 * The hybrid uses that to decide which books only CBF can judge.
 *
 * Re-run after loading more ratings (load_rating.js). It replaces the table.
 *
 * Run:
 *   node HYBRID/build-popularity.js
 */

const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Missing DATABASE_URL in .env file");
    process.exit(1);
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DROP TABLE IF EXISTS book_popularity;`);
    await client.query(`
      CREATE TABLE book_popularity AS
      SELECT book_id,
             count(*)::int                             AS ratings_count,
             count(*) FILTER (WHERE rating >= 4)::int  AS liked_count
      FROM dataset_ratings
      GROUP BY book_id;`);
    await client.query(`ALTER TABLE book_popularity ADD PRIMARY KEY (book_id);`);
    await client.query(`CREATE INDEX book_popularity_liked_idx ON book_popularity (liked_count DESC);`);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const { rows } = await pool.query(
    `SELECT count(*)::int AS books, max(liked_count)::int AS max_liked FROM book_popularity;`
  );
  const { rows: top } = await pool.query(
    `SELECT b.title, p.liked_count FROM book_popularity p JOIN books b ON b.id = p.book_id
     ORDER BY p.liked_count DESC LIMIT 5;`
  );
  console.log(`book_popularity: ${rows[0].books} books with ratings (max liked: ${rows[0].max_liked})`);
  console.log("Most liked:");
  top.forEach((r, i) => console.log(`  ${i + 1}. ${r.title} (${r.liked_count})`));
  await pool.end();
}

main().catch(async (err) => {
  console.error("Fatal error:", err.message);
  await pool.end();
  process.exit(1);
});
