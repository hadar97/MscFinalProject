/**
 * Try the recommender yourself - your own books, stars and genres.
 *
 * Usage (from the project folder):
 *
 *   Veteran reader (a goodbooks user with many ratings):
 *     node hybrid/try-recommend.js --user 6
 *
 *   New user (like after the questionnaire): books=stars + chosen genres
 *     node hybrid/try-recommend.js "The Hobbit=5" "Twilight=2" "Gone Girl=4" --genres fantasy,mystery-crime
 *
 *   New books (Google books, no ratings): choose a Google-only genre and
 *   rate one such book - the list should include [Google] books (CBF):
 *     node hybrid/try-recommend.js "The Pragmatic Programmer=5" "The Hobbit=5" --genres technology,fantasy
 *
 * Titles: exact title first; if not found, the closest title that contains
 * the text. Genre keys: see onboarding/genres.js (fantasy, romance, technology...).
 */

const hybrid = require("./hybrid-recommender");
const { pool } = hybrid;

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { books: [], genres: [], user: null, count: 10 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--genres") out.genres = args[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (args[i] === "--user") out.user = Number(args[++i]);
    else if (args[i] === "--count") out.count = Number(args[++i]);
    else {
      const m = args[i].match(/^(.*)=(\d)$/);
      if (!m) throw new Error(`Write books as "Title=stars", got: ${args[i]}`);
      out.books.push({ title: m[1].trim(), stars: Number(m[2]) });
    }
  }
  return out;
}

async function findBook(title) {
  const exact = await pool.query(
    `SELECT id, title, goodbooks_id FROM books WHERE lower(title) = lower($1)
     ORDER BY goodbooks_id NULLS LAST LIMIT 1;`,
    [title]
  );
  if (exact.rows[0]) return exact.rows[0];
  const like = await pool.query(
    `SELECT id, title, goodbooks_id FROM books WHERE title ILIKE '%' || $1 || '%'
     ORDER BY goodbooks_id NULLS LAST, length(title) LIMIT 1;`,
    [title]
  );
  return like.rows[0] || null;
}

async function main() {
  const { books, genres, user, count } = parseArgs();
  let result;

  if (user) {
    console.log(`\nVeteran reader: goodbooks user ${user}`);
    result = await hybrid.getHybridRecommendationsForUser(user, count, { genres });
  } else {
    const ratings = [];
    console.log("\nYour books:");
    for (const b of books) {
      const found = await findBook(b.title);
      if (!found) {
        console.log(`  - "${b.title}": NOT FOUND (skipped)`);
        continue;
      }
      const src = found.goodbooks_id ? "[10K]   " : "[Google]";
      console.log(`  ${src} "${found.title}"  ${"*".repeat(b.stars)}`);
      ratings.push({ bookId: found.id, rating: b.stars });
    }
    if (genres.length) console.log(`Chosen genres: ${genres.join(", ")}`);
    result = await hybrid.getHybridRecommendations(ratings, count, { genres });
  }

  console.log(`\nCF (${result.cfModel}) weight: ${(result.cfWeight * 100).toFixed(0)}%   genres used: ${result.genres.join(", ") || "-"}`);
  console.log("Recommendations:");
  result.recommendations.forEach((r, i) => {
    const src = r.goodbooks_id ? "[10K]   " : "[Google]";
    const authors = r.authors && r.authors.length ? r.authors.join(", ") : "Unknown author";
    console.log(`  ${String(i + 1).padStart(2)}. ${src} "${r.title}" - ${authors}`);
    console.log(`      ${r.reason}`);
  });
  console.log();
  await pool.end();
}

main().catch(async (err) => {
  console.error("Error:", err.message);
  await pool.end();
  process.exit(1);
});
