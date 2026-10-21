/**
 * What is in the database right now? (READ-ONLY - changes nothing)
 *
 * Lists every table with its size, approximate row count and columns, so we
 * can design the users tables without clashing with existing tables
 * (including Hadar's).
 *
 * Uses only the database's own catalog - almost no network transfer.
 *
 * Run:  node db/list-tables.js
 */

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const { rows: tables } = await pool.query(
    `SELECT c.relname AS table,
            pg_size_pretty(pg_total_relation_size(c.oid)) AS size,
            greatest(c.reltuples, 0)::bigint AS approx_rows
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'r' AND n.nspname = 'public'
     ORDER BY pg_total_relation_size(c.oid) DESC;`
  );
  const { rows: cols } = await pool.query(
    `SELECT table_name, string_agg(column_name || ' ' || data_type, ', ' ORDER BY ordinal_position) AS columns
     FROM information_schema.columns WHERE table_schema = 'public'
     GROUP BY table_name;`
  );
  const colsOf = new Map(cols.map((c) => [c.table_name, c.columns]));
  const { rows: db } = await pool.query(`SELECT pg_size_pretty(pg_database_size(current_database())) AS size;`);

  console.log(`Database size: ${db[0].size}\n`);
  for (const t of tables) {
    console.log(`${t.table}  (${t.size}, ~${Number(t.approx_rows).toLocaleString()} rows)`);
    console.log(`    ${colsOf.get(t.table) || ""}`);
  }
}

main()
  .catch((err) => {
    console.error("Error:", err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
