/**
 * Choosing gamma - how strong the "boost" mode pushes available books up.
 *
 *   score = position score (1 top .. 0 bottom) + gamma * availability
 *
 * Too weak: boost changes nothing. Too strong: boost = filter, and the books
 * that fit the user's taste best are pushed out just for not being nearby.
 *
 * For the same N users (10 ratings each, random point in Jerusalem / Tel
 * Aviv, radius 10 km) it measures, for each gamma:
 *   available - how many of the top 10 are on the shelf nearby (higher = more useful)
 *   kept      - how many of the top 10 are the same as the plain list (higher = taste kept)
 *   top3 kept - how many of the plain top 3 are still in the list
 * gamma = 0 must give the plain list exactly (a built-in check).
 *
 * Nothing in the database is changed. ~6 requests per user.
 *
 * Run:  node library/tune-gamma.js
 *       node library/tune-gamma.js --users 50 --radius 10
 */

const path = require("path");
const hybrid = require(path.join(__dirname, "..", "hybrid", "hybrid-recommender"));
const { getAvailability, parseNearby } = require("./availability");

const { pool } = hybrid;

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i > -1 ? Number(process.argv[i + 1]) : def;
}
const N_USERS = arg("--users", 50);
const RADIUS = arg("--radius", 10);
const GAMMAS = [0, 0.05, 0.1, 0.2, 0.3];
const COUNT = 10;
const CENTERS = [
  { lat: 31.778, lng: 35.215 }, // Jerusalem
  { lat: 32.08, lng: 34.78 },   // Tel Aviv-Yafo
];

function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
const rand = seededRandom(11);

async function main() {
  const { rows: users } = await pool.query(
    `SELECT user_id FROM dataset_ratings GROUP BY user_id HAVING count(*) >= 20
     ORDER BY md5(user_id::text) LIMIT $1;`,
    [N_USERS]
  );
  const { rows: ratingRows } = await pool.query(
    `SELECT user_id, book_id, rating FROM dataset_ratings WHERE user_id = ANY($1::int[]) ORDER BY user_id, book_id;`,
    [users.map((u) => u.user_id)]
  );
  const byUser = new Map();
  for (const r of ratingRows) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    byUser.get(r.user_id).push({ bookId: r.book_id, rating: r.rating });
  }
  const tests = users.map((u) => {
    const ratings = byUser.get(u.user_id).sort(() => rand() - 0.5).slice(0, 10);
    const c = CENTERS[Math.floor(rand() * CENTERS.length)];
    return { ratings, location: { lat: c.lat + (rand() - 0.5) * 0.05, lng: c.lng + (rand() - 0.5) * 0.05 } };
  });
  console.log(`${tests.length} users, radius ${RADIUS} km. Gammas: ${GAMMAS.join(", ")}\n`);

  const rows = GAMMAS.map((g) => ({ gamma: g, available: 0, kept: 0, top3: 0, sameAsPlain: 0 }));
  let plainAvailable = 0;
  let done = 0;
  for (const t of tests) {
    const plain = (await hybrid.getHybridRecommendations(t.ratings, COUNT, {})).recommendations.map((b) => b.id);
    const plainSet = new Set(plain);
    const avail = await getAvailability(pool, plain, parseNearby({ location: t.location, radiusKm: RADIUS }));
    plainAvailable += avail.size;

    for (const row of rows) {
      const res = await hybrid.getHybridRecommendations(t.ratings, COUNT, {
        nearby: { location: t.location, radiusKm: RADIUS, mode: "boost", gamma: row.gamma },
      });
      const ids = res.recommendations.map((b) => b.id);
      row.available += res.nearby.available;
      row.kept += ids.filter((id) => plainSet.has(id)).length;
      row.top3 += plain.slice(0, 3).filter((id) => ids.includes(id)).length;
      if (ids.join() === plain.join()) row.sameAsPlain++;
    }
    if (++done % 10 === 0) console.log(`  ${done} / ${tests.length} users`);
  }

  const n = tests.length;
  console.log(`\nplain list (no nearby): ${(plainAvailable / n).toFixed(1)} of ${COUNT} happen to be available nearby\n`);
  console.log("gamma   available   kept from plain   plain top-3 kept   identical to plain");
  for (const r of rows) {
    console.log(
      `${String(r.gamma).padEnd(8)}${(r.available / n).toFixed(1).padStart(6)} / ${COUNT}` +
        `${(r.kept / n).toFixed(1).padStart(12)} / ${COUNT}` +
        `${(r.top3 / n).toFixed(1).padStart(15)} / 3` +
        `${String(r.sameAsPlain).padStart(15)} / ${n}`
    );
  }
  const g0 = rows[0];
  console.log(`\nCheck - gamma 0 gives the plain list: ${g0.sameAsPlain === n ? "PASS" : `FAIL (${g0.sameAsPlain}/${n})`}`);
  console.log("(library inventory is SIMULATED)");
}

main()
  .catch((err) => {
    console.error("Error:", err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
