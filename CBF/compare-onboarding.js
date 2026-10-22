/**
 * The questionnaire's Google books - MiniLM vs mpnet, side by side.
 *
 * For a genre that exists ONLY in Google books (Technology, Health, Education...)
 * onboarding/onboarding.js picks: first books with 5+ Google ratings, then the
 * most TYPICAL books of the genre = closest to the genre's average embedding.
 * "Typical" depends on the embedding, so the switch to mpnet (22/10/2026) may
 * show other books. These books have no readers' ratings, so there is no
 * judge - this script prints both lists for a human check.
 *
 *   node CBF/compare-onboarding.js            all Google-only genres, 10 books each
 *   node CBF/compare-onboarding.js --n 20
 * Only READS. Columns: embedding (mpnet, the app) and embedding_minilm (old).
 */

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { GENRES, expandGenres } = require(path.join(__dirname, "..", "onboarding", "genres"));

const i = process.argv.indexOf("--n");
const N = Math.min(Math.max(Number(i > 0 ? process.argv[i + 1] : 10) || 10, 3), 30);
const MIN_DESCRIPTION = 200;    // as onboarding.js
const MIN_GOOGLE_RATINGS = 5;   // as onboarding.js

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// the same query as googleBooksOfGenre in onboarding.js, with the column as a choice
async function typical(col, google) {
  const { rows } = await pool.query(
    `WITH g AS (
       SELECT id, title, ratings_count, ${col} AS e FROM books
       WHERE goodbooks_id IS NULL AND categories && $1::text[] AND ${col} IS NOT NULL
         AND length(coalesce(description, '')) >= $2
     ),
     c AS (SELECT avg(e) AS centroid FROM g)
     SELECT g.id, g.title, coalesce(g.ratings_count, 0) >= $3 AS rated
     FROM g, c
     ORDER BY (coalesce(g.ratings_count, 0) >= $3) DESC, g.e <=> c.centroid
     LIMIT $4;`,
    [google, MIN_DESCRIPTION, MIN_GOOGLE_RATINGS, N]
  );
  return rows;
}

async function main() {
  const googleOnly = GENRES.filter((g) => !g.goodreads.length);
  for (const g of googleOnly) {
    const { google } = expandGenres([g.key]);
    const [mp, ml] = [await typical("embedding", google), await typical("embedding_minilm", google)];
    const same = mp.filter((b) => ml.some((x) => x.id === b.id)).length;
    console.log(`\n=== ${g.label || g.key}   (same book in both lists: ${same} of ${N})`);
    console.log(`${"mpnet (the app now)".padEnd(58)}MiniLM (before)`);
    for (let k = 0; k < N; k++) {
      const a = mp[k], b = ml[k];
      const fmt = (x) => (x ? `${x.rated ? "*" : " "} ${String(x.title).slice(0, 52)}` : "");
      console.log(`${String(k + 1).padStart(2)}. ${fmt(a).padEnd(54)}${fmt(b)}`);
    }
  }
  console.log("\n* = has 5+ Google ratings (always first, the embedding does not change these)");
}

main()
  .catch((err) => {
    console.error("Error:", err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
