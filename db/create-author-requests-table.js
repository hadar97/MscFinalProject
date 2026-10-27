/**
 * author_requests - "I am the author of these books" requests from the Account page.
 *
 *   status    pending -> approved | rejected   (decided by the project team with
 *             db/author-requests.js, after checking the person really is the author)
 *   pen_name  the name the author publishes under
 *   books     the books they say they wrote, as they typed them (titles / links)
 *   message   optional note to the team
 *   note      the team's answer, shown to the user (e.g. why it was rejected)
 *
 * At most ONE pending request per user. Approving makes the user an author
 * (users.user_type = 'author') and links the chosen books (author_books).
 * Deleting the user deletes their requests.
 *
 * Only CREATES a new table. Safe to run again.
 * Run:  node db/create-author-requests-table.js
 */

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const SQL = `
CREATE TABLE IF NOT EXISTS author_requests (
  id          bigserial PRIMARY KEY,
  user_id     int  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pen_name    text NOT NULL CHECK (length(pen_name) BETWEEN 1 AND 120),
  books       text NOT NULL CHECK (length(books) BETWEEN 1 AND 2000),
  message     text CHECK (message IS NULL OR length(message) <= 2000),
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS author_requests_one_pending ON author_requests (user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS author_requests_status_idx ON author_requests (status, created_at);
`;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Missing DATABASE_URL in .env file");
  const { rows } = await pool.query(`SELECT to_regclass('public.author_books') AS t;`);
  if (!rows[0].t) throw new Error("author_books not found - run db/create-social-tables.js first");
  await pool.query(SQL);
  console.log("author_requests is ready.");
}

main()
  .catch((err) => { console.error("Error:", err.message); process.exitCode = 1; })
  .finally(() => pool.end());
