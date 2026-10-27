/**
 * Why is the admin page not letting me in? Checks the admin settings.
 *   node db/check-admin.js
 * Prints what the server will read from .env and whether each admin email
 * has a BookBridge account. Only READS. (Restart the server after changing .env!)
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { Pool } = require("pg");
const { ADMINS } = require(path.join(__dirname, "..", "server", "mailer"));

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  console.log(`ADMIN_EMAILS raw:  ${JSON.stringify(process.env.ADMIN_EMAILS ?? null)}`);
  console.log(`read as:           ${ADMINS.length ? ADMINS.join(" | ") : "(nothing - add ADMIN_EMAILS=... to .env)"}`);
  console.log(`SMTP_USER:         ${process.env.SMTP_USER ? process.env.SMTP_USER : "(missing)"}`);
  console.log(`SMTP_PASS:         ${process.env.SMTP_PASS ? `${process.env.SMTP_PASS.replace(/\s+/g, "").length} letters (should be 16)` : "(missing)"}`);
  let nodemailer = "installed";
  try { require.resolve("nodemailer"); } catch { nodemailer = "NOT installed - run: npm install nodemailer"; }
  console.log(`nodemailer:        ${nodemailer}\n`);
  for (const email of ADMINS) {
    const { rows } = await pool.query(
      `SELECT a.email, a.name, u.id AS app_id FROM neon_auth."user" a LEFT JOIN users u ON u.auth_user_id = a.id WHERE lower(a.email) = $1;`,
      [email]
    );
    if (!rows[0]) {
      const { rows: like } = await pool.query(`SELECT email FROM neon_auth."user" WHERE email ILIKE '%' || $1 || '%' LIMIT 3;`, [email.split("@")[0]]);
      console.log(`✗ ${email}: no BookBridge account with this exact email.${like.length ? ` Similar: ${like.map((l) => l.email).join(", ")}` : ""}`);
    } else {
      console.log(`✓ ${email}: account found (${rows[0].name})${rows[0].app_id ? "" : " - sign in to the site once to finish setting it up"}`);
    }
  }
}

main()
  .catch((err) => { console.error("Error:", err.message); process.exitCode = 1; })
  .finally(() => pool.end());
