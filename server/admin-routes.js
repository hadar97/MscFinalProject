/**
 * Admin pages' API - for the project team only (ADMIN_EMAILS in .env, see server/mailer.js).
 * The signed-in user's email (in Neon Auth) must be on that list; anyone else gets 403.
 *
 *   GET  /api/admin/summary                              { admin, pendingAuthorRequests } - for the bell in the header
 *                                                        (any signed-in user may ask: non-admins just get { admin: false })
 *   GET  /api/admin/me                                   { admin: true } - is this user an admin?
 *   GET  /api/admin/author-requests?status=pending|all   requests with the user's name and email
 *   POST /api/admin/author-requests/:id/approve          { bookIds: [..], note } - the user becomes an author of these books
 *   POST /api/admin/author-requests/:id/reject           { note }
 *
 * Same rules as the script db/author-requests.js (which still works too).
 */

const express = require("express");
const { isAdminEmail } = require("./mailer");
const { profilesTable } = require("./author-profiles");

module.exports = function adminRoutes({ db, requireUser, h }) {
  const { BadRequest, wrap, checkId } = h;
  const router = express.Router();
  router.use(requireUser(db));

  const emailOf = async (req) =>
    (await db.query(`SELECT email FROM neon_auth."user" WHERE id = $1;`, [req.user.authUserId])).rows[0]?.email || null;

  // The bell: asked on every page by every signed-in user, so no 403 here - just "not an admin"
  router.get("/summary", wrap(async (req, res) => {
    if (!isAdminEmail(await emailOf(req))) return res.json({ admin: false });
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM author_requests WHERE status = 'pending';`);
    res.json({ admin: true, pendingAuthorRequests: rows[0].n });
  }));

  router.use(async (req, res, next) => {
    try {
      const email = await emailOf(req);
      // signedInAs: only the user's OWN email, to see at once if they are signed in with the wrong account
      if (!isAdminEmail(email)) return res.status(403).json({ error: "this page is for the project team only", signedInAs: email });
      next();
    } catch (err) { next(err); }
  });

  router.get("/me", (req, res) => res.json({ admin: true }));

  router.get("/author-requests", wrap(async (req, res) => {
    const all = req.query.status === "all";
    const { rows } = await db.query(
      `SELECT r.id, r.status, r.pen_name, r.books, r.message, r.note, r.created_at, r.decided_at,
              r.user_id, a.name, a.email, u.user_type,
              (SELECT count(*)::int FROM author_books ab WHERE ab.user_id = r.user_id) AS linked_count
       FROM author_requests r JOIN users u ON u.id = r.user_id JOIN neon_auth."user" a ON a.id = u.auth_user_id
       ${all ? "" : "WHERE r.status = 'pending'"}
       ORDER BY (r.status = 'pending') DESC, r.created_at DESC
       LIMIT 200;`
    );
    res.json({
      requests: rows.map((r) => ({
        id: Number(r.id), status: r.status, penName: r.pen_name, books: r.books, message: r.message, note: r.note,
        createdAt: r.created_at, decidedAt: r.decided_at, name: r.name, email: r.email, userType: r.user_type,
        userId: r.user_id, linkedCount: r.linked_count, // linked already -> the admin page links to the author's page
      })),
    });
  }));

  const pendingRequest = async (id) => {
    const { rows } = await db.query(`SELECT id, user_id, status, pen_name FROM author_requests WHERE id = $1;`, [id]);
    if (!rows[0]) throw new BadRequest(`no request #${id}`);
    if (rows[0].status !== "pending") throw new BadRequest(`request #${id} is already ${rows[0].status}`);
    return rows[0];
  };
  const noteOf = (v) => {
    const t = typeof v === "string" ? v.trim() : "";
    if (t.length > 1000) throw new BadRequest("note: up to 1000 characters");
    return t || null;
  };

  router.post("/author-requests/:id/approve", wrap(async (req, res) => {
    const r = await pendingRequest(checkId(req.params.id));
    const bookIds = [...new Set((Array.isArray(req.body.bookIds) ? req.body.bookIds : []).map(Number).filter(Number.isInteger))];
    if (!bookIds.length) throw new BadRequest("choose at least one book");
    const { rows: found } = await db.query(`SELECT id FROM books WHERE id = ANY($1::int[]);`, [bookIds]);
    if (found.length !== bookIds.length) throw new BadRequest("unknown book id");
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE users SET user_type = 'author' WHERE id = $1 AND user_type <> 'librarian';`, [r.user_id]);
      await client.query(`INSERT INTO author_books (user_id, book_id) SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING;`, [r.user_id, bookIds]);
      await client.query(`UPDATE author_requests SET status = 'approved', note = $2, decided_at = now() WHERE id = $1;`, [r.id, noteOf(req.body.note)]);
      // the author's page starts with this pen name (the author can change it later; an existing profile is kept)
      if (await profilesTable(db)) {
        await client.query(`INSERT INTO author_profiles (user_id, pen_name) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING;`, [r.user_id, r.pen_name]);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    res.json({ ok: true });
  }));

  router.post("/author-requests/:id/reject", wrap(async (req, res) => {
    const r = await pendingRequest(checkId(req.params.id));
    await db.query(`UPDATE author_requests SET status = 'rejected', note = $2, decided_at = now() WHERE id = $1;`, [r.id, noteOf(req.body.note)]);
    res.json({ ok: true });
  }));

  return router;
};
