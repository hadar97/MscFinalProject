/**
 * API for the SIGNED-IN user - everything under /api/me.
 *
 * The user is identified ONLY by the login token (server/auth.js), never by
 * an id in the address - so one user can never read or change another
 * user's data.
 *
 *   GET    /api/me                       profile, name, email, genres, number of ratings
 *   PATCH  /api/me                       { preferredCity }
 *   PUT    /api/me/genres                { genres: [...] }            (1-5 keys from genres.js)
 *   POST   /api/me/onboarding            { genres, answers }          saves the questionnaire + returns 10 recommendations
 *   GET    /api/me/ratings               the user's ratings (newest first)
 *   POST   /api/me/ratings               { bookId, rating } or { ratings: [{ bookId, rating }] }
 *   DELETE /api/me/ratings/:bookId
 *   POST   /api/me/events                { bookId, type }             saved | unsaved | started | finished | dismissed | clicked
 *   GET    /api/me/shelf                 { saved: [...], finished: [...] }  (from the events)
 *   GET    /api/me/recommendations       ?count=10 [&city=Jerusalem | &lat=&lng=&radiusKm=] [&mode=filter|boost]
 *
 * Events are only STORED for now (decided 21/10/2026); the model uses ratings.
 */

const express = require("express");

const EVENT_TYPES = new Set(["saved", "unsaved", "started", "finished", "dismissed", "clicked"]);
const CITIES = new Set(["Jerusalem", "Tel Aviv-Yafo"]);

