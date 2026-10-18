/**
 * Onboarding questionnaire - backend functions.
 *
 * Flow (as in the proposal: "choose 3-5 genres", plus marking books):
 *   1. The user picks 3-5 genres (the list in genres.js).
 *   2. getOnboardingBooks(genres) -> ~20 books from those genres.
 *      The user rates each one 1-5 stars, or "haven't read" (no rating).
 *   3. answersToRatings(answers) -> [{bookId, rating}] for the hybrid
 *      recommender (getHybridRecommendations).
 *
 * How books are chosen for each genre (an equal share per genre):
 *   - Genre with rated books (10K): the most liked books (book_popularity) -
 *     well-known books, so the user probably read some of them.
 *   - Genre with only Google books (Technology, Health, Education): there are
 *     no ratings from our readers, and only ~9% of Google books have Google's
 *     own ratings. So:
 *       first  - books with at least 5 Google ratings (ratings_count)
 *       then   - the most TYPICAL books of the genre: closest (by embedding)
 *                to the genre's average embedding.
 *     Only books with a real description (200+ characters) - CBF needs it.
 *   - At most 2 books per author in the whole list (no "6 Harry Potters").
 *   - A 10K book counts in a genre by its 2 MAIN genres (main_genres), and
 *     books whose FIRST genre is the chosen one come first (Fellowship before
 *     The Hunger Games in Fantasy).
 *   - A genre with only Google books gets half a share (less known books).
 *
 * Try it:
 *   node onboarding/onboarding.js fantasy technology
 *   node onboarding/onboarding.js romance history-politics health
 */

const { Pool } = require("pg");
require("dotenv").config();
const { GENRES, expandGenres, genreCondition } = require("./genres");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const TOTAL_BOOKS = 20;
const MAX_PER_AUTHOR = 2;
const MIN_GOOGLE_RATINGS = 5;
const MIN_DESCRIPTION = 200;


function authorKey(book) {
  return (book.authors && book.authors[0] ? book.authors[0] : `?${book.id}`).toLowerCase().trim();
}

/** Most liked rated (10K) books of a genre */
async function ratedBooksOfGenre(genreKey, limit) {
  const { goodreads, google } = expandGenres([genreKey]);
  const { rows } = await pool.query(
    `SELECT b.id, b.title, b.authors, b.thumbnail_url, b.goodbooks_id
     FROM books b
     JOIN book_popularity p ON p.book_id = b.id
     WHERE ${genreCondition("$1", "$2")}
     ORDER BY (b.main_genres[1] = ANY($1::text[])) DESC,  -- the genre is the book's FIRST genre
              p.liked_count DESC                          -- then the most liked
     LIMIT $3;`,
    [goodreads, google, limit]
  );
  return rows;
}

/** Google books of a genre: with Google ratings first, then the most typical ones */
async function googleBooksOfGenre(genreKey, limit) {
  const { google } = expandGenres([genreKey]);
  if (!google.length) return [];
  const { rows } = await pool.query(
    `WITH g AS (
       SELECT id, title, authors, thumbnail_url, goodbooks_id, ratings_count, embedding
       FROM books
       WHERE goodbooks_id IS NULL
         AND categories && $1::text[]
         AND embedding IS NOT NULL
         AND length(coalesce(description, '')) >= $2
     ),
     c AS (SELECT avg(embedding) AS centroid FROM g)
     SELECT g.id, g.title, g.authors, g.thumbnail_url, g.goodbooks_id
     FROM g, c
     ORDER BY (coalesce(g.ratings_count, 0) >= $3) DESC,   -- books Google readers rated first
              g.embedding <=> c.centroid                   -- then the most typical of the genre
     LIMIT $4;`,
    [google, MIN_DESCRIPTION, MIN_GOOGLE_RATINGS, limit]
  );
  return rows;
}

/**
 * ~20 books for the questionnaire, an equal share from each chosen genre.
 * @param {string[]} genreKeys keys from genres.js, e.g. ["fantasy", "technology"]
 * @param {number} [total=20]
 * @returns {Promise<Array<{id, title, authors, thumbnail_url, goodbooks_id, genre}>>}
 */
