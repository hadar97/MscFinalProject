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
 *   Hybrid a=X  - alpha * CF + (1 - alpha) * CBF-kNN, both normalized to 0..1
 *                 per user. Several fixed alphas are compared.
 *   Hybrid-adapt- alpha = n / (n + BETA), n = how many ratings the user has:
 *                 a user with few ratings leans on CBF, with many on CF.
 *
 *   Proposal-rule - exactly the rule written in the project proposal:
 *                 a user with fewer than 10 ratings gets CBF only (CBF-kNN);
 *                 from 10 ratings CF takes over (CBF fills places CF cannot).
 *                 CF scores only books with at least 5 ratings.
 *
 *   Hybrid-genre - Hybrid-final, but popularity counted only inside the user's
 *                 genres (questionnaire simulation: his 3 most common genres
 *                 among the books he liked, by main_genres / genres.js).
 *   Hybrid-v2   - Hybrid-genre + user mean pulled toward the global mean
 *                 (--mean-shrink 5). (--max-author 2 = at most 2 books per author:
 *                 measured, lowers precision, so off by default.)
 *   Hybrid-v3   - Hybrid-v2 + at most 2 books per author among the books chosen
 *                 by POPULARITY only (--pop-author). CF's picks are never removed.
 *
 * Three parts: TRAIN / VALIDATION / TEST.
 *   Each test user's ratings are split: 20% TEST, another 20% VALIDATION, the
 *   rest train. The TEST part is never used for choosing settings.
 *     node evaluate.js --validation   -> test part removed completely, models
 *                                        measured on the VALIDATION part.
 *                                        Use this to choose settings (grid search).
 *     node evaluate.js                -> validation part goes back into train,
 *                                        models measured on the TEST part.
 *                                        Run once at the end, for the report.
 *
 * Cold start: --cold 5 simulates NEW users - each test user keeps only 5
 * known ratings (the rest are removed from training too). This is where CBF
 * and the hybrid are expected to matter most.
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
 *   node evaluate.js --cold 5          new users with only 5 known ratings
 *   node evaluate.js --validation      measure on the validation part (for tuning)
 *   node evaluate.js --validation --emb embedding_v2   CBF with another embedding column
 */

const fs = require("fs");
const path = require("path");
// The questionnaire's genre list (onboarding/genres.js, next to this folder)
const { GENRES } = require(path.join(__dirname, "..", "onboarding", "genres"));
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
const COLD = arg("--cold", 0); // >0: test users keep only this many known ratings
const COLD_ITEMS = arg("--cold-items", 0); // >0: this fraction of books lose all their ratings
// Hybrid: score = alpha * CF + (1 - alpha) * CBF (both normalized to 0..1 per user)
const HYBRID_ALPHAS = [0.3, 0.5, 0.7, 0.9]; // fixed weights to compare
const HYBRID_BETA = arg("--beta", 20); // adaptive: alpha = n / (n + beta), n = user's ratings
const FINAL_BETA = arg("--final-beta", 5); // Hybrid-final: CF weight w = n / (n + FINAL_BETA)
const FINAL_SLOTS = arg("--slots", 2);     // Hybrid-final: places reserved for books without ratings
const VALIDATION = process.argv.includes("--validation"); // measure on validation instead of test
// Which embedding column CBF uses (e.g. --emb embedding_v2 to test the version with genres)
const EMB_COLUMN = (() => {
  const i = process.argv.indexOf("--emb");
  const c = i > -1 ? process.argv[i + 1] : "embedding";
  if (!/^[a-z_][a-z0-9_]*$/.test(c)) throw new Error(`Bad --emb column: ${c}`);
  return c;
})();
// Proposal-rule (from the project proposal)
const PROPOSAL_MIN_USER_RATINGS = arg("--proposal-min", 10); // CF starts from 10 user ratings
const PROPOSAL_MIN_BOOK_RATINGS = 5;                          // CF scores a book from 5 ratings
const MIN_USER_RATINGS = 20;
// Hybrid-genre / Hybrid-v2 (questionnaire simulation)
const GENRES_PICKED = arg("--genres-picked", 3); // the user "chose" his 3 most common genres
const MEAN_SHRINK = arg("--mean-shrink", 5);     // Hybrid-v2: user mean pulled toward the global mean
const POP_PER_AUTHOR = arg("--pop-author", 2);   // Hybrid-v3: books per author among POPULARITY picks
const MAX_PER_AUTHOR = arg("--max-author", 99);  // Hybrid-v2: books per author (99 = no limit; 2 cost 1.5 points)
const LIKED = 4; // rating >= 4 = "liked"

