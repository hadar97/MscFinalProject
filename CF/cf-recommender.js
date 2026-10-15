/**
 * Item-item Collaborative Filtering (CF) recommendations.
 * Uses the table item_similarity built by train-item-cf.js.
 *
 * getCfSimilarBooks(bookId, count)
 *   "People who liked this book also liked..." - the book's CF neighbours.
 *
 * getCfRecommendationsForUser(userId, count)
 *   Recommendations for a goodbooks user, from the books they rated.
 *   For a candidate book j, over the user's books i that have j as a neighbour:
 *     score(j)     = sum_i sim(i,j) * (r_ui - mean(u))           <- used for RANKING
 *     predicted(j) = mean(u) + score(j) / sum_i |sim(i,j)|       <- estimated stars (1-5)
 *   Ranking by score (not by predicted) rewards books supported by MANY of the
 *   user's liked books. Ranking by predicted alone puts books that come from
 *   just 2 books at "5.00 stars" on top, which is noisy.
 *   Books the user already rated are excluded. `support` = how many of the
 *   user's books point to j.
 *
 * Only books that have ratings ([10K]) can appear in CF results - that is
 * exactly the cold-start gap the hybrid model fills with CBF.
 */

const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const MIN_SUPPORT = 2; // a recommendation must come from at least 2 of the user's books

async function getCfSimilarBooks(bookId, count) {
  const { rows } = await pool.query(
    `SELECT b.id, b.title, b.authors, b.categories, b.goodbooks_id,
            s.similarity, s.co_count
     FROM item_similarity s
     JOIN books b ON b.id = s.neighbor_id
     WHERE s.book_id = $1
     ORDER BY s.similarity DESC
     LIMIT $2;`,
    [bookId, count]
  );
  return rows;
}

async function getUserRatings(userId) {
  const { rows } = await pool.query(
    `SELECT r.book_id, r.rating, b.title, b.authors
     FROM dataset_ratings r JOIN books b ON b.id = r.book_id
     WHERE r.user_id = $1
     ORDER BY r.rating DESC, b.title;`,
    [userId]
  );
  return rows;
}

async function getCfRecommendationsForUser(userId, count, minSupport = MIN_SUPPORT) {
  const { rows } = await pool.query(
    `WITH mine AS (
       SELECT book_id, rating FROM dataset_ratings WHERE user_id = $1
     ),
     avg_u AS (
       SELECT avg(rating)::float8 AS mean FROM mine
     )
     SELECT b.id, b.title, b.authors, b.categories, b.goodbooks_id,
            sum(s.similarity * (m.rating - a.mean)) AS score,
            least(5, greatest(1,
              a.mean + sum(s.similarity * (m.rating - a.mean)) / sum(abs(s.similarity))
            )) AS predicted,
            count(*)::int AS support
     FROM mine m
     JOIN item_similarity s ON s.book_id = m.book_id
     JOIN books b ON b.id = s.neighbor_id
     CROSS JOIN avg_u a
     WHERE s.neighbor_id NOT IN (SELECT book_id FROM mine)
     GROUP BY b.id, b.title, b.authors, b.categories, b.goodbooks_id, a.mean
     HAVING count(*) >= $3
     ORDER BY score DESC
     LIMIT $2;`,
    [userId, count, minSupport]
  );
  return rows;
}

function formatAuthors(authors) {
  return authors && authors.length ? authors.join(", ") : "Unknown author";
}

module.exports = {
  pool,
  getCfSimilarBooks,
  getUserRatings,
  getCfRecommendationsForUser,
  formatAuthors,
};