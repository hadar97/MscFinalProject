/**
 * user_consents - what each user agreed to, and when (Terms, Privacy Policy,
 * age, optional research use). One row per decision, never updated: the
 * latest row of each type is the user's current choice, the older rows are
 * the history (proof of what was agreed, to which version, when).
 *
 *   consent_type  terms | privacy | age_16 | research
 *   version       the policy version agreed to (server/consents.js), e.g. '2026-10-25'
 *   granted       true = agreed, false = declined / withdrew (research can be withdrawn)
 *   source        signup | consent_page | account
 *
 * When a policy changes, its version goes up in server/consents.js and users
 * are asked to agree again (the website's ConsentGate).
 * No IP address or browser details are stored (data minimization).
 * Deleting an account deletes its rows (ON DELETE CASCADE, like the other user tables).
 *
 * Only CREATES a new table; does not touch any existing table. Safe to run again.
 * Run:  node db/create-consent-table.js
 */

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const SQL = `
CREATE TABLE IF NOT EXISTS user_consents (
  id            bigserial PRIMARY KEY,
  user_id       int     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  consent_type  text    NOT NULL CHECK (consent_type IN ('terms', 'privacy', 'age_16', 'research')),
  version       text    NOT NULL,
  granted       boolean NOT NULL,
  source        text    NOT NULL DEFAULT 'consent_page' CHECK (source IN ('signup', 'consent_page', 'account')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_consents_latest_idx ON user_consents (user_id, consent_type, created_at DESC);
`;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Missing DATABASE_URL in .env file");
  const { rows: u } = await pool.query(`SELECT to_regclass('public.users') AS t;`);
  if (!u[0].t) throw new Error("users table not found - run db/create-user-tables.js first");
  await pool.query(SQL);
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM user_consents;`);
  console.log(`user_consents is ready (${rows[0].n} rows).`);
}

main()
  .catch((err) => {
    console.error("Error:", err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
