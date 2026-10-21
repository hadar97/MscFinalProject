/**
 * App users - DRAFT, to agree on with Hadar before running.
 *
 *   users          - one row per person who signs up
 *   user_genres    - the genres chosen in the questionnaire (keys from onboarding/genres.js)
 *   user_ratings   - the user's own ratings (questionnaire + later in the app)
 *   user_events    - other signals the proposal mentions: saved, started, finished...
 *
 * Separate from dataset_ratings on purpose: dataset_ratings (goodbooks) is the
 * TRAINING data and stays fixed, so the offline evaluation stays reproducible;
 * user_ratings is what the app knows about its own users.
 *
 * Login: Neon Auth (email + password), already enabled in the Neon project.
 * Neon Auth keeps the account itself (email, password, sessions) in its own
 * schema, neon_auth (new version: Managed Better Auth, table neon_auth."user",
 * id uuid - checked with db/check-neon-auth.js). users here is the app
 * PROFILE, linked by auth_user_id. No passwords or emails in our tables; the
 * name and email are read from neon_auth."user" when needed.
 *
 * user_type / library_id - the proposal's three user types: readers, authors, and
 * librarians who update their library's catalog and availability.
 *
 * Location is NOT stored - the website sends it per request, only when the
 * user asks for nearby libraries (privacy).
 *
 * Safe to run again (CREATE ... IF NOT EXISTS). Creates only new tables;
 * does not touch any existing table.
 *
 * Decided 21/10/2026: Neon Auth with email + password; no chat
 * tables for now; saved/finished events are stored but not used by the model yet.
 *
 * Run:  node db/create-user-tables.js
 */

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const SQL = `
CREATE TABLE IF NOT EXISTS users (
  id             serial PRIMARY KEY,
  -- the account in Neon Auth (name, email, password live there);
  -- deleting the account deletes the profile and all its data
  auth_user_id   uuid NOT NULL UNIQUE REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
  user_type      text NOT NULL DEFAULT 'reader' CHECK (user_type IN ('reader', 'author', 'librarian')),
  library_id     int REFERENCES libraries(id),            -- librarians: the library they manage
  preferred_city text,                                  -- optional: 'Jerusalem' | 'Tel Aviv-Yafo'
  onboarded_at   timestamptz,                           -- when the questionnaire was completed
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (user_type <> 'librarian' OR library_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS user_genres (
  user_id    int  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  genre_key  text NOT NULL,                             -- e.g. 'fantasy' (checked by the server against genres.js)
  PRIMARY KEY (user_id, genre_key)
);

CREATE TABLE IF NOT EXISTS user_ratings (
  user_id     int      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id     int      NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  rating      smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  source      text     NOT NULL DEFAULT 'app' CHECK (source IN ('onboarding', 'app', 'chat')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, book_id)                        -- one rating per book; rating again = update
);

CREATE TABLE IF NOT EXISTS user_events (
  id          bigserial PRIMARY KEY,
  user_id     int  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id     int  NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN ('saved', 'unsaved', 'started', 'finished', 'dismissed', 'clicked')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_events_user_idx ON user_events (user_id, created_at DESC);
`;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Missing DATABASE_URL in .env file");
  const { rows: auth } = await pool.query(`SELECT to_regclass('neon_auth."user"') AS t;`);
  if (!auth[0].t) throw new Error('neon_auth."user" not found - is Neon Auth enabled on this branch? (node db/check-neon-auth.js)');
  await pool.query(SQL);
  const { rows } = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name IN ('users', 'user_genres', 'user_ratings', 'user_events')
     ORDER BY table_name;`
  );
  console.log(`Tables ready: ${rows.map((r) => r.table_name).join(", ")}`);
}

main()
  .catch((err) => {
    console.error("Error:", err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
