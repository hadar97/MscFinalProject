/**
 * Author insights - how readers respond to an author's books
 * (GET /api/me/author/insights and /api/me/author/insights/audience).
 *
 * Like the reader's Insights page, everything is computed on request from the
 * raw rows (user_ratings, user_events, book_reviews, book_posts, dataset_ratings),
 * so the numbers always match the event log - checked by server/test-author-insights.js.
 *
 * Privacy: an author sees only COUNTS and averages - never who rated, saved or
 * wrote. The audience part (genres of the readers, books they also loved) is
 * shown only when at least MIN_READERS readers are behind it, and every "also
 * loved" book needs MIN_READERS readers of its own.
 *
 * Definitions (the test script uses the same ones):
 *   ratings      = rows in user_ratings for the book (all sources - the sign-up
 *                  questionnaire too: those are real readers saying they read it)
 *   loved        = rated 4 or 5 stars
 *   on TBR now   = readers whose LATEST saved/unsaved event for the book is "saved"
 *   added to TBR = readers who ever saved it; month = their FIRST save
 *   finished     = readers who marked it finished; month = their FIRST "finished"
 *   not for me   = readers who dismissed it from their picks
 *   reviews      = book_reviews rows; posts = discussion posts; replies = replies to them
 *   Goodreads    = dataset_ratings (the goodbooks-10k readers), for books from that dataset
 *   trend        = per calendar month (UTC), last 12 months
 *   also loved   = books rated 4-5 by the readers who rated this book 4-5, shown if
 *                  >= MIN_READERS of them (and >= 3%) AND they love it >= 10% more than
 *                  readers in general (lift = their share / liked_count share of all readers)
 */

const path = require("path");
const { GENRES } = require(path.join(__dirname, "..", "onboarding", "genres"));
const { last12Months, monthKey } = require("./insights");

const MIN_READERS = 3;
const MIN_LIFT = 1.1;
const DATASET_SAMPLE = 2000; // readers from the dataset used for "also loved" (enough for stable shares, fast)
const LABEL = new Map(GENRES.map((g) => [g.key, g.label]));
const round2 = (x) => Math.round(x * 100) / 100;

async function authorBooks(db, userId) {
  const { rows } = await db.query(
    `SELECT b.id, b.title, b.authors, b.thumbnail_url, b.goodbooks_id, b.published_date
     FROM author_books ab JOIN books b ON b.id = ab.book_id
     WHERE ab.user_id = $1 ORDER BY b.published_date NULLS LAST, b.title;`,
    [userId]
  );
  return rows;
}

const emptyStats = () => ({
  ratings: 0, avgRating: null, loved: 0, distribution: [0, 0, 0, 0, 0],
  tbrNow: 0, addedToTbr: 0, finished: 0, notForMe: 0,
  reviews: 0, posts: 0, replies: 0,
  goodreads: null, // { ratings, avgRating, distribution }
});

