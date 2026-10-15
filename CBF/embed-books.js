/**
 * Compute sentence embeddings for all books, for CBF (Content-Based Filtering)
 *
 * Uses all-MiniLM-L6-v2 (384 dims) via @xenova/transformers - runs locally
 * in Node, no external API needed. Stores the vector in the `embedding`
 * column (pgvector) on the books table in Neon.
 *
 * Run: node embed-books.js
 */

const { Pool } = require("pg");
require("dotenv").config();

const BATCH_SIZE = 25;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function ensureVectorSetup() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector;`);
  await pool.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS embedding vector(384);`);
}

async function getBooksNeedingEmbedding(limit) {
  const result = await pool.query(
    `SELECT id, title, description
     FROM books
     WHERE embedding IS NULL
     ORDER BY id
     LIMIT $1;`,
    [limit]
  );
  return result.rows;
}

function buildText(book) {
  const desc = book.description ? book.description.slice(0, 1000) : "";
  return desc ? book.title + ". " + desc : book.title;
}

function toVectorLiteral(floatArray) {
  return "[" + Array.from(floatArray).join(",") + "]";
}

async function saveEmbedding(id, vectorLiteral) {
  await pool.query(`UPDATE books SET embedding = $1::vector WHERE id = $2;`, [vectorLiteral, id]);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Missing DATABASE_URL in .env file");
    process.exit(1);
  }

  console.log("Loading embeddings model (first run downloads it - may take a while)...");
  const { pipeline } = await import("@xenova/transformers");
  const extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");

  await ensureVectorSetup();

  let totalProcessed = 0;

  while (true) {
    const books = await getBooksNeedingEmbedding(BATCH_SIZE);
    if (books.length === 0) break;

    for (const book of books) {
      const text = buildText(book);
      const output = await extractor(text, { pooling: "mean", normalize: true });
      const vectorLiteral = toVectorLiteral(output.data);
      await saveEmbedding(book.id, vectorLiteral);
      totalProcessed++;
    }

    console.log("Processed " + totalProcessed + " books so far...");
  }

  console.log("\nDone. Computed embeddings for " + totalProcessed + " books total.");
  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});