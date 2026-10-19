/**
 * RecoRead recommendation API - the one file the website talks to.
 *
 * The website (React / Next.js) calls these addresses; this server calls the
 * recommendation code we built and measured (onboarding, hybrid, CBF).
 *
 *   GET  /api/health                      is the server up + database reachable
 *   GET  /api/onboarding/questionnaire    the questionnaire: screens, texts, genres
 *   POST /api/onboarding/books            { genres } -> ~20 books to rate
 *   POST /api/recommendations             { answers | ratings, genres, count } -> 10 books
 *   GET  /api/books/search?q=harry        search books by title (for search boxes)
 *   GET  /api/books/:id                   one book's details
 *   GET  /api/books/:id/similar           "similar books" for a book page (CBF)
 *
 * There is no users table yet: the website sends the user's ratings and genres
 * in the request. When the users table exists (with Hadar), the server will
 * read them from there instead - the recommendation code stays the same.
 *
 * Setup (once):   npm install express cors
 * Run:            node server/server.js
 * Then try in the browser:  http://localhost:3001/api/health
 */

const path = require("path");
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const root = path.join(__dirname, "..");
const hybrid = require(path.join(root, "hybrid", "hybrid-recommender"));
const { getOnboardingBooks, answersToRatings } = require(path.join(root, "onboarding", "onboarding"));
const { QUESTIONNAIRE } = require(path.join(root, "onboarding", "questionnaire"));
const { GENRES } = require(path.join(root, "onboarding", "genres"));
const cbf = require(path.join(root, "CBF", "Recommender"));

const db = hybrid.pool; // reuse the hybrid's connection pool for simple reads
const PORT = Number(process.env.PORT) || 3001;
const GENRE_KEYS = new Set(GENRES.map((g) => g.key));

const app = express();
app.use(cors());                          // the website runs on another port in development
app.use(express.json({ limit: "100kb" }));

// ---------- input checks (never trust what the browser sends) ----------
class BadRequest extends Error {}

function checkGenres(genres, { min = 0, max = 5 } = {}) {
  if (genres === undefined) genres = [];
  if (!Array.isArray(genres)) throw new BadRequest("genres must be a list");
  const unknown = genres.filter((g) => !GENRE_KEYS.has(g));
  if (unknown.length) throw new BadRequest(`unknown genres: ${unknown.join(", ")}`);
  if (genres.length < min || genres.length > max) throw new BadRequest(`choose ${min}-${max} genres`);
  return [...new Set(genres)];
}

function checkId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new BadRequest("bad book id");
  return id;
}

// answers from the questionnaire: [{ bookId, stars: 1-5 | null }]
// or ratings from the app: [{ bookId, rating: 1-5 }]
function checkRatings(body) {
  const list = body.answers ?? body.ratings ?? [];
  if (!Array.isArray(list) || list.length > 1000) throw new BadRequest("answers must be a list (up to 1000)");
  const answers = list.map((a) => ({
    bookId: checkId(a.bookId),
    stars: a.stars === null || a.stars === undefined ? (a.rating ?? null) : a.stars,
  }));
  return answersToRatings(answers); // keeps only stars 1-5, drops "haven't read"
}

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

// Hebrew text for each recommendation reason (from questionnaire.js)
function withHebrewReason(rec) {
  const label = QUESTIONNAIRE.reasonLabels[rec.reason];
  return { ...rec, reasonHe: label ? label.he : rec.reason, reasonEn: label ? label.en : rec.reason };
}

// ---------- routes ----------

app.get("/api/health", wrap(async (req, res) => {
  await db.query("SELECT 1");
  res.json({ ok: true });
}));

app.get("/api/onboarding/questionnaire", (req, res) => {
  res.json(QUESTIONNAIRE);
});

app.post("/api/onboarding/books", wrap(async (req, res) => {
  const genres = checkGenres(req.body.genres, { min: 1, max: 5 });
  const books = await getOnboardingBooks(genres);
  res.json({ books });
}));

async function recommend(req, res) {
  const genres = checkGenres(req.body.genres);
  const ratings = checkRatings(req.body);
  const count = Math.min(Math.max(Number(req.body.count) || 10, 1), 30);
  const result = await hybrid.getHybridRecommendations(ratings, count, { genres });
  res.json({ ...result, recommendations: result.recommendations.map(withHebrewReason) });
}
app.post("/api/recommendations", wrap(recommend));
app.post("/api/onboarding/submit", wrap(recommend)); // the name used in questionnaire.js

app.get("/api/books/search", wrap(async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 2) throw new BadRequest("search needs at least 2 letters");
  const { rows } = await db.query(
    `SELECT id, title, authors, thumbnail_url, goodbooks_id
     FROM books
     WHERE title ILIKE '%' || $1 || '%'
     ORDER BY (lower(title) = lower($1)) DESC, goodbooks_id NULLS LAST, length(title)
     LIMIT 20;`,
    [q]
  );
  res.json({ books: rows });
}));

app.get("/api/books/:id", wrap(async (req, res) => {
  const id = checkId(req.params.id);
  const { rows } = await db.query(
    `SELECT b.id, b.title, b.authors, b.description, b.categories, b.main_genres,
            b.thumbnail_url, b.published_date, b.page_count, b.goodbooks_id,
            p.ratings_count, p.liked_count
     FROM books b LEFT JOIN book_popularity p ON p.book_id = b.id
     WHERE b.id = $1;`,
    [id]
  );
  if (!rows[0]) return res.status(404).json({ error: "book not found" });
  res.json(rows[0]);
}));

app.get("/api/books/:id/similar", wrap(async (req, res) => {
  const id = checkId(req.params.id);
  const count = Math.min(Math.max(Number(req.query.count) || 6, 1), 20);
  const books = await cbf.getSimilarBooks(id, count);
  res.json({ books: books.map(({ id: bid, title, authors, goodbooks_id, score }) => ({ id: bid, title, authors, goodbooks_id, score })) });
}));

// ---------- errors ----------
app.use((req, res) => res.status(404).json({ error: "no such address" }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof BadRequest || err.message?.startsWith("Unknown genre")) {
    return res.status(400).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: "server error" });
});

app.listen(PORT, () => {
  console.log(`RecoRead API on http://localhost:${PORT}  (try /api/health)`);
});