async function getOnboardingBooks(genreKeys, total = TOTAL_BOOKS) {
  const keys = [...new Set(genreKeys)];
  if (!keys.length) throw new Error("Choose at least one genre");
  expandGenres(keys); // throws on an unknown genre

  // Share per genre. A genre with only Google books gets HALF a share: its
  // books are less known (the user will mostly answer "haven't read").
  const weight = keys.map((k) => (GENRES.find((g) => g.key === k).goodreads.length ? 1 : 0.5));
  const sumW = weight.reduce((a, b) => a + b, 0);
  const exact = weight.map((w) => (total * w) / sumW);
  const quota = exact.map(Math.floor);
  // hand out the remainder to the largest fractions
  const order = exact.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]);
  for (let r = total - quota.reduce((a, b) => a + b, 0), j = 0; r > 0; r--, j++) quota[order[j % order.length][1]]++;

  const picked = [];
  const seen = new Set();
  const perAuthor = new Map();
  const tryAdd = (book, genre) => {
    if (seen.has(book.id)) return false;
    const a = authorKey(book);
    if ((perAuthor.get(a) || 0) >= MAX_PER_AUTHOR) return false;
    seen.add(book.id);
    perAuthor.set(a, (perAuthor.get(a) || 0) + 1);
    picked.push({ ...book, genre });
    return true;
  };

  // Candidates per genre (extra, because some are skipped: author limit, already picked)
  const candidates = [];
  for (let i = 0; i < keys.length; i++) {
    const n = Math.max(quota[i], 1) * 6;
    const rated = await ratedBooksOfGenre(keys[i], n);
    const google = rated.length < n ? await googleBooksOfGenre(keys[i], n) : [];
    candidates.push([...rated, ...google]);
  }
  // 1st pass: each genre up to its share
  const pos = keys.map(() => 0);
  for (let i = 0; i < keys.length; i++) {
    let got = 0;
    while (got < quota[i] && pos[i] < candidates[i].length) {
      if (tryAdd(candidates[i][pos[i]++], keys[i])) got++;
    }
  }
  // 2nd pass: if a genre could not fill its share, the others fill the gap
  for (let i = 0; picked.length < total && keys.some((_, k) => pos[k] < candidates[k].length); i = (i + 1) % keys.length) {
    while (pos[i] < candidates[i].length) {
      if (tryAdd(candidates[i][pos[i]++], keys[i])) break;
    }
  }
  // Group by genre for display
  picked.sort((a, b) => keys.indexOf(a.genre) - keys.indexOf(b.genre));
  return picked.slice(0, total);
}

/**
 * The user's answers -> ratings for getHybridRecommendations.
 * Stars 1-5, the same scale as the goodbooks ratings CF learned from.
 * A book the user has not read has stars = null and is skipped.
 * @param {Array<{bookId:number, stars:number|null}>} answers
 */
function answersToRatings(answers) {
  return answers
    .filter((a) => Number.isInteger(a.stars) && a.stars >= 1 && a.stars <= 5)
    .map((a) => ({ bookId: Number(a.bookId), rating: a.stars }));
}

module.exports = { pool, GENRES, getOnboardingBooks, answersToRatings };

// ---- try it: node onboarding/onboarding.js fantasy technology ----
if (require.main === module) {
  (async () => {
    const keys = process.argv.slice(2);
    if (!keys.length) {
      console.log("Usage: node onboarding/onboarding.js <genre> [genre...]");
      console.log("Genres: " + GENRES.map((g) => g.key).join(", "));
      return pool.end();
    }
    const books = await getOnboardingBooks(keys);
    console.log(`\n${books.length} books for: ${keys.join(", ")}\n`);
    books.forEach((b, i) => {
      const source = b.goodbooks_id ? "[10K]   " : "[Google]";
      const authors = b.authors && b.authors.length ? b.authors.join(", ") : "Unknown author";
      console.log(`${String(i + 1).padStart(2)}. ${source} (${b.genre}) "${b.title}" - ${authors}`);
    });
    await pool.end();
  })().catch(async (e) => {
    console.error("Fatal error:", e.message);
    await pool.end();
    process.exit(1);
  });
}