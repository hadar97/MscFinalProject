/**
 * Fixes two data problems in the goodbooks-10k-extended file, for the 10K books
 * that are already in the `books` table.
 *
 * Problem 1 - brackets in author names (~1,800 books):
 *   the extended file has authors like "[George Orwell" or "Nicholas Sparks]",
 *   so "[George Orwell" != "George Orwell" and the CBF author bonus breaks.
 *
 * Problem 2 - wrong enrichment (~180 books):
 *   for some books the extended file copied the description, authors, genres
 *   and pages of a NEIGHBOURING book. Example: "The Snow Child" (Eowyn Ivey)
 *   got the description and authors of "The History of the Hobbit".
 *
 * The fix uses the ORIGINAL goodbooks books.csv (the one you loaded at the
 * start), whose authors are correct:
 *   - every 10K book gets its authors from the original file
 *     (written in Google's style: "J.K. Rowling" -> "J. K. Rowling")
 *   - a book whose enriched first author does not appear in the original
 *     authors is "wrongly enriched": its description, categories,
 *     goodreads_genres and page_count are cleared, and its embedding is reset
 *     so embed-books.js computes it again (from the title).
 *
 *   - with --delete-wrong, those books are DELETED instead of cleared.
 *     Their ratings are then simply skipped when ratings are loaded.
 *
 * Default is a DRY RUN that writes data/fix-review.csv. --apply changes the
 * table in one transaction.
 *
 * Run:
 *   node fix-goodbooks.js ./data/books.csv ./data/books_enriched.csv
 *   node fix-goodbooks.js ./data/books.csv ./data/books_enriched.csv --apply --delete-wrong
 *   node fix-goodbooks.js ./data/books.csv ./data/books_enriched.csv --apply   (clear instead,
 *                                                       then run node embed-books.js)
 */

const fs = require("fs");
const { parse } = require("csv-parse/sync");
const { Pool } = require("pg");
require("dotenv").config();

const csvArgs = process.argv.filter((a) => a.endsWith(".csv"));
const ORIGINAL_CSV = csvArgs[0] || "./data/books.csv";
const ENRICHED_CSV = csvArgs[1] || "./data/books_enriched.csv";
const APPLY = process.argv.includes("--apply");
// --delete-wrong: delete the wrongly enriched books instead of clearing their data
const DELETE_WRONG = process.argv.includes("--delete-wrong");
const REVIEW_PATH = "./data/fix-review.csv";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function readCsv(path) {
  if (!fs.existsSync(path)) throw new Error(`File not found: ${path}`);
  return parse(fs.readFileSync(path), { columns: true, bom: true, relax_quotes: true });
}

// "['[George Orwell', 'Erich Fromm]']" -> ["George Orwell", "Erich Fromm"]
function parseList(text) {
  if (!text) return [];
  const out = [];
  const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(text))) out.push((m[1] ?? m[2]).replace(/[[\]]/g, "").trim());
  return out.filter(Boolean);
}

// "J.K. Rowling" -> "J. K. Rowling" (Google's style; the CBF bonus compares exactly)
function normalizeAuthor(name) {
  return name.replace(/\.(?=[A-Z])/g, ". ").replace(/\s+/g, " ").trim();
}

function lastName(name) {
  const words = (name || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z ]/g, " ").trim().split(/\s+/);
  return words[words.length - 1] || "";
}

// The original books.csv exists in two versions:
//   GitHub: book_id = goodbooks id (1..10000)
//   Kaggle: id = goodbooks id, book_id = Goodreads id
function goodbooksIdOf(row) {
  return parseInt("goodreads_book_id" in row ? row.book_id : row.id, 10);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Missing DATABASE_URL in .env file");
    process.exit(1);
  }

  const original = new Map(); // goodbooks id -> [authors]
  for (const r of readCsv(ORIGINAL_CSV)) {
    original.set(
      goodbooksIdOf(r),
      (r.authors || "").split(",").map((a) => normalizeAuthor(a)).filter(Boolean)
    );
  }
  const enriched = new Map(); // goodbooks id -> first enriched author
  for (const r of readCsv(ENRICHED_CSV)) {
    enriched.set(parseInt(r.book_id, 10), parseList(r.authors)[0] || "");
  }
  console.log(`Original authors: ${original.size} books, enriched: ${enriched.size} books`);

  const { rows: books } = await pool.query(
    `SELECT id, goodbooks_id, title, authors FROM books WHERE goodbooks_id IS NOT NULL;`
  );

  const authorFixes = []; // { id, authors }
  const wrong = [];       // { id, title, enrichedAuthor, originalAuthors }
  for (const b of books) {
    const origAuthors = original.get(b.goodbooks_id);
    if (!origAuthors || !origAuthors.length) continue;

    if (JSON.stringify(origAuthors) !== JSON.stringify(b.authors)) {
      authorFixes.push({ id: b.id, authors: origAuthors });
    }
    const enrichedFirst = enriched.get(b.goodbooks_id) || "";
    const origLastNames = new Set(origAuthors.map(lastName));
    if (enrichedFirst && !origLastNames.has(lastName(enrichedFirst))) {
      wrong.push({
        id: b.id, title: b.title,
        enrichedAuthor: enrichedFirst, originalAuthors: origAuthors.join(", "),
      });
    }
  }

  console.log(`\n10K books in table:                 ${books.length}`);
  console.log(`  authors to replace with original: ${authorFixes.length}`);
  console.log(`  wrongly enriched (data cleared):  ${wrong.length}`);
  wrong.slice(0, 8).forEach((w) =>
    console.log(`    - "${w.title}": had ${w.enrichedAuthor}, really ${w.originalAuthors}`)
  );

  const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const lines = ["books_id,title,enriched_author_wrong,original_authors"];
  wrong.forEach((w) =>
    lines.push([w.id, esc(w.title), esc(w.enrichedAuthor), esc(w.originalAuthors)].join(","))
  );
  fs.mkdirSync("./data", { recursive: true });
  fs.writeFileSync(REVIEW_PATH, "﻿" + lines.join("\n"), "utf8");
  console.log(`\nAll wrongly enriched books were written to ${REVIEW_PATH}`);

  if (!APPLY) {
    console.log("DRY RUN - nothing was changed. Run again with --apply.");
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const f of authorFixes) {
      await client.query(`UPDATE books SET authors = $1 WHERE id = $2;`, [f.authors, f.id]);
    }
    if (DELETE_WRONG) {
      await client.query(`DELETE FROM books WHERE id = ANY($1::int[]);`, [wrong.map((w) => w.id)]);
    } else {
      await client.query(
        `UPDATE books
         SET description = NULL, categories = '{}', goodreads_genres = NULL,
             page_count = NULL, embedding = NULL
         WHERE id = ANY($1::int[]);`,
        [wrong.map((w) => w.id)]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  const action = DELETE_WRONG ? "deleted" : "cleared";
  console.log(`\nDone. Fixed authors of ${authorFixes.length} books, ${action} ${wrong.length} wrongly enriched books.`);
  if (!DELETE_WRONG) console.log("Now run: node embed-books.js   (recomputes the cleared embeddings)");
  await pool.end();
}

main().catch(async (err) => {
  console.error("Fatal error:", err.message);
  await pool.end();
  process.exit(1);
});