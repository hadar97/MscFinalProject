/**
 * Test harness for the CBF recommender, on the combined books table.
 * Runs a list of test cases and prints results so you can eyeball whether
 * the ranking makes sense. Each result shows the final score and how it was
 * built: embedding similarity + a bonus when author AND category both match.
 *
 * Books are looked up by TITLE (not id), so the tests keep working even if
 * the table is rebuilt and the ids change.
 * Each result is tagged [10K] (has ratings) or [Google] (no ratings).
 *
 * Usage:
 *   node test.js [count]
 *
 * To compare with and without the bonus, change MATCH_BONUS in recommender.js
 * (set it to 0 for pure embedding similarity).
 */

const {
  pool,
  MATCH_BONUS,
  formatAuthors,
  formatCategories,
  getBookById,
  getSimilarBooks,
  formatRow,
} = require("./Recommender");

// ---- Edit this list: a title (or a category for "any Google book") + expectation ----
const TEST_CASES = [
  {
    title: "Harry Potter and the Sorcerer's Stone",
    label: "Same author, series (10K)",
    note: "Expect other Harry Potter books near the top, lifted by the bonus (same author + shared category).",
  },
  {
    title: "The Hunger Games",
    label: "Theme check: YA dystopia (10K)",
    note: "Expect Catching Fire / Mockingjay, then other YA dystopias (Divergent, The Maze Runner...).",
  },
  {
    title: "Pride and Prejudice",
    label: "Classic romance (10K)",
    note: "Expect other Jane Austen novels and similar classic romances.",
  },
  {
    title: "The Hobbit",
    label: "Fantasy classic (10K)",
    note: "Expect The Lord of the Rings books and other classic fantasy.",
  },
  {
    category: "Computers",
    label: "Google-only book (no ratings)",
    note: "A book from a genre that exists only in the Google part. Expect other computer / tech books, " +
      "mostly tagged [Google]. This is the cold-start case: CF can't help here, CBF can.",
  },
  {
    category: "Juvenile Fiction",
    label: "Google book in a genre close to 10K",
    note: "Children's fiction from Google. Expect a MIX of [Google] and [10K] results - " +
      "shows that both sources live in one embedding space.",
  },
  {
    title: "No Such Book Title 12345",
    label: "Edge case: book not found",
    note: "Should fail gracefully, not crash.",
  },
];
// ----------------------------------------------------------------------------------

// Exact title (case-insensitive). If both a 10K and a Google book have it, prefer 10K.
async function findByTitle(title) {
  const { rows } = await pool.query(
    `SELECT id FROM books
     WHERE lower(title) = lower($1) AND embedding IS NOT NULL
     ORDER BY goodbooks_id NULLS LAST, id
     LIMIT 1;`,
    [title]
  );
  return rows[0]?.id ?? null;
}

// First Google-only book (no ratings) in a category, that has a description
async function findGoogleByCategory(category) {
  const { rows } = await pool.query(
    `SELECT id FROM books
     WHERE goodbooks_id IS NULL AND $1 = ANY(categories)
       AND embedding IS NOT NULL AND length(coalesce(description, '')) > 200
     ORDER BY id
     LIMIT 1;`,
    [category]
  );
  return rows[0]?.id ?? null;
}

async function runTestCase(tc, count) {
  const what = tc.title ? `title="${tc.title}"` : `Google book in category "${tc.category}"`;
  console.log("\n" + "=".repeat(70));
  console.log(`TEST: ${tc.label}  (${what})`);
  console.log(`Expectation: ${tc.note}`);
  console.log("=".repeat(70));

  const bookId = tc.title ? await findByTitle(tc.title) : await findGoogleByCategory(tc.category);
  if (!bookId) {
    console.log("  -> No matching book found (expected for edge cases).");
    return;
  }

  const book = await getBookById(bookId);
  const source = book.goodbooks_id ? "10K" : "Google";
  console.log(
    `Base book: id=${book.id} [${source}] "${book.title}" - ${formatAuthors(book.authors)} ` +
    `[${formatCategories(book.categories)}]\n`
  );

  const similar = await getSimilarBooks(bookId, count);
  if (similar.length === 0) {
    console.log("  (no similar books returned)");
    return;
  }
  similar.forEach((row, i) => console.log("  " + formatRow(row, i)));

  const rated = similar.filter((r) => r.goodbooks_id).length;
  console.log(`\n  ${rated}/${similar.length} recommendations are [10K] (have ratings)`);
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