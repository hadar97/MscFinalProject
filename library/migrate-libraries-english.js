/**
 * ONE-TIME change of the libraries table (run once, after geocoding):
 *   1. deletes the branches WITHOUT a location (OpenStreetMap could not find
 *      their address) - 21 branches, including all of Beit Shemesh
 *   2. renames the remaining 27 to English (name, city, address), like the
 *      rest of the app - their lat / lng are kept
 *
 * Touches only the libraries table (and, through ON DELETE CASCADE, the
 * inventory of the deleted branches - empty at this point anyway).
 * Safe to run again: a branch that is already in English is skipped.
 *
 * Run:  node library/migrate-libraries-english.js
 */

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { LIBRARIES } = require("./libraries-data");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Hebrew name in the table -> English name in libraries-data.js
const HE_TO_EN = {
  "הספרייה המרכזית – בית העם": "Central Library – Beit Ha'am",
  "הספרייה הרוסית": "Russian Library",
  "ספריית הר נוף": "Har Nof Library",
  "ספריית בית הכרם": "Beit HaKerem Library",
  "ספריית בקעה": "Baka Library",
  "ספריית גילה": "Gilo Library",
  "ספריית נווה יעקב": "Neve Yaakov Library",
  "ספריית סוואחרה": "Sawahre Library",
  "ספריית פסגת זאב": "Pisgat Ze'ev Library",
  "ספריית קטמון": "Katamon Library",
  "ספריית קריית יובל": "Kiryat Yovel Library",
  "ספריית קרית מנחם – עיר גנים": "Kiryat Menachem – Ir Ganim Library",
  "ספריית רמות": "Ramot Library",
  "ספריית רמת אשכול": "Ramat Eshkol Library",
  "ספריית תלפיות מזרח – ארמון הנציב": "East Talpiot – Armon HaNatziv Library",
};

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Missing DATABASE_URL in .env file");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Branches without a location
    const del = await client.query(`DELETE FROM libraries WHERE lat IS NULL OR lng IS NULL RETURNING name;`);
    console.log(`Deleted ${del.rowCount} branches without a location.`);

    // 2. English names
    const byEnglish = new Map(LIBRARIES.map((l) => [l.name, l]));
    const { rows } = await client.query(`SELECT id, name FROM libraries ORDER BY id;`);
    let renamed = 0;
    const unknown = [];
    for (const r of rows) {
      const en = byEnglish.get(HE_TO_EN[r.name] || r.name); // Tel Aviv names are already English
      if (!en) {
        unknown.push(r);
        continue;
      }
      await client.query(
        `UPDATE libraries SET name = $1, city = $2, address = $3, size = $4, source_url = $5, updated_at = now()
         WHERE id = $6;`,
        [en.name, en.city, en.address, en.size, en.source, r.id]
      );
      renamed++;
    }
    if (unknown.length) {
      throw new Error(`Branches not in libraries-data.js (nothing was changed): ${unknown.map((u) => `${u.id} ${u.name}`).join(", ")}`);
    }

    await client.query("COMMIT");
    console.log(`Renamed to English: ${renamed} branches.`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const { rows: summary } = await pool.query(
    `SELECT city, count(*)::int AS branches, count(lat)::int AS with_location FROM libraries GROUP BY city ORDER BY city;`
  );
  console.table(summary);
  console.log("Next: node library/simulate-inventory.js");
}

main()
  .catch((err) => {
    console.error("Error:", err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
