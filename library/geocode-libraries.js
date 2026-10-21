/**
 * Fills lat / lng of the library branches from their address, using the free
 * OpenStreetMap geocoder (Nominatim).
 *
 * Nominatim's usage policy: at most 1 request per second, and a User-Agent
 * that names the application. This script follows both (one branch at a time,
 * ~1.2 seconds apart). 48 branches take about a minute.
 *
 * Only branches WITHOUT a location are geocoded (run again = continues).
 * A result is accepted only if it is within 20 km of the city's center
 * (so "Herzl Street" does not land in another city).
 *
 * Run:  node library/geocode-libraries.js
 *       node library/geocode-libraries.js --all      re-geocode every branch
 *
 * Branches that were not found are printed at the end; set them by hand, e.g.
 *   UPDATE libraries SET lat = 31.7, lng = 34.9, geocoded_by = 'manual' WHERE id = 23;
 */

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const ALL = process.argv.includes("--all");
const USER_AGENT = "BookBridge-MSc-student-project/1.0 (library availability geocoding)";
const DELAY_MS = 1200;
const MAX_KM_FROM_CENTER = 20;

// Approximate city centers - only for the sanity check above
const CITY_CENTER = {
  "Jerusalem": [31.778, 35.235],
  "Tel Aviv-Yafo": [32.08, 34.78],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function km(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

// q = free text ("Bialik 26, Tel Aviv") or an object for a structured search
// ({ street: "26 Bialik Street", city: "Tel Aviv-Yafo" })
async function geocode(q) {
  const params = new URLSearchParams({ format: "json", limit: "3", countrycodes: "il" });
  if (typeof q === "string") params.set("q", q);
  else for (const [k, v] of Object.entries(q)) params.set(k, v);
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "he,en" },
  });
  if (res.status === 429 || res.status === 403) {
    throw new Error(`Nominatim answered ${res.status} (too many requests / blocked) - wait an hour and run again`);
  }
  if (!res.ok) throw new Error(`Nominatim answered ${res.status}`);
  const data = await res.json();
  return data.map((d) => ({ lat: Number(d.lat), lng: Number(d.lon), label: d.display_name }));
}

const describe = (q) => (typeof q === "string" ? q : Object.values(q).join(", "));

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Missing DATABASE_URL in .env file");
  const { rows: libs } = await pool.query(
    `SELECT id, name, city, address FROM libraries ${ALL ? "" : "WHERE lat IS NULL"} ORDER BY id;`
  );
  console.log(`Geocoding ${libs.length} branches (about ${Math.ceil((libs.length * 6 * DELAY_MS) / 60000)} min at most)...`);

  const missing = [];
  for (const l of libs) {
    const cityEn = l.city;
    const cityShort = l.city.replace("-Yafo", ""); // "Tel Aviv" is how most addresses are written
    // English addresses ("26 Bialik Street") -> also without "Street"/"Boulevard",
    // which OpenStreetMap often writes differently
    const plain = l.address ? l.address.replace(/\b(Street|St\.?|Boulevard|Blvd\.?)\b/gi, "").trim() : null;
    // Try the address first (several spellings); branches without an address - by name
    const queries = [
      l.address && `${l.address}, ${l.city}`,
      l.address && { street: plain, city: cityEn, country: "Israel" },
      l.address && `${plain}, ${cityEn}, Israel`,
      l.address && `${plain}, ${cityShort}`,
      `${l.name}, ${cityShort}`,
      `${l.name}, ${cityEn}`,
    ].filter(Boolean);

    let found = null;
    const tried = [];
    for (const q of queries) {
      const results = await geocode(q);
      await sleep(DELAY_MS);
      const [clat, clng] = CITY_CENTER[l.city] || [results[0]?.lat ?? 0, results[0]?.lng ?? 0];
      // the first result inside the city (not "Herzl Street" in another city)
      const inCity = results.find((r) => km(r.lat, r.lng, clat, clng) <= MAX_KM_FROM_CENTER);
      if (inCity) {
        found = { ...inCity, query: describe(q) };
        break;
      }
      tried.push(
        `"${describe(q)}": ` +
          (results.length
            ? `${results.length} results, nearest ${Math.round(Math.min(...results.map((r) => km(r.lat, r.lng, clat, clng))))} km from the city`
            : "no results")
      );
    }

    if (found) {
      await pool.query(
        `UPDATE libraries SET lat = $1, lng = $2, geocoded_by = 'nominatim', updated_at = now() WHERE id = $3;`,
        [found.lat, found.lng, l.id]
      );
      console.log(`  ✓ ${l.id} ${l.name} (${l.city}) -> ${found.lat.toFixed(5)}, ${found.lng.toFixed(5)}  [${found.query}]`);
    } else {
      missing.push(l);
      console.log(`  ✗ ${l.id} ${l.name} (${l.city}) - not found`);
      for (const t of tried) console.log(`      ${t}`);
    }
  }

  console.log(`\nDone: ${libs.length - missing.length} found, ${missing.length} not found.`);
  if (missing.length) {
    console.log("Set these by hand (find the place on a map, right-click -> coordinates):");
    for (const l of missing) {
      console.log(`  UPDATE libraries SET lat = ..., lng = ..., geocoded_by = 'manual' WHERE id = ${l.id};  -- ${l.name}, ${l.city}`);
    }
  }
}

main()
  .catch((err) => {
    console.error("Error:", err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