// CF settings - the same as train-item-cf.js / cf-recommender.js
const CF_TOP_K = 50;
const CF_SHRINK = 10;
const CF_MIN_COMMON = 5;
const CF_MIN_SUPPORT = 2;
const CBF_TOP_K = 50; // content neighbours per book, for CBF-kNN

const PAGE = 200000;
const RESULTS_PATH =
  (COLD_ITEMS ? `./data/eval-results-newbooks` : COLD ? `./data/eval-results-cold${COLD}` : "./data/eval-results") +
  (VALIDATION ? "-val" : "") + (EMB_COLUMN !== "embedding" ? `-${EMB_COLUMN}` : "") + ".csv";

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

// For every rated book: its genre keys (genres.js, by main_genres) and first author
async function loadBookMeta(bookIndex) {
  const valueToKeys = new Map();
  for (const g of GENRES) for (const v of g.goodreads) {
    if (!valueToKeys.has(v)) valueToKeys.set(v, []);
    valueToKeys.get(v).push(g.key);
  }
  const genreKeys = Array.from({ length: bookIndex.size }, () => []);
  const author = new Array(bookIndex.size);
  const { rows } = await pool.query(
    `SELECT id, main_genres, lower(authors[1]) AS author FROM books WHERE goodbooks_id IS NOT NULL;`
  );
  for (const r of rows) {
    const b = bookIndex.get(r.id);
    if (b === undefined) continue;
    const keys = new Set();
    for (const v of r.main_genres || []) for (const k of valueToKeys.get(v) || []) keys.add(k);
    genreKeys[b] = [...keys];
    author[b] = r.author || undefined;
  }
  return { genreKeys, author };
}

