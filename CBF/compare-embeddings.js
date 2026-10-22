/**
 * Which embedding gives better "similar books"?  (any two columns of books)
 *
 * Since 22/10/2026 `embedding` = mpnet and `embedding_minilm` = the old MiniLM
 * (db/switch-embedding.js). Results on 200 popular books: readers agree@10
 * without the series 17.0% (MiniLM) -> 22.4% (mpnet). Earlier tests (columns
 * since dropped): v3 = + Goodreads genres in the text, v4 = cleaned
 * descriptions - neither helped.
 *
 *   v1  embedding     title + description                    (what the app uses now)
 *   v3  embedding_v3  title + Goodreads genres + description (CBF/embed-books.js --text v3)
 *
 * evaluate.js measures PERSONAL recommendations; this script measures the book
 * page ("Similar in spirit"), which nobody measured yet.
 *
 * The judge = the READERS. For a popular book, the books its readers also loved
 * are known from the ratings (the ALS book vectors, als_item_factors). For each
 * test book we take:
 *     CBF top 10  - the closest books by the embedding column (10K books only,
 *                   English, like CBF/Recommender.js)
 *     ALS top 50  - the closest books by ALS = "readers who liked it liked these"
 * and count how many of the 10 are in the 50:
 *     readers agree@10 = |CBF10 ∩ ALS50| / 10
 * Also measured WITHOUT books of the same series (any version finds Harry
 * Potter 2 for Harry Potter 1 - the interesting part is the rest), and
 *     same genre@10 = share of the 10 whose first genre = the book's first genre.
 *
 * Light on Neon's network quota: the vector search runs inside the database,
 * only ~60 book ids come back per test book.
 *
 * Run:
 *   node CBF/compare-embeddings.js                      embedding vs embedding_minilm, 50 popular books
 *   node CBF/compare-embeddings.js --books 30
 *   node CBF/compare-embeddings.js --a embedding --b embedding_v2
 *   node CBF/compare-embeddings.js --show "Mockingjay"  also print both top-10 lists for a title
 *   node CBF/compare-embeddings.js --rerank             genre bonus test: re-rank the app's pool
 *        (similarity + same-author-and-category bonus, as CBF/Recommender.js)
 *        with + GENRE_BONUS x (share of the book's main genres the other book has),
 *        for several bonus values. Chosen on one group of books (A) and checked
 *        on ANOTHER group (B), so the winner is not just fitted to group A.
 *        --fresh: groups C and D instead (books not in A or B), for a final check.
 *        --match 0,0.05,0.1,0.2 --genre 0.05,0.1,0.15   try every pair of values
 *        (match = the same-author-and-category bonus, genre = the genre bonus)
 *   node CBF/compare-embeddings.js --curve              for choosing the "Show more" cut-off:
 *        top 30 similar books of each test book (column --a), grouped by
 *        similarity, and how often the readers agree in each group
 * Only READS - changes nothing.
 */

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const COL_A = arg("--a", "embedding");
const COL_B = arg("--b", "embedding_minilm");
const N_BOOKS = Math.min(Math.max(Number(arg("--books", 50)) || 50, 5), 200);
const SHOW = arg("--show", "Mockingjay");
const K = 10;
const ALS_K = 50;