async function computeAuthorInsights(db, userId, { now = new Date() } = {}) {
  const books = await authorBooks(db, userId);
  const months = last12Months(now);
  if (!books.length) return { books: [], months };
  const ids = books.map((b) => b.id);

  const [{ rows: ratings }, { rows: events }, { rows: dataset }, { rows: reviews }, { rows: posts }] = await Promise.all([
    db.query(`SELECT book_id, user_id, rating, created_at FROM user_ratings WHERE book_id = ANY($1::int[]);`, [ids]),
    db.query(
      `SELECT book_id, user_id, type, created_at FROM user_events
       WHERE book_id = ANY($1::int[]) AND type IN ('saved', 'unsaved', 'finished', 'dismissed')
       ORDER BY created_at, id;`,
      [ids]
    ),
    db.query(`SELECT book_id, rating, count(*)::int AS n FROM dataset_ratings WHERE book_id = ANY($1::int[]) GROUP BY book_id, rating;`, [ids]),
    db.query(`SELECT book_id, count(*)::int AS n FROM book_reviews WHERE book_id = ANY($1::int[]) GROUP BY book_id;`, [ids]),
    db.query(
      `SELECT book_id, count(*) FILTER (WHERE parent_id IS NULL)::int AS posts, count(*) FILTER (WHERE parent_id IS NOT NULL)::int AS replies
       FROM book_posts WHERE book_id = ANY($1::int[]) GROUP BY book_id;`,
      [ids]
    ),
  ]);

  const stats = new Map(ids.map((id) => [id, emptyStats()]));
  const trend = new Map(ids.map((id) => [id, new Map(months.map((m) => [m, { month: m, rated: 0, addedToTbr: 0, finished: 0 }]))]));
  const bump = (bookId, at, key) => { const t = trend.get(bookId).get(monthKey(at)); if (t) t[key]++; };

  // ratings
  const sums = new Map();
  for (const r of ratings) {
    const s = stats.get(r.book_id);
    s.ratings++;
    s.distribution[r.rating - 1]++;
    if (r.rating >= 4) s.loved++;
    sums.set(r.book_id, (sums.get(r.book_id) || 0) + r.rating);
    bump(r.book_id, r.created_at, "rated");
  }
  for (const [id, sum] of sums) stats.get(id).avgRating = round2(sum / stats.get(id).ratings);

  // events, per reader and book (they come in time order)
  const lastSave = new Map(); const firstSave = new Map(); const firstFinish = new Map(); const dismissed = new Set();
  for (const e of events) {
    const k = `${e.book_id}:${e.user_id}`;
    if (e.type === "saved" || e.type === "unsaved") lastSave.set(k, e);
    if (e.type === "saved" && !firstSave.has(k)) firstSave.set(k, e);
    if (e.type === "finished" && !firstFinish.has(k)) firstFinish.set(k, e);
    if (e.type === "dismissed") dismissed.add(k);
  }
  for (const e of lastSave.values()) if (e.type === "saved") stats.get(e.book_id).tbrNow++;
  for (const e of firstSave.values()) { stats.get(e.book_id).addedToTbr++; bump(e.book_id, e.created_at, "addedToTbr"); }
  for (const e of firstFinish.values()) { stats.get(e.book_id).finished++; bump(e.book_id, e.created_at, "finished"); }
  for (const k of dismissed) stats.get(Number(k.split(":")[0])).notForMe++;

  // talk around the book
  for (const r of reviews) stats.get(r.book_id).reviews = r.n;
  for (const p of posts) Object.assign(stats.get(p.book_id), { posts: p.posts, replies: p.replies });

  // the Goodreads readers (goodbooks-10k), for comparison
  for (const d of dataset) {
    const s = stats.get(d.book_id);
    s.goodreads ||= { ratings: 0, avgRating: null, distribution: [0, 0, 0, 0, 0], sum: 0 };
    s.goodreads.ratings += d.n;
    s.goodreads.distribution[d.rating - 1] += d.n;
    s.goodreads.sum += d.rating * d.n;
  }
  for (const s of stats.values()) {
    if (!s.goodreads) continue;
    s.goodreads.avgRating = round2(s.goodreads.sum / s.goodreads.ratings);
    delete s.goodreads.sum;
  }

  return {
    months,
    books: books.map((b) => ({
      id: b.id, title: b.title, thumbnail_url: b.thumbnail_url, published_date: b.published_date,
      inDataset: Boolean(b.goodbooks_id),
      ...stats.get(b.id),
      trend: [...trend.get(b.id).values()],
    })),
  };
}

// readers in the dataset: user ids are 1..N (goodbooks), so max() is the count - one index lookup
let datasetReaders = null;
async function datasetReaderCount(db) {
  if (!datasetReaders) {
    datasetReaders = db.query(`SELECT max(user_id)::int AS n FROM dataset_ratings;`).then((r) => r.rows[0].n || 0)
      .catch((err) => { datasetReaders = null; throw err; });
  }
  return datasetReaders;
}

/**
 * Who loves the book(s): the genres those readers chose, and the books they also
 * loved (more than readers in general do). bookId = one of the author's books, or "all".
 */
