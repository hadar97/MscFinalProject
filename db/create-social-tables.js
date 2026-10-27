/**
 * The social layer, small version ("discussion around a book"):
 *
 *   book_reviews  - a written review, one per user per book. The stars come from
 *                   user_ratings (a review needs a rating - the same user and book).
 *   book_posts    - the book's discussion: posts, and replies to them
 *                   (parent_id = the post; one level of replies). An author of
 *                   the book can PIN one post to the top (pinned).
 *   author_books  - which books an author account wrote (users.user_type = 'author').
 *                   Their posts get an "Author" badge on those books, and they can pin.
 *                   Set by an admin script: db/make-author.js.
 *
 * Deleting a user deletes their reviews, posts and author links (ON DELETE CASCADE);
 * deleting a post deletes its replies.
 *
 * Only CREATES new tables; does not touch any existing table. Safe to run again.
 * Run:  node db/create-social-tables.js
 */

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const SQL = `
CREATE TABLE IF NOT EXISTS book_reviews (
  user_id     int  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id     int  NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  body        text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, book_id)
);
CREATE INDEX IF NOT EXISTS book_reviews_book_idx ON book_reviews (book_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS book_posts (
  id          bigserial PRIMARY KEY,
  book_id     int     NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id     int     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id   bigint  REFERENCES book_posts(id) ON DELETE CASCADE,   -- NULL = a post, else a reply to it
  body        text    NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  pinned      boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_id IS NULL OR NOT pinned)                             -- only posts can be pinned
);
CREATE INDEX IF NOT EXISTS book_posts_book_idx ON book_posts (book_id, parent_id, created_at);
CREATE INDEX IF NOT EXISTS book_posts_user_idx ON book_posts (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS author_books (
  user_id     int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id     int NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, book_id)
);
CREATE INDEX IF NOT EXISTS author_books_book_idx ON author_books (book_id);
`;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Missing DATABASE_URL in .env file");
  const { rows: u } = await pool.query(`SELECT to_regclass('public.users') AS t;`);
  if (!u[0].t) throw new Error("users table not found - run db/create-user-tables.js first");
  await pool.query(SQL);
  console.log("Tables ready: book_reviews, book_posts, author_books.");
}

main()
  .catch((err) => {
    console.error("Error:", err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
