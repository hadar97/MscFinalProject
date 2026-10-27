/**
 * Emails to the PROJECT TEAM only (never to users) - e.g. "a new author request".
 * Sent through the project's Gmail with an App Password (Google's official way
 * for programs to use an account).
 *
 * .env:
 *   SMTP_USER     the project's Gmail address (the emails are sent from it)
 *   SMTP_PASS     the 16-letter Google App Password (no spaces) - never in git
 *   ADMIN_EMAILS  who receives them, comma-separated (also: who may open /admin pages)
 *   APP_URL       the website address for links in the email (default http://localhost:3000)
 *
 * Safe for the account:
 *   - at most MAX_PER_DAY emails a day (Gmail limits sending; we stay far below)
 *   - one attempt only: if Google refuses (e.g. a wrong password) we log it and
 *     do NOT retry - repeated failed logins are what makes Google suspicious
 *   - sending never blocks or breaks the user's action: the request is saved
 *     either way, and the admin page / script shows it
 *   - without SMTP_USER / SMTP_PASS nothing is sent and everything else works
 * Package: npm install nodemailer
 */

const MAX_PER_DAY = 20;
const ADMINS = (process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
const APP_URL = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

let transporter = null;
let disabled = false;           // set after Google refuses the login - no more attempts until restart
let sentToday = { day: "", n: 0 };

function getTransporter() {
  if (transporter || disabled) return transporter;
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS || !ADMINS.length) return null;
  let nodemailer;
  try { nodemailer = require("nodemailer"); } catch {
    console.warn("[mail] nodemailer is not installed (npm install nodemailer) - no emails.");
    disabled = true;
    return null;
  }
  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS.replace(/\s+/g, "") },
  });
  return transporter;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Send to the admins. Never throws - returns true if sent. */
async function sendToAdmins(subject, text, html) {
  const t = getTransporter();
  if (!t) return false;
  const day = new Date().toISOString().slice(0, 10);
  if (sentToday.day !== day) sentToday = { day, n: 0 };
  if (sentToday.n >= MAX_PER_DAY) {
    console.warn(`[mail] daily limit (${MAX_PER_DAY}) reached - not sent: ${subject}`);
    return false;
  }
  sentToday.n++;
  try {
    await t.sendMail({ from: `BookBridge <${process.env.SMTP_USER}>`, to: ADMINS.join(", "), subject, text, html });
    return true;
  } catch (err) {
    console.warn(`[mail] not sent (${err.code || err.name}): ${err.message}`);
    if (err.code === "EAUTH" || err.responseCode === 535) {
      disabled = true; // wrong user / App Password: stop, do not keep trying to log in
      console.warn("[mail] Google refused the login - check SMTP_USER / SMTP_PASS in .env, then restart the server.");
    }
    return false;
  }
}

/** "A new author request" - with a button to the admin page */
function notifyAuthorRequest({ id, name, email, penName, books, message }) {
  const link = `${APP_URL}/admin/author-requests?id=${id}`;
  const text =
    `New author request #${id}\n\nFrom: ${name} <${email}>\nPen name: ${penName}\nBooks:\n${books}\n` +
    (message ? `\nMessage:\n${message}\n` : "") + `\nReview it: ${link}\n`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;color:#2B211C">
      <h2 style="margin:0 0 12px">New author request #${id}</h2>
      <p style="margin:4px 0"><b>From:</b> ${esc(name)} &lt;${esc(email)}&gt;</p>
      <p style="margin:4px 0"><b>Pen name:</b> ${esc(penName)}</p>
      <p style="margin:12px 0 4px"><b>Books:</b></p>
      <pre style="white-space:pre-wrap;font-family:inherit;background:#F7F1E8;padding:10px;border-radius:8px;margin:0">${esc(books)}</pre>
      ${message ? `<p style="margin:12px 0 4px"><b>Message:</b></p><pre style="white-space:pre-wrap;font-family:inherit;margin:0">${esc(message)}</pre>` : ""}
      <p style="margin:24px 0"><a href="${esc(link)}" style="background:#A24B25;color:#FFFBF4;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">Review request</a></p>
      <p style="font-size:12px;color:#6B5B4E">Check that the person really is the author before approving. You will be asked to sign in with the project account.</p>
    </div>`;
  return sendToAdmins(`BookBridge: author request from ${penName}`, text, html);
}

const isAdminEmail = (email) => Boolean(email) && ADMINS.includes(String(email).toLowerCase());

module.exports = { sendToAdmins, notifyAuthorRequest, isAdminEmail, ADMINS };
