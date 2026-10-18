/**
 * The HYBRID recommender - the one the app calls.  (version 2)
 *
 * Chosen by measurement on the VALIDATION set (2,000 users, evaluate.js):
 *   regular users  - Precision@10 18.48%  (CF alone 18.31%, previous hybrid 18.18%)
 *   new users (5)  - Precision@10  6.85%  (CF alone 5.86%, proposal rule 3.13%)
 *
 *   1. Books WITH ratings (count - slots places):
 *        score = w * CF + (1 - w) * GenrePopularity,   w = n / (n + BETA)
 *      n = how many of the user's books CF knows. A new user leans on
 *      popularity, a user with many ratings on CF.
 *        BETA = 5:  n=0 -> 0% CF,  n=5 -> 50%,  n=20 -> 80%,  n=80 -> 94%
 *      GenrePopularity = how liked the book is, counted only INSIDE the user's
 *      genres (questionnaire answer, or - if not given - the genres most common
 *      among the books he liked). "Popular in your genres", not "popular with
 *      everyone" (which gave Harry Potter to everybody).
 *
 *   2. Books WITHOUT ratings (Google books) - `slots` places:
 *      only CBF can judge them: the best by content similarity to the user's
 *      books, and only if similar to at least 2 of them. Default 2 places; if
 *      the user chose genres that exist only in Google books (Technology,
 *      Health, Education), they get a matching share of the list.
 *
 *   The user's "average" is pulled toward the average of all readers when he
 *   has few ratings:  mean = (sum + 5 * globalMean) / (n + 5).
 *   So a new user who gave every book 5 stars still has books "above his
 *   average" - before this fix his recommendations from CF/CBF were all 0.
 *
 *   At most 2 books per author - but ONLY among books chosen by popularity.
 *   (A limit on ALL books cost 1.5 points of precision for regular users: the
 *   next book in a series - a CF pick - is often exactly what they want.)
 *
 * Tables used: item_similarity (CF/train-cf.js), content_similarity
 * (CBF/train-cbf.js), book_popularity (HYBRID/build-popularity.js), books
 * (main_genres, categories), dataset_ratings (global mean, once).
 *
 * Two ways to call it:
 *   getHybridRecommendations([{ bookId, rating }, ...], count, { genres })
 *       - for ANY user: an app user's ratings, or the onboarding questionnaire
 *         (stars 1-5 + the genres he chose, keys from onboarding/genres.js)
 *   getHybridRecommendationsForUser(userId, count)
 *       - for a goodbooks user in dataset_ratings (testing)
 *
 * Every result says WHY it was recommended (`reason`) - useful for the UI.
 */

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config();
const { GENRES, expandGenres, genreCondition } = require(path.join(__dirname, "..", "onboarding", "genres"));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const BETA = 5;                 // CF weight w = n / (n + BETA)
const NEW_BOOK_SLOTS = 2;       // places reserved for books without ratings
const CF_MIN_SUPPORT = 2;       // a CF candidate must come from >= 2 of the user's books
const NEW_BOOK_MIN_SUPPORT = 2; // a new book must be similar to >= 2 of the user's books (or all, if fewer)
const MEAN_SHRINK = 5;          // user mean pulled toward the global mean
const GENRES_INFERRED = 3;      // genres taken from the user's books when he did not choose
const OUTSIDE_GENRE = 0.01;     // tiny popularity for books outside his genres - only breaks ties
const CANDIDATES = 300;         // candidates fetched from each source before mixing
const POP_PER_AUTHOR = 2;       // max books per author among POPULARITY picks (CF picks unlimited)

// Global mean rating (all readers) - read once
let globalMeanPromise = null;
function getGlobalMean() {
  if (!globalMeanPromise) {
    globalMeanPromise = pool
      .query(`SELECT avg(rating)::float8 AS m FROM dataset_ratings;`)
      .then((r) => r.rows[0].m || 3.9);
  }
  return globalMeanPromise;
}

// goodreads value / Google category -> genre keys
const VALUE_TO_KEYS = (() => {
  const m = new Map();
  for (const g of GENRES) for (const v of [...g.goodreads, ...g.google]) {
    if (!m.has(v)) m.set(v, []);
    m.get(v).push(g.key);
  }
  return m;
})();

