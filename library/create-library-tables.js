/**
 * Creates the library tables and puts the real branches in them.
 *
 *   libraries          - real branches (name, city, address, lat/lng)
 *   library_inventory  - which book is in which branch, how many copies,
 *                        how many are on the shelf now. SIMULATED for now
 *                        (library/simulate-inventory.js), source = 'simulated'.
 *
 * Safe to run again: CREATE ... IF NOT EXISTS, and branches are upserted by
 * (name, city) - lat/lng that were already geocoded are kept.
 * Does not touch any other table.
 *
 * Run:  node library/create-library-tables.js
 * Then: node library/geocode-libraries.js
 */

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { LIBRARIES } = require("./libraries-data");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Missing DATABASE_URL in .env file");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS libraries (
      id           serial PRIMARY KEY,
      name         text NOT NULL,
      city         text NOT NULL,
      address      text,
      lat          double precision,
      lng          double precision,
      size         text NOT NULL DEFAULT 'medium' CHECK (size IN ('small', 'medium', 'large')),
      is_open      boolean NOT NULL DEFAULT true,
      source_url   text,
      geocoded_by  text,               -- 'nominatim' | 'manual' | null (not yet)
      updated_at   timestamptz NOT NULL DEFAULT now(),
      UNIQUE (name, city)
    );`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS library_inventory (
      library_id        int NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
      book_id           int NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      copies_total      smallint NOT NULL CHECK (copies_total > 0),
      copies_available  smallint NOT NULL CHECK (copies_available >= 0),
      source            text NOT NULL DEFAULT 'simulated',  -- 'simulated' | a real source later
      updated_at        timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (library_id, book_id),
      CHECK (copies_available <= copies_total)
    );`);
  // "where is this book?" - the question every recommendation asks
  await pool.query(`CREATE INDEX IF NOT EXISTS library_inventory_book_idx ON library_inventory (book_id);`);

  let added = 0;
  let updated = 0;
  for (const l of LIBRARIES) {
    const { rows } = await pool.query(
      `INSERT INTO libraries (name, city, address, size, is_open, source_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (name, city) DO UPDATE
         SET address = EXCLUDED.address, size = EXCLUDED.size, is_open = EXCLUDED.is_open,
             source_url = EXCLUDED.source_url, updated_at = now()
       RETURNING (xmax = 0) AS inserted;`,
      [l.name, l.city, l.address, l.size, l.isOpen !== false, l.source]
    );
    rows[0].inserted ? added++ : updated++;
  }

  const { rows: summary } = await pool.query(
    `SELECT city, count(*)::int AS branches, count(lat)::int AS with_location
     FROM libraries GROUP BY city ORDER BY city;`
  );
  console.log(`Libraries: ${added} added, ${updated} updated.`);
  console.table(summary);
  console.log("Next: node library/geocode-libraries.js");
}

main()
  .catch((err) => {
    console.error("Error:", err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