for (const c of [COL_A, COL_B]) {
  if (!/^[a-z_][a-z0-9_]*$/.test(c)) throw new Error(`Bad column name: ${c}`);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function cbfTop(col, bookId) {
  const { rows } = await pool.query(
    `SELECT b.id FROM books b, (SELECT ${col} AS e FROM books WHERE id = $1) t
     WHERE b.id <> $1 AND b.${col} IS NOT NULL AND b.goodbooks_id IS NOT NULL AND b.language = 'en'
     ORDER BY b.${col} <=> t.e
     LIMIT $2;`,
    [bookId, K]
  );
  return rows.map((r) => r.id);
}

async function alsTop(bookId) {
  const { rows } = await pool.query(
    `SELECT a.book_id AS id FROM als_item_factors a, (SELECT factors FROM als_item_factors WHERE book_id = $1) t
     WHERE a.book_id <> $1
     ORDER BY a.factors <=> t.factors
     LIMIT $2;`,
    [bookId, ALS_K]
  );
  return new Set(rows.map((r) => r.id));
}

// --curve: readers' agreement by similarity - where do the matches turn into noise?
async function curve() {
  const TOP = 30;
  const { rows: tests } = await pool.query(
    `SELECT b.id, b.series_name FROM books b
     JOIN book_popularity p ON p.book_id = b.id JOIN als_item_factors a ON a.book_id = b.id
     WHERE b.${COL_A} IS NOT NULL AND b.language = 'en'
     ORDER BY p.ratings_count DESC, b.id LIMIT $1;`,
    [N_BOOKS * 4]
  );
  const sample = tests.filter((_, i) => i % 4 === 0).slice(0, N_BOOKS);
  const bins = new Map(); // "0.45" -> { n, agree }
  const atRank = { 10: [], 20: [], 30: [] };
  for (const t of sample) {
    const als = await alsTop(t.id);
    const { rows } = await pool.query(
      `SELECT b.id, b.series_name, 1 - (b.${COL_A} <=> x.e) AS sim
       FROM books b, (SELECT ${COL_A} AS e FROM books WHERE id = $1) x
       WHERE b.id <> $1 AND b.${COL_A} IS NOT NULL AND b.goodbooks_id IS NOT NULL AND b.language = 'en'
       ORDER BY b.${COL_A} <=> x.e LIMIT $2;`,
      [t.id, TOP]
    );
    rows.forEach((r, i) => { if (atRank[i + 1]) atRank[i + 1].push(r.sim); });
    for (const r of rows) {
      if (t.series_name && r.series_name === t.series_name) continue; // same series: too easy
      const key = (Math.floor(r.sim * 20) / 20).toFixed(2); // groups of 0.05
      const b = bins.get(key) || { n: 0, agree: 0 };
      b.n++; if (als.has(r.id)) b.agree++;
      bins.set(key, b);
    }
  }
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)].toFixed(3) : "-"; };
  console.log(`\n${COL_A}: top ${TOP} similar books of ${sample.length} popular books (same series left out)`);
  console.log(`Typical similarity at place 10: ${med(atRank[10])}, 20: ${med(atRank[20])}, 30: ${med(atRank[30])}`);
  console.log(`\nsimilarity     books   readers agree`);
  for (const [key, b] of [...bins.entries()].sort((a, b2) => Number(b2[0]) - Number(a[0]))) {
    const hi = (Number(key) + 0.05).toFixed(2);
    console.log(`${key} - ${hi}   ${String(b.n).padStart(5)}   ${((b.agree / b.n) * 100).toFixed(1).padStart(5)}%`);
  }
  console.log(`\n(a random book would be "agreed" ~${((ALS_K / 10000) * 100).toFixed(1)}% of the time)`);
}

