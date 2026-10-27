/**
 * Review "become an author" requests (admin script for the project team).
 *
 *   node db/author-requests.js                                  list pending requests
 *   node db/author-requests.js --find "Mockingjay"              look up book ids to link
 *   node db/author-requests.js --approve 7 --books 1943,2025    approve: the user becomes an author of these books
 *   node db/author-requests.js --reject 7 --note "Please send a link to your publisher page"
 *   node db/author-requests.js --all                            every request, any status
 *
 * Check that the person really is the author (website, publisher, social media)
 * before approving. The user sees the result and the note on their Account page.
 */

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function list(all) {
  const { rows } = await pool.query(
    `SELECT r.id, r.status, r.pen_name, r.books, r.message, r.note, r.created_at, a.name, a.email, u.user_type
     FROM author_requests r JOIN users u ON u.id = r.user_id JOIN neon_auth."user" a ON a.id = u.auth_user_id
     ${all ? "" : "WHERE r.status = 'pending'"}
     ORDER BY r.created_at;`
  );
  if (!rows.length) return console.log(all ? "No requests yet." : "No pending requests.");
  for (const r of rows) {
    console.log(`\n#${r.id}  [${r.status}]  ${r.created_at.toISOString().slice(0, 10)}  ${r.name} <${r.email}>  (now: ${r.user_type})`);
    console.log(`  Pen name: ${r.pen_name}`);
    console.log(`  Books:    ${r.books.replace(/\n/g, "\n            ")}`);
    if (r.message) console.log(`  Message:  ${r.message}`);
    if (r.note) console.log(`  Note:     ${r.note}`);
  }
  if (!all) console.log(`\nNext: --find "<title>" to get book ids, then --approve <id> --books <ids>  or  --reject <id> --note "..."`);
}

async function main() {
  if (arg("--find")) {
    const { rows } = await pool.query(
      `SELECT b.id, b.title, b.authors[1] AS author, (SELECT count(*) FROM author_books ab WHERE ab.book_id = b.id)::int AS authors_linked
       FROM books b WHERE b.title ILIKE '%' || $1 || '%' ORDER BY b.goodbooks_id NULLS LAST LIMIT 15;`,
      [arg("--find")]
    );
    rows.forEach((b) => console.log(`  ${String(b.id).padStart(6)}  ${b.title} - ${b.author || "?"}${b.authors_linked ? `  (already linked to ${b.authors_linked} author account)` : ""}`));
    return;
  }
  const approveId = Number(arg("--approve"));
  const rejectId = Number(arg("--reject"));
  if (!approveId && !rejectId) return list(process.argv.includes("--all"));

  const id = approveId || rejectId;
  const { rows: req } = await pool.query(`SELECT * FROM author_requests WHERE id = $1;`, [id]);
  if (!req[0]) throw new Error(`no request #${id}`);
  if (req[0].status !== "pending") throw new Error(`request #${id} is already ${req[0].status}`);
  const note = arg("--note");

  if (rejectId) {
    await pool.query(`UPDATE author_requests SET status = 'rejected', note = $2, decided_at = now() WHERE id = $1;`, [id, note]);
    return console.log(`Request #${id} rejected.${note ? "" : " (Tip: add --note so the user knows why.)"}`);
  }

  const books = (arg("--books") || "").split(",").map(Number).filter(Number.isInteger);
  if (!books.length) throw new Error('give --books 1,2 (ids from --find "<title>")');
  const { rows: found } = await pool.query(`SELECT id, title FROM books WHERE id = ANY($1::int[]);`, [books]);
  const missing = books.filter((b) => !found.some((f) => f.id === b));
  if (missing.length) throw new Error(`unknown book ids: ${missing.join(", ")}`);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE users SET user_type = 'author' WHERE id = $1 AND user_type <> 'librarian';`, [req[0].user_id]);
    await client.query(`INSERT INTO author_books (user_id, book_id) SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING;`, [req[0].user_id, books]);
    await client.query(`UPDATE author_requests SET status = 'approved', note = $2, decided_at = now() WHERE id = $1;`, [id, note]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  console.log(`Request #${id} approved: author of ${found.map((b) => `"${b.title}"`).join(", ")}.`);
}

main()
  .catch((err) => { console.error("Error:", err.message); process.exitCode = 1; })
  .finally(() => pool.end());