async function computeAudience(db, userId, bookId) {
  const books = await authorBooks(db, userId);
  const own = books.map((b) => b.id);
  const ids = bookId === "all" ? own : own.filter((id) => id === bookId);
  if (!ids.length) return null;
  const authorNames = [...new Set(books.flatMap((b) => b.authors || []))];

  const { rows: appLovers } = await db.query(
    `SELECT DISTINCT user_id FROM user_ratings WHERE book_id = ANY($1::int[]) AND rating >= 4;`, [ids]
  );
  const appIds = appLovers.map((r) => r.user_id);

  // genres the app readers who loved it picked at sign-up
  let genres = null;
  if (appIds.length >= MIN_READERS) {
    const { rows } = await db.query(
      `SELECT genre_key, count(DISTINCT user_id)::int AS n FROM user_genres WHERE user_id = ANY($1::int[]) GROUP BY genre_key ORDER BY n DESC, genre_key LIMIT 8;`,
      [appIds]
    );
    genres = rows.filter((g) => g.n >= MIN_READERS).map((g) => ({ key: g.genre_key, label: LABEL.get(g.genre_key) || g.genre_key, readers: g.n, share: Math.round((g.n / appIds.length) * 100) }));
  }

  // books they also loved: app readers + (a fixed sample of) the dataset readers
  const [{ rows: appAlso }, { rows: dsLovers }] = await Promise.all([
    appIds.length
      ? db.query(
          `SELECT book_id, count(DISTINCT user_id)::int AS n FROM user_ratings
           WHERE user_id = ANY($1::int[]) AND rating >= 4 AND NOT (book_id = ANY($2::int[])) GROUP BY book_id;`,
          [appIds, own]
        )
      : { rows: [] },
    db.query(
      `SELECT count(*)::int AS n FROM (SELECT user_id FROM dataset_ratings WHERE book_id = ANY($1::int[]) AND rating >= 4
        GROUP BY user_id ORDER BY user_id LIMIT ${DATASET_SAMPLE}) t;`,
      [ids]
    ),
  ]);
  const dsCount = dsLovers[0].n;
  const { rows: dsAlso } = dsCount
    ? await db.query(
        `WITH lovers AS (
           SELECT user_id FROM dataset_ratings WHERE book_id = ANY($1::int[]) AND rating >= 4
           GROUP BY user_id ORDER BY user_id LIMIT ${DATASET_SAMPLE})
         SELECT d.book_id, count(*)::int AS n FROM dataset_ratings d JOIN lovers USING (user_id)
         WHERE d.rating >= 4 AND NOT (d.book_id = ANY($2::int[]))
         GROUP BY d.book_id ORDER BY n DESC LIMIT 300;`,
        [ids, own]
      )
    : { rows: [] };

  const readers = appIds.length + dsCount;
  let alsoLoved = [];
  if (readers >= MIN_READERS) {
    const count = new Map();
    for (const r of [...appAlso, ...dsAlso]) count.set(r.book_id, (count.get(r.book_id) || 0) + r.n);
    const minCount = Math.max(MIN_READERS, Math.ceil(readers * 0.03));
    const candidates = [...count.entries()].filter(([, n]) => n >= minCount).map(([id]) => id);
    if (candidates.length) {
      const [{ rows: info }, total] = await Promise.all([
        db.query(
          `SELECT b.id, b.title, b.authors, b.thumbnail_url, p.liked_count FROM books b LEFT JOIN book_popularity p ON p.book_id = b.id
           WHERE b.id = ANY($1::int[]) AND NOT (coalesce(b.authors, '{}') && $2::text[]);`,
          [candidates, authorNames]
        ),
        datasetReaderCount(db).catch(() => 0),
      ]);
      alsoLoved = info.map((b) => {
        const share = count.get(b.id) / readers;
        const base = total && b.liked_count ? b.liked_count / total : null; // how many readers in general love it
        return {
          id: b.id, title: b.title, author: b.authors?.[0] || null, thumbnail_url: b.thumbnail_url,
          readers: count.get(b.id), share: Math.round(share * 100),
          generalShare: base === null ? null : Math.round(base * 1000) / 10,
          lift: base ? round2(share / base) : null,
        };
      })
        // only books they love clearly MORE than readers in general (at least 10% more);
        // a book every reader loves says nothing about this author's readers
        .filter((b) => b.lift === null || b.lift >= MIN_LIFT)
        // rank by lift; books without a base rate (not in the dataset) go last, by share
        .sort((a, b) => (b.lift ?? -1) - (a.lift ?? -1) || b.share - a.share)
        .slice(0, 6);
    }
  }

  return { bookId, minReaders: MIN_READERS, readers: { app: appIds.length, dataset: dsCount, sampled: dsCount >= DATASET_SAMPLE }, genres, alsoLoved };
}

module.exports = { computeAuthorInsights, computeAudience, MIN_READERS };