// --rerank: which bonuses make "Similar in spirit" better? The app's score is
//   similarity + MATCH (same author AND same category) + GENRE x (share of shared main genres)
// --match 0,0.05,0.1  and  --genre 0,0.1  give the values to try (every pair is tried).
const APP_NOW = { match: 0.1, genre: 0.1 };   // CBF/Recommender.js today
const listArg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1].split(",").map(Number).filter((x) => x >= 0) : def;
};
const MATCHES = listArg("--match", [0.1]);
const GENRES = listArg("--genre", [0, 0.02, 0.05, 0.1, 0.15]);
const POOL = 50;                       // the app re-ranks the 50 closest books (count 6 -> max(60, 50))
async function rerank() {
  const { rows: all } = await pool.query(
    `SELECT b.id, b.series_name, b.main_genres, b.authors, b.categories FROM books b
     JOIN book_popularity p ON p.book_id = b.id JOIN als_item_factors a ON a.book_id = b.id
     WHERE b.${COL_A} IS NOT NULL AND b.language = 'en' AND cardinality(b.main_genres) > 0
     ORDER BY p.ratings_count DESC, b.id LIMIT $1;`,
    [N_BOOKS * 4]
  );
  // --fresh: two OTHER groups (C, D) - for checking a value chosen on A and B
  const fresh = process.argv.includes("--fresh");
  const groups = fresh
    ? { C: all.filter((_, i) => i % 4 === 1), D: all.filter((_, i) => i % 4 === 3) }
    : { A: all.filter((_, i) => i % 4 === 0), B: all.filter((_, i) => i % 4 === 2) };
  const [g1, g2] = Object.keys(groups);
  const overlap = (a, b) => (a || []).filter((x) => (b || []).includes(x)).length;
  const settings = MATCHES.flatMap((match) => GENRES.map((genre) => ({ match, genre, key: `${match}|${genre}` })));
  const result = {};
  for (const [g, books] of Object.entries(groups)) {
    const sum = Object.fromEntries(settings.map((st) => [st.key, { agree: 0, n: 0, genre: 0 }]));
    for (const t of books) {
      const als = await alsTop(t.id);
      const { rows: cands } = await pool.query(
        `SELECT b.id, b.series_name, b.main_genres, b.authors, b.categories, 1 - (b.${COL_A} <=> x.e) AS sim
         FROM books b, (SELECT ${COL_A} AS e FROM books WHERE id = $1) x
         WHERE b.id <> $1 AND b.${COL_A} IS NOT NULL AND b.goodbooks_id IS NOT NULL AND b.language = 'en'
         ORDER BY b.${COL_A} <=> x.e LIMIT $2;`,
        [t.id, POOL]
      );
      for (const st of settings) {
        const ranked = cands
          .map((c) => {
            const match = overlap(c.authors, t.authors) && overlap(c.categories, t.categories) ? st.match : 0;
            const genre = st.genre * (overlap(c.main_genres, t.main_genres) / t.main_genres.length);
            return { ...c, score: c.sim + match + genre };
          })
          .sort((a, b) => b.score - a.score)
          .slice(0, K);
        const s2 = sum[st.key];
        const others = ranked.filter((c) => !(t.series_name && c.series_name === t.series_name));
        if (others.length) { s2.agree += others.filter((c) => als.has(c.id)).length / others.length; s2.n++; }
        s2.genre += ranked.filter((c) => c.main_genres?.[0] === t.main_genres[0]).length / K;
      }
    }
    result[g] = { size: books.length, sum };
  }
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  console.log(`\nBonuses on ${COL_A}: top ${K} out of the ${POOL} closest (10K books), group ${g1} and ${g2} = ${result[g1].size} books each`);
  console.log(`\nmatch  genre   ${g1}: agree   ${g2}: agree   average   ${g1}: same genre   ${g2}: same genre`);
  for (const st of settings) {
    const a = result[g1].sum[st.key], b = result[g2].sum[st.key];
    const avg = (a.agree / a.n + b.agree / b.n) / 2;
    const now = st.match === APP_NOW.match && st.genre === APP_NOW.genre ? "   <- the app now" : "";
    console.log(`${st.match.toFixed(2).padEnd(7)}${st.genre.toFixed(2).padEnd(8)}${pct(a.agree / a.n).padStart(9)}${pct(b.agree / b.n).padStart(12)}${pct(avg).padStart(10)}${pct(a.genre / result[g1].size).padStart(18)}${pct(b.genre / result[g2].size).padStart(18)}${now}`);
  }
  console.log("\n(agree = readers agree@10 without books of the same series)");
}

