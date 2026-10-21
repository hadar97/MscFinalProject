/**
 * Library availability - tests and response time (the proposal's metric:
 * availability query < 500 ms at p95, measured with simultaneous requests).
 *
 * Measures, for N simulated users (each: 10 of a goodbooks user's ratings,
 * located at a random point in Jerusalem / Tel Aviv):
 *   1. availability query alone   - where are 100 candidate books on the shelf
 *   2. recommendations, no nearby - the normal path (for comparison)
 *   3. recommendations + nearby "filter" (radius 10 km)
 *   4. recommendations + nearby "boost"
 * and how often "filter" still fills all 10 places.
 *
 * Requests run CONCURRENTLY (default 10 at a time) - closer to a real server
 * than one by one. Nothing in the database is changed.
 *
 * Run:  node library/test-availability.js
 *       node library/test-availability.js --users 200 --concurrency 10 --radius 10
 */

const path = require("path");
const hybrid = require(path.join(__dirname, "..", "hybrid", "hybrid-recommender"));
const { getAvailability, parseNearby } = require("./availability");

const { pool } = hybrid;

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i > -1 ? Number(process.argv[i + 1]) : def;
}
const N_USERS = arg("--users", 100);
const CONCURRENCY = arg("--concurrency", 10);
const RADIUS = arg("--radius", 10);
const RATINGS_PER_USER = 10;
const COUNT = 10;

const CENTERS = [
  { city: "Jerusalem", lat: 31.778, lng: 35.215 },
  { city: "Tel Aviv-Yafo", lat: 32.08, lng: 34.78 },
];

function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
const rand = seededRandom(7);

const percentile = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

async function runConcurrent(items, fn) {
  const times = [];
  const results = [];
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      const t = performance.now();
      results[i] = await fn(items[i]);
      times.push(performance.now() - t);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { times, results };
}

function report(label, times) {
  const ms = (x) => `${Math.round(x)} ms`;
  console.log(
    `${label.padEnd(34)} p50 ${ms(percentile(times, 50)).padStart(7)}   p95 ${ms(percentile(times, 95)).padStart(7)}   max ${ms(Math.max(...times)).padStart(7)}`
  );
}

