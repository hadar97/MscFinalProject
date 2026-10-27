/**
 * Author accounts and their pages - shared by the routes.
 *
 * The name shown for an author account: the pen name in author_profiles, else
 * the pen name of their latest approved request, else "First L." of the account.
 * If the table author_profiles was not created yet (db/create-author-profiles-table.js)
 * everything still works with the fallbacks.
 */

const { displayName } = require("./social-routes");

let hasTable = null; // checked once
async function profilesTable(db) {
  if (hasTable === null) {
    const { rows } = await db.query(`SELECT to_regclass('public.author_profiles') AS t;`);
    hasTable = Boolean(rows[0].t);
    if (!hasTable) console.warn("[authors] author_profiles table not found - run db/create-author-profiles-table.js");
  }
  return hasTable;
}

/** SQL for the pen name of user u (users row) joined with neon_auth a */
async function penNameSql(db) {
  const fromRequest = `(SELECT r.pen_name FROM author_requests r WHERE r.user_id = u.id ORDER BY (r.status = 'approved') DESC, r.decided_at DESC NULLS LAST, r.created_at DESC LIMIT 1)`;
  return (await profilesTable(db))
    ? `coalesce((SELECT p.pen_name FROM author_profiles p WHERE p.user_id = u.id), ${fromRequest})`
    : fromRequest;
}

/** The author accounts linked to a book: [{ userId, penName }] (for links on the book page) */
async function authorAccountsOfBook(db, bookId) {
  const pen = await penNameSql(db);
  const { rows } = await db.query(
    `SELECT u.id, ${pen} AS pen_name, a.name
     FROM author_books ab JOIN users u ON u.id = ab.user_id JOIN neon_auth."user" a ON a.id = u.auth_user_id
     WHERE ab.book_id = $1 ORDER BY ab.created_at;`,
    [bookId]
  );
  return rows.map((r) => ({ userId: r.id, penName: r.pen_name || displayName(r.name) }));
}

/** An author's page: name, bio, website, books. null if the user has no linked books. */
async function authorPage(db, userId) {
  const pen = await penNameSql(db);
  const withProfile = await profilesTable(db);
  const { rows } = await db.query(
    `SELECT u.id, ${pen} AS pen_name, a.name
            ${withProfile ? ", (SELECT p.bio FROM author_profiles p WHERE p.user_id = u.id) AS bio, (SELECT p.website FROM author_profiles p WHERE p.user_id = u.id) AS website" : ""}
     FROM users u JOIN neon_auth."user" a ON a.id = u.auth_user_id WHERE u.id = $1;`,
    [userId]
  );
  if (!rows[0]) return null;
  const { rows: books } = await db.query(
    `SELECT b.id, b.title, b.authors, b.thumbnail_url, b.published_date
     FROM author_books ab JOIN books b ON b.id = ab.book_id
     WHERE ab.user_id = $1 ORDER BY b.published_date NULLS LAST, b.title;`,
    [userId]
  );
  if (!books.length) return null;
  const r = rows[0];
  return { userId: r.id, penName: r.pen_name || displayName(r.name), bio: r.bio || null, website: r.website || null, books };
}

/** Pen name to prefill a new request with (and the profile form): the one we already know */
async function knownPenName(db, userId) {
  const pen = await penNameSql(db);
  const { rows } = await db.query(`SELECT ${pen} AS pen_name FROM users u WHERE u.id = $1;`, [userId]);
  return rows[0]?.pen_name || null;
}

/** "https://site.com" - only http(s) links (no javascript: etc.); empty -> null */
function cleanWebsite(v) {
  const t = typeof v === "string" ? v.trim() : "";
  if (!t) return null;
  const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  let url;
  try { url = new URL(withScheme); } catch { return undefined; }
  if (!/^https?:$/.test(url.protocol) || !url.hostname.includes(".")) return undefined;
  return url.toString().slice(0, 300);
}

module.exports = { profilesTable, authorAccountsOfBook, authorPage, knownPenName, cleanWebsite, resetForTests: () => { hasTable = null; } };
