/**
 * Offline evaluation of the recommendation models.
 *
 * Method (hold-out):
 *   1. Pick N test users (default 500), each with at least MIN_USER_RATINGS ratings.
 *   2. For each test user, HIDE 20% of their ratings (chosen at random).
 *      Hidden books rated 4-5 stars = the books the user really liked = "relevant".
 *   3. Every model sees only the remaining 80% (the "train" ratings), and
 *      returns its top-K recommendations (default K=10).
 *   4. Count how many of the hidden liked books appear in the top K.
 *
 * Models compared:
 *   Random      - K random books. Shows how hard the task is.
 *   Popularity  - the books most liked (4-5 stars) by everyone. The baseline
 *                 every real model must beat.
 *   CBF-mean    - ONE content profile per user = average embedding of the
 *                 books the user liked (4-5 stars); recommends the closest books.
 *   CBF-centered- same, after removing the "average book" direction from all
 *                 embeddings (so generic books stop matching everyone).
 *   CBF-kNN     - each book the user rated SEPARATELY: its 50 most similar books
 *                 by content, weighted by how much the user liked it (the CF
 *                 formula, with content similarity instead of reader similarity).
 *                 A user with several tastes gets books from each of them.
 *   CF          - item-item, SAME settings as train-item-cf.js, but RE-TRAINED
 *                 here on the train ratings only. (The item_similarity table was
 *                 trained on ALL ratings, so using it would "see the answers".)
 *
 * Fairness: all models recommend only from the books that have ratings
 * (goodbooks), because only those can be hidden and found. Books the user
 * already rated (in train) are never recommended.
 *
 * Metrics (averaged over test users):
 *   Precision@K - of the K recommendations, the % that were relevant
 *   Recall@K    - of the relevant hidden books, the % that were found
 *   HitRate@K   - % of users with at least one relevant book in the top K
 *   NDCG@K      - like recall, but a hit at position 1 counts more than at position 10
 *   Coverage    - % of the catalog that was recommended to at least one user
 *
 * Nothing in the database is changed. Results are also saved to
 * data/eval-results.csv for the report.
 *
 * Run:
 *   node evaluate.js
 *   node evaluate.js --users 1000 --k 10 --holdout 0.2
 */

const fs = require("fs");
const { Pool } = require("pg");
require("dotenv").config();

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i > -1 ? Number(process.argv[i + 1]) : def;
}
const N_USERS = arg("--users", 500);
const K = arg("--k", 10);
const HOLDOUT = arg("--holdout", 0.2);
const SEED = arg("--seed", 42);
const MIN_USER_RATINGS = 20;
const LIKED = 4; // rating >= 4 = "liked"

// CF settings - the same as train-item-cf.js / cf-recommender.js
const CF_TOP_K = 50;
const CF_SHRINK = 10;
const CF_MIN_COMMON = 5;
const CF_MIN_SUPPORT = 2;
const CBF_TOP_K = 50; // content neighbours per book, for CBF-kNN

const PAGE = 200000;
const RESULTS_PATH = "./data/eval-results.csv";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
const rand = seededRandom(SEED);

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------- data ----------

async function loadRatings() {
  const rows = [];
  let lastUser = -1;
  let lastBook = -1;
  for (;;) {
    const { rows: page } = await pool.query({
      text: `SELECT user_id, book_id, rating FROM dataset_ratings
             WHERE (user_id, book_id) > ($1, $2)
             ORDER BY user_id, book_id LIMIT $3;`,
      values: [lastUser, lastBook, PAGE],
      rowMode: "array",
    });
    if (!page.length) break;
    for (const r of page) rows.push(r);
    [lastUser, lastBook] = page[page.length - 1];
    console.log(`  read ${rows.length.toLocaleString()} ratings...`);
  }
  return rows;
}

async function loadEmbeddings(bookIndex) {
  const { rows } = await pool.query(
    `SELECT id, embedding::text AS e FROM books
     WHERE goodbooks_id IS NOT NULL AND embedding IS NOT NULL;`
  );
  const dim = JSON.parse(rows[0].e).length;
  const emb = new Float32Array(bookIndex.size * dim);
  const has = new Uint8Array(bookIndex.size);
  for (const r of rows) {
    const b = bookIndex.get(r.id);
    if (b === undefined) continue;
    const v = JSON.parse(r.e);
    let norm = 0;
    for (const x of v) norm += x * x;
    norm = Math.sqrt(norm) || 1;
    for (let d = 0; d < dim; d++) emb[b * dim + d] = v[d] / norm;
    has[b] = 1;
  }
  return { emb, has, dim };
}

// ---------- split ----------

