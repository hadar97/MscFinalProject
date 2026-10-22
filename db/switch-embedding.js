/**
 * Switch the app's book embeddings from MiniLM to mpnet - by RENAMING columns.
 *
 * Measured with CBF/compare-embeddings.js (22/10/2026, 200 popular books):
 *   readers agree@10 without the series   MiniLM 17.0%  ->  mpnet 22.4%  (+5.4, rule: +2)
 *
 *   before:  embedding        = MiniLM (384)   <- the app reads this column
 *            embedding_mpnet  = mpnet  (768)
 *   after:   embedding        = mpnet  (768)   <- the app reads this column, no code change
 *            embedding_minilm = MiniLM (384)   kept: backup, and for anything that still
 *                                              turns text into MiniLM vectors (check with Hadar)
 *
 * Nothing is deleted or computed - only names change, in ONE transaction
 * (all or nothing). An index on a column moves with it; the new `embedding`
 * gets no vector index: an exact scan of ~11K books is fast, and an HNSW index
 * would return at most ~40 rows per search (ef_search), too few for
 * CBF/Recommender.js which re-ranks a pool of 50+.
 *
 *   node db/switch-embedding.js              dry run: show the columns and what would happen
 *   node db/switch-embedding.js --apply      switch to mpnet
 *   node db/switch-embedding.js --rollback   back to MiniLM (the reverse renames)
 *
 * After the switch:
 *   - new books: node CBF/embed-books.js --model mpnet   (fills `embedding` with mpnet)
 *   - content_similarity (CBF-kNN in personal recommendations) is still built
 *     from MiniLM until CBF/train-cbf.js runs again - it reads every vector
 *     (~170MB), so run it after Neon's monthly network quota resets.
 */

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// embedding columns of books and their size (pgvector keeps the size in atttypmod)
async function columns(db) {
  const { rows } = await db.query(
    `SELECT attname AS name, atttypmod AS dim FROM pg_attribute
     WHERE attrelid = 'books'::regclass AND attname LIKE 'embedding%' AND NOT attisdropped AND attnum > 0
     ORDER BY attname;`
  );
  return new Map(rows.map((r) => [r.name, r.dim]));
}

async function main() {
  const cols = await columns(pool);
  console.log("Embedding columns in books:");
  for (const [name, dim] of cols) console.log(`  ${name.padEnd(18)} ${dim} numbers${dim === 384 ? "  (MiniLM)" : dim === 768 ? "  (mpnet)" : ""}`);
  const { rows: idx } = await pool.query(
    `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'books' AND indexdef ILIKE '%embedding%';`
  );
  console.log(idx.length ? `Vector indexes: ${idx.map((i) => i.indexname).join(", ")}` : "Vector indexes: none");

  let steps;
  if (ROLLBACK) {
    if (cols.get("embedding") !== 768 || cols.get("embedding_minilm") !== 384) {
      throw new Error("Nothing to roll back: expected embedding = mpnet (768) and embedding_minilm = MiniLM (384).");
    }
    steps = [
      ["embedding", "embedding_mpnet"],
      ["embedding_minilm", "embedding"],
    ];
  } else {
    if (cols.get("embedding") === 768) return console.log("\nAlready switched: `embedding` is mpnet.");
    if (cols.get("embedding") !== 384 || cols.get("embedding_mpnet") !== 768) {
      throw new Error("Expected embedding = MiniLM (384) and embedding_mpnet = mpnet (768). Run CBF/embed-books.js --column embedding_mpnet --model mpnet first.");
    }
    if (cols.has("embedding_minilm")) throw new Error("embedding_minilm already exists - check it before switching.");
    const { rows: missing } = await pool.query(`SELECT count(*)::int AS n FROM books WHERE embedding_mpnet IS NULL AND embedding IS NOT NULL;`);
    if (missing[0].n) throw new Error(`${missing[0].n} books have MiniLM but no mpnet vector - finish embed-books.js first.`);
    steps = [
      ["embedding", "embedding_minilm"],
      ["embedding_mpnet", "embedding"],
    ];
  }

  console.log(`\n${ROLLBACK ? "Roll back" : "Switch"}:`);
  for (const [from, to] of steps) console.log(`  ${from}  ->  ${to}`);
  if (!APPLY && !ROLLBACK) {
    console.log("\nDRY RUN - nothing changed. Run again with --apply to switch.");
    console.log("Before that: make sure nothing else (e.g. Hadar's chatbot) compares MiniLM vectors with books.embedding.");
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [from, to] of steps) await client.query(`ALTER TABLE books RENAME COLUMN ${from} TO ${to};`);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  const after = await columns(pool);
  console.log(`\nDone. embedding = ${after.get("embedding") === 768 ? "mpnet (768)" : "MiniLM (384)"}. Restart the server.`);
}

main()
  .catch((err) => {
    console.error("Error:", err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
