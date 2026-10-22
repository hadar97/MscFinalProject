/**
 * Book series - "Harry Potter, #2" - for the books that have ratings.
 *
 * goodbooks-10k keeps the series inside the title:
 *     "Harry Potter and the Chamber of Secrets (Harry Potter, #2)"
 * build-books.js removed the part in brackets (clean titles on screen), so
 * this script reads it again from the same CSV and stores it in two new
 * columns of books:
 *     series_name    'Harry Potter'
 *     series_number  2          (can be 1.5; null when the title has no number)
 *
 * Used by the recommender to show ONE book per series (the next one the user
 * has not rated) instead of five Harry Potters.
 *
 * Only ADDS two columns and fills them, matched by goodbooks_id. Never deletes
 * rows. Reads the CSV from your computer, so it barely uses Neon's network quota.
 *
 * Default is a DRY RUN: prints how many series were found and examples.
 *   node db/add-series.js                     (dry run, ./data/books_enriched.csv)
 *   node db/add-series.js --apply             write to the database
 *   node db/add-series.js ./data/other.csv    another CSV path
 */

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { parse } = require("csv-parse");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const CSV_PATH = process.argv.find((a) => a.endsWith(".csv")) || "./data/books_enriched.csv";
const APPLY = process.argv.includes("--apply");
const BATCH = 2000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/**
 * "Title (Harry Potter, #2)"              -> { name: "Harry Potter", number: 2 }
 * "Title (Discworld, #2; Rincewind #2)"   -> { name: "Discworld", number: 2 }   (first series only)
 * "Title (The Dark Tower #1)"             -> { name: "The Dark Tower", number: 1 }
 * "Title (Some Series, #1-3)"             -> { name: "Some Series", number: null } (an omnibus)
 * "Title"                                 -> null
 */
function parseSeries(rawTitle) {
  const m = String(rawTitle || "").match(/\(([^()]*#[^()]*)\)\s*$/);
  if (!m) return null;
  const first = m[1].split(";")[0].trim();
  const s = first.match(/^(.*?),?\s*#\s*([\d.]+)?(.*)$/);
  if (!s || !s[1].trim()) return null;
  const name = s[1].trim();
  const rest = (s[3] || "").trim();
  const number = s[2] && !rest ? Number(s[2]) : null; // "#1-3" = omnibus -> no single number
  return { name, number: Number.isFinite(number) ? number : null };
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) throw new Error(`CSV not found: ${CSV_PATH}`);
  const rows = [];
  const parser = fs.createReadStream(CSV_PATH).pipe(parse({ columns: true, bom: true, relax_quotes: true }));
  for await (const r of parser) rows.push(r);

  const found = [];
  for (const r of rows) {
    const id = parseInt(r.book_id, 10);
    const s = parseSeries(r.title);
    if (Number.isInteger(id) && s) found.push({ goodbooksId: id, ...s, title: r.title });
  }
  const bySeries = new Map();
  for (const f of found) bySeries.set(f.name, (bySeries.get(f.name) || 0) + 1);
  const multi = [...bySeries.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);

  console.log(`CSV rows: ${rows.length}`);
  console.log(`Books with a series in the title: ${found.length} (${((found.length / rows.length) * 100).toFixed(1)}%)`);
  console.log(`Series with 2+ books in the catalog: ${multi.length}`);
  console.log("Largest series:", multi.slice(0, 10).map(([n, c]) => `${n} (${c})`).join(", "));
  console.log("Examples:");
  for (const f of found.slice(0, 6)) console.log(`  ${f.title}  ->  "${f.name}" #${f.number ?? "-"}`);

  if (!APPLY) {
    console.log("\nDRY RUN - nothing written. Run again with --apply to save.");
    return;
  }

  await pool.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS series_name text;`);
  await pool.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS series_number numeric;`);
  let updated = 0;
  for (let i = 0; i < found.length; i += BATCH) {
    const part = found.slice(i, i + BATCH);
    const res = await pool.query(
      `UPDATE books b SET series_name = t.name, series_number = t.num
       FROM unnest($1::int[], $2::text[], $3::numeric[]) AS t(gid, name, num)
       WHERE b.goodbooks_id = t.gid;`,
      [part.map((f) => f.goodbooksId), part.map((f) => f.name), part.map((f) => f.number)]
    );
    updated += res.rowCount;
  }
  await pool.query(`CREATE INDEX IF NOT EXISTS books_series_idx ON books (series_name) WHERE series_name IS NOT NULL;`);
  console.log(`\nSaved: ${updated} books updated with their series.`);
}

module.exports = { parseSeries };

if (require.main === module) {
  main()
    .catch((err) => {
      console.error("Error:", err.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
