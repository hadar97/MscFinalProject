/**
 * Quantitative check of the CBF recommender.
 *
 * Takes a random sample of books, asks the recommender for the top K similar
 * books for each one, and measures how often the recommendations share an
 * author / a category with the base book. The same numbers are computed for
 * RANDOM books as a baseline, so you can see how much better than chance the
 * recommender is.
 *
 * It runs several bonus values (see BONUS_VALUES) so you can compare them.
 *
 * IMPORTANT - how to read the numbers:
 *   - The row with bonus 0 is pure embedding similarity. Its "same author" and
 *     "category" numbers are a fair test of the embeddings themselves.
 *   - With a bonus, "same author" and "category" go up BY DESIGN, because the
 *     bonus rewards exactly those things. Do not read that as better quality.
 *     Look at the other columns instead: how much content similarity you give
 *     up (avg similarity) and how many recommendations changed.
 *   - These are proxy metrics from catalog data. The Precision@10 target in the
 *     proposal needs real user interactions, which come later with the CF part.
 *
 * Usage:
 *   node evaluate.js                      (200 books, top 10)
 *   node evaluate.js --n=300 --k=10       (more books)
 *   node evaluate.js --seed=7             (different random sample)
 */

const { pool, getSimilarBooks } = require("../recommender");

const BONUS_VALUES = [0, 0.05, 0.1, 0.15];
const GENERIC_CATEGORY_SHARE = 0.03; // a category in >3% of books counts as "generic"

function parseArg(name, fallback) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? Number(arg.split("=")[1]) : fallback;
}

const K = parseArg("k", 10);
const N = parseArg("n", 200);
const SEED = parseArg("seed", 42);

// Small seeded random generator so runs are repeatable
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sample(array, n, rand) {
  const copy = array.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

function overlap(a, b) {
  return !!(a && b && a.some((x) => b.includes(x)));
}

function newStats() {
  return {
    recs: 0,
    sameAuthor: 0,
    anyCategory: 0,
    specificCategory: 0,
    specificDenominator: 0,
    simSum: 0,
    simCount: 0,
    changed: 0,
    changedDenominator: 0,
  };
}

function addRecs(stats, base, recs, genericSet, baselineIds) {
  const baseSpecific = (base.categories || []).filter((c) => !genericSet.has(c));
  for (const rec of recs) {
    stats.recs++;
    if (overlap(base.authors, rec.authors)) stats.sameAuthor++;
    if (overlap(base.categories, rec.categories)) stats.anyCategory++;
    if (baseSpecific.length > 0) {
      stats.specificDenominator++;
      if (overlap(baseSpecific, rec.categories)) stats.specificCategory++;
    }
    if (rec.similarity !== undefined) {
      stats.simSum += Number(rec.similarity);
      stats.simCount++;
    }
    if (baselineIds) {
      stats.changedDenominator++;
      if (!baselineIds.has(rec.id)) stats.changed++;
    }
  }
}

function pct(part, whole) {
  return whole > 0 ? ((100 * part) / whole).toFixed(1) + "%" : "-";
}

function printRow(label, s) {
  const avgSim = s.simCount > 0 ? (s.simSum / s.simCount).toFixed(3) : "-";
  const changed = s.changedDenominator > 0 ? pct(s.changed, s.changedDenominator) : "-";
  console.log(
    label.padEnd(28) +
      pct(s.sameAuthor, s.recs).padEnd(14) +
      pct(s.anyCategory, s.recs).padEnd(16) +
      pct(s.specificCategory, s.specificDenominator).padEnd(20) +
      avgSim.padEnd(16) +
      changed
  );
}

async function main() {
  const rand = mulberry32(SEED);

  // Load a light version of the catalog into memory (id, authors, categories)
  const poolRows = (
    await pool.query(
      `SELECT id, authors, categories
       FROM books
       WHERE language = 'en' AND embedding IS NOT NULL;`
    )
  ).rows;
  console.log(`Books in catalog (English, with embedding): ${poolRows.length}`);

  // "Generic" categories (like Fiction) appear on many books, so sharing one means little
  const counts = new Map();
  for (const row of poolRows) {
    for (const c of row.categories || []) counts.set(c, (counts.get(c) || 0) + 1);
  }
  const genericSet = new Set(
    [...counts.entries()]
      .filter(([, n]) => n / poolRows.length > GENERIC_CATEGORY_SHARE)
      .map(([c]) => c)
  );
  console.log(`Generic categories (ignored in the "specific category" column): ${[...genericSet].join(", ") || "none"}`);

  // Base books: need an author and a category to be measurable
  const eligible = poolRows.filter(
    (r) => r.authors && r.authors.length > 0 && r.categories && r.categories.length > 0
  );
  const bases = sample(eligible, Math.min(N, eligible.length), rand);
  console.log(`Sample: ${bases.length} books, top ${K} recommendations each (seed ${SEED})\n`);

  // Pure embedding results (bonus 0) are the reference for "recommendations changed"
  const results = new Map(); // bonus -> stats
  let baselineIdsByBook = new Map();

  for (const bonus of BONUS_VALUES) {
    const stats = newStats();
    process.stdout.write(`Running bonus ${bonus} `);
    let done = 0;
    for (const base of bases) {
      const recs = await getSimilarBooks(base.id, K, { matchBonus: bonus });
      if (bonus === 0) baselineIdsByBook.set(base.id, new Set(recs.map((r) => r.id)));
      addRecs(stats, base, recs, genericSet, bonus === 0 ? null : baselineIdsByBook.get(base.id));
      done++;
      if (done % 25 === 0) process.stdout.write(".");
    }
    process.stdout.write("\n");
    results.set(bonus, stats);
  }

  // Random baseline: K random books for every base book
  const randomStats = newStats();
  for (const base of bases) {
    const others = poolRows.filter((r) => r.id !== base.id);
    addRecs(randomStats, base, sample(others, K, rand), genericSet, null);
  }

  console.log("\n" + "=".repeat(100));
  console.log(
    "Configuration".padEnd(28) +
      "Same author".padEnd(14) +
      "Any category".padEnd(16) +
      "Specific category".padEnd(20) +
      "Avg similarity".padEnd(16) +
      "Changed vs bonus 0"
  );
  console.log("=".repeat(100));
  printRow("Random books (baseline)", randomStats);
  for (const bonus of BONUS_VALUES) {
    const label = bonus === 0 ? "Embedding only (bonus 0)" : `Bonus ${bonus}`;
    printRow(label, results.get(bonus));
  }
  console.log("=".repeat(100));
  console.log(
    "\nHow to read:\n" +
      "  Embedding only vs Random -> how much better than chance the embeddings are.\n" +
      "  Bonus rows: author/category numbers rise by design. Check 'Avg similarity'\n" +
      "  (content closeness you give up) and 'Changed vs bonus 0' (how much the list changes).\n"
  );

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
