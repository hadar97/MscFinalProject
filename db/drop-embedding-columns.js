/**
 * Remove the TEST embedding columns that were measured and rejected
 * (CBF/compare-embeddings.js, 22/10/2026):
 *   embedding_v2  title + Google genres + description   - a little worse than v1
 *   embedding_v3  title + Goodreads genres + description - no difference
 *   embedding_v4  title + cleaned description            - no difference
 * The app uses `embedding` (v1) - it is NEVER touched by this script.
 *
 * Default is a DRY RUN: shows which columns exist and how much they take.
 *   node db/drop-embedding-columns.js            dry run
 *   node db/drop-embedding-columns.js --apply    drop them (cannot be undone -
 *                                                they can be re-created with embed-books.js)
 * Space: Postgres frees the space of a dropped column when rows are rewritten;
 * --apply also runs VACUUM FULL books (rewrites the table, a few seconds).
 */

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const TO_DROP = ["embedding_v2", "embedding_v3", "embedding_v4"];
const APPLY = process.argv.includes("--apply");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const { rows: cols } = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'books' AND column_name = ANY($1::text[]) ORDER BY column_name;`,
    [TO_DROP]
  );
  const existing = cols.map((c) => c.column_name);
  if (!existing.length) return console.log("Nothing to drop - none of these columns exist.");

  for (const c of existing) {
    const { rows } = await pool.query(`SELECT pg_size_pretty(sum(pg_column_size(${c}))::bigint) AS size FROM books;`);
    console.log(`  ${c.padEnd(14)} ${rows[0].size}`);
  }
  const { rows: before } = await pool.query(`SELECT pg_size_pretty(pg_total_relation_size('books')) AS s;`);
  console.log(`books table now: ${before[0].s}`);

  if (!APPLY) return console.log("\nDRY RUN - nothing dropped. Run again with --apply to drop them.");

  for (const c of existing) {
    if (!TO_DROP.includes(c) || c === "embedding") throw new Error(`refusing to drop ${c}`);
    await pool.query(`ALTER TABLE books DROP COLUMN IF EXISTS ${c};`);
    console.log(`Dropped ${c}`);
  }
  await pool.query(`VACUUM FULL books;`);
  const { rows: after } = await pool.query(`SELECT pg_size_pretty(pg_total_relation_size('books')) AS s;`);
  console.log(`books table after: ${after[0].s}`);
}

main()
  .catch((err) => {
    console.error("Error:", err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