async function main() {
  if (process.argv.includes("--curve")) return curve();
  if (process.argv.includes("--rerank")) return rerank();
  // Coverage: does every book have both columns?
  const { rows: cov } = await pool.query(
    `SELECT count(*)::int AS total, count(${COL_A})::int AS a, count(${COL_B})::int AS b FROM books;`
  );
  console.log(`Books: ${cov[0].total}  with ${COL_A}: ${cov[0].a}  with ${COL_B}: ${cov[0].b}`);

  // Test books: popular 10K books (well-known readers' taste), spread over the top 4*N
  const { rows: tests } = await pool.query(
    `SELECT b.id, b.title, b.series_name, b.main_genres
     FROM books b
     JOIN book_popularity p ON p.book_id = b.id
     JOIN als_item_factors a ON a.book_id = b.id
     WHERE b.${COL_A} IS NOT NULL AND b.${COL_B} IS NOT NULL AND b.language = 'en'
     ORDER BY p.ratings_count DESC
     LIMIT $1;`,
    [N_BOOKS * 4]
  );
  const sample = tests.filter((_, i) => i % 4 === 0).slice(0, N_BOOKS);

  // details of every book we will see (series, genre, title) - fetched as needed
  const info = new Map();
  async function need(ids) {
    const missing = ids.filter((id) => !info.has(id));
    if (!missing.length) return;
    const { rows } = await pool.query(
      `SELECT id, title, series_name, main_genres FROM books WHERE id = ANY($1::int[]);`,
      [missing]
    );
    for (const r of rows) info.set(r.id, r);
  }

  const score = { [COL_A]: { agree: 0, agreeNoSeries: 0, nNoSeries: 0, genre: 0 }, [COL_B]: { agree: 0, agreeNoSeries: 0, nNoSeries: 0, genre: 0 } };
  for (const t of sample) {
    info.set(t.id, t);
    const als = await alsTop(t.id);
    for (const col of [COL_A, COL_B]) {
      const top = await cbfTop(col, t.id);
      await need(top);
      const s = score[col];
      s.agree += top.filter((id) => als.has(id)).length / K;
      const others = top.filter((id) => !(t.series_name && info.get(id)?.series_name === t.series_name));
      if (others.length) {
        s.agreeNoSeries += others.filter((id) => als.has(id)).length / others.length;
        s.nNoSeries++;
      }
      const g = t.main_genres?.[0];
      if (g) s.genre += top.filter((id) => info.get(id)?.main_genres?.[0] === g).length / K;
    }
  }

  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  console.log(`\n${sample.length} popular books, top ${K} similar vs the ${ALS_K} books their readers also liked (ALS)\n`);
  console.log(`${"".padEnd(30)}${COL_A.padEnd(16)}${COL_B}`);
  const row = (label, f) => console.log(`${label.padEnd(30)}${pct(f(score[COL_A])).padEnd(16)}${pct(f(score[COL_B]))}`);
  row("readers agree@10", (s) => s.agree / sample.length);
  row("  same, without the series", (s) => (s.nNoSeries ? s.agreeNoSeries / s.nNoSeries : 0));
  row("same first genre@10", (s) => s.genre / sample.length);

  // Example lists, to see the difference with your own eyes
  if (SHOW) {
    const { rows: found } = await pool.query(
      `SELECT b.id, b.title FROM books b JOIN book_popularity p ON p.book_id = b.id
       WHERE b.title ILIKE $1 ORDER BY p.ratings_count DESC LIMIT 1;`,
      [`%${SHOW}%`]
    );
    if (found[0]) {
      const als = await alsTop(found[0].id);
      console.log(`\n"${found[0].title}"   (* = its readers also liked it)`);
      for (const col of [COL_A, COL_B]) {
        const top = await cbfTop(col, found[0].id);
        await need(top);
        console.log(`  ${col}:`);
        top.forEach((id, i) => console.log(`    ${String(i + 1).padStart(2)}. ${als.has(id) ? "*" : " "} ${info.get(id)?.title}`));
      }
    } else {
      console.log(`\nNo popular book matching "${SHOW}".`);
    }
  }
}

main()
  .catch((err) => {
    console.error("Error:", err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