/** The genres most common among the user's liked books (4-5 stars; all if none) */
async function inferGenres(bookIds, stars) {
  const liked = bookIds.filter((_, i) => stars[i] >= 4);
  const use = liked.length ? liked : bookIds;
  if (!use.length) return [];
  const { rows } = await pool.query(
    `SELECT goodbooks_id, main_genres, categories FROM books WHERE id = ANY($1::int[]);`,
    [use]
  );
  const count = new Map();
  for (const r of rows) {
    // 10K books by their main genres, Google books by their categories
    const values = r.goodbooks_id ? r.main_genres || [] : r.categories || [];
    const keys = new Set(values.flatMap((v) => VALUE_TO_KEYS.get(v) || []));
    for (const k of keys) count.set(k, (count.get(k) || 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, GENRES_INFERRED).map((e) => e[0]);
}

/**
 * @param {{bookId:number, rating:number}[]} ratings  the user's ratings (1-5)
 * @param {number} [count=10]
 * @param {{genres?:string[], slots?:number, beta?:number}} [options]
 *        genres: keys from onboarding/genres.js (the questionnaire answer)
 */
async function getHybridRecommendations(ratings, count = 10, options = {}) {
  const beta = options.beta ?? BETA;
  const bookIds = ratings.map((r) => Number(r.bookId));
  const stars = ratings.map((r) => Number(r.rating));
  const n = ratings.length;

  // The user's genres: from the questionnaire, or inferred from his books
  const genres = options.genres?.length ? [...new Set(options.genres)] : await inferGenres(bookIds, stars);
  const { goodreads, google } = expandGenres(genres);

  // Places for books without ratings: 2, or the share of genres that exist only in Google books
  const googleOnly = genres.filter((k) => GENRES.find((g) => g.key === k).goodreads.length === 0).length;
  const slots = Math.min(
    count,
    options.slots ?? Math.max(NEW_BOOK_SLOTS, genres.length ? Math.round((count * googleOnly) / genres.length) : 0)
  );

  // CF weight counts only the user's books that CF knows (books with ratings)
  const { rows: known } = await pool.query(
    `SELECT count(*)::int AS n FROM book_popularity WHERE book_id = ANY($1::int[]);`,
    [bookIds]
  );
  const nCf = known[0].n;
  const w = nCf / (nCf + beta);

  // User mean, pulled toward the global mean
  const globalMean = await getGlobalMean();
  const mean = (stars.reduce((a, b) => a + b, 0) + MEAN_SHRINK * globalMean) / (n + MEAN_SHRINK);

  // 1a. CF candidates: score(j) = sum_i sim(i,j) * (r_i - mean)
  const cf = n
    ? (await pool.query(
        `WITH mine AS (SELECT * FROM unnest($1::int[], $2::int[]) AS t(book_id, rating))
         SELECT s.neighbor_id AS id,
                sum(s.similarity * (mine.rating - $3::float8)) AS score
         FROM mine
         JOIN item_similarity s ON s.book_id = mine.book_id
         WHERE s.neighbor_id <> ALL($1::int[])
         GROUP BY s.neighbor_id
         HAVING count(*) >= $4
         ORDER BY score DESC
         LIMIT $5;`,
        [bookIds, stars, mean, CF_MIN_SUPPORT, CANDIDATES]
      )).rows
    : [];

  // 1b. Popularity inside the user's genres (+ the global most liked, as a fallback)
  const { rows: popular } = await pool.query(
    `(SELECT p.book_id AS id, p.liked_count, ${genreCondition("$1", "$2")} AS in_genre
      FROM book_popularity p JOIN books b ON b.id = p.book_id
      WHERE ${genreCondition("$1", "$2")} AND p.book_id <> ALL($3::int[])
      ORDER BY p.liked_count DESC LIMIT $4)
     UNION
     (SELECT p.book_id, p.liked_count, ${genreCondition("$1", "$2")}
      FROM book_popularity p JOIN books b ON b.id = p.book_id
      WHERE p.book_id <> ALL($3::int[])
      ORDER BY p.liked_count DESC LIMIT $5)
     UNION
     (SELECT p.book_id, p.liked_count, ${genreCondition("$1", "$2")}
      FROM book_popularity p JOIN books b ON b.id = p.book_id
      WHERE p.book_id = ANY($6::int[]));`,
    [goodreads, google, bookIds, CANDIDATES, CANDIDATES, cf.map((r) => r.id)]
  );
  const maxInGenre = Math.max(0, ...popular.filter((r) => r.in_genre).map((r) => r.liked_count));
  const maxAll = Math.max(1, ...popular.map((r) => r.liked_count));
  const popNorm = new Map(
    popular.map((r) => [
      r.id,
      r.in_genre && maxInGenre > 0 ? r.liked_count / maxInGenre : (OUTSIDE_GENRE * r.liked_count) / maxAll,
    ])
  );
  const inGenre = new Set(popular.filter((r) => r.in_genre).map((r) => r.id));

  // Mix: w * CF(0..1) + (1 - w) * GenrePopularity(0..1)
  const maxCf = Math.max(0, ...cf.map((r) => Number(r.score)));
  const cfNorm = new Map(cf.map((r) => [r.id, maxCf > 0 ? Math.max(0, Number(r.score)) / maxCf : 0]));
  const rated = [...new Set([...cfNorm.keys(), ...popNorm.keys()])]
    .map((id) => {
      const c = cfNorm.get(id) || 0;
      const p = popNorm.get(id) || 0;
      return { id, score: w * c + (1 - w) * p, cf: c, popularity: p };
    })
    .sort((a, b) => b.score - a.score);

  // 2. Books without ratings: best by CBF (content neighbours of the user's books)
  const newBooks = n && slots
    ? (await pool.query(
        `WITH mine AS (SELECT * FROM unnest($1::int[], $2::int[]) AS t(book_id, rating))
         SELECT s.neighbor_id AS id,
                sum(s.similarity * (mine.rating - $3::float8)) AS score
         FROM mine
         JOIN content_similarity s ON s.book_id = mine.book_id
         JOIN books nb ON nb.id = s.neighbor_id
         LEFT JOIN book_popularity p ON p.book_id = s.neighbor_id
         WHERE p.book_id IS NULL                  -- no ratings at all
           AND s.neighbor_id <> ALL($1::int[])
         GROUP BY s.neighbor_id, nb.categories
         HAVING sum(s.similarity * (mine.rating - $3::float8)) > 0
            -- similar to enough of the user's books: 2 - or 1 if the book is
            -- in a Google genre the user CHOSE (he may have rated only one
            -- book of that genre, e.g. Fantasy + Technology)
            AND count(*) >= CASE WHEN nb.categories && $6::text[] THEN 1 ELSE $5 END
         ORDER BY score DESC
         LIMIT $4;`,
        [bookIds, stars, mean, slots, Math.min(NEW_BOOK_MIN_SUPPORT, n), options.genres?.length ? google : []]
      )).rows
    : [];

  // Authors of the candidates (for the limit below)
  const { rows: auth } = await pool.query(
    `SELECT id, lower(authors[1]) AS author FROM books WHERE id = ANY($1::int[]);`,
    [rated.slice(0, CANDIDATES).map((r) => r.id)]
  );
  const authorOf = new Map(auth.map((r) => [r.id, r.author]));

  // Combine: (count - new books) rated books + the new books.
  // At most POP_PER_AUTHOR books per author among the books that are here
  // because of POPULARITY (no "6 Harry Potters"). A book CF chose - readers
  // like you liked it, e.g. the next book in a series - is never removed.
  const picked = [];
  const perAuthor = new Map();
  for (const r of rated) {
    if (picked.length >= count - newBooks.length) break;
    const byCf = r.cf > 0 && w * r.cf >= (1 - w) * r.popularity;
    const a = authorOf.get(r.id);
    if (!byCf && a && (perAuthor.get(a) || 0) >= POP_PER_AUTHOR) continue;
    if (a) perAuthor.set(a, (perAuthor.get(a) || 0) + 1);
    picked.push({
      ...r,
      reason: byCf
        ? "Readers with similar taste liked it (CF)"
        : inGenre.has(r.id)
          ? "Popular in your genres"
          : "Popular with readers",
    });
  }
  for (const r of newBooks) {
    picked.push({
      id: r.id, score: Number(r.score), cf: 0, popularity: 0,
      reason: "Similar in content to books you liked - new, no ratings yet (CBF)",
    });
  }

  // Book details, in the same order
  const { rows: details } = await pool.query(
    `SELECT id, title, authors, categories, goodbooks_id, thumbnail_url
     FROM books WHERE id = ANY($1::int[]);`,
    [picked.map((p) => p.id)]
  );
  const byId = new Map(details.map((d) => [d.id, d]));
  return {
    cfWeight: w,
    genres,
    recommendations: picked.map((p) => ({ ...byId.get(p.id), ...p })),
  };
}

/** For a goodbooks user (dataset_ratings) - used for testing. */
async function getHybridRecommendationsForUser(userId, count = 10, options = {}) {
  const { rows } = await pool.query(
    `SELECT book_id, rating FROM dataset_ratings WHERE user_id = $1;`,
    [userId]
  );
  return getHybridRecommendations(
    rows.map((r) => ({ bookId: r.book_id, rating: r.rating })),
    count,
    options
  );
}

module.exports = {
  pool,
  BETA,
  NEW_BOOK_SLOTS,
  getHybridRecommendations,
  getHybridRecommendationsForUser,
};