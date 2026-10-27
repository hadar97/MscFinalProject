/**
 * The social layer around a book - reviews and discussion (signed-in users).
 * Tables: book_reviews, book_posts, author_books (db/create-social-tables.js).
 *
 *   GET    /api/social/books/:id              reviews + discussion of a book, and what the user may do
 *   PUT    /api/social/books/:id/review       { body }   write / edit your review (you must rate the book first)
 *   DELETE /api/social/books/:id/review       delete your review
 *   POST   /api/social/books/:id/posts        { body, parentId? }   a new post, or a reply to a post
 *   DELETE /api/social/posts/:postId          delete your own post (its replies go with it)
 *   POST   /api/social/posts/:postId/pin      { pinned }   authors of the book only: pin / unpin (one pinned post per book)
 *
 * Names: other users see the first name and the first letter of the last name
 * ("Hodaya A.") - never the email. Text is stored as typed and shown as plain
 * text by the website (React escapes it - no HTML from users ever runs).
 * Limits against floods: 2000 characters, 30 posts per user per hour.
 */

const express = require("express");

const MAX_LEN = 2000;
const POSTS_PER_HOUR = 30;

// "Hodaya Amiram" -> "Hodaya A."
function displayName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Reader";
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}

module.exports = function socialRoutes({ db, requireUser, h }) {
  const { BadRequest, wrap, checkId } = h;
  const router = express.Router();
  router.use(requireUser(db));

  const checkBody = (body) => {
    const text = typeof body === "string" ? body.trim() : "";
    if (!text) throw new BadRequest("write something first");
    if (text.length > MAX_LEN) throw new BadRequest(`up to ${MAX_LEN} characters`);
    return text;
  };
  const isAuthorOf = async (userId, bookId) =>
    (await db.query(`SELECT 1 FROM author_books WHERE user_id = $1 AND book_id = $2;`, [userId, bookId])).rowCount > 0;

  router.get("/books/:id", wrap(async (req, res) => {
    const bookId = checkId(req.params.id);
    const me = req.user.id;
    const [{ rows: reviews }, { rows: posts }, { rows: myRating }, author] = await Promise.all([
      db.query(
        `SELECT rv.user_id, rv.body, rv.updated_at, r.rating, a.name,
                EXISTS (SELECT 1 FROM author_books ab WHERE ab.user_id = rv.user_id AND ab.book_id = rv.book_id) AS is_author
         FROM book_reviews rv
         JOIN users u ON u.id = rv.user_id JOIN neon_auth."user" a ON a.id = u.auth_user_id
         LEFT JOIN user_ratings r ON r.user_id = rv.user_id AND r.book_id = rv.book_id
         WHERE rv.book_id = $1
         ORDER BY (rv.user_id = $2) DESC, rv.updated_at DESC
         LIMIT 100;`,
        [bookId, me]
      ),
      db.query(
        `SELECT p.id, p.parent_id, p.user_id, p.body, p.pinned, p.created_at, a.name,
                EXISTS (SELECT 1 FROM author_books ab WHERE ab.user_id = p.user_id AND ab.book_id = p.book_id) AS is_author
         FROM book_posts p
         JOIN users u ON u.id = p.user_id JOIN neon_auth."user" a ON a.id = u.auth_user_id
         WHERE p.book_id = $1
         ORDER BY p.created_at
         LIMIT 500;`,
        [bookId]
      ),
      db.query(`SELECT rating FROM user_ratings WHERE user_id = $1 AND book_id = $2;`, [me, bookId]),
      isAuthorOf(me, bookId),
    ]);

    const view = (p) => ({
      id: Number(p.id), body: p.body, pinned: p.pinned, createdAt: p.created_at,
      name: displayName(p.name), isAuthor: p.is_author, mine: p.user_id === me,
    });
    const top = posts.filter((p) => !p.parent_id).map((p) => ({ ...view(p), replies: [] }));
    const byId = new Map(top.map((p) => [p.id, p]));
    for (const r of posts.filter((p) => p.parent_id)) byId.get(Number(r.parent_id))?.replies.push(view(r));
    top.sort((a, b) => Number(b.pinned) - Number(a.pinned) || new Date(b.createdAt) - new Date(a.createdAt)); // pinned, then newest

    res.json({
      reviews: reviews.map((r) => ({
        body: r.body, rating: r.rating, updatedAt: r.updated_at,
        name: displayName(r.name), isAuthor: r.is_author, mine: r.user_id === me,
      })),
      posts: top,
      me: { rating: myRating[0]?.rating ?? null, isAuthor: author },
    });
  }));

  router.put("/books/:id/review", wrap(async (req, res) => {
    const bookId = checkId(req.params.id);
    const body = checkBody(req.body.body);
    const { rowCount } = await db.query(`SELECT 1 FROM user_ratings WHERE user_id = $1 AND book_id = $2;`, [req.user.id, bookId]);
    if (!rowCount) throw new BadRequest("rate the book first - a review goes with your stars");
    await db.query(
      `INSERT INTO book_reviews (user_id, book_id, body) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, book_id) DO UPDATE SET body = EXCLUDED.body, updated_at = now();`,
      [req.user.id, bookId, body]
    );
    res.json({ ok: true });
  }));

  router.delete("/books/:id/review", wrap(async (req, res) => {
    const bookId = checkId(req.params.id);
    await db.query(`DELETE FROM book_reviews WHERE user_id = $1 AND book_id = $2;`, [req.user.id, bookId]);
    res.json({ ok: true });
  }));

  router.post("/books/:id/posts", wrap(async (req, res) => {
    const bookId = checkId(req.params.id);
    const body = checkBody(req.body.body);
    let parentId = null;
    if (req.body.parentId !== undefined && req.body.parentId !== null) {
      parentId = checkId(req.body.parentId);
      const { rows } = await db.query(`SELECT book_id, parent_id FROM book_posts WHERE id = $1;`, [parentId]);
      if (!rows[0] || rows[0].book_id !== bookId) throw new BadRequest("that post is not in this book's discussion");
      if (rows[0].parent_id) throw new BadRequest("reply to the post itself (one level of replies)");
    }
    const { rows: recent } = await db.query(
      `SELECT count(*)::int AS n FROM book_posts WHERE user_id = $1 AND created_at > now() - interval '1 hour';`,
      [req.user.id]
    );
    if (recent[0].n >= POSTS_PER_HOUR) throw new BadRequest("you have posted a lot in the last hour - please try again later");
    const { rows: book } = await db.query(`SELECT 1 FROM books WHERE id = $1;`, [bookId]);
    if (!book[0]) throw new BadRequest("unknown book");
    const { rows } = await db.query(
      `INSERT INTO book_posts (book_id, user_id, parent_id, body) VALUES ($1, $2, $3, $4) RETURNING id;`,
      [bookId, req.user.id, parentId, body]
    );
    res.status(201).json({ ok: true, id: Number(rows[0].id) });
  }));

  router.delete("/posts/:postId", wrap(async (req, res) => {
    const postId = checkId(req.params.postId);
    const { rowCount } = await db.query(`DELETE FROM book_posts WHERE id = $1 AND user_id = $2;`, [postId, req.user.id]);
    if (!rowCount) return res.status(404).json({ error: "post not found (or not yours)" });
    res.json({ ok: true });
  }));

  router.post("/posts/:postId/pin", wrap(async (req, res) => {
    const postId = checkId(req.params.postId);
    const pinned = req.body.pinned !== false;
    const { rows } = await db.query(`SELECT book_id, parent_id FROM book_posts WHERE id = $1;`, [postId]);
    if (!rows[0]) return res.status(404).json({ error: "post not found" });
    if (rows[0].parent_id) throw new BadRequest("only posts can be pinned, not replies");
    if (!(await isAuthorOf(req.user.id, rows[0].book_id))) return res.status(403).json({ error: "only an author of this book can pin" });
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      if (pinned) await client.query(`UPDATE book_posts SET pinned = false WHERE book_id = $1 AND pinned;`, [rows[0].book_id]);
      await client.query(`UPDATE book_posts SET pinned = $2 WHERE id = $1;`, [postId, pinned]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    res.json({ ok: true });
  }));

  return router;
};

module.exports.displayName = displayName;
