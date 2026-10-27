/**
 * Send the "new author request" email again for every PENDING request -
 * e.g. a request sent while the email settings were not ready yet.
 * For development / testing. Uses the same email code and limits as the
 * server (server/mailer.js): only to ADMIN_EMAILS, at most 20 a day.
 *
 *   node db/email-pending-requests.js          send one email per pending request
 *   node db/email-pending-requests.js --dry    only list them, send nothing
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") }); // before the mailer reads the settings
const { Pool } = require("pg");
const { notifyAuthorRequest, ADMINS } = require(path.join(__dirname, "..", "server", "mailer"));

const DRY = process.argv.includes("--dry");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  const missing = ["SMTP_USER", "SMTP_PASS", "ADMIN_EMAILS"].filter((k) => !process.env[k]);
  if (missing.length && !DRY) throw new Error(`missing in .env: ${missing.join(", ")}`);
  const { rows } = await pool.query(
    `SELECT r.id, r.pen_name, r.books, r.message, r.created_at, a.name, a.email
     FROM author_requests r JOIN users u ON u.id = r.user_id JOIN neon_auth."user" a ON a.id = u.auth_user_id
     WHERE r.status = 'pending' ORDER BY r.created_at;`
  );
  if (!rows.length) return console.log("No pending requests.");
  console.log(`${rows.length} pending request(s) -> ${ADMINS.join(", ") || "(ADMIN_EMAILS not set)"}`);
  for (const r of rows) {
    if (DRY) { console.log(`  #${r.id}  ${r.pen_name}  (${r.name} <${r.email}>)`); continue; }
    const ok = await notifyAuthorRequest({ id: Number(r.id), name: r.name, email: r.email, penName: r.pen_name, books: r.books, message: r.message });
    console.log(`  #${r.id}  ${r.pen_name}: ${ok ? "sent" : "NOT sent - see the [mail] line above"}`);
    if (!ok) break; // do not keep trying (e.g. a wrong password)
  }
}

main()
  .catch((err) => { console.error("Error:", err.message); process.exitCode = 1; })
  .finally(() => pool.end());
