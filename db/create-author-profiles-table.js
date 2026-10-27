/**
 * author_profiles - the author's own page (/authors/<id>): the pen name, a short
 * bio and a website. One row per author account; the author edits it on the
 * Account page ("Your books").
 *
 * The pen name starts as the one in the author's first approved request (filled
 * in here for authors approved before this table existed, and by the admin page
 * when a request is approved). Deleting the user deletes the profile.
 *
 * Only CREATES a new table and fills it for existing authors. Safe to run again
 * (never overwrites a profile that exists).
 * Run:  node db/create-author-profiles-table.js
 */

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const SQL = `
CREATE TABLE IF NOT EXISTS author_profiles (
  user_id     int  PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  pen_name    text NOT NULL CHECK (length(pen_name) BETWEEN 1 AND 120),
  bio         text CHECK (bio IS NULL OR length(bio) <= 2000),
  website     text CHECK (website IS NULL OR length(website) <= 300),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
`;

// authors that already have books linked: pen name from their latest approved request
// (or the earliest request at all, for authors linked by the make-author script)
const BACKFILL = `
INSERT INTO author_profiles (user_id, pen_name)
SELECT DISTINCT ON (ab.user_id) ab.user_id, r.pen_name
FROM author_books ab
JOIN author_requests r ON r.user_id = ab.user_id
ORDER BY ab.user_id, (r.status = 'approved') DESC, r.decided_at DESC NULLS LAST, r.created_at
ON CONFLICT (user_id) DO NOTHING;
`;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Missing DATABASE_URL in .env file");
  const { rows } = await pool.query(`SELECT to_regclass('public.author_requests') AS t;`);
  if (!rows[0].t) throw new Error("author_requests not found - run db/create-author-requests-table.js first");
  await pool.query(SQL);
  const { rowCount } = await pool.query(BACKFILL);
  const { rows: missing } = await pool.query(
    `SELECT DISTINCT ab.user_id FROM author_books ab LEFT JOIN author_profiles p ON p.user_id = ab.user_id WHERE p.user_id IS NULL;`
  );
  console.log(`author_profiles is ready. Filled ${rowCount} profile(s) from approved requests.`);
  if (missing.length) console.log(`${missing.length} author(s) without a request - their page shows their account name until they set a pen name: users ${missing.map((m) => m.user_id).join(", ")}`);
}

main()
  .catch((err) => { console.error("Error:", err.message); process.exitCode = 1; })
  .finally(() => pool.end());
