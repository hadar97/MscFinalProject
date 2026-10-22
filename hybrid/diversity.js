/**
 * Diversity in a list of books - post-processing, AFTER the model has scored.
 *
 * Problem (seen in the app): 5 Harry Potter books in one "For you" list,
 * 3 Nicholas Sparks books under "Similar in spirit".
 *
 * Two simple rules:
 *   1. ONE book per series. The series comes from goodbooks titles
 *      ("... (Harry Potter, #2)"), saved by db/add-series.js in
 *      books.series_name / books.series_number.
 *      In "For you" the series is shown by the NEXT book the user has not
 *      rated (rated #1 and #2 -> we show #3; rated none -> #1), and the card
 *      says how many more books the series has.
 *   2. At most MAX_PER_AUTHOR books by the same (first) author.
 *
 * The model's scores do not change - only which books reach the screen.
 * If db/add-series.js has not been run yet, rule 1 is skipped (no error).
 */

const MAX_PER_AUTHOR = 2;

// Normalised title: two editions of the same book (10K + Google copy) = same key
const titleKey = (t) => String(t || "").toLowerCase().replace(/\(.*?\)/g, "").replace(/[^\p{L}\p{N}]/gu, "");

// Do books.series_name / series_number exist? (checked once)
let hasSeriesPromise = null;
function hasSeriesColumns(pool) {
  if (!hasSeriesPromise) {
    hasSeriesPromise = pool
      .query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'books' AND column_name = 'series_name';`)
      .then((r) => {
        if (!r.rowCount) console.warn("books.series_name not found - run db/add-series.js --apply. Series grouping is off.");
        return r.rowCount > 0;
      })
      .catch(() => { hasSeriesPromise = null; return false; });
  }
  return hasSeriesPromise;
}

/**
 * The series of the given books, and ALL books of those series in the catalog.
 * @returns {{ seriesOf: Map<id, name>, members: Map<name, {id, number, rated}[]> }}
 *          members sorted by number; `rated` = has enough ratings (not a "new" book)
 */
async function loadSeries(pool, ids, minRatings = 5) {
  const empty = { seriesOf: new Map(), members: new Map() };
  if (!ids.length || !(await hasSeriesColumns(pool))) return empty;
  const { rows } = await pool.query(
    `WITH s AS (SELECT DISTINCT series_name FROM books WHERE id = ANY($1::int[]) AND series_name IS NOT NULL)
     SELECT b.id, b.series_name, b.series_number::float8 AS number,
            coalesce(p.ratings_count, 0) >= $2 AS rated
     FROM books b JOIN s USING (series_name)
     LEFT JOIN book_popularity p ON p.book_id = b.id
     ORDER BY b.series_name, b.series_number NULLS LAST, b.id;`,
    [ids, minRatings]
  );
  const seriesOf = new Map();
  const members = new Map();
  for (const r of rows) {
    seriesOf.set(r.id, r.series_name);
    if (!members.has(r.series_name)) members.set(r.series_name, []);
    members.get(r.series_name).push({ id: r.id, number: r.number, rated: r.rated });
  }
  return { seriesOf, members };
}

/**
 * The book that represents a series for this user: the lowest-numbered book
 * that `allowed(id)` accepts (not rated by the user, not another edition of a
 * book already shown). Omnibus editions ("#1-3", no single number) are never
 * chosen. Returns null if the user has read the whole series.
 * @returns {{id, number, more}|null}  more = how many other unread books the series has
 */
function seriesRepresentative(members, allowed) {
  const unread = (members || []).filter((m) => m.number !== null && m.rated && allowed(m.id));
  if (!unread.length) return null;
  return { id: unread[0].id, number: unread[0].number, more: unread.length - 1 };
}

/**
 * Simple version for lists that only need filtering (the "similar books" row):
 * keeps the order, one book per series, at most `maxPerAuthor` per author,
 * no two editions of the same title.
 * @param {Array<{id, title, authors}>} books  already ranked
 * @param {{seriesOf?: Map, skipTitles?: string[], maxPerAuthor?: number, count?: number}} opts
 */
function diversify(books, { seriesOf = new Map(), skipTitles = [], maxPerAuthor = MAX_PER_AUTHOR, count = Infinity } = {}) {
  const out = [];
  const series = new Set();
  const titles = new Set(skipTitles.map(titleKey).filter(Boolean));
  const perAuthor = new Map();
  for (const b of books) {
    if (out.length >= count) break;
    const t = titleKey(b.title);
    if (t && titles.has(t)) continue;
    const s = seriesOf.get(b.id);
    if (s && series.has(s)) continue;
    const a = (b.authors?.[0] || "").toLowerCase().trim();
    if (a && (perAuthor.get(a) || 0) >= maxPerAuthor) continue;
    if (t) titles.add(t);
    if (s) series.add(s);
    if (a) perAuthor.set(a, (perAuthor.get(a) || 0) + 1);
    out.push(b);
  }
  return out;
}

module.exports = { MAX_PER_AUTHOR, titleKey, hasSeriesColumns, loadSeries, seriesRepresentative, diversify };
