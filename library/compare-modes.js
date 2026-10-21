/**
 * The three modes side by side, for the same user:
 *   1. plain   - no `nearby`: recommendations by taste only (the default)
 *   2. filter  - only books on the shelf in the chosen libraries
 *   3. boost   - all books, available ones moved up
 * and automatic checks that each mode behaves as it should.
 *
 * Light on the database (3 recommendation requests) - fine for the Neon quota.
 *
 * Run (from the project folder):
 *   node library/compare-modes.js --user 6 --city Jerusalem
 *   node library/compare-modes.js --user 6 --city Jerusalem --gamma 0.1   boost strength
 *   node library/compare-modes.js "The Hobbit=5" "Twilight=4" --genres fantasy --near 32.08,34.78 --radius 5
 */

const path = require("path");
const hybrid = require(path.join(__dirname, "..", "hybrid", "hybrid-recommender"));

const { getAvailability, parseNearby } = require("./availability");

const { pool } = hybrid;

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { books: [], genres: [], user: null, city: null, near: null, radius: 10, count: 10, gamma: undefined };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--genres") out.genres = args[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--user") out.user = Number(args[++i]);
    else if (a === "--city") out.city = args[++i];
    else if (a === "--near") {
      const [lat, lng] = args[++i].split(",").map(Number);
      out.near = { lat, lng };
    } else if (a === "--radius") out.radius = Number(args[++i]);
    else if (a === "--gamma") out.gamma = Number(args[++i]);
    else if (a === "--count") out.count = Number(args[++i]);
    else {
      const m = a.match(/^(.*)=(\d)$/);
      if (!m) throw new Error(`Write books as "Title=stars", got: ${a}`);
      out.books.push({ title: m[1].trim(), stars: Number(m[2]) });
    }
  }
  if (!out.city && !out.near) out.city = "Jerusalem";
  return out;
}

async function findBook(title) {
  const { rows } = await pool.query(
    `SELECT id, title FROM books
     WHERE lower(title) = lower($1) OR title ILIKE '%' || $1 || '%'
     ORDER BY (lower(title) = lower($1)) DESC, goodbooks_id NULLS LAST, length(title) LIMIT 1;`,
    [title]
  );
  return rows[0] || null;
}

function show(label, result) {
  console.log(`\n=== ${label} ===`);
  if (result.nearby) {
    console.log(`(${result.nearby.available} of ${result.recommendations.length} available nearby)`);
  }
  result.recommendations.forEach((b, i) => {
    let where = "";
    if (b.availability !== undefined) {
      const n = b.availability?.nearest;
      where = n ? `  ->  ${n.name}${n.distanceKm === null ? "" : ` (${n.distanceKm} km)`}` : "  ->  not available nearby";
    }
    console.log(`  ${String(i + 1).padStart(2)}. ${b.title}${where}`);
  });
}

async function main() {
  const o = parseArgs();

  // The user's ratings
  let ratings = [];
  if (o.user) {
    const { rows } = await pool.query(`SELECT book_id, rating FROM dataset_ratings WHERE user_id = $1;`, [o.user]);
    ratings = rows.map((r) => ({ bookId: r.book_id, rating: r.rating }));
    console.log(`goodbooks user ${o.user}: ${ratings.length} ratings`);
  } else {
    for (const b of o.books) {
      const f = await findBook(b.title);
      if (!f) console.log(`  "${b.title}": NOT FOUND (skipped)`);
      else ratings.push({ bookId: f.id, rating: b.stars });
    }
    console.log(`${ratings.length} rated books`);
  }
  const where = o.city ? { city: o.city } : { location: o.near, radiusKm: o.radius };
  console.log(`Libraries: ${o.city ? `city ${o.city}` : `within ${o.radius} km of ${o.near.lat}, ${o.near.lng}`}`);

  const base = { genres: o.genres };
  const plain = await hybrid.getHybridRecommendations(ratings, o.count, base);
  const filter = await hybrid.getHybridRecommendations(ratings, o.count, { ...base, nearby: { ...where, mode: "filter" } });
  const boost = await hybrid.getHybridRecommendations(ratings, o.count, { ...base, nearby: { ...where, mode: "boost", gamma: o.gamma } });

  show("1. PLAIN - taste only (no nearby)", plain);
  show("2. FILTER - only books on the shelf nearby", filter);
  show("3. BOOST - available books moved up", boost);

  // Automatic checks
  const ids = (r) => r.recommendations.map((b) => b.id);
  // how many of the PLAIN list happen to be available nearby (for comparison)
  const plainAvail = await getAvailability(pool, ids(plain), parseNearby(where));
  const plainSet = new Set(ids(plain));
  const checks = [
    ["plain: no availability info at all", plain.recommendations.every((b) => b.availability === undefined) && !plain.nearby],
    [`plain: ${o.count} books`, plain.recommendations.length === o.count],
    ["filter: every book is available nearby", filter.recommendations.every((b) => b.availability)],
    ["boost: has availability info for every book", boost.recommendations.every((b) => b.availability !== undefined)],
    [
      `boost: at least as many available books as plain (${boost.nearby.available} vs ${plainAvail.size})`,
      boost.nearby.available >= plainAvail.size,
    ],
    ["no duplicate books in any list", [plain, filter, boost].every((r) => new Set(ids(r)).size === ids(r).length)],
  ];
  console.log("\n=== CHECKS ===");
  for (const [name, ok] of checks) console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  console.log(
    `\nfilter kept ${ids(filter).filter((id) => plainSet.has(id)).length}/${o.count} of the plain list, ` +
      `boost kept ${ids(boost).filter((id) => plainSet.has(id)).length}/${o.count}.`
  );
  console.log("(library inventory is SIMULATED)");
}

main()
  .catch((err) => {
    console.error("Error:", err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
