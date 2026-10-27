/**
 * Checks the Insights page against the raw data - the proposal's requirement
 * "analytics dashboard accuracy: 100% match to the raw event log".
 *
 * For one user, every number of GET /api/me/insights (computed in JavaScript
 * by server/insights.js) is counted AGAIN in a different way - directly in SQL
 * on user_ratings / user_events - and the two must be equal.
 *
 *   node server/test-insights.js                        the user with the most ratings
 *   node server/test-insights.js --email you@mail.com   a specific user
 * Only READS. Exit code 1 if anything does not match.
 */

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { computeInsights, last12Months } = require("./insights");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const i = process.argv.indexOf("--email");
const EMAIL = i > 0 ? process.argv[i + 1] : null;

async function main() {
  const { rows: u } = EMAIL
    ? await pool.query(`SELECT u.id FROM users u JOIN neon_auth."user" a ON a.id = u.auth_user_id WHERE lower(a.email) = lower($1);`, [EMAIL])
    : await pool.query(`SELECT user_id AS id FROM user_ratings GROUP BY user_id ORDER BY count(*) DESC LIMIT 1;`);
  if (!u[0]) throw new Error(EMAIL ? `no user with email ${EMAIL}` : "no user has ratings yet");
  const userId = u[0].id;
  const now = new Date();
  const ins = await computeInsights(pool, userId, { now });

  // the same numbers, straight from SQL
  const one = async (sql) => (await pool.query(sql, [userId])).rows[0];
  const READ = `SELECT book_id FROM user_ratings WHERE user_id = $1
                UNION SELECT book_id FROM user_events WHERE user_id = $1 AND type = 'finished'`;
  const sql = {
    rated: (await one(`SELECT count(*)::int AS v FROM user_ratings WHERE user_id = $1;`)).v,
    finished: (await one(`SELECT count(DISTINCT book_id)::int AS v FROM user_events WHERE user_id = $1 AND type = 'finished';`)).v,
    read: (await one(`SELECT count(*)::int AS v FROM (${READ}) t;`)).v,
    tbr: (await one(
      `SELECT count(*)::int AS v FROM (
         SELECT DISTINCT ON (book_id) type FROM user_events
         WHERE user_id = $1 AND type IN ('saved', 'unsaved') ORDER BY book_id, created_at DESC, id DESC) t
       WHERE type = 'saved';`)).v,
    pagesRead: (await one(`SELECT coalesce(sum(b.page_count), 0)::int AS v FROM books b WHERE b.id IN (${READ}) AND b.page_count > 0;`)).v,
    avgRating: (await one(`SELECT round(avg(rating)::numeric, 2)::float8 AS v FROM user_ratings WHERE user_id = $1;`)).v,
    notForMe: (await one(`SELECT count(DISTINCT book_id)::int AS v FROM user_events WHERE user_id = $1 AND type = 'dismissed';`)).v,
    lovedBooks: (await one(`SELECT count(*)::int AS v FROM user_ratings r JOIN books b ON b.id = r.book_id WHERE r.user_id = $1 AND r.rating >= 4;`)).v,
  };
  const { rows: dist } = await pool.query(`SELECT rating, count(*)::int AS n FROM user_ratings WHERE user_id = $1 GROUP BY rating;`, [userId]);
  const { rows: fin } = await pool.query(
    `SELECT to_char(min(created_at) AT TIME ZONE 'UTC', 'YYYY-MM') AS m FROM user_events
     WHERE user_id = $1 AND type = 'finished' GROUP BY book_id;`, [userId]);
  const { rows: rat } = await pool.query(
    `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM') AS m, count(*)::int AS n FROM user_ratings
     WHERE user_id = $1 AND source <> 'onboarding' GROUP BY 1;`, [userId]);

  const checks = [
    ["books rated", ins.totals.rated, sql.rated],
    ["books finished", ins.totals.finished, sql.finished],
    ["books read (rated or finished)", ins.totals.read, sql.read],
    ["on TBR", ins.totals.tbr, sql.tbr],
    ["pages read", ins.totals.pagesRead, sql.pagesRead],
    ["average rating", ins.totals.avgRating, sql.avgRating],
    ["'Not for me' books", ins.notForMe.count, sql.notForMe],
    ["loved books (4-5 stars)", ins.taste.lovedBooks, sql.lovedBooks],
  ];
  for (let s = 1; s <= 5; s++) {
    checks.push([`${s}-star ratings`, ins.ratingStyle.distribution[s - 1].count, dist.find((d) => d.rating === s)?.n ?? 0]);
  }
  for (const m of last12Months(now)) {
    const a = ins.activity.find((x) => x.month === m);
    checks.push([`${m} finished`, a.finished, fin.filter((f) => f.m === m).length]);
    checks.push([`${m} rated in the app`, a.rated, rat.find((r) => r.m === m)?.n ?? 0]);
  }

  let bad = 0;
  console.log(`Insights vs raw data - user ${userId}\n`);
  for (const [name, page, raw] of checks) {
    const ok = page === raw;
    if (!ok) bad++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(34)} page ${String(page).padStart(6)}   raw ${String(raw).padStart(6)}`);
  }
  console.log(`\n${checks.length - bad} / ${checks.length} match (${(((checks.length - bad) / checks.length) * 100).toFixed(0)}%)`);
  if (bad) process.exitCode = 1;
}

main()
  .catch((err) => { console.error("Error:", err.message); process.exitCode = 1; })
  .finally(() => pool.end());