async function main() {
  const { rows: libCount } = await pool.query(
    `SELECT (SELECT count(*) FROM libraries WHERE lat IS NOT NULL)::int AS located,
            (SELECT count(*) FROM library_inventory)::int AS inventory;`
  );
  if (!libCount[0].located || !libCount[0].inventory) {
    throw new Error("Run create-library-tables.js, geocode-libraries.js and simulate-inventory.js first");
  }
  console.log(`Branches with location: ${libCount[0].located}, inventory rows: ${libCount[0].inventory.toLocaleString()}`);

  // Test users: N goodbooks users (fixed order), 10 random ratings each
  const { rows: users } = await pool.query(
    `SELECT user_id FROM dataset_ratings GROUP BY user_id HAVING count(*) >= 20
     ORDER BY md5(user_id::text) LIMIT $1;`,
    [N_USERS]
  );
  const { rows: ratingRows } = await pool.query(
    `SELECT user_id, book_id, rating FROM dataset_ratings WHERE user_id = ANY($1::int[]);`,
    [users.map((u) => u.user_id)]
  );
  const byUser = new Map();
  for (const r of ratingRows) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    byUser.get(r.user_id).push({ bookId: r.book_id, rating: r.rating });
  }
  const tests = users.map((u) => {
    const all = byUser.get(u.user_id);
    const ratings = all.sort(() => rand() - 0.5).slice(0, RATINGS_PER_USER);
    const c = CENTERS[Math.floor(rand() * CENTERS.length)];
    const location = { lat: c.lat + (rand() - 0.5) * 0.05, lng: c.lng + (rand() - 0.5) * 0.05 }; // ±~2.5 km
    return { ratings, location, city: c.city };
  });
  console.log(`${tests.length} test users, ${RATINGS_PER_USER} ratings each, ${CONCURRENCY} requests at a time, radius ${RADIUS} km\n`);

  // Warm-up - not measured. A running server keeps its database connections
  // open, so open all CONCURRENCY connections first (each new connection to
  // Neon costs ~0.5 s of TLS + login), then load the ALS model and global mean.
  const warmT = performance.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, () => pool.query("SELECT 1")));
  console.log(`(warm-up: opened ${CONCURRENCY} connections in ${Math.round(performance.now() - warmT)} ms - not counted)`);
  await hybrid.getHybridRecommendations(tests[0].ratings, COUNT, {});

  // One round trip to the database - the floor for any query
  const rtt = [];
  for (let i = 0; i < 10; i++) {
    const t = performance.now();
    await pool.query("SELECT 1");
    rtt.push(performance.now() - t);
  }
  console.log(`Network round trip to the database (SELECT 1): p50 ${Math.round(percentile(rtt, 50))} ms\n`);

  // 1. Availability query alone: 100 candidate books (popular ones)
  const { rows: cand } = await pool.query(
    `SELECT book_id FROM book_popularity ORDER BY liked_count DESC LIMIT 100;`
  );
  const candIds = cand.map((r) => r.book_id);
  const q1 = await runConcurrent(tests, (t) =>
    getAvailability(pool, candIds, parseNearby({ location: t.location, radiusKm: RADIUS }))
  );

  // 2-4. Recommendations
  const q2 = await runConcurrent(tests, (t) => hybrid.getHybridRecommendations(t.ratings, COUNT, {}));
  const q3 = await runConcurrent(tests, (t) =>
    hybrid.getHybridRecommendations(t.ratings, COUNT, { nearby: { location: t.location, radiusKm: RADIUS, mode: "filter" } })
  );
  const q4 = await runConcurrent(tests, (t) =>
    hybrid.getHybridRecommendations(t.ratings, COUNT, { nearby: { location: t.location, radiusKm: RADIUS, mode: "boost" } })
  );

  console.log("================ RESPONSE TIME ================");
  report("1. availability query (100 books)", q1.times);
  report("2. recommendations, no nearby", q2.times);
  report("3. recommendations + filter", q3.times);
  report("4. recommendations + boost", q4.times);
  const p95 = percentile(q1.times, 95);
  console.log(`\nProposal target - availability query < 500 ms at p95: ${Math.round(p95)} ms -> ${p95 < 500 ? "MET" : "NOT MET"}`);

  // Quality of the filtered lists
  const full = q3.results.filter((r) => r.recommendations.length === COUNT).length;
  const avgLen = q3.results.reduce((s, r) => s + r.recommendations.length, 0) / q3.results.length;
  const boostAvail = q4.results.reduce((s, r) => s + r.nearby.available, 0) / q4.results.length;
  const plainIds = q2.results.map((r) => new Set(r.recommendations.map((b) => b.id)));
  const filterOverlap =
    q3.results.reduce((s, r, i) => s + r.recommendations.filter((b) => plainIds[i].has(b.id)).length, 0) /
    q3.results.length;
  console.log("\n================ FILTER / BOOST ================");
  console.log(`filter: users who still got all ${COUNT} books: ${full}/${q3.results.length} (${((full / q3.results.length) * 100).toFixed(1)}%), average list length ${avgLen.toFixed(1)}`);
  console.log(`filter: books also in the normal top ${COUNT}: ${filterOverlap.toFixed(1)} of ${COUNT} on average`);
  console.log(`boost : books available nearby in the top ${COUNT}: ${boostAvail.toFixed(1)} on average`);
  console.log("(inventory is SIMULATED - see library/simulate-inventory.js)");

  // One example
  const ex = q3.results[0];
  console.log(`\nExample - user near ${tests[0].city}, filter ${RADIUS} km:`);
  ex.recommendations.forEach((b, i) => {
    const a = b.availability?.nearest;
    console.log(`  ${String(i + 1).padStart(2)}. ${b.title}  ->  ${a ? `${a.name} (${a.distanceKm} km, ${a.copiesAvailable} on shelf)` : "-"}`);
  });
}

main()
  .catch((err) => {
    console.error("Error:", err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());