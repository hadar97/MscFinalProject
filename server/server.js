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
 *   GET  /api/libraries?city=Jerusalem    library branches (for a map / a "choose library" list)
 *   GET  /api/books/:id/availability      where a book is on the shelf (?lat=&lng=&radiusKm= | ?city=)
 *
 * Signed-in user (Neon Auth token in "Authorization: Bearer ..."), see server/me-routes.js:
 *   GET/PATCH /api/me, PUT /api/me/genres, POST /api/me/onboarding,
 *   GET/POST /api/me/ratings, DELETE /api/me/ratings/:bookId, POST /api/me/events,
 *   GET /api/me/recommendations   (recommendations from the SAVED ratings and genres)
 *
 * Library availability in recommendations - ONLY if the request asks for it:
 *   POST /api/recommendations { ..., nearby: { location: {lat, lng}, radiusKm, mode } }
 *        nearby can also be { city: "Jerusalem" } or { libraryIds: [1, 2] };
 *        mode "filter" (default) = only books on the shelf nearby, "boost" = those first.
 *   The inventory is SIMULATED for now (library/simulate-inventory.js).
 *
 * Two ways to get recommendations:
 *   POST /api/recommendations     - ratings + genres sent in the request (no login; guests, tests)
 *   GET  /api/me/recommendations  - a signed-in user; ratings + genres read from the database
 *
 * Setup (once):   npm install express cors jose
 *                 .env: DATABASE_URL, NEON_AUTH_BASE_URL (Neon Console -> Auth)
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
const { parseNearby, getAvailability, NearbyError } = require(path.join(root, "library", "availability"));

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

// Text to show under each recommended book (the app is in English):
// reasonText from questionnaire.js reasonLabels, availabilityText if asked
function withTexts(rec) {
  const out = { ...rec, reasonText: QUESTIONNAIRE.reasonLabels[rec.reason] || rec.reason };
  if (rec.availability !== undefined) out.availabilityText = availabilityText(rec.availability);
  return out;
}

// "Available at Gilo Library (2.3 km) and 2 more branches"
function availabilityText(a) {
  if (!a) return "Not available right now in the chosen libraries";
  const n = a.nearest;
  const dist = n.distanceKm === null ? "" : ` (${n.distanceKm} km)`;
  const more = a.branchCount === 2 ? " and 1 more branch" : a.branchCount > 2 ? ` and ${a.branchCount - 1} more branches` : "";
  return `Available at ${n.name}${dist}${more}`;
}

// nearby / location from a query string: ?lat=&lng=&radiusKm= or ?city=
function nearbyFromQuery(q) {
  if (q.lat !== undefined || q.lng !== undefined) {
    return { location: { lat: q.lat, lng: q.lng }, radiusKm: q.radiusKm };
  }
  if (q.city) return { city: q.city };
  return null;
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
  // Library availability only if asked; checked here so bad input is a 400
  const nearby = req.body.nearby ? req.body.nearby : undefined;
  if (nearby) parseNearby(nearby);
  const result = await hybrid.getHybridRecommendations(ratings, count, { genres, nearby });
  res.json({ ...result, recommendations: result.recommendations.map(withTexts) });
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
  // covers for the website (CBF returns the book data without them)
  const { rows: covers } = await db.query(
    `SELECT id, thumbnail_url FROM books WHERE id = ANY($1::int[]);`,
    [books.map((b) => b.id)]
  );
  const coverOf = new Map(covers.map((c) => [c.id, c.thumbnail_url]));
  res.json({
    books: books.map(({ id: bid, title, authors, goodbooks_id, score }) => ({
      id: bid, title, authors, goodbooks_id, score, thumbnail_url: coverOf.get(bid) || null,
    })),
  });
}));

app.get("/api/libraries", wrap(async (req, res) => {
  const params = [];
  let where = "WHERE is_open";
  if (req.query.city) {
    const { city } = parseNearby({ city: req.query.city });
    params.push(city);
    where += ` AND city = $1`;
  }
  const { rows } = await db.query(
    `SELECT id, name, city, address, lat, lng FROM libraries ${where} ORDER BY city, name;`,
    params
  );
  res.json({ libraries: rows, inventorySimulated: true });
}));

app.get("/api/books/:id/availability", wrap(async (req, res) => {
  const id = checkId(req.params.id);
  const nearby = nearbyFromQuery(req.query);
  const where = nearby ? parseNearby(nearby) : { lat: null, lng: null, radiusKm: null, city: null, libraryIds: null };
  const avail = (await getAvailability(db, [id], where)).get(id) || null;
  res.json({ bookId: id, availability: avail, availabilityText: availabilityText(avail), inventorySimulated: true });
}));

// ---------- the signed-in user (/api/me) ----------
const { requireUser } = require("./auth");
const meRoutes = require("./me-routes");
app.use("/api/me", meRoutes({
  db, hybrid, requireUser,
  h: { BadRequest, wrap, checkGenres, checkRatings, checkId, withTexts, nearbyFromQuery, parseNearby },
}));

// ---------- errors ----------
app.use((req, res) => res.status(404).json({ error: "no such address" }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof BadRequest || err instanceof NearbyError || err.message?.startsWith("Unknown genre")) {
    return res.status(400).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: "server error" });
});

app.listen(PORT, () => {
  console.log(`RecoRead API on http://localhost:${PORT}  (try /api/health)`);
});
