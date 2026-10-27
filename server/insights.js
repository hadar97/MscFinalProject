/**
 * Personal reading analytics - the Insights page (GET /api/me/insights).
 *
 * The proposal: "personal reading analytics: visualization of reading patterns
 * and insights on the reader's development over time", computed from the event
 * data, and the dashboard must match the raw event log 100%
 * (checked by server/test-insights.js).
 *
 * Everything is computed on request from the user's own rows - user_ratings,
 * user_events, user_genres - and book details. Nothing is stored separately,
 * so the numbers can never drift away from the raw data.
 *
 * Definitions (the test script uses the same ones):
 *   read      = books the user rated OR marked "I finished it"
 *   TBR       = books whose LATEST saved/unsaved event is "saved"
 *   finished  = the first "finished" event of each book
 *   loved     = rated 4 or 5 stars
 *   activity  = per calendar month (UTC), last 12 months: books finished, and
 *               ratings given in the app (questionnaire ratings are left out -
 *               they all have the sign-up date and would be one big spike)
 *   genres    = 10K books by main_genres, Google books by categories (genres.js)
 */

const path = require("path");
const { GENRES } = require(path.join(__dirname, "..", "onboarding", "genres"));
const { hasSeriesColumns } = require(path.join(__dirname, "..", "hybrid", "diversity"));

const LABEL = new Map(GENRES.map((g) => [g.key, g.label]));
const GOODREADS_TO_KEYS = new Map();
const GOOGLE_TO_KEYS = new Map();
for (const g of GENRES) {
  for (const v of g.goodreads) GOODREADS_TO_KEYS.set(v, [...(GOODREADS_TO_KEYS.get(v) || []), g.key]);
  for (const v of g.google) GOOGLE_TO_KEYS.set(v, [...(GOOGLE_TO_KEYS.get(v) || []), g.key]);
}

/** genre keys of a book (from genres.js) */
function genreKeysOf(book) {
  const values = book.goodbooks_id ? book.main_genres || [] : book.categories || [];
  const map = book.goodbooks_id ? GOODREADS_TO_KEYS : GOOGLE_TO_KEYS;
  return [...new Set(values.flatMap((v) => map.get(v) || []))];
}

const monthKey = (d) => new Date(d).toISOString().slice(0, 7); // "2026-10" (UTC)
function last12Months(now = new Date()) {
  const out = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

// All readers' average ratings (goodbooks), sorted - for "you rate more generously
// than X% of readers". One query when first needed, then kept in memory.
let readersPromise = null;
function readersAverages(db) {
  if (!readersPromise) {
    readersPromise = db
      .query(`SELECT avg(rating)::float8 AS a FROM dataset_ratings GROUP BY user_id;`)
      .then((r) => Float64Array.from(r.rows.map((x) => x.a)).sort())
      .catch((err) => { readersPromise = null; throw err; });
  }
  return readersPromise;
}
const shareBelow = (sorted, x) => {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < x) lo = mid + 1; else hi = mid; }
  return sorted.length ? lo / sorted.length : null;
};

function topCounts(counter, n, extra = () => ({})) {
  return [...counter.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n).map(([k, c]) => ({ ...extra(k), count: c }));
}

