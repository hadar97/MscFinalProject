/**
 * SIMULATED library inventory - which book is in which branch, and how many
 * copies are on the shelf right now.
 *
 * Why simulated: no public source gives per-branch holdings / loan status for
 * Israeli public libraries (checked: the National Library SRU interface
 * returns no records to the public, and the union catalog ULI covers academic
 * libraries, not municipal ones). The branches are real; the inventory is
 * generated, and every row is marked source = 'simulated'.
 *
 * The generation is not uniform - it follows simple, realistic rules:
 *   - a large (central) branch holds more of the catalog than a small one
 *       large 30%, medium 12%, small 5%   (x2 for the most popular books)
 *   - popular books (many ratings) are in more branches, have more copies,
 *     and are on loan more often
 *   - books with no ratings (Google books) are held less often
 *   - fixed seed: every run gives exactly the same inventory (reproducible)
 *
 * Expected size: ~80,000 rows (~8 MB). Re-running replaces only the
 * simulated rows (DELETE ... WHERE source = 'simulated').
 *
 * Run:  node library/simulate-inventory.js
 *       node library/simulate-inventory.js --seed 7
 */

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i > -1 ? Number(process.argv[i + 1]) : def;
}
const SEED = arg("--seed", 42);
const HOLD_SHARE = { large: 0.3, medium: 0.12, small: 0.05 }; // share of the catalog a branch holds
const BATCH = 5000;

function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Missing DATABASE_URL in .env file");
  const rand = seededRandom(SEED);

  const { rows: libs } = await pool.query(`SELECT id, name, size FROM libraries ORDER BY id;`);
  if (!libs.length) throw new Error("No libraries - run library/create-library-tables.js first");

  // Popularity percentile of every book: 0 = no ratings ... 1 = the most rated
  const { rows: books } = await pool.query(
    `SELECT b.id, coalesce(p.ratings_count, 0) AS n
     FROM books b LEFT JOIN book_popularity p ON p.book_id = b.id
     ORDER BY b.id;`
  );
  const rated = books.filter((b) => b.n > 0).sort((a, b) => a.n - b.n);
  const pct = new Map(books.map((b) => [b.id, 0]));
  rated.forEach((b, i) => pct.set(b.id, (i + 1) / rated.length));
  console.log(`${libs.length} branches, ${books.length} books (${rated.length} with ratings). Seed ${SEED}.`);

  // Generate
  const libIds = [];
  const bookIds = [];
  const totals = [];
  const available = [];
  for (const l of libs) {
    const share = HOLD_SHARE[l.size] ?? HOLD_SHARE.medium;
    for (const b of books) {
      const p = pct.get(b.id);
      const popFactor = p > 0 ? 0.25 + 0.75 * p : 0.25; // 0.25 .. 1
      if (rand() >= share * popFactor * 2) continue;     // not in this branch
      let copies = 1;
      if (rand() < p * 0.6) copies++;
      if (l.size === "large" && rand() < p * 0.5) copies++;
      const loanChance = 0.15 + 0.5 * p; // popular books are borrowed more
      let onShelf = 0;
      for (let c = 0; c < copies; c++) if (rand() >= loanChance) onShelf++;
      libIds.push(l.id);
      bookIds.push(b.id);
      totals.push(copies);
      available.push(onShelf);
    }
  }
  console.log(`Generated ${libIds.length.toLocaleString()} inventory rows. Writing...`);

  // Replace the simulated rows, in one transaction
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM library_inventory WHERE source = 'simulated';`);
    for (let i = 0; i < libIds.length; i += BATCH) {
      await client.query(
        `INSERT INTO library_inventory (library_id, book_id, copies_total, copies_available, source)
         SELECT * , 'simulated' FROM unnest($1::int[], $2::int[], $3::smallint[], $4::smallint[])
         ON CONFLICT (library_id, book_id) DO NOTHING;`,
        [libIds.slice(i, i + BATCH), bookIds.slice(i, i + BATCH), totals.slice(i, i + BATCH), available.slice(i, i + BATCH)]
      );
      process.stdout.write(`  ${Math.min(i + BATCH, libIds.length).toLocaleString()} / ${libIds.length.toLocaleString()}\r`);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const { rows: summary } = await pool.query(
    `SELECT l.city, l.size, count(DISTINCT l.id)::int AS branches,
            count(*)::int AS rows, round(avg(i.copies_available::numeric / i.copies_total) * 100)::int AS pct_on_shelf
     FROM library_inventory i JOIN libraries l ON l.id = i.library_id
     GROUP BY l.city, l.size ORDER BY l.city, l.size;`
  );
  console.log("\nInventory by city and branch size:");
  console.table(summary);

  // Sanity check: a very popular book vs a book without ratings
  const { rows: check } = await pool.query(
    `SELECT b.title, coalesce(p.ratings_count, 0) AS ratings,
            count(i.library_id)::int AS branches, coalesce(sum(i.copies_available), 0)::int AS on_shelf
     FROM books b
     LEFT JOIN book_popularity p ON p.book_id = b.id
     LEFT JOIN library_inventory i ON i.book_id = b.id
     WHERE b.id IN (
       (SELECT book_id FROM book_popularity ORDER BY ratings_count DESC LIMIT 1),
       (SELECT b2.id FROM books b2 LEFT JOIN book_popularity p2 ON p2.book_id = b2.id
        WHERE p2.book_id IS NULL ORDER BY b2.id LIMIT 1))
     GROUP BY b.title, p.ratings_count;`
  );
  console.log("Sanity check (most rated book vs. a book without ratings):");
  console.table(check);
}

main()
  .catch((err) => {
    console.error("Error:", err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
