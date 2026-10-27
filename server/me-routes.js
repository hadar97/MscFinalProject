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
 *   POST   /api/me/rate-more             { skip: [ids] } -> ~20 books from the user's genres to rate,
 *                                        without the books he already rated (and without `skip`)
 *   POST   /api/me/ratings               { bookId, rating } or { ratings: [{ bookId, rating }] }
 *   DELETE /api/me/ratings/:bookId
 *   POST   /api/me/events                { bookId, type }             saved | unsaved | started | finished | dismissed | clicked
 *                                        (in the app "saved" = on the user's TBR list, "to be read")
 *   GET    /api/me/shelf                 { saved: [...], finished: [...] }  (from the events)
 *   GET    /api/me/consents              { needed, versions, current: { terms, privacy, age_16, research } }
 *   POST   /api/me/consents              { terms, privacy, age16, research, source } - only the keys sent are saved
 *   GET    /api/me/author                author status: type, linked books, latest request, profile, pen name to prefill
 *   PUT    /api/me/author/profile        { penName, bio, website } - the author's page (authors only)
 *   GET    /api/me/author/insights       how readers respond to the author's books (server/author-insights.js)
 *   GET    /api/me/author/insights/audience?book=<id>|all   genres of the readers who loved it, books they also loved
 *   POST   /api/me/author-request        { penName, books, message } - "I am the author of these books"
 *   GET    /api/me/insights              personal reading analytics (server/insights.js)
 *   GET    /api/me/recommendations       ?count=10 [&exclude=1,2,3] [&city=Jerusalem | &lat=&lng=&radiusKm=] [&mode=filter|boost]
 *                                        exclude = books already shown ("Recommend more") - 10 NEW ones
 *
 * Events are only STORED for now (decided 21/10/2026); the model uses ratings.
 */

const express = require("express");
const { computeInsights } = require("./insights");
const { computeAuthorInsights, computeAudience } = require("./author-insights");
const { notifyAuthorRequest } = require("./mailer");
const { authorPage, knownPenName, profilesTable, cleanWebsite } = require("./author-profiles");
const { CONSENT_VERSIONS, REQUIRED, SOURCES, BODY_KEYS, currentConsents, consentNeeded } = require("./consents");
const path = require("path");
const { getOnboardingBooks } = require(path.join(__dirname, "..", "onboarding", "onboarding"));

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

  async function recommendFor(userId, count, nearby, exclude = []) {
    const [{ rows: ratings }, { rows: genres }, { rows: dismissed }] = await Promise.all([
      db.query(`SELECT book_id, rating FROM user_ratings WHERE user_id = $1;`, [userId]),
      db.query(`SELECT genre_key FROM user_genres WHERE user_id = $1;`, [userId]),
      // Never recommended again: "Not for me" (✕), "I finished it", and books
      // now on the TBR list ("to be read" = the latest saved/unsaved event is saved)
      db.query(
        `SELECT book_id FROM user_events WHERE user_id = $1 AND type IN ('dismissed', 'finished')
         UNION
         SELECT book_id FROM (
           SELECT DISTINCT ON (book_id) book_id, type FROM user_events
           WHERE user_id = $1 AND type IN ('saved', 'unsaved')
           ORDER BY book_id, created_at DESC
         ) t WHERE type = 'saved';`,
        [userId]
      ),
    ]);
    exclude = [...exclude, ...dismissed.map((d) => d.book_id)];
    const result = await hybrid.getHybridRecommendations(
      ratings.map((r) => ({ bookId: r.book_id, rating: r.rating })),
      count,
      { genres: genres.map((g) => g.genre_key), nearby, diversify: true, exclude }
    );
    return { ...result, recommendations: result.recommendations.map(withTexts) };
  }

  // ---------- consents (Terms, Privacy Policy, age 16+, optional research use) ----------
  router.get("/consents", wrap(async (req, res) => {
    const current = await currentConsents(db, req.user.id);
    res.json({ needed: consentNeeded(current), required: REQUIRED, versions: CONSENT_VERSIONS, current });
  }));

  // Saves one row per key sent (history is kept). Required consents cannot be
  // declined - without them the app cannot be used (delete the account instead).
  router.post("/consents", wrap(async (req, res) => {
    const source = SOURCES.has(req.body.source) ? req.body.source : "consent_page";
    const items = [];
    for (const [key, type] of Object.entries(BODY_KEYS)) {
      if (req.body[key] === undefined) continue;
      if (typeof req.body[key] !== "boolean") throw new BadRequest(`${key} must be true or false`);
      if (REQUIRED.includes(type) && req.body[key] !== true) {
        throw new BadRequest(`${key} is required to use BookBridge`);
      }
      items.push({ type, granted: req.body[key] });
    }
    if (!items.length) throw new BadRequest("send at least one of: terms, privacy, age16, research");
    await db.query(
      `INSERT INTO user_consents (user_id, consent_type, version, granted, source)
       SELECT $1, t, v, g, $5 FROM unnest($2::text[], $3::text[], $4::boolean[]) AS x(t, v, g);`,
      [req.user.id, items.map((i) => i.type), items.map((i) => CONSENT_VERSIONS[i.type]), items.map((i) => i.granted), source]
    );
    const current = await currentConsents(db, req.user.id);
    res.json({ ok: true, needed: consentNeeded(current), current });
  }));

  // ---------- authors: status and "become an author" requests ----------
  router.get("/author", wrap(async (req, res) => {
    const [{ rows: books }, { rows: reqs }] = await Promise.all([
      db.query(
        `SELECT b.id, b.title, b.thumbnail_url FROM author_books ab JOIN books b ON b.id = ab.book_id
         WHERE ab.user_id = $1 ORDER BY b.title;`,
        [req.user.id]
      ),
      db.query(
        `SELECT id, pen_name, books, status, note, created_at, decided_at FROM author_requests
         WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1;`,
        [req.user.id]
      ).catch((err) => (err.code === "42P01" ? { rows: [] } : Promise.reject(err))), // table not created yet
    ]);
    const r = reqs[0];
    const page = books.length ? await authorPage(db, req.user.id).catch(() => null) : null;
    res.json({
      isAuthor: req.user.user_type === "author",
      books,
      userId: req.user.id,
      profile: page ? { penName: page.penName, bio: page.bio, website: page.website } : null,
      penName: page?.penName || (await knownPenName(db, req.user.id).catch(() => null)), // to prefill the next request
      request: r ? { id: Number(r.id), penName: r.pen_name, books: r.books, status: r.status, note: r.note, createdAt: r.created_at, decidedAt: r.decided_at } : null,
    });
  }));

  router.get("/author/insights", wrap(async (req, res) => {
    const data = await computeAuthorInsights(db, req.user.id);
    if (!data.books.length) return res.status(403).json({ error: "author insights are for authors linked to a book" });
    res.json(data);
  }));

  router.get("/author/insights/audience", wrap(async (req, res) => {
    const book = req.query.book === "all" || req.query.book === undefined ? "all" : checkId(req.query.book);
    const data = await computeAudience(db, req.user.id, book);
    if (!data) return res.status(404).json({ error: "not one of your books" });
    res.json(data);
  }));

  router.put("/author/profile", wrap(async (req, res) => {
    const { rowCount } = await db.query(`SELECT 1 FROM author_books WHERE user_id = $1 LIMIT 1;`, [req.user.id]);
    if (!rowCount) return res.status(403).json({ error: "only authors linked to a book have an author page" });
    if (!(await profilesTable(db))) throw new BadRequest("author pages are not set up yet (db/create-author-profiles-table.js)");
    const penName = typeof req.body.penName === "string" ? req.body.penName.trim() : "";
    if (!penName) throw new BadRequest("pen name is required");
    if (penName.length > 120) throw new BadRequest("pen name: up to 120 characters");
    const bio = typeof req.body.bio === "string" ? req.body.bio.trim() : "";
    if (bio.length > 2000) throw new BadRequest("bio: up to 2000 characters");
    const website = cleanWebsite(req.body.website);
    if (website === undefined) throw new BadRequest("website: please give a full link, like https://yoursite.com");
    await db.query(
      `INSERT INTO author_profiles (user_id, pen_name, bio, website) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET pen_name = EXCLUDED.pen_name, bio = EXCLUDED.bio, website = EXCLUDED.website, updated_at = now();`,
      [req.user.id, penName, bio || null, website]
    );
    res.json({ ok: true });
  }));

  router.post("/author-request", wrap(async (req, res) => {
    const text = (v, max, name, required = true) => {
      const t = typeof v === "string" ? v.trim() : "";
      if (required && !t) throw new BadRequest(`${name} is required`);
      if (t.length > max) throw new BadRequest(`${name}: up to ${max} characters`);
      return t || null;
    };
    const penName = text(req.body.penName, 120, "pen name");
    const books = text(req.body.books, 2000, "your books");
    const message = text(req.body.message, 2000, "message", false);
    if (req.body.confirm !== true) throw new BadRequest("please confirm that you are the author of these books");
    if (req.user.user_type === "librarian") throw new BadRequest("library accounts cannot become authors");
    let id;
    try {
      ({ rows: [{ id }] } = await db.query(
        `INSERT INTO author_requests (user_id, pen_name, books, message) VALUES ($1, $2, $3, $4) RETURNING id;`,
        [req.user.id, penName, books, message]
      ));
    } catch (err) {
      if (err.code === "23505") throw new BadRequest("you already have a request waiting for review");
      throw err;
    }
    res.status(201).json({ ok: true });
    // an email to the project team - after answering, so it never slows or breaks the request
    db.query(`SELECT name, email FROM neon_auth."user" WHERE id = $1;`, [req.user.authUserId])
      .then(({ rows }) => notifyAuthorRequest({ id: Number(id), name: rows[0]?.name, email: rows[0]?.email, penName, books, message }))
      .catch((err) => console.warn("[mail] author request email:", err.message));
  }));

  // ---------- reading analytics (the Insights page) ----------
  router.get("/insights", wrap(async (req, res) => {
    res.json(await computeInsights(db, req.user.id));
  }));

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

  // "Rate more": the same choice as the questionnaire (onboarding.js - the
  // most liked books of HIS genres, at most 2 per author), but never a book he
  // already rated, and not the ones in `skip` (shown before, "haven't read").
  router.post("/rate-more", wrap(async (req, res) => {
    const skip = Array.isArray(req.body.skip) ? req.body.skip.slice(0, 1000).map(Number).filter(Number.isInteger) : [];
    const [{ rows: genres }, { rows: rated }] = await Promise.all([
      db.query(`SELECT genre_key FROM user_genres WHERE user_id = $1;`, [req.user.id]),
      db.query(`SELECT book_id FROM user_ratings WHERE user_id = $1;`, [req.user.id]),
    ]);
    if (!genres.length) throw new BadRequest("choose your genres first");
    const keys = genres.map((g) => g.genre_key);
    const books = await getOnboardingBooks(keys, 20, { exclude: [...rated.map((r) => r.book_id), ...skip] });
    res.json({ genres: keys, books });
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
    // "Recommend more": the ids already on the page (up to 50 books in all)
    const exclude = String(req.query.exclude || "").split(",").filter(Boolean).slice(0, 100).map(Number).filter(Number.isInteger);
    res.json(await recommendFor(req.user.id, count, nearby, exclude));
  }));

  return router;
};
