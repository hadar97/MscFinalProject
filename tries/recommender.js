/**
 * Shared CBF recommender logic, used by recommend.js and test.js.
 *
 * Step 1: pgvector finds the closest books by embedding (cosine similarity).
 * Step 2: those candidates are re-ranked with a bonus:
 *           + MATCH_BONUS  ONLY if the book shares an author with the base
 *                          book AND shares a category with it.
 *         Same author alone, or same category alone, gives no bonus.
 *         final score = similarity + match_bonus
 *
 * Tune MATCH_BONUS below (or pass it in `options`) and check the effect with
 * test.js. Set it to 0 for pure embedding similarity.
 */

const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const MATCH_BONUS = 0.1;

function formatAuthors(authors) {
  return authors && authors.length ? authors.join(", ") : "Unknown author";
}

function formatCategories(categories) {
  return categories && categories.length ? categories.join(", ") : "No category";
}

async function getBookById(id) {
  const result = await pool.query(
    `SELECT id, title, authors, categories, embedding
     FROM books
     WHERE id = $1;`,
    [id]
  );
  return result.rows[0] || null;
}

/**
 * @param {number|string} bookId
 * @param {number} count how many recommendations to return
 * @param {{matchBonus?: number}} [options]
 */
async function getSimilarBooks(bookId, count, options = {}) {
  const matchBonus = options.matchBonus ?? MATCH_BONUS;

  // Candidate pool for re-ranking. The bonus can only lift books that are
  // already among the closest by embedding.
  const candidates = Math.max(count * 10, 50);

  // <=> is the cosine distance operator from pgvector - smaller = more similar.
  // && is "arrays overlap" (shares at least one author / category).
  // We restrict to English-language books to avoid language acting as a
  // dominant, non-semantic similarity signal.
  const result = await pool.query(
    `SELECT c.*, c.similarity + c.match_bonus AS score
     FROM (
       SELECT
         b.id,
         b.title,
         b.authors,
         b.categories,
         1 - (b.embedding <=> t.embedding) AS similarity,
         CASE
           WHEN b.authors && t.authors AND b.categories && t.categories
           THEN $3::float8
           ELSE 0::float8
         END AS match_bonus
       FROM books b,
            (SELECT embedding, authors, categories FROM books WHERE id = $1) AS t
       WHERE b.id != $1
         AND b.embedding IS NOT NULL
         AND b.language = 'en'
       ORDER BY b.embedding <=> t.embedding
       LIMIT $4
     ) AS c
     ORDER BY score DESC
     LIMIT $2;`,
    [bookId, count, matchBonus, candidates]
  );
  return result.rows;
}

// One printable line per recommendation, with the score breakdown
function formatRow(row, index) {
  const bonusText = Number(row.match_bonus) > 0 ? ", +same author & category" : "";
  return (
    `${index + 1}. "${row.title}" - ${formatAuthors(row.authors)} [${formatCategories(row.categories)}] ` +
    `(score: ${Number(row.score).toFixed(3)} = similarity ${Number(row.similarity).toFixed(3)}${bonusText})`
  );
}

module.exports = {
  pool,
  MATCH_BONUS,
  formatAuthors,
  formatCategories,
  getBookById,
  getSimilarBooks,
  formatRow,
};