/**
 * Content-based recommendations (CBF) - given a book id, returns the most
 * similar books: embedding similarity (pgvector cosine) plus a bonus when the
 * book has the same author AND a shared category. See recommender.js.
 *
 * Usage:
 *   node recommend.js <book_id> [count]
 *
 * Example:
 *   node recommend.js 42 5
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

async function main() {
  const bookId = process.argv[2];
  const count = parseInt(process.argv[3], 10) || 5;

  if (!bookId) {
    console.error("Usage: node recommend.js <book_id> [count]");
    process.exit(1);
  }

  const book = await getBookById(bookId);
  if (!book) {
    console.error(`No book found with id=${bookId}`);
    process.exit(1);
  }
  if (!book.embedding) {
    console.error(`Book id=${bookId} ("${book.title}") has no embedding yet.`);
    process.exit(1);
  }

  console.log(`\nBase book: "${book.title}" - ${formatAuthors(book.authors)} [${formatCategories(book.categories)}]`);
  console.log(`Bonus: +${MATCH_BONUS} only when author AND category both match\n`);
  console.log(`Top ${count} similar books:\n`);

  const similar = await getSimilarBooks(bookId, count);
  similar.forEach((row, i) => console.log(formatRow(row, i)));

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});