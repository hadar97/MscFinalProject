/**
 * Trains the item-item Collaborative Filtering (CF) model.
 *
 * Idea: two books are similar if the SAME USERS rated them in the same
 * direction (both above or both below their personal average).
 *
 * Steps:
 *   1. Read all ratings from dataset_ratings.
 *   2. Center each rating by the user's average:  r_ui - mean(u)
 *      (some users rate everything 5, some are harsh - this removes that bias)
 *   3. For every pair of books, adjusted cosine similarity:
 *         sim(i,j) = sum_u (r_ui - mean_u)(r_uj - mean_u) / (||i|| * ||j||)
 *   4. Shrinkage: sim * n / (n + SHRINK), where n = users who rated both.
 *      A similarity built on 3 shared users is less reliable than one built
 *      on 300, so it is pulled towards 0.
 *   5. Keep the TOP_K most similar books per book (positive similarity only)
 *      and save them in the table item_similarity.
 *
 * The CF recommendations are then quick SQL queries (see cf-recommender.js).
 * Re-running the script replaces item_similarity (e.g. after loading more ratings).
 *
 * Run:
 *   node train-item-cf.js
 *   node train-item-cf.js --k 50 --shrink 10 --min-common 5
 */

const { Pool } = require("pg");
require("dotenv").config();

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i > -1 ? Number(process.argv[i + 1]) : def;
}
const TOP_K = arg("--k", 50);           // neighbours kept per book
const SHRINK = arg("--shrink", 10);     // shrinkage strength
const MIN_COMMON = arg("--min-common", 5); // min users who rated both books
const PAGE = 200000;
const INSERT_BATCH = 20000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// 1. Read ratings in pages (2M+ rows), in "array" mode to save memory
async function loadRatings() {
  const users = [];
  const books = [];
  const values = [];
  let lastUser = -1;
  let lastBook = -1;
  for (;;) {
    const { rows } = await pool.query({
      text: `SELECT user_id, book_id, rating FROM dataset_ratings
             WHERE (user_id, book_id) > ($1, $2)
             ORDER BY user_id, book_id
             LIMIT $3;`,
      values: [lastUser, lastBook, PAGE],
      rowMode: "array",
    });
    if (!rows.length) break;
    for (const [u, b, r] of rows) {
      users.push(u);
      books.push(b);
      values.push(r);
    }
    [lastUser, lastBook] = rows[rows.length - 1];
    console.log(`  read ${users.length.toLocaleString()} ratings...`);
  }
  return { users, books, values };
}

// Builds a compressed sparse layout: for each group (user or book), the list
// of (other index, value). Much faster than objects for millions of entries.
function buildCSR(groupIdx, otherIdx, vals, nGroups) {
  const start = new Int32Array(nGroups + 1);
  for (const g of groupIdx) start[g + 1]++;
  for (let g = 0; g < nGroups; g++) start[g + 1] += start[g];
  const pos = start.slice(0, nGroups);
  const other = new Int32Array(groupIdx.length);
  const value = new Float32Array(groupIdx.length);
  for (let k = 0; k < groupIdx.length; k++) {
    const p = pos[groupIdx[k]]++;
    other[p] = otherIdx[k];
    value[p] = vals[k];
  }
  return { start, other, value };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Missing DATABASE_URL in .env file");
    process.exit(1);
  }
  const t0 = Date.now();
  console.log(`Settings: top-k=${TOP_K}, shrink=${SHRINK}, min-common=${MIN_COMMON}`);
  console.log("Reading ratings...");
  const { users, books, values } = await loadRatings();
  const n = users.length;

  // Map ids -> 0..N-1
  const userIds = [...new Set(users)];
  const bookIds = [...new Set(books)];
  const uIndex = new Map(userIds.map((id, i) => [id, i]));
  const bIndex = new Map(bookIds.map((id, i) => [id, i]));
  const uIdx = Int32Array.from(users, (id) => uIndex.get(id));
  const bIdx = Int32Array.from(books, (id) => bIndex.get(id));
  const nU = userIds.length;
  const nB = bookIds.length;
  console.log(`${n.toLocaleString()} ratings, ${nU.toLocaleString()} users, ${nB.toLocaleString()} books`);

  // 2. Center by user mean
  const sum = new Float64Array(nU);
  const cnt = new Int32Array(nU);
  for (let k = 0; k < n; k++) {
    sum[uIdx[k]] += values[k];
    cnt[uIdx[k]]++;
  }
  const centered = new Float32Array(n);
  for (let k = 0; k < n; k++) centered[k] = values[k] - sum[uIdx[k]] / cnt[uIdx[k]];

  const byUser = buildCSR(uIdx, bIdx, centered, nU);
  const byBook = buildCSR(bIdx, uIdx, centered, nB);

  // Norm of each book's centered vector
  const norm = new Float64Array(nB);
  for (let b = 0; b < nB; b++) {
    let s = 0;
    for (let p = byBook.start[b]; p < byBook.start[b + 1]; p++) s += byBook.value[p] ** 2;
    norm[b] = Math.sqrt(s);
  }

  // 3-5. Similarities, book by book
  console.log("Computing similarities...");
  const dot = new Float64Array(nB);
  const common = new Int32Array(nB);
  const touched = new Int32Array(nB);
  const out = { book: [], neighbor: [], sim: [], common: [] };

  for (let i = 0; i < nB; i++) {
    let nTouched = 0;
    for (let p = byBook.start[i]; p < byBook.start[i + 1]; p++) {
      const u = byBook.other[p];
      const vi = byBook.value[p];
      for (let q = byUser.start[u]; q < byUser.start[u + 1]; q++) {
        const j = byUser.other[q];
        if (common[j] === 0) touched[nTouched++] = j;
        dot[j] += vi * byUser.value[q];
        common[j]++;
      }
    }

    const candidates = [];
    for (let t = 0; t < nTouched; t++) {
      const j = touched[t];
      const c = common[j];
      if (j !== i && c >= MIN_COMMON && norm[i] > 0 && norm[j] > 0) {
        const s = (dot[j] / (norm[i] * norm[j])) * (c / (c + SHRINK));
        if (s > 0) candidates.push([j, s, c]);
      }
      dot[j] = 0;
      common[j] = 0;
    }
    candidates.sort((a, b) => b[1] - a[1]);
    for (const [j, s, c] of candidates.slice(0, TOP_K)) {
      out.book.push(bookIds[i]);
      out.neighbor.push(bookIds[j]);
      out.sim.push(s);
      out.common.push(c);
    }
    if ((i + 1) % 1000 === 0) console.log(`  ${i + 1} / ${nB} books`);
  }
  console.log(`Kept ${out.book.length.toLocaleString()} similar pairs.`);

  // Save
  console.log("Saving to item_similarity...");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DROP TABLE IF EXISTS item_similarity;`);
    await client.query(`
      CREATE TABLE item_similarity (
        book_id     INT  NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        neighbor_id INT  NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        similarity  REAL NOT NULL,
        co_count    INT  NOT NULL,   -- users who rated both books
        PRIMARY KEY (book_id, neighbor_id)
      );`);
    for (let k = 0; k < out.book.length; k += INSERT_BATCH) {
      await client.query(
        `INSERT INTO item_similarity (book_id, neighbor_id, similarity, co_count)
         SELECT * FROM unnest($1::int[], $2::int[], $3::real[], $4::int[]);`,
        [
          out.book.slice(k, k + INSERT_BATCH),
          out.neighbor.slice(k, k + INSERT_BATCH),
          out.sim.slice(k, k + INSERT_BATCH),
          out.common.slice(k, k + INSERT_BATCH),
        ]
      );
    }
    await client.query(`CREATE INDEX item_similarity_neighbor_idx ON item_similarity (neighbor_id);`);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  console.log(`\nDone in ${Math.round((Date.now() - t0) / 1000)}s. Books with neighbours: ${new Set(out.book).size} / ${nB}`);
  await pool.end();
}

main().catch(async (err) => {
  console.error("Fatal error:", err.message);
  await pool.end();
  process.exit(1);
});