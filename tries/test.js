/**
 * Test harness for the CBF recommender.
 * Runs a list of test cases and prints results so you can eyeball whether
 * the ranking makes sense. Each result shows the final score and how it was
 * built: embedding similarity + a bonus when author AND category both match.
 *
 * Usage:
 *   node test.js [count]
 *
 * To compare with and without the bonus, change MATCH_BONUS in recommender.js
 * (set it to 0 for pure embedding similarity).
 *
 * Note: after merge-duplicates some ids were deleted. If a test says
 * "No book found", look up a new id with:
 *   SELECT id, title FROM books WHERE title ILIKE '%hemingway%';
 */

const {
  pool,
  MATCH_BONUS,
  formatAuthors,
  formatCategories,
  getBookById,
  getSimilarBooks,
  formatRow,
} = require("./recommender");

// ---- Edit this list with real book_ids + what you expect to see ----
const TEST_CASES = [
  {
    bookId: 6,
    label: "Same author, different book (Jane Austen)",
    note:
      "Sense and Sensibility - Illustrated Edition (id=6). Expect other Austen books that also " +
      "share a category (e.g. Fiction) to rise because of the bonus. Books with category " +
      "'No category' (like Pride and Prejudice Annotated) get NO bonus, since the category cannot match.",
  },
  {
    bookId: 3,
    label: "Theme check (literary fiction)",
    note:
      "The Face of Another (Kobo Abe). Few other books by this author exist, so the " +
      "ranking should stay mostly content-based: identity, masks, doubles.",
  },
  {
    bookId: 9,
    label: "Cross-genre check (Biography vs Fiction)",
    note:
      "Hemingway (biography of the author). Expect books about authors and literature. " +
      "A bonus needs the same author AND category, so only books by James R. Mellow in the " +
      "same category would get it.",
  },
  {
    bookId: 999999,
    label: "Edge case: nonexistent id",
    note: "Should fail gracefully, not crash.",
  },
];
// ----------------------------------------------------------------------

async function runTestCase(tc, count) {
  console.log("\n" + "=".repeat(70));
  console.log(`TEST: ${tc.label}  (book_id=${tc.bookId})`);
  console.log(`Expectation: ${tc.note}`);
  console.log("=".repeat(70));

  const book = await getBookById(tc.bookId);
  if (!book) {
    console.log(`  -> No book found with id=${tc.bookId} (expected for edge cases).`);
    return;
  }
  if (!book.embedding) {
    console.log(`  -> Book "${book.title}" has no embedding yet. Skipping.`);
    return;
  }

  console.log(`Base book: "${book.title}" - ${formatAuthors(book.authors)} [${formatCategories(book.categories)}]\n`);

  const similar = await getSimilarBooks(tc.bookId, count);
  if (similar.length === 0) {
    console.log("  (no similar books returned)");
    return;
  }

  similar.forEach((row, i) => console.log("  " + formatRow(row, i)));
}

async function main() {
  const count = parseInt(process.argv[2], 10) || 5;
  console.log(`Bonus: +${MATCH_BONUS} only when author AND category both match`);
  for (const tc of TEST_CASES) {
    await runTestCase(tc, count);
  }
  console.log("\nDone. Review each block against its expectation above.\n");
  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});