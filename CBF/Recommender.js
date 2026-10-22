/**
 * Shared CBF recommender logic, used by recommend.js and test.js.
 *
 * Two functions:
 *   getSimilarBooks(bookId)              book -> similar books (below)
 *   getCbfRecommendationsForUser(userId) user -> recommendations (kNN, uses
 *                                        the content_similarity table built
 *                                        by train-cbf.js)
 *
 * getSimilarBooks:
 * Step 1: pgvector finds the closest books by embedding (cosine similarity).
 * Step 2: those candidates are re-ranked with a bonus:
 *           + MATCH_BONUS  ONLY if the book shares an author with the base
 *                          book AND shares a category with it.
 *         Same author alone, or same category alone, gives no bonus.
 *           + GENRE_BONUS x (share of the base book's main genres that the
 *                          other book has too) - 2 of 2 genres = full bonus,
 *                          1 of 2 = half. Books without main genres (Google
 *                          books) get 0, so nothing changes for them.
 *         final score = similarity + match_bonus + genre_bonus
 *
 * GENRE_BONUS = 0.1 chosen by measurement (CBF/compare-embeddings.js --rerank,
 * 22/10/2026, mpnet): chosen on groups A+B (100 books each), then checked on
 * two NEW groups C+D - readers agree@10 (without the series) 30.3% -> 33.3%
 * on C+D (+3.0, rule: +2). A genre given as separate data helps; the same
 * genre written into the embedded text (v3) did not.
 *
 * Tune MATCH_BONUS below (or pass it in `options`) and check the effect with
 * test.js. Set it to 0 for pure embedding similarity.
 *
 * Works on the combined books table: goodbooks-10k books (goodbooks_id set,
 * have ratings) and Google books (goodbooks_id NULL, no ratings).
 */

const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const MATCH_BONUS = 0.1;
const GENRE_BONUS = 0.1;

function formatAuthors(authors) {
  return authors && authors.length ? authors.join(", ") : "Unknown author";
}

function formatCategories(categories) {
  return categories && categories.length ? categories.join(", ") : "No category";
}

async function getBookById(id) {
  const result = await pool.query(
    `SELECT id, title, authors, categories, embedding, goodbooks_id
     FROM books
     WHERE id = $1;`,
    [id]
  );
  return result.rows[0] || null;
}

/**
 * @param {number|string} bookId
 * @param {number} count how many recommendations to return
 * @param {{matchBonus?: number, genreBonus?: number}} [options]
 */
async function getSimilarBooks(bookId, count, options = {}) {
  const matchBonus = options.matchBonus ?? MATCH_BONUS;
  const genreBonus = options.genreBonus ?? GENRE_BONUS;

  // Candidate pool for re-ranking. The bonus can only lift books that are
  // already among the closest by embedding.
  const candidates = Math.max(count * 10, 50);

  // <=> is the cosine distance operator from pgvector - smaller = more similar.
  // && is "arrays overlap" (shares at least one author / category).
  // We restrict to English-language books to avoid language acting as a
  // dominant, non-semantic similarity signal.
  const result = await pool.query(
    `SELECT c.*, c.similarity + c.match_bonus + c.genre_bonus AS score
     FROM (
       SELECT
         b.id,
         b.title,
         b.authors,
         b.categories,
         b.goodbooks_id,
         1 - (b.embedding <=> t.embedding) AS similarity,
         CASE
           WHEN b.authors && t.authors AND b.categories && t.categories
           THEN $3::float8
           ELSE 0::float8
         END AS match_bonus,
         CASE
           WHEN cardinality(t.main_genres) > 0
           THEN $5::float8 * (SELECT count(*) FROM unnest(b.main_genres) g WHERE g = ANY(t.main_genres))::float8
                / cardinality(t.main_genres)
           ELSE 0::float8
         END AS genre_bonus
       FROM books b,
            (SELECT embedding, authors, categories, main_genres FROM books WHERE id = $1) AS t
       WHERE b.id != $1
         AND b.embedding IS NOT NULL
         AND b.language = 'en'
       ORDER BY b.embedding <=> t.embedding
       LIMIT $4
     ) AS c
     ORDER BY score DESC
     LIMIT $2;`,
    [bookId, count, matchBonus, candidates, genreBonus]
  );
  return result.rows;
}

/**
 * CBF recommendations for a USER (kNN): every book the user rated is looked at
 * SEPARATELY - its content neighbours from content_similarity (train-cbf.js) -
 * and the results are added up:
 *
 *   score(j) = sum over the user's books i of  sim(i,j) * (r_ui - mean(u))
 *
 * A neighbour of a book the user loved (above their average) gains score,
 * a neighbour of a book they disliked loses score. This is the same formula
 * as CF - only the similarity comes from content instead of from readers.
 * Unlike one averaged profile, a user with several tastes (e.g. fantasy AND
 * biographies) gets books from each of them.
 *
 * Can recommend ANY book, including Google books without ratings.
 * `support` = how many of the user's books point to the recommended book.
 *
 * @param {number} userId  a user in dataset_ratings
 * @param {number} count
 * @param {number} [minSupport=1]
 */
async function getCbfRecommendationsForUser(userId, count, minSupport = 1) {
  const result = await pool.query(
    `WITH mine AS (
       SELECT book_id, rating FROM dataset_ratings WHERE user_id = $1
     ),
     avg_u AS (
       SELECT avg(rating)::float8 AS mean FROM mine
     )
     SELECT b.id, b.title, b.authors, b.categories, b.goodbooks_id,
            sum(s.similarity * (m.rating - a.mean)) AS score,
            count(*)::int AS support
     FROM mine m
     JOIN content_similarity s ON s.book_id = m.book_id
     JOIN books b ON b.id = s.neighbor_id
     CROSS JOIN avg_u a
     WHERE s.neighbor_id NOT IN (SELECT book_id FROM mine)
     GROUP BY b.id, b.title, b.authors, b.categories, b.goodbooks_id
     HAVING count(*) >= $3
     ORDER BY score DESC
     LIMIT $2;`,
    [userId, count, minSupport]
  );
  return result.rows;
}

// One printable line per recommendation, with the score breakdown
function formatRow(row, index) {
  const bonusText = Number(row.match_bonus) > 0 ? ", +same author & category" : "";
  // [10K] = from goodbooks-10k, has ratings (CF can use it); [Google] = no ratings
  const source = row.goodbooks_id ? "[10K]   " : "[Google]";
  return (
    `${index + 1}. ${source} "${row.title}" - ${formatAuthors(row.authors)} [${formatCategories(row.categories)}] ` +
    `(score: ${Number(row.score).toFixed(3)} = similarity ${Number(row.similarity).toFixed(3)}${bonusText})`
  );
}

module.exports = {
  pool,
  MATCH_BONUS,
  GENRE_BONUS,
  formatAuthors,
  formatCategories,
  getBookById,
  getSimilarBooks,
  getCbfRecommendationsForUser,
  formatRow,
};