async function loadEmbeddings(bookIndex) {
  const { rows } = await pool.query(
    `SELECT id, ${EMB_COLUMN}::text AS e FROM books
     WHERE goodbooks_id IS NOT NULL AND ${EMB_COLUMN} IS NOT NULL;`
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

  // --cold-items F: a fraction F of the books become "new books" for TEST and
  // another F for VALIDATION: ALL their ratings are removed from training. A
  // user's relevant books = the new books they liked. Only a model that does
  // not need ratings can find them. (Same shuffles in both modes, so the
  // test books are always the same ones.)
  if (COLD_ITEMS) {
    const allBooks = [...new Set(ratings.map((r) => r[1]))].sort((a, b) => a - b);
    const nCold = Math.round(allBooks.length * COLD_ITEMS);
    const shuffled = shuffle(allBooks);
    const testBooks = new Set(shuffled.slice(0, nCold));
    const valBooks = new Set(shuffled.slice(nCold, 2 * nCold));
    const removed = (b) => testBooks.has(b) || (VALIDATION && valBooks.has(b));
    const target = VALIDATION ? valBooks : testBooks;
    const hiddenAll = new Set();
    for (const [u, b] of ratings) if (removed(b)) hiddenAll.add(`${u}|${b}`);
    const hidden = new Map();
    for (const u of shuffle(eligible.sort((a, b) => a - b))) {
      const liked = byUser.get(u).filter(([b, r]) => target.has(b) && r >= LIKED).map(([b]) => b);
      if (liked.length) hidden.set(u, new Set(liked));
      if (hidden.size >= N_USERS) break;
    }
    const train = ratings.filter(([u, b]) => !hiddenAll.has(`${u}|${b}`));
    return { train, hidden, testUsers: [...hidden.keys()] };
  }

  const testUsers = shuffle(eligible.sort((a, b) => a - b)).slice(0, N_USERS);

  const hidden = new Map(); // user -> Set of hidden liked books (relevant)
  const hiddenAll = new Set(); // "user|book" of every rating removed from training
  for (const u of testUsers) {
    // Same shuffle in both modes: [ TEST | VALIDATION | train ... ]
    const list = shuffle([...byUser.get(u)]);
    const nPart = Math.max(1, Math.round(list.length * HOLDOUT));
    const testPart = list.slice(0, nPart);
    const valPart = list.slice(nPart, 2 * nPart);
    const rest = list.slice(2 * nPart);

    // The TEST part is always removed from training.
    for (const [b] of testPart) hiddenAll.add(`${u}|${b}`);
    // --validation: the validation part is removed too and is what we measure.
    // Otherwise it goes back into training.
    if (VALIDATION) for (const [b] of valPart) hiddenAll.add(`${u}|${b}`);
    const measured = VALIDATION ? valPart : testPart;
    const relevant = new Set(measured.filter(([, r]) => r >= LIKED).map(([b]) => b));

    // --cold N: the user is "new" - only N ratings are known (taken from the
    // train part, the same N in both modes); everything else is removed
    if (COLD) {
      for (const [b] of valPart) hiddenAll.add(`${u}|${b}`);
      for (const [b] of rest.slice(COLD)) hiddenAll.add(`${u}|${b}`);
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

// Like topK, but at most `cap` books per author (counts shared through `used`)
function topKCapped(scores, exclude, k, authorOf, cap, used = new Map()) {
  const order = [];
  for (let b = 0; b < scores.length; b++) {
    if (exclude.has(b) || !(scores[b] > -Infinity)) continue;
    order.push(b);
  }
  order.sort((a, b) => scores[b] - scores[a]);
  const out = [];
  for (const b of order) {
    const a = authorOf[b];
    if (a !== undefined && (used.get(a) || 0) >= cap) continue;
    if (a !== undefined) used.set(a, (used.get(a) || 0) + 1);
    out.push(b);
    if (out.length === k) break;
  }
  return out;
}

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
  console.log(`Measuring on: ${VALIDATION ? "VALIDATION part (for choosing settings)" : "TEST part (final numbers)"}`);
  console.log(`CBF embeddings from column: ${EMB_COLUMN}`);
  console.log(`Settings: ${N_USERS} test users, K=${K}, hold-out ${HOLDOUT * 100}%, seed ${SEED}` +
    (COLD ? `, COLD START: test users keep only ${COLD} known ratings` : "") +
    (COLD_ITEMS ? `, NEW BOOKS: ${COLD_ITEMS * 100}% of books have no ratings` : ""));

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

  // All database reads happen here, BEFORE the long calculations, so a
  // connection that drops while the CPU is busy cannot break the run.
  console.log("Loading book genres and authors...");
  const { genreKeys: bookGenres, author: authorOf } = await loadBookMeta(bIndex);
  console.log("Loading embeddings for CBF...");
  const { emb, has, dim } = await loadEmbeddings(bIndex);

  console.log("Training CF on the train ratings only...");
  const neighbors = trainItemCF(uIdx, bIdx, centered, nU, nB);

  const embCentered = centerEmbeddings(emb, has, dim, nB);
  console.log("Finding content neighbours for CBF-kNN...");
  const cbfNeighbors = contentNeighbors(embCentered, has, dim, nB, CBF_TOP_K);

  const hybridNames = [...HYBRID_ALPHAS.map((a) => `Hybrid a=${a}`), "Hybrid-adapt", "Hybrid-RRF", "Hybrid-switch", "Hybrid-final",
    "Hybrid-genre", "Hybrid-v2", "Hybrid-v3"];

  const globalMean = train.reduce((s2, r) => s2 + r[2], 0) / train.length;

  // For Hybrid-final: how many train ratings each book has, and popularity 0..1
  const ratingCount = new Int32Array(nB);
  train.forEach(([, b]) => ratingCount[bIndex.get(b)]++);
  let maxPop = 0;
  for (let b = 0; b < nB; b++) if (popularity[b] > maxPop) maxPop = popularity[b];
  const popN = Float64Array.from(popularity, (p) => (maxPop ? p / maxPop : 0));
  const models = ["Random", "Popularity", "CBF-mean", "CBF-centered", "CBF-kNN", "CF", "Proposal-rule", ...hybridNames];
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

    // Proposal-rule (as written in the proposal):
    //  fewer than 10 ratings -> CBF only;
    //  10+ ratings -> CF (only books with 5+ ratings), CBF fills the empty places
    if (mine.length < PROPOSAL_MIN_USER_RATINGS) {
      recs["Proposal-rule"] = recs["CBF-kNN"];
    } else {
      const cfOk = Float64Array.from(cfScore, (s, b) =>
        ratingCount[b] >= PROPOSAL_MIN_BOOK_RATINGS ? s : -Infinity);
      const cfList = topK(cfOk, exclude, K);
      const fill = topK(kScore, new Set([...exclude, ...cfList]), K - cfList.length);
      recs["Proposal-rule"] = [...cfList, ...fill];
    }

    // Hybrid: normalize each model's scores to 0..1 for this user (divide by
    // its best score), books a model has no opinion on get 0 from it, then
    //   hybrid = alpha * CF + (1 - alpha) * CBF
    const normalize = (scores) => {
      let max = 0;
      for (let b = 0; b < nB; b++) if (!exclude.has(b) && scores[b] > max) max = scores[b];
      return Float64Array.from(scores, (s) => (max > 0 && s > 0 ? s / max : 0));
    };
    const cfN = normalize(cfScore);
    const cbfN = normalize(kScore);
    const hybrid = (alpha) => {
      const h = new Float64Array(nB);
      for (let b = 0; b < nB; b++) {
        h[b] = cfN[b] === 0 && cbfN[b] === 0 ? -Infinity : alpha * cfN[b] + (1 - alpha) * cbfN[b];
      }
      return topK(h, exclude, K);
    };
    for (const a of HYBRID_ALPHAS) recs[`Hybrid a=${a}`] = hybrid(a);
    // adaptive: the more ratings the user has, the more weight CF gets
    recs["Hybrid-adapt"] = hybrid(mine.length / (mine.length + HYBRID_BETA));

    // Rank fusion (RRF): uses positions instead of scores: 1/(60 + rank) per model
    const rankOf = (scores) => {
      const order = topK(scores, exclude, 300);
      const r = new Map();
      order.forEach((b, i) => r.set(b, i + 1));
      return r;
    };
    const cfRank = rankOf(cfScore);
    const cbfRank = rankOf(kScore);
    const rrf = new Float64Array(nB).fill(-Infinity);
    for (const [b, r] of cfRank) rrf[b] = 1 / (60 + r);
    for (const [b, r] of cbfRank) rrf[b] = (rrf[b] > -Infinity ? rrf[b] : 0) + 1 / (60 + r);
    recs["Hybrid-RRF"] = topK(rrf, exclude, K);

    // Switching: CF's list first; CBF fills only the places CF cannot fill
    // (books CF has no opinion on - e.g. books without ratings)
    const cfList = topK(cfScore, exclude, K);
    const fill = topK(kScore, new Set([...exclude, ...cfList]), K - cfList.length);
    recs["Hybrid-switch"] = [...cfList, ...fill];

    // FINAL hybrid - each situation handled by the model that is good at it:
    //  * books WITH ratings: w * CF + (1 - w) * Popularity, w = n / (n + FINAL_BETA)
    //    (new user, few ratings -> mostly popularity; many ratings -> mostly CF)
    //  * books WITHOUT ratings: only CBF can judge them, so FINAL_SLOTS of the K
    //    places are reserved for the best of them by CBF (if there are any)
    const w = mine.length / (mine.length + FINAL_BETA);
    const rated = new Float64Array(nB).fill(-Infinity);
    for (let b = 0; b < nB; b++) {
      if (ratingCount[b] > 0) rated[b] = w * cfN[b] + (1 - w) * popN[b];
    }
    // same rule as hybrid-recommender.js: a new book must be similar to at
    // least 2 of the user's books (or all of them, if fewer)
    const minNewSupport = Math.min(2, mine.length);
    const unrated = Float64Array.from(kScore, (s, b) =>
      ratingCount[b] === 0 && s > 0 && kSupport[b] >= minNewSupport ? s : -Infinity);
    const newBooks = topK(unrated, exclude, FINAL_SLOTS);
    const main = topK(rated, new Set([...exclude, ...newBooks]), K - newBooks.length);
    recs["Hybrid-final"] = [...main, ...newBooks];

    // ---- Questionnaire simulation ----
    // The user "chose" GENRES_PICKED genres in the questionnaire: we take the
    // genres most common among the books he liked (in train). Then popularity
    // is counted ONLY inside those genres ("popular in the genres you chose")
    // instead of popular with everyone.
    const genreCount = new Map();
    const likedTrain = mine.filter(([, r]) => r >= LIKED);
    for (const [b] of likedTrain.length ? likedTrain : mine) {
      for (const g of bookGenres[b]) genreCount.set(g, (genreCount.get(g) || 0) + 1);
    }
    const chosen = new Set([...genreCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, GENRES_PICKED).map((e) => e[0]));
    const inChosen = (b) => bookGenres[b].some((g) => chosen.has(g));
    let maxGenrePop = 0;
    for (let b = 0; b < nB; b++) if (inChosen(b) && popularity[b] > maxGenrePop) maxGenrePop = popularity[b];
    const popGenre = (b) => (maxGenrePop && inChosen(b) ? popularity[b] / maxGenrePop : 0);

    // Hybrid-genre: Hybrid-final, but popularity inside the chosen genres
    const ratedG = new Float64Array(nB).fill(-Infinity);
    for (let b = 0; b < nB; b++) if (ratingCount[b] > 0) ratedG[b] = w * cfN[b] + (1 - w) * popGenre(b);
    const mainG = topK(ratedG, new Set([...exclude, ...newBooks]), K - newBooks.length);
    recs["Hybrid-genre"] = [...mainG, ...newBooks];

    // Hybrid-v2: Hybrid-genre + two fixes
    //  * the user's mean is pulled toward the global mean when he has few
    //    ratings: mean = (sum + MEAN_SHRINK * globalMean) / (n + MEAN_SHRINK).
    //    (A new user who gave everything 5 stars still has books "above his mean".)
    //  * at most MAX_PER_AUTHOR books per author in the list
    const umS = (mine.reduce((s2, [, r]) => s2 + r, 0) + MEAN_SHRINK * globalMean) / (mine.length + MEAN_SHRINK);
    const cfS = new Float64Array(nB);
    const cfSup = new Int32Array(nB);
    const kS = new Float64Array(nB);
    const kSup = new Int32Array(nB);
    for (const [i, r] of mine) {
      for (const [j, s2] of neighbors[i]) { cfS[j] += s2 * (r - umS); cfSup[j]++; }
      for (const [j, s2] of cbfNeighbors[i]) { kS[j] += s2 * (r - umS); kSup[j]++; }
    }
    for (let b = 0; b < nB; b++) if (cfSup[b] < CF_MIN_SUPPORT) cfS[b] = -Infinity;
    const cfSN = normalize(cfS);
    const ratedV2 = new Float64Array(nB).fill(-Infinity);
    for (let b = 0; b < nB; b++) if (ratingCount[b] > 0) ratedV2[b] = w * cfSN[b] + (1 - w) * popGenre(b);
    const unratedV2 = Float64Array.from(kS, (s2, b) =>
      ratingCount[b] === 0 && s2 > 0 && kSup[b] >= minNewSupport ? s2 : -Infinity);
    const used = new Map();
    const newV2 = topKCapped(unratedV2, exclude, FINAL_SLOTS, authorOf, MAX_PER_AUTHOR, used);
    const mainV2 = topKCapped(ratedV2, new Set([...exclude, ...newV2]), K - newV2.length, authorOf, MAX_PER_AUTHOR, used);
    recs["Hybrid-v2"] = [...mainV2, ...newV2];

    // Hybrid-v3: Hybrid-v2 + at most POP_PER_AUTHOR books per author, but ONLY
    // for books that are there because of POPULARITY. A book CF chose (readers
    // like you liked it - e.g. the next book in a series you read) is never
    // removed. Fights "6 Harry Potters" for new users (the proposal's
    // "bias toward global popularity") without hurting CF.
    const orderV3 = [];
    for (let b = 0; b < nB; b++) if (!exclude.has(b) && ratedV2[b] > -Infinity && !newV2.includes(b)) orderV3.push(b);
    orderV3.sort((a, b) => ratedV2[b] - ratedV2[a]);
    const authorsV3 = new Map();
    const mainV3 = [];
    for (const b of orderV3) {
      if (mainV3.length >= K - newV2.length) break;
      const a = authorOf[b];
      const popDriven = (1 - w) * popGenre(b) > w * cfSN[b];
      if (popDriven && a !== undefined && (authorsV3.get(a) || 0) >= POP_PER_AUTHOR) continue;
      if (a !== undefined) authorsV3.set(a, (authorsV3.get(a) || 0) + 1);
      mainV3.push(b);
    }
    recs["Hybrid-v3"] = [...mainV3, ...newV2];

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
  console.log(`${"Model".padEnd(16)}${`Precision@${K}`.padEnd(15)}${`Recall@${K}`.padEnd(13)}${`HitRate@${K}`.padEnd(14)}${`NDCG@${K}`.padEnd(11)}Coverage`);
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
      `${m.padEnd(16)}${pct(row.p).padEnd(15)}${pct(row.r).padEnd(13)}${pct(row.h).padEnd(14)}${pct(row.n).padEnd(11)}${pct(row.c)}`
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