module.exports = function meRoutes({ db, hybrid, requireUser, h }) {
  const { BadRequest, wrap, checkGenres, checkRatings, checkId, withTexts, nearbyFromQuery, parseNearby } = h;
  const router = express.Router();
  router.use(requireUser(db));

  // all book ids exist? (a clear 400 instead of a database error)
  async function checkBooksExist(ids) {
    if (!ids.length) return;
    const { rows } = await db.query(`SELECT id FROM books WHERE id = ANY($1::int[]);`, [ids]);
    const found = new Set(rows.map((r) => r.id));
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length) throw new BadRequest(`unknown book ids: ${missing.slice(0, 10).join(", ")}`);
  }

  async function saveRatings(client, userId, ratings, source) {
    if (!ratings.length) return;
    await client.query(
      `INSERT INTO user_ratings (user_id, book_id, rating, source)
       SELECT $1, b, r, $4 FROM unnest($2::int[], $3::smallint[]) AS t(b, r)
       ON CONFLICT (user_id, book_id) DO UPDATE SET rating = EXCLUDED.rating, updated_at = now();`,
      [userId, ratings.map((r) => r.bookId), ratings.map((r) => r.rating), source]
    );
  }

  async function saveGenres(client, userId, genres) {
    await client.query(`DELETE FROM user_genres WHERE user_id = $1;`, [userId]);
    if (genres.length) {
      await client.query(
        `INSERT INTO user_genres (user_id, genre_key) SELECT $1, unnest($2::text[]);`,
        [userId, genres]
      );
    }
  }

  async function recommendFor(userId, count, nearby) {
    const [{ rows: ratings }, { rows: genres }] = await Promise.all([
      db.query(`SELECT book_id, rating FROM user_ratings WHERE user_id = $1;`, [userId]),
      db.query(`SELECT genre_key FROM user_genres WHERE user_id = $1;`, [userId]),
    ]);
    const result = await hybrid.getHybridRecommendations(
      ratings.map((r) => ({ bookId: r.book_id, rating: r.rating })),
      count,
      { genres: genres.map((g) => g.genre_key), nearby }
    );
    return { ...result, recommendations: result.recommendations.map(withTexts) };
  }

  // ---------- profile ----------
  router.get("/", wrap(async (req, res) => {
    const u = req.user;
    const [{ rows: acc }, { rows: genres }, { rows: n }] = await Promise.all([
      db.query(`SELECT name, email FROM neon_auth."user" WHERE id = $1;`, [u.authUserId]),
      db.query(`SELECT genre_key FROM user_genres WHERE user_id = $1 ORDER BY genre_key;`, [u.id]),
      db.query(`SELECT count(*)::int AS n FROM user_ratings WHERE user_id = $1;`, [u.id]),
    ]);
    res.json({
      id: u.id,
      name: acc[0]?.name ?? null,
      email: acc[0]?.email ?? u.email,
      userType: u.user_type,
      libraryId: u.library_id,
      preferredCity: u.preferred_city,
      onboarded: Boolean(u.onboarded_at),
      genres: genres.map((g) => g.genre_key),
      ratingsCount: n[0].n,
    });
  }));

  router.patch("/", wrap(async (req, res) => {
    const city = req.body.preferredCity ?? null;
    if (city !== null && !CITIES.has(city)) throw new BadRequest(`preferredCity must be one of: ${[...CITIES].join(", ")}`);
    await db.query(`UPDATE users SET preferred_city = $1 WHERE id = $2;`, [city, req.user.id]);
    res.json({ ok: true, preferredCity: city });
  }));

  router.put("/genres", wrap(async (req, res) => {
    const genres = checkGenres(req.body.genres, { min: 1, max: 5 });
    await saveGenres(db, req.user.id, genres);
    res.json({ ok: true, genres });
  }));

  // ---------- questionnaire ----------
  router.post("/onboarding", wrap(async (req, res) => {
    const genres = checkGenres(req.body.genres, { min: 1, max: 5 });
    const ratings = checkRatings(req.body); // stars 1-5 only; "haven't read" dropped
    await checkBooksExist(ratings.map((r) => r.bookId));
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await saveGenres(client, req.user.id, genres);
      await saveRatings(client, req.user.id, ratings, "onboarding");
      await client.query(`UPDATE users SET onboarded_at = coalesce(onboarded_at, now()) WHERE id = $1;`, [req.user.id]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    res.json({ saved: { genres, ratings: ratings.length }, ...(await recommendFor(req.user.id, 10)) });
  }));

  // ---------- ratings ----------
  router.get("/ratings", wrap(async (req, res) => {
    const { rows } = await db.query(
      `SELECT r.book_id AS "bookId", r.rating, r.source, r.updated_at AS "updatedAt", b.title, b.authors, b.thumbnail_url
       FROM user_ratings r JOIN books b ON b.id = r.book_id
       WHERE r.user_id = $1 ORDER BY r.updated_at DESC;`,
      [req.user.id]
    );
    res.json({ ratings: rows });
  }));

  router.post("/ratings", wrap(async (req, res) => {
    const list = req.body.ratings ?? [{ bookId: req.body.bookId, rating: req.body.rating }];
    if (!Array.isArray(list) || !list.length || list.length > 500) throw new BadRequest("send { bookId, rating } or { ratings: [...] } (up to 500)");
    const ratings = list.map((r) => {
      const rating = Number(r.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new BadRequest("rating must be 1-5");
      return { bookId: checkId(r.bookId), rating };
    });
    await checkBooksExist(ratings.map((r) => r.bookId));
    await saveRatings(db, req.user.id, ratings, req.body.source === "chat" ? "chat" : "app");
    res.json({ ok: true, saved: ratings.length });
  }));

  router.delete("/ratings/:bookId", wrap(async (req, res) => {
    const bookId = checkId(req.params.bookId);
    const { rowCount } = await db.query(`DELETE FROM user_ratings WHERE user_id = $1 AND book_id = $2;`, [req.user.id, bookId]);
    res.json({ ok: true, deleted: rowCount });
  }));

  // ---------- events (stored only, for now) ----------
  router.post("/events", wrap(async (req, res) => {
    const bookId = checkId(req.body.bookId);
    const type = String(req.body.type || "");
    if (!EVENT_TYPES.has(type)) throw new BadRequest(`type must be one of: ${[...EVENT_TYPES].join(", ")}`);
    await checkBooksExist([bookId]);
    await db.query(`INSERT INTO user_events (user_id, book_id, type) VALUES ($1, $2, $3);`, [req.user.id, bookId, type]);
    res.json({ ok: true });
  }));

  // ---------- shelf: saved + finished books (from the events) ----------
  router.get("/shelf", wrap(async (req, res) => {
    const { rows } = await db.query(
      `WITH last_save AS (
         SELECT DISTINCT ON (book_id) book_id, type, created_at
         FROM user_events WHERE user_id = $1 AND type IN ('saved', 'unsaved')
         ORDER BY book_id, created_at DESC
       ), finished AS (
         SELECT book_id, max(created_at) AS created_at
         FROM user_events WHERE user_id = $1 AND type = 'finished' GROUP BY book_id
       )
       SELECT 'saved' AS list, b.id, b.title, b.authors, b.thumbnail_url, s.created_at AS at
       FROM last_save s JOIN books b ON b.id = s.book_id WHERE s.type = 'saved'
       UNION ALL
       SELECT 'finished', b.id, b.title, b.authors, b.thumbnail_url, f.created_at
       FROM finished f JOIN books b ON b.id = f.book_id
       ORDER BY at DESC;`,
      [req.user.id]
    );
    const pick = (list) => rows.filter((r) => r.list === list).map(({ list: _l, at, ...b }) => ({ ...b, at }));
    res.json({ saved: pick("saved"), finished: pick("finished") });
  }));

  // ---------- recommendations from the saved ratings ----------
  router.get("/recommendations", wrap(async (req, res) => {
    const count = Math.min(Math.max(Number(req.query.count) || 10, 1), 30);
    let nearby;
    const where = nearbyFromQuery(req.query);
    if (where) {
      nearby = { ...where, mode: req.query.mode };
      parseNearby(nearby); // 400 on bad input
    }
    res.json(await recommendFor(req.user.id, count, nearby));
  }));

  return router;
};