async function computeInsights(db, userId, { now = new Date() } = {}) {
  const [{ rows: ratings }, { rows: events }, { rows: chosen }] = await Promise.all([
    db.query(`SELECT book_id, rating, source, created_at FROM user_ratings WHERE user_id = $1;`, [userId]),
    db.query(
      `SELECT id, book_id, type, created_at FROM user_events
       WHERE user_id = $1 AND type IN ('saved', 'unsaved', 'finished', 'dismissed')
       ORDER BY created_at, id;`,
      [userId]
    ),
    db.query(`SELECT genre_key FROM user_genres WHERE user_id = $1 ORDER BY genre_key;`, [userId]),
  ]);

  // events -> finished (first time), TBR (latest saved/unsaved), dismissed
  const finishedAt = new Map();
  const lastSave = new Map();
  const dismissed = new Set();
  for (const e of events) {
    if (e.type === "finished" && !finishedAt.has(e.book_id)) finishedAt.set(e.book_id, e.created_at);
    if (e.type === "saved" || e.type === "unsaved") lastSave.set(e.book_id, e);
    if (e.type === "dismissed") dismissed.add(e.book_id);
  }
  const tbr = [...lastSave.values()].filter((e) => e.type === "saved");
  const readIds = new Set([...ratings.map((r) => r.book_id), ...finishedAt.keys()]);

  // book details for every book we look at
  const ids = [...new Set([...readIds, ...dismissed, ...tbr.map((e) => e.book_id)])];
  const withSeries = await hasSeriesColumns(db);
  const { rows: bookRows } = ids.length
    ? await db.query(
        `SELECT id, title, authors, main_genres, categories, page_count, goodbooks_id
                ${withSeries ? ", series_name, series_number::float8 AS series_number" : ""}
         FROM books WHERE id = ANY($1::int[]);`,
        [ids]
      )
    : { rows: [] };
  const book = new Map(bookRows.map((b) => [b.id, b]));

  // 1. totals
  const pagesKnown = [...readIds].map((id) => book.get(id)?.page_count).filter((p) => Number.isInteger(p) && p > 0);
  const avgRating = ratings.length ? ratings.reduce((s, r) => s + r.rating, 0) / ratings.length : null;
  const oldestTbr = tbr.length ? tbr.reduce((a, b) => (a.created_at <= b.created_at ? a : b)) : null;
  const totals = {
    rated: ratings.length,
    finished: finishedAt.size,
    read: readIds.size,
    tbr: tbr.length,
    pagesRead: pagesKnown.reduce((s, p) => s + p, 0),
    booksWithPages: pagesKnown.length,
    avgRating: avgRating === null ? null : Math.round(avgRating * 100) / 100,
    oldestTbr: oldestTbr ? { id: oldestTbr.book_id, title: book.get(oldestTbr.book_id)?.title, since: oldestTbr.created_at } : null,
  };

  // 2. activity per month (last 12 months)
  const months = last12Months(now);
  const act = new Map(months.map((m) => [m, { month: m, finished: 0, rated: 0 }]));
  for (const at of finishedAt.values()) act.get(monthKey(at)) && act.get(monthKey(at)).finished++;
  for (const r of ratings) if (r.source !== "onboarding") act.get(monthKey(r.created_at)) && act.get(monthKey(r.created_at)).rated++;
  const activity = [...act.values()];

  // 3. taste: genres you chose vs genres of the books you loved
  const loved = ratings.filter((r) => r.rating >= 4).map((r) => book.get(r.book_id)).filter(Boolean);
  const lovedGenres = new Map();
  for (const b of loved) for (const k of genreKeysOf(b)) lovedGenres.set(k, (lovedGenres.get(k) || 0) + 1);
  const chosenKeys = chosen.map((c) => c.genre_key);
  const taste = {
    chosen: chosenKeys.map((k) => ({ key: k, label: LABEL.get(k) || k })),
    lovedBooks: loved.length,
    loved: topCounts(lovedGenres, 8, (k) => ({ key: k, label: LABEL.get(k) || k, chosen: chosenKeys.includes(k) })),
  };

  // 4. how you rate
  const distribution = [1, 2, 3, 4, 5].map((s) => ({ stars: s, count: ratings.filter((r) => r.rating === s).length }));
  let generousThan = null;
  let readersAvg = null;
  if (avgRating !== null) {
    try {
      const avgs = await readersAverages(db);
      generousThan = shareBelow(avgs, avgRating);
      readersAvg = avgs.length ? Math.round((avgs.reduce((s, x) => s + x, 0) / avgs.length) * 100) / 100 : null;
    } catch { /* the comparison is optional */ }
  }
  const ratingStyle = { distribution, avg: totals.avgRating, readersAvg, generousThan: generousThan === null ? null : Math.round(generousThan * 100) };

  // 5. series in progress
  let series = { inProgress: [], completed: 0 };
  if (withSeries) {
    const names = [...new Set([...readIds].map((id) => book.get(id)?.series_name).filter(Boolean))];
    if (names.length) {
      const { rows: members } = await db.query(
        `SELECT id, series_name, series_number::float8 AS n FROM books
         WHERE series_name = ANY($1::text[]) AND series_number IS NOT NULL ORDER BY series_number, id;`,
        [names]
      );
      const lastAt = new Map();
      for (const r of ratings) lastAt.set(r.book_id, r.created_at);
      for (const [id, at] of finishedAt) if (!lastAt.has(id) || at > lastAt.get(id)) lastAt.set(id, at);
      const inProgress = [];
      for (const name of names) {
        const byNumber = new Map(); // one book per number (editions)
        for (const m of members.filter((x) => x.series_name === name)) if (!byNumber.has(m.n)) byNumber.set(m.n, []);
        for (const m of members.filter((x) => x.series_name === name)) byNumber.get(m.n).push(m.id);
        const readNumbers = [...byNumber.entries()].filter(([, bookIds]) => bookIds.some((id) => readIds.has(id))).map(([n]) => n);
        if (!byNumber.size || !readNumbers.length) continue;
        if (readNumbers.length >= byNumber.size) { series.completed++; continue; }
        const next = [...byNumber.entries()].find(([, bookIds]) => !bookIds.some((id) => readIds.has(id)));
        const lastTs = Math.max(...[...readIds].filter((id) => book.get(id)?.series_name === name).map((id) => +new Date(lastAt.get(id) || 0)));
        inProgress.push({ name, read: readNumbers.length, total: byNumber.size, nextBookId: next ? next[1][0] : null, lastActivity: new Date(lastTs).toISOString() });
      }
      inProgress.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
      series = { inProgress: inProgress.slice(0, 6), completed: series.completed };
    }
  }

  // 6. "Not for me" by genre, and favourite authors
  const dismissedGenres = new Map();
  for (const id of dismissed) for (const k of genreKeysOf(book.get(id) || {})) dismissedGenres.set(k, (dismissedGenres.get(k) || 0) + 1);
  const authors = new Map();
  for (const b of loved) if (b.authors?.[0]) authors.set(b.authors[0], (authors.get(b.authors[0]) || 0) + 1);

  return {
    totals,
    activity,
    taste,
    ratingStyle,
    series,
    notForMe: { count: dismissed.size, genres: topCounts(dismissedGenres, 5, (k) => ({ key: k, label: LABEL.get(k) || k })) },
    topAuthors: topCounts(authors, 5, (name) => ({ name })),
  };
}

module.exports = { computeInsights, genreKeysOf, last12Months, monthKey };
