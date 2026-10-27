/**
 * Checks the author Insights against the raw data - the proposal's requirement
 * "analytics dashboard accuracy: 100% match to the raw event log", for authors.
 *
 * For one author, every number of GET /api/me/author/insights (computed in
 * JavaScript by server/author-insights.js) is counted AGAIN in a different way -
 * directly in SQL - and the two must be equal. The audience part ("readers who
 * loved it also loved") is recounted too.
 *
 *   node server/test-author-insights.js                        the author whose books have the most ratings
 *   node server/test-author-insights.js --email you@mail.com   a specific author
 * Only READS. Exit code 1 if anything does not match.
 */

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { computeAuthorInsights, computeAudience, MIN_READERS } = require("./author-insights");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const i = process.argv.indexOf("--email");
const EMAIL = i > 0 ? process.argv[i + 1] : null;

let checks = 0;
const failures = [];
function same(name, a, b) {
  checks++;
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) failures.push(`${name}: page ${JSON.stringify(a)} vs SQL ${JSON.stringify(b)}`);
}

async function main() {
  const { rows: u } = EMAIL
    ? await pool.query(`SELECT u.id FROM users u JOIN neon_auth."user" a ON a.id = u.auth_user_id WHERE lower(a.email) = lower($1);`, [EMAIL])
    : await pool.query(
        `SELECT ab.user_id AS id FROM author_books ab LEFT JOIN user_ratings r ON r.book_id = ab.book_id
         GROUP BY ab.user_id ORDER BY count(r.*) DESC, ab.user_id LIMIT 1;`
      );
  if (!u[0]) throw new Error(EMAIL ? `no user with email ${EMAIL}` : "no author is linked to a book yet (approve a request first)");
  const userId = u[0].id;
  const now = new Date();
  const ins = await computeAuthorInsights(pool, userId, { now });
  if (!ins.books.length) throw new Error("this user is not linked to any book");

  const one = async (sql, params) => (await pool.query(sql, params)).rows[0].v;
  for (const b of ins.books) {
    const p = [b.id];
    const t = `"${b.title}"`;
    same(`${t} ratings`, b.ratings, await one(`SELECT count(*)::int AS v FROM user_ratings WHERE book_id = $1;`, p));
    same(`${t} average`, b.avgRating, await one(`SELECT round(avg(rating)::numeric, 2)::float8 AS v FROM user_ratings WHERE book_id = $1;`, p));
    same(`${t} loved`, b.loved, await one(`SELECT count(*)::int AS v FROM user_ratings WHERE book_id = $1 AND rating >= 4;`, p));
    const { rows: dist } = await pool.query(`SELECT rating, count(*)::int AS n FROM user_ratings WHERE book_id = $1 GROUP BY rating;`, p);
    same(`${t} stars`, b.distribution, [1, 2, 3, 4, 5].map((s) => dist.find((d) => d.rating === s)?.n || 0));
    same(`${t} on TBR now`, b.tbrNow, await one(
      `SELECT count(*)::int AS v FROM (
         SELECT DISTINCT ON (user_id) type FROM user_events
         WHERE book_id = $1 AND type IN ('saved', 'unsaved') ORDER BY user_id, created_at DESC, id DESC) t
       WHERE type = 'saved';`, p));
    same(`${t} added to TBR`, b.addedToTbr, await one(`SELECT count(DISTINCT user_id)::int AS v FROM user_events WHERE book_id = $1 AND type = 'saved';`, p));
    same(`${t} finished`, b.finished, await one(`SELECT count(DISTINCT user_id)::int AS v FROM user_events WHERE book_id = $1 AND type = 'finished';`, p));
    same(`${t} not for me`, b.notForMe, await one(`SELECT count(DISTINCT user_id)::int AS v FROM user_events WHERE book_id = $1 AND type = 'dismissed';`, p));
    same(`${t} reviews`, b.reviews, await one(`SELECT count(*)::int AS v FROM book_reviews WHERE book_id = $1;`, p));
    same(`${t} posts`, b.posts, await one(`SELECT count(*)::int AS v FROM book_posts WHERE book_id = $1 AND parent_id IS NULL;`, p));
    same(`${t} replies`, b.replies, await one(`SELECT count(*)::int AS v FROM book_posts WHERE book_id = $1 AND parent_id IS NOT NULL;`, p));
    const gr = (await pool.query(`SELECT count(*)::int AS n, round(avg(rating)::numeric, 2)::float8 AS a FROM dataset_ratings WHERE book_id = $1;`, p)).rows[0];
    same(`${t} Goodreads ratings`, b.goodreads?.ratings || 0, gr.n);
    same(`${t} Goodreads average`, b.goodreads?.avgRating ?? null, gr.a);

    // the trend, month by month (UTC) - first save / first finish of each reader
    const { rows: tr } = await pool.query(
      `WITH r AS (SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM') AS m, count(*)::int AS n FROM user_ratings WHERE book_id = $1 GROUP BY 1),
            s AS (SELECT to_char(min(created_at) AT TIME ZONE 'UTC', 'YYYY-MM') AS m FROM user_events WHERE book_id = $1 AND type = 'saved' GROUP BY user_id),
            f AS (SELECT to_char(min(created_at) AT TIME ZONE 'UTC', 'YYYY-MM') AS m FROM user_events WHERE book_id = $1 AND type = 'finished' GROUP BY user_id)
       SELECT m.m,
              coalesce((SELECT n FROM r WHERE r.m = m.m), 0) AS rated,
              (SELECT count(*)::int FROM s WHERE s.m = m.m) AS saved,
              (SELECT count(*)::int FROM f WHERE f.m = m.m) AS finished
       FROM unnest($2::text[]) AS m(m);`,
      [b.id, ins.months]
    );
    same(`${t} trend`, b.trend.map((x) => [x.month, x.rated, x.addedToTbr, x.finished]), tr.map((x) => [x.m, x.rated, x.saved, x.finished]));
  }

  // audience, for every book and for "all"
  const own = ins.books.map((b) => b.id);
  for (const target of [...own, "all"]) {
    const a = await computeAudience(pool, userId, target);
    const ids = target === "all" ? own : [target];
    const name = target === "all" ? "all books" : `"${ins.books.find((b) => b.id === target).title}"`;
    const lovers = (await pool.query(`SELECT DISTINCT user_id FROM user_ratings WHERE book_id = ANY($1::int[]) AND rating >= 4;`, [ids])).rows.map((r) => r.user_id);
    same(`${name} audience: app readers who loved it`, a.readers.app, lovers.length);
    for (const g of a.genres || []) {
      same(`${name} audience: genre ${g.key}`, g.readers, await one(`SELECT count(DISTINCT user_id)::int AS v FROM user_genres WHERE genre_key = $1 AND user_id = ANY($2::int[]);`, [g.key, lovers]));
      if (g.readers < MIN_READERS) failures.push(`${name}: genre ${g.key} shown with fewer than ${MIN_READERS} readers`);
    }
    if ((a.genres || []).length && lovers.length < MIN_READERS) failures.push(`${name}: genres shown with fewer than ${MIN_READERS} readers`);
    for (const x of a.alsoLoved) {
      const app = await one(`SELECT count(DISTINCT user_id)::int AS v FROM user_ratings WHERE book_id = $1 AND rating >= 4 AND user_id = ANY($2::int[]);`, [x.id, lovers]);
      const ds = await one(
        `SELECT count(*)::int AS v FROM dataset_ratings d
         WHERE d.book_id = $1 AND d.rating >= 4 AND d.user_id IN (
           SELECT user_id FROM dataset_ratings WHERE book_id = ANY($2::int[]) AND rating >= 4 GROUP BY user_id ORDER BY user_id LIMIT 2000);`,
        [x.id, ids]
      );
      same(`${name} also loved "${x.title}"`, x.readers, app + ds);
      if (x.readers < MIN_READERS) failures.push(`${name}: "${x.title}" shown with fewer than ${MIN_READERS} readers`);
      if (own.includes(x.id)) failures.push(`${name}: the author's own book "${x.title}" is in "also loved"`);
    }
  }

  console.log(`Author ${userId}, ${ins.books.length} book(s): ${checks - failures.length}/${checks} numbers match the raw data.`);
  if (failures.length) {
    failures.forEach((f) => console.log("  MISMATCH " + f));
    process.exitCode = 1;
  } else {
    console.log("100% match.");
  }
}

main()
  .catch((err) => { console.error("Error:", err.message); process.exitCode = 1; })
  .finally(() => pool.end());
