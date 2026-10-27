/**
 * Author pages (signed-in users).
 *
 *   GET /api/authors/:userId     { userId, penName, bio, website, books, isMe }
 *                                404 if this account is not linked to any book
 *
 * Only what the author chose to show: the pen name, bio, website and the books
 * linked to them - never the account email or real name.
 */

const express = require("express");
const { authorPage } = require("./author-profiles");

module.exports = function authorRoutes({ db, requireUser, h }) {
  const { wrap, checkId } = h;
  const router = express.Router();
  router.use(requireUser(db));

  router.get("/:userId", wrap(async (req, res) => {
    const page = await authorPage(db, checkId(req.params.userId));
    if (!page) return res.status(404).json({ error: "author not found" });
    res.json({ ...page, isMe: page.userId === req.user.id });
  }));

  return router;
};
