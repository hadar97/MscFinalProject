/**
 * Is Neon Auth set up in this database, and which version? (READ-ONLY)
 *
 * Neon Auth keeps its users in a separate schema called neon_auth.
 *   new version (Managed Better Auth): tables like neon_auth."user", "session", "account"
 *   old version (Stack Auth):          neon_auth.users_sync
 * This prints the tables and columns of that schema (no user data), so the
 * app's users table can link to the right table and id type.
 *
 * Run:  node db/check-neon-auth.js
 */

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const { rows: schemas } = await pool.query(
    `SELECT schema_name FROM information_schema.schemata
     WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND schema_name NOT LIKE 'pg_temp%'
     ORDER BY schema_name;`
  );
  console.log(`Schemas: ${schemas.map((s) => s.schema_name).join(", ")}\n`);

  const { rows: cols } = await pool.query(
    `SELECT table_name, string_agg(column_name || ' ' || data_type, ', ' ORDER BY ordinal_position) AS columns
     FROM information_schema.columns WHERE table_schema = 'neon_auth'
     GROUP BY table_name ORDER BY table_name;`
  );
  if (!cols.length) {
    console.log("No neon_auth schema / tables - Neon Auth is not set up in this database (or on this branch).");
    return;
  }
  const { rows: counts } = await pool.query(
    `SELECT relname AS table_name, greatest(reltuples, 0)::bigint AS approx_rows
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'neon_auth' AND c.relkind = 'r';`
  );
  const countOf = new Map(counts.map((c) => [c.table_name, c.approx_rows]));
  console.log("neon_auth tables:");
  for (const c of cols) {
    console.log(`  ${c.table_name}  (~${countOf.get(c.table_name) ?? 0} rows)`);
    console.log(`      ${c.columns}`);
  }
  const version = cols.some((c) => c.table_name === "users_sync")
    ? "OLD version (Stack Auth - users_sync)"
    : cols.some((c) => c.table_name === "user")
    ? "NEW version (Managed Better Auth - neon_auth.\"user\")"
    : "unknown - send this output";
  console.log(`\nLooks like: ${version}`);
}

main()
  .catch((err) => {
    console.error("Error:", err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