function split(ratings) {
  const byUser = new Map();
  for (const [u, b, r] of ratings) {
    if (!byUser.has(u)) byUser.set(u, []);
    byUser.get(u).push([b, r]);
  }
  const eligible = [...byUser.keys()].filter((u) => byUser.get(u).length >= MIN_USER_RATINGS);
  const testUsers = shuffle(eligible.sort((a, b) => a - b)).slice(0, N_USERS);

  const hidden = new Map(); // user -> Set of hidden liked books (relevant)
  const hiddenAll = new Set(); // "user|book" of every hidden rating
  for (const u of testUsers) {
    const list = shuffle([...byUser.get(u)]);
    const nHide = Math.max(1, Math.round(list.length * HOLDOUT));
    const relevant = new Set();
    for (const [b, r] of list.slice(0, nHide)) {
      hiddenAll.add(`${u}|${b}`);
      if (r >= LIKED) relevant.add(b);
    }
    if (relevant.size) hidden.set(u, relevant);
  }
  const train = ratings.filter(([u, b]) => !hiddenAll.has(`${u}|${b}`));
  return { train, hidden, testUsers: [...hidden.keys()] };
}

// ---------- CF (same algorithm as train-item-cf.js) ----------

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

function trainItemCF(uIdx, bIdx, centered, nU, nB) {
  const byUser = buildCSR(uIdx, bIdx, centered, nU);
  const byBook = buildCSR(bIdx, uIdx, centered, nB);
  const norm = new Float64Array(nB);
  for (let b = 0; b < nB; b++) {
    let s = 0;
    for (let p = byBook.start[b]; p < byBook.start[b + 1]; p++) s += byBook.value[p] ** 2;
    norm[b] = Math.sqrt(s);
  }
  const dot = new Float64Array(nB);
  const common = new Int32Array(nB);
  const touched = new Int32Array(nB);
  const neighbors = new Array(nB); // book -> [[j, sim], ...]
  for (let i = 0; i < nB; i++) {
    let nT = 0;
    for (let p = byBook.start[i]; p < byBook.start[i + 1]; p++) {
      const u = byBook.other[p];
      const vi = byBook.value[p];
      for (let q = byUser.start[u]; q < byUser.start[u + 1]; q++) {
        const j = byUser.other[q];
        if (common[j] === 0) touched[nT++] = j;
        dot[j] += vi * byUser.value[q];
        common[j]++;
      }
    }
    const cand = [];
    for (let t = 0; t < nT; t++) {
      const j = touched[t];
      const c = common[j];
      if (j !== i && c >= CF_MIN_COMMON && norm[i] > 0 && norm[j] > 0) {
        const s = (dot[j] / (norm[i] * norm[j])) * (c / (c + CF_SHRINK));
        if (s > 0) cand.push([j, s]);
      }
      dot[j] = 0;
      common[j] = 0;
    }
    cand.sort((a, b) => b[1] - a[1]);
    neighbors[i] = cand.slice(0, CF_TOP_K);
    if ((i + 1) % 2000 === 0) console.log(`    CF: ${i + 1} / ${nB} books`);
  }
  return neighbors;
}

// ---------- CBF variants ----------

// Subtracts the average embedding of all books and re-normalizes.
// Every book description shares a "generic book" direction; removing it stops
// generic books from looking similar to everything.
function centerEmbeddings(emb, has, dim, nB) {
  const meanVec = new Float64Array(dim);
  let n = 0;
  for (let b = 0; b < nB; b++) {
    if (!has[b]) continue;
    for (let d = 0; d < dim; d++) meanVec[d] += emb[b * dim + d];
    n++;
  }
  for (let d = 0; d < dim; d++) meanVec[d] /= n || 1;
  const out = new Float32Array(emb.length);
  for (let b = 0; b < nB; b++) {
    if (!has[b]) continue;
    let norm = 0;
    for (let d = 0; d < dim; d++) {
      const v = emb[b * dim + d] - meanVec[d];
      out[b * dim + d] = v;
      norm += v * v;
    }
    norm = Math.sqrt(norm) || 1;
    for (let d = 0; d < dim; d++) out[b * dim + d] /= norm;
  }
  return out;
}

// For every book: its CBF_TOP_K most similar books by content (like CF's
// neighbours, but by description instead of by readers).
function contentNeighbors(emb, has, dim, nB, topK) {
  const neighbors = new Array(nB);
  const scores = new Float32Array(nB);
  for (let i = 0; i < nB; i++) {
    if (!has[i]) {
      neighbors[i] = [];
      continue;
    }
    const oi = i * dim;
    for (let j = 0; j < nB; j++) {
      if (j === i || !has[j]) {
        scores[j] = -Infinity;
        continue;
      }
      const oj = j * dim;
      let s = 0;
      for (let d = 0; d < dim; d++) s += emb[oi + d] * emb[oj + d];
      scores[j] = s;
    }
    // keep the top K without sorting all books
    const top = [];
    let minVal = -Infinity;
    for (let j = 0; j < nB; j++) {
      const s = scores[j];
      if (top.length < topK) {
        top.push([j, s]);
        if (top.length === topK) minVal = Math.min(...top.map((t) => t[1]));
      } else if (s > minVal) {
        let minPos = 0;
        for (let t = 1; t < topK; t++) if (top[t][1] < top[minPos][1]) minPos = t;
        top[minPos] = [j, s];
        minVal = Math.min(...top.map((t) => t[1]));
      }
    }
    neighbors[i] = top.filter(([, s]) => s > 0);
    if ((i + 1) % 2000 === 0) console.log(`    CBF neighbours: ${i + 1} / ${nB} books`);
  }
  return neighbors;
}

// ---------- helpers ----------

function topK(scores, exclude, k) {
  const out = [];
  for (let b = 0; b < scores.length; b++) {
    if (exclude.has(b) || !(scores[b] > -Infinity)) continue;
    out.push(b);
  }
  out.sort((a, b) => scores[b] - scores[a]);
  return out.slice(0, k);
}

function metrics(recs, relevant, k) {
  let hits = 0;
  let dcg = 0;
  recs.forEach((b, i) => {
    if (relevant.has(b)) {
      hits++;
      dcg += 1 / Math.log2(i + 2);
    }
  });
  let idcg = 0;
  for (let i = 0; i < Math.min(relevant.size, k); i++) idcg += 1 / Math.log2(i + 2);
  return {
    precision: hits / k,
    recall: hits / relevant.size,
    hit: hits > 0 ? 1 : 0,
    ndcg: idcg ? dcg / idcg : 0,
  };
}

