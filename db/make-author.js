/**
 * Make a user an AUTHOR of some books (admin script).
 *
 * An author account gets an "Author" badge in the discussion of THEIR books and
 * can pin one post there. Run it after checking that the person really is the
 * author (a request from the Account page - step 2 - or for a demo).
 *
 *   node db/make-author.js --email reader@mail.com --find "Mockingjay"     show matching books (nothing changes)
 *   node db/make-author.js --email reader@mail.com --books 1943,2025       make them the author of these books
 *   node db/make-author.js --email reader@mail.com --remove                back to a regular reader (removes the links)
 */

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const EMAIL = arg("--email");
const FIND = arg("--find");
const BOOKS = (arg("--books") || "").split(",").map(Number).filter(Number.isInteger);
const REMOVE = process.argv.includes("--remove");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  if (!EMAIL) throw new Error('usage: --email <user email> and one of: --find "title" | --books 1,2 | --remove');
  const { rows: u } = await pool.query(
    `SELECT u.id, u.user_type, a.name FROM users u JOIN neon_auth."user" a ON a.id = u.auth_user_id WHERE lower(a.email) = lower($1);`,
    [EMAIL]
  );
  if (!u[0]) throw new Error(`no app user with email ${EMAIL} (they must sign in once first)`);
  const user = u[0];
  console.log(`User ${user.id} (${user.name}) - now: ${user.user_type}`);

  if (FIND) {
    const { rows } = await pool.query(
      `SELECT id, title, authors[1] AS author FROM books WHERE title ILIKE '%' || $1 || '%' ORDER BY goodbooks_id NULLS LAST LIMIT 15;`,
      [FIND]
    );
    rows.forEach((b) => console.log(`  ${String(b.id).padStart(6)}  ${b.title} - ${b.author || "?"}`));
    console.log("\nNothing changed. Use --books <ids> to link the books.");
    return;
  }
  if (REMOVE) {
    if (user.user_type === "librarian") throw new Error("this is a librarian account - not changed");
    await pool.query(`DELETE FROM author_books WHERE user_id = $1;`, [user.id]);
    await pool.query(`UPDATE users SET user_type = 'reader' WHERE id = $1;`, [user.id]);
    console.log("Done: regular reader again, author links removed.");
    return;
  }
  if (!BOOKS.length) throw new Error("give --books 1,2 (ids from --find)");
  const { rows: found } = await pool.query(`SELECT id, title FROM books WHERE id = ANY($1::int[]);`, [BOOKS]);
  const missing = BOOKS.filter((id) => !found.some((b) => b.id === id));
  if (missing.length) throw new Error(`unknown book ids: ${missing.join(", ")}`);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE users SET user_type = 'author' WHERE id = $1 AND user_type <> 'librarian';`, [user.id]);
    await client.query(
      `INSERT INTO author_books (user_id, book_id) SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING;`,
      [user.id, BOOKS]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  console.log(`Done: author of ${found.map((b) => `"${b.title}"`).join(", ")}.`);
}

main()
  .catch((err) => { console.error("Error:", err.message); process.exitCode = 1; })
  .finally(() => pool.end());
