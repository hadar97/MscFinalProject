/**
 * Builds the CBF neighbour table `content_similarity`: for every book, its
 * TOP_K most similar books BY CONTENT (embedding of title + description).
 *
 * It is the content version of item_similarity (train-cf.js), and it is what
 * makes user-level CBF fast: a user's recommendations become ONE query over
 * this table, instead of one similarity search per book the user rated.
 *
 * - All books with an embedding are included: goodbooks AND Google books, so
 *   Google books (no ratings) can still be recommended to users.
 * - "Centered" embeddings: the average embedding of all books is subtracted
 *   first. Every description shares a generic "this is a book" direction;
 *   removing it stops generic books from looking similar to everything.
 *   (In the evaluation this was clearly better.)
 * - Only English books, like recommender.js.
 *
 * Re-run after embed-books.js adds books. It replaces the table.
 *
 * Run:
 *   node CBF/train-cbf.js
 *   node CBF/train-cbf.js --k 50
 */

const { Pool } = require("pg");
require("dotenv").config();

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i > -1 ? Number(process.argv[i + 1]) : def;
}
const TOP_K = arg("--k", 50);
const PAGE = 2000;
const INSERT_BATCH = 20000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function loadEmbeddings() {
  const ids = [];
  const vectors = [];
  let lastId = 0;
  for (;;) {
    const { rows } = await pool.query(
      `SELECT id, embedding::text AS e FROM books
       WHERE embedding IS NOT NULL AND language = 'en' AND id > $1
       ORDER BY id LIMIT $2;`,
      [lastId, PAGE]
    );
    if (!rows.length) break;
    for (const r of rows) {
      ids.push(r.id);
      vectors.push(JSON.parse(r.e));
    }
    lastId = rows[rows.length - 1].id;
    console.log(`  read ${ids.length.toLocaleString()} embeddings...`);
  }
  return { ids, vectors };
}

// Subtract the mean vector, then normalize each vector to length 1
function center(vectors) {
  const n = vectors.length;
  const dim = vectors[0].length;
  const mean = new Float64Array(dim);
  for (const v of vectors) for (let d = 0; d < dim; d++) mean[d] += v[d] / n;
  const emb = new Float32Array(n * dim);
  vectors.forEach((v, i) => {
    let norm = 0;
    for (let d = 0; d < dim; d++) {
      const x = v[d] - mean[d];
      emb[i * dim + d] = x;
      norm += x * x;
    }
    norm = Math.sqrt(norm) || 1;
    for (let d = 0; d < dim; d++) emb[i * dim + d] /= norm;
  });
  return { emb, dim };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Missing DATABASE_URL in .env file");
    process.exit(1);
  }
  const t0 = Date.now();
  console.log(`Settings: top-k=${TOP_K}`);
  console.log("Reading embeddings...");
  const { ids, vectors } = await loadEmbeddings();
  const n = ids.length;
  const { emb, dim } = center(vectors);
  vectors.length = 0;

  console.log(`Computing content neighbours for ${n.toLocaleString()} books...`);
  const out = { book: [], neighbor: [], sim: [] };
  const scores = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const oi = i * dim;
    for (let j = 0; j < n; j++) {
      if (j === i) {
        scores[j] = -Infinity;
        continue;
      }
      const oj = j * dim;
      let s = 0;
      for (let d = 0; d < dim; d++) s += emb[oi + d] * emb[oj + d];
      scores[j] = s;
    }
    // top K without sorting all books
    const top = [];
    let minPos = -1;
    for (let j = 0; j < n; j++) {
      const s = scores[j];
      if (top.length < TOP_K) {
        top.push([j, s]);
        if (top.length === TOP_K) {
          minPos = 0;
          for (let t = 1; t < TOP_K; t++) if (top[t][1] < top[minPos][1]) minPos = t;
        }
      } else if (s > top[minPos][1]) {
        top[minPos] = [j, s];
        minPos = 0;
        for (let t = 1; t < TOP_K; t++) if (top[t][1] < top[minPos][1]) minPos = t;
      }
    }
    top.sort((a, b) => b[1] - a[1]);
    for (const [j, s] of top) {
      if (s <= 0) break;
      out.book.push(ids[i]);
      out.neighbor.push(ids[j]);
      out.sim.push(s);
    }
    if ((i + 1) % 1000 === 0) console.log(`  ${i + 1} / ${n} books`);
  }
  console.log(`Kept ${out.book.length.toLocaleString()} similar pairs.`);

  console.log("Saving to content_similarity...");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DROP TABLE IF EXISTS content_similarity;`);
    await client.query(`
      CREATE TABLE content_similarity (
        book_id     INT  NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        neighbor_id INT  NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        similarity  REAL NOT NULL,   -- cosine of centered embeddings
        PRIMARY KEY (book_id, neighbor_id)
      );`);
    for (let k = 0; k < out.book.length; k += INSERT_BATCH) {
      await client.query(
        `INSERT INTO content_similarity (book_id, neighbor_id, similarity)
         SELECT * FROM unnest($1::int[], $2::int[], $3::real[]);`,
        [
          out.book.slice(k, k + INSERT_BATCH),
          out.neighbor.slice(k, k + INSERT_BATCH),
          out.sim.slice(k, k + INSERT_BATCH),
        ]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  console.log(`\nDone in ${Math.round((Date.now() - t0) / 1000)}s.`);
  await pool.end();
}

main().catch(async (err) => {
  console.error("Fatal error:", err.message);
  await pool.end();
  process.exit(1);
});