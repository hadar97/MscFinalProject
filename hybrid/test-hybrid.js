/**
 * Test harness for the hybrid recommender.
 *
 * Scenario 1 - goodbooks users with many ratings (should look like CF).
 * Scenario 2 - a NEW user who picked only a few books (like an onboarding
 *              questionnaire) - should mix popular books with CF.
 * Scenario 3 - a user who likes books from a Google-only genre (Computers) -
 *              the reserved places should show [Google] books, by CBF.
 * Scenario 4 - a user with NO ratings - only popular books.
 * Scenario 5 - questionnaire: chose Fantasy + Technology and gave 5 stars to
 *              everything (checks the mean fix: before it, CF/CBF gave 0).
 *
 * Usage:
 *   node HYBRID/test-hybrid.js [count]
 */

const hybrid = require("./hybrid-recommender");
const { pool } = hybrid;

function formatAuthors(a) {
  return a && a.length ? a.join(", ") : "Unknown author";
}

function print(result) {
  console.log(`CF weight for this user: ${(result.cfWeight * 100).toFixed(0)}%   genres: ${result.genres.join(", ") || "-"}`);
  result.recommendations.forEach((r, i) => {
    const source = r.goodbooks_id ? "[10K]   " : "[Google]";
    console.log(
      `  ${String(i + 1).padStart(2)}. ${source} "${r.title}" - ${formatAuthors(r.authors)}\n` +
      `      ${r.reason}  (score ${Number(r.score).toFixed(3)})`
    );
  });
}

async function idByTitle(title) {
  const { rows } = await pool.query(
    `SELECT id FROM books WHERE lower(title) = lower($1) ORDER BY goodbooks_id NULLS LAST LIMIT 1;`,
    [title]
  );
  return rows[0]?.id;
}

async function main() {
  const count = parseInt(process.argv[2], 10) || 10;

  // Scenario 1
  for (const userId of [1, 6]) {
    console.log("\n" + "=".repeat(70));
    console.log(`SCENARIO 1: goodbooks user ${userId} (many ratings)`);
    console.log("=".repeat(70));
    print(await hybrid.getHybridRecommendationsForUser(userId, count));
  }

  // Scenario 2: new user, onboarding picks
  console.log("\n" + "=".repeat(70));
  console.log("SCENARIO 2: NEW user - loved 3 fantasy books, disliked 1");
  console.log("=".repeat(70));
  const picks = [
    ["The Hobbit", 5],
    ["The Name of the Wind", 5],
    ["Harry Potter and the Sorcerer's Stone", 5],
    ["Twilight", 2],
  ];
  const newUser = [];
  for (const [title, rating] of picks) {
    const id = await idByTitle(title);
    if (id) newUser.push({ bookId: id, rating });
  }
  console.log(`Rated: ${picks.map(([t, r]) => `${t} (${r}★)`).join(", ")}`);
  print(await hybrid.getHybridRecommendations(newUser, count));

  // Scenario 3: likes Google-only genre
  console.log("\n" + "=".repeat(70));
  console.log("SCENARIO 3: user who loved 3 Computers books (Google, no ratings) + 2 popular novels");
  console.log("=".repeat(70));
  const { rows: tech } = await pool.query(
    `SELECT id, title FROM books
     WHERE goodbooks_id IS NULL AND 'Computers' = ANY(categories)
       AND length(coalesce(description, '')) > 100 AND embedding IS NOT NULL
     ORDER BY id LIMIT 3;`
  );
  const techUser = tech.map((b) => ({ bookId: b.id, rating: 5 }));
  for (const t of ["The Hunger Games", "To Kill a Mockingbird"]) {
    const id = await idByTitle(t);
    if (id) techUser.push({ bookId: id, rating: 4 });
  }
  console.log(`Rated: ${tech.map((b) => `"${b.title}"`).join(", ")} (5★) + 2 novels (4★)`);
  print(await hybrid.getHybridRecommendations(techUser, count));

  // Scenario 4: no ratings
  console.log("\n" + "=".repeat(70));
  console.log("SCENARIO 4: user with NO ratings");
  console.log("=".repeat(70));
  print(await hybrid.getHybridRecommendations([], count));

  // Scenario 5: questionnaire - genres + only 5-star answers
  console.log("\n" + "=".repeat(70));
  console.log("SCENARIO 5: questionnaire - chose Fantasy + Technology, 5 stars to everything");
  console.log("=".repeat(70));
  const q = [];
  for (const t of ["The Hobbit", "A Game of Thrones", "The Pragmatic Programmer"]) {
    const id = await idByTitle(t);
    if (id) q.push({ bookId: id, rating: 5 });
  }
  console.log(`Rated 5 stars: The Hobbit, A Game of Thrones, The Pragmatic Programmer (${q.length} found)`);
  print(await hybrid.getHybridRecommendations(q, count, { genres: ["fantasy", "technology"] }));

  console.log("\nDone.\n");
  await pool.end();
}

main().catch(async (err) => {
  console.error("Fatal error:", err);
  await pool.end();
  process.exit(1);
});