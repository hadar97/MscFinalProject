/**
 * Test harness for the CF recommender (item-item), next to CBF for comparison.
 *
 * Part 1 - "similar books": for each test book, CBF (content) vs CF (readers)
 *          side by side.
 * Part 2 - personal recommendations for a few goodbooks users: their top-rated
 *          books, then what CBF (kNN) and CF recommend.
 *          Needs content_similarity (CBF/train-cbf.js) and item_similarity (CF/train-cf.js).
 *
 * Usage:
 *   node test-cf.js [count]
 */

const cf = require("./cf-recommender");
const cbf = require("../CBF/Recommender");

const TEST_BOOKS = [
  "The Hunger Games",               // CBF gave "books about the book" - CF should give Divergent etc.
  "Harry Potter and the Sorcerer's Stone",
  "Pride and Prejudice",
  "The Da Vinci Code",
  "Gone Girl",
];
const TEST_USERS = 3; // a few users with many ratings

async function findByTitle(title) {
  const { rows } = await cf.pool.query(
    `SELECT id FROM books WHERE lower(title) = lower($1) AND goodbooks_id IS NOT NULL LIMIT 1;`,
    [title]
  );
  return rows[0]?.id ?? null;
}

function line(i, title, authors, extra) {
  return `  ${String(i + 1).padStart(2)}. "${title}" - ${cf.formatAuthors(authors)}  ${extra}`;
}

async function compareSimilar(title, count) {
  console.log("\n" + "=".repeat(70));
  console.log(`SIMILAR BOOKS: "${title}"`);
  console.log("=".repeat(70));
  const id = await findByTitle(title);
  if (!id) {
    console.log("  -> not found");
    return;
  }
  const content = await cbf.getSimilarBooks(id, count);
  console.log("CBF (similar content):");
  content.forEach((r, i) => console.log(line(i, r.title, r.authors, `(score ${Number(r.score).toFixed(3)})`)));

  const readers = await cf.getCfSimilarBooks(id, count);
  console.log("CF (readers who liked it also liked):");
  if (!readers.length) console.log("  (no CF neighbours)");
  readers.forEach((r, i) =>
    console.log(line(i, r.title, r.authors, `(sim ${Number(r.similarity).toFixed(3)}, ${r.co_count} shared readers)`))
  );
}

async function userRecommendations(count) {
  const { rows: users } = await cf.pool.query(
    `SELECT user_id FROM dataset_ratings
     GROUP BY user_id
     HAVING count(*) BETWEEN 80 AND 120
     ORDER BY user_id
     LIMIT $1;`,
    [TEST_USERS]
  );
  for (const { user_id: userId } of users) {
    console.log("\n" + "=".repeat(70));
    console.log(`USER ${userId}`);
    console.log("=".repeat(70));
    const rated = await cf.getUserRatings(userId);
    console.log(`Rated ${rated.length} books. Top rated:`);
    rated.slice(0, 5).forEach((r, i) => console.log(line(i, r.title, r.authors, `(${r.rating}★)`)));

    const content = await cbf.getCbfRecommendationsForUser(userId, count);
    console.log("CBF recommends (kNN, by content):");
    content.forEach((r, i) => {
      const source = r.goodbooks_id ? "[10K]" : "[Google]";
      console.log(line(i, r.title, r.authors, `${source} (score ${Number(r.score).toFixed(2)}, support ${r.support})`));
    });

    const recs = await cf.getCfRecommendationsForUser(userId, count);
    console.log("CF recommends (by readers):");
    recs.forEach((r, i) =>
      console.log(line(i, r.title, r.authors,
        `(score ${Number(r.score).toFixed(2)}, predicted ${Number(r.predicted).toFixed(2)}★, support ${r.support})`))
    );
  }
}

async function main() {
  const count = parseInt(process.argv[2], 10) || 5;
  for (const title of TEST_BOOKS) await compareSimilar(title, count);
  await userRecommendations(count);
  console.log("\nDone.\n");
  await cf.pool.end();
  await cbf.pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});