// ---------- main ----------

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Missing DATABASE_URL in .env file");
    process.exit(1);
  }
  const t0 = Date.now();
  console.log(`Settings: ${N_USERS} test users, K=${K}, hold-out ${HOLDOUT * 100}%, seed ${SEED}`);

  console.log("Reading ratings...");
  const ratings = await loadRatings();
  const { train, hidden, testUsers } = split(ratings);
  console.log(`Test users with hidden liked books: ${testUsers.length}`);

  // Index users and books (books = only those with ratings)
  const userIds = [...new Set(train.map((r) => r[0]))];
  const bookIds = [...new Set(ratings.map((r) => r[1]))];
  const uIndex = new Map(userIds.map((id, i) => [id, i]));
  const bIndex = new Map(bookIds.map((id, i) => [id, i]));
  const nU = userIds.length;
  const nB = bookIds.length;

  const uIdx = Int32Array.from(train, (r) => uIndex.get(r[0]));
  const bIdx = Int32Array.from(train, (r) => bIndex.get(r[1]));
  const sum = new Float64Array(nU);
  const cnt = new Int32Array(nU);
  train.forEach(([, , r], k) => {
    sum[uIdx[k]] += r;
    cnt[uIdx[k]]++;
  });
  const mean = Float64Array.from(sum, (s, u) => s / cnt[u]);
  const centered = Float32Array.from(train, (r, k) => r[2] - mean[uIdx[k]]);

  // Train ratings per test user
  const userTrain = new Map();
  train.forEach(([u, b, r]) => {
    if (!hidden.has(u)) return;
    if (!userTrain.has(u)) userTrain.set(u, []);
    userTrain.get(u).push([bIndex.get(b), r]);
  });

  // Popularity: number of 4-5 star ratings in train
  const popularity = new Float64Array(nB);
  train.forEach(([, b, r]) => {
    if (r >= LIKED) popularity[bIndex.get(b)]++;
  });

  console.log("Training CF on the train ratings only...");
  const neighbors = trainItemCF(uIdx, bIdx, centered, nU, nB);

  console.log("Loading embeddings for CBF...");
  const { emb, has, dim } = await loadEmbeddings(bIndex);
  const embCentered = centerEmbeddings(emb, has, dim, nB);
  console.log("Finding content neighbours for CBF-kNN...");
  const cbfNeighbors = contentNeighbors(embCentered, has, dim, nB, CBF_TOP_K);

  const models = ["Random", "Popularity", "CBF-mean", "CBF-centered", "CBF-kNN", "CF"];
  const totals = Object.fromEntries(models.map((m) => [m, { precision: 0, recall: 0, hit: 0, ndcg: 0, users: 0 }]));
  const recommended = Object.fromEntries(models.map((m) => [m, new Set()]));

  console.log("Evaluating...");
  let done = 0;
  for (const u of testUsers) {
    const mine = userTrain.get(u) || [];
    const exclude = new Set(mine.map(([b]) => b));
    const relevant = new Set([...hidden.get(u)].map((id) => bIndex.get(id)));
    const um = mine.reduce((s, [, r]) => s + r, 0) / (mine.length || 1);
    const recs = {};

    // Random
    const randomScores = Float64Array.from({ length: nB }, () => rand());
    recs.Random = topK(randomScores, exclude, K);

    // Popularity
    recs.Popularity = topK(popularity, exclude, K);

    // CBF-mean / CBF-centered: ONE profile = average embedding of the liked books
    // (all train books if none liked); recommend the books closest to it.
    const likedBooks = mine.filter(([, r]) => r >= LIKED).map(([b]) => b);
    const profileBooks = (likedBooks.length ? likedBooks : mine.map(([b]) => b)).filter((b) => has[b]);
    const profileScores = (vectors) => {
      const profile = new Float64Array(dim);
      for (const b of profileBooks) for (let d = 0; d < dim; d++) profile[d] += vectors[b * dim + d];
      const scores = new Float64Array(nB).fill(-Infinity);
      if (!profileBooks.length) return scores;
      for (let b = 0; b < nB; b++) {
        if (!has[b]) continue;
        let s = 0;
        for (let d = 0; d < dim; d++) s += profile[d] * vectors[b * dim + d];
        scores[b] = s;
      }
      return scores;
    };
    recs["CBF-mean"] = topK(profileScores(emb), exclude, K);
    recs["CBF-centered"] = topK(profileScores(embCentered), exclude, K);

    // CBF-kNN: each rated book SEPARATELY - its content neighbours, weighted by
    // how much the user liked it (same formula as CF, content instead of readers)
    const kScore = new Float64Array(nB);
    const kSupport = new Int32Array(nB);
    for (const [i, r] of mine) {
      for (const [j, s] of cbfNeighbors[i]) {
        kScore[j] += s * (r - um);
        kSupport[j]++;
      }
    }
    for (let b = 0; b < nB; b++) if (kSupport[b] < 1) kScore[b] = -Infinity;
    recs["CBF-kNN"] = topK(kScore, exclude, K);

    // CF: score(j) = sum_i sim(i,j) * (r_ui - mean_u), at least CF_MIN_SUPPORT supporting books
    const cfScore = new Float64Array(nB);
    const support = new Int32Array(nB);
    for (const [i, r] of mine) {
      for (const [j, s] of neighbors[i]) {
        cfScore[j] += s * (r - um);
        support[j]++;
      }
    }
    for (let b = 0; b < nB; b++) if (support[b] < CF_MIN_SUPPORT) cfScore[b] = -Infinity;
    recs.CF = topK(cfScore, exclude, K);

    for (const m of models) {
      const r = metrics(recs[m], relevant, K);
      const t = totals[m];
      t.precision += r.precision;
      t.recall += r.recall;
      t.hit += r.hit;
      t.ndcg += r.ndcg;
      t.users++;
      recs[m].forEach((b) => recommended[m].add(b));
    }
    if (++done % 100 === 0) console.log(`  ${done} / ${testUsers.length} users`);
  }

  // Report
  const pct = (x) => (x * 100).toFixed(2) + "%";
  const lines = [`model,precision@${K},recall@${K},hitrate@${K},ndcg@${K},coverage`];
  console.log(`\n================ RESULTS (K=${K}, ${testUsers.length} users) ================`);
  console.log(`${"Model".padEnd(14)}${`Precision@${K}`.padEnd(15)}${`Recall@${K}`.padEnd(13)}${`HitRate@${K}`.padEnd(14)}${`NDCG@${K}`.padEnd(11)}Coverage`);
  for (const m of models) {
    const t = totals[m];
    const row = {
      p: t.precision / t.users,
      r: t.recall / t.users,
      h: t.hit / t.users,
      n: t.ndcg / t.users,
      c: recommended[m].size / nB,
    };
    console.log(
      `${m.padEnd(14)}${pct(row.p).padEnd(15)}${pct(row.r).padEnd(13)}${pct(row.h).padEnd(14)}${pct(row.n).padEnd(11)}${pct(row.c)}`
    );
    lines.push([m, row.p, row.r, row.h, row.n, row.c].map((x) => (typeof x === "number" ? x.toFixed(4) : x)).join(","));
  }
  console.log("=".repeat(76));
  fs.mkdirSync("./data", { recursive: true });
  fs.writeFileSync(RESULTS_PATH, lines.join("\n"), "utf8");
  console.log(`Saved to ${RESULTS_PATH}. Done in ${Math.round((Date.now() - t0) / 1000)}s.`);
  await pool.end();
}

main().catch(async (err) => {
  console.error("Fatal error:", err);
  await pool.end();
  process.exit(1);
});