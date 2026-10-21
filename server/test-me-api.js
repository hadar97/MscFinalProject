/**
 * End-to-end test of the signed-in user API, with a REAL Neon Auth account.
 *
 *   1. signs in to Neon Auth with a TEST email + password (creates the
 *      account the first time)
 *   2. gets the login token (JWT)
 *   3. calls the running server: profile, questionnaire, ratings, events,
 *      recommendations (plain + nearby libraries), and a request without a
 *      token (must be refused)
 *
 * WRITES data for the test user only (its ratings, genres, one event). To
 * remove the test user completely: delete the account in the Neon Console
 * (Auth -> Users) - its profile and data are deleted with it.
 *
 * First start the server in another terminal:  node server/server.js
 * Run:  node server/test-me-api.js test1@recoread.dev "Test-password-123"
 *
 * Needs NEON_AUTH_BASE_URL in .env. If sign-in fails, the full answer from Neon
 * Auth is printed - email + password sign-in must be enabled in the Neon
 * Console (Auth -> Configuration).
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const AUTH_URL = (process.env.NEON_AUTH_URL || process.env.NEON_AUTH_BASE_URL || "").replace(/\/$/, "");
const API = `http://localhost:${process.env.PORT || 3001}`;
const ORIGIN = "http://localhost:3000"; // like a website running locally
const [email, password] = process.argv.slice(2);

let pass = 0;
let fail = 0;
function check(name, ok, extra = "") {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);
}

// cookies returned by Neon Auth (the session), sent back on the next calls
function cookiesFrom(res) {
  const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  return list.map((c) => c.split(";")[0]).join("; ");
}

async function authCall(pathPart, body, cookie) {
  const res = await fetch(`${AUTH_URL}${pathPart}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { res, json, text };
}

async function getToken() {
  // sign in; the first time - sign up
  let r = await authCall("/sign-in/email", { email, password });
  if (!r.res.ok) {
    console.log(`Sign-in: ${r.res.status} - trying to create the test account...`);
    r = await authCall("/sign-up/email", { email, password, name: "BookBridge Test" });
  }
  if (!r.res.ok) throw new Error(`Neon Auth refused (${r.res.status}): ${r.text.slice(0, 300)}`);
  const cookie = cookiesFrom(r.res);

  // the JWT: from the session header, or from /token
  const s = await authCall("/get-session", null, cookie);
  let token = s.res.headers.get("set-auth-jwt");
  if (!token) {
    const t = await authCall("/token", null, cookie);
    token = t.json?.token;
    if (!token) throw new Error(`No token from Neon Auth (/token ${t.res.status}): ${t.text.slice(0, 300)}`);
  }
  return token;
}

async function api(method, pathPart, token, body) {
  const res = await fetch(`${API}${pathPart}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

async function main() {
  if (!AUTH_URL) throw new Error("Missing NEON_AUTH_BASE_URL in .env");
  if (!email || !password) throw new Error('Usage: node server/test-me-api.js <test email> "<password>"');

  console.log(`Signing in to Neon Auth as ${email}...`);
  const token = await getToken();
  console.log("Got a login token.\n");

  const noToken = await api("GET", "/api/me");
  check("request without login is refused (401)", noToken.status === 401, `got ${noToken.status}`);
  const badToken = await api("GET", "/api/me", "not-a-real-token");
  check("fake token is refused (401)", badToken.status === 401, `got ${badToken.status}`);

  const me = await api("GET", "/api/me", token);
  check("profile (GET /api/me)", me.status === 200, me.json ? `name ${me.json.name}, ${me.json.ratingsCount} ratings` : me.status);

  // three known books, found by title
  const ids = [];
  for (const q of ["The Hobbit", "Twilight", "Gone Girl"]) {
    const s = await api("GET", `/api/books/search?q=${encodeURIComponent(q)}`);
    if (s.json?.books?.[0]) ids.push(s.json.books[0].id);
  }
  check("found 3 test books by search", ids.length === 3, ids.join(", "));

  const onb = await api("POST", "/api/me/onboarding", token, {
    genres: ["fantasy", "mystery-crime"],
    answers: [{ bookId: ids[0], stars: 5 }, { bookId: ids[1], stars: 4 }, { bookId: ids[2], stars: null }],
  });
  check("questionnaire saved + 10 recommendations", onb.status === 200 && onb.json?.recommendations?.length === 10,
    onb.json?.saved ? `saved ${onb.json.saved.ratings} ratings (1 "haven't read" dropped)` : JSON.stringify(onb.json));

  const rate = await api("POST", "/api/me/ratings", token, { bookId: ids[2], rating: 4 });
  check("rate a book (POST /api/me/ratings)", rate.status === 200);
  const badRate = await api("POST", "/api/me/ratings", token, { bookId: ids[2], rating: 9 });
  check("bad rating refused (400)", badRate.status === 400);

  const ev = await api("POST", "/api/me/events", token, { bookId: ids[0], type: "saved" });
  check("save event (POST /api/me/events)", ev.status === 200);

  const mine = await api("GET", "/api/me/ratings", token);
  const got = new Map((mine.json?.ratings || []).map((r) => [r.bookId, r.rating]));
  check("my ratings saved: 5, 4, and the re-rated book 4",
    got.get(ids[0]) === 5 && got.get(ids[1]) === 4 && got.get(ids[2]) === 4,
    (mine.json?.ratings || []).map((r) => `${r.title}=${r.rating} (${r.source})`).join(", "));

  const recs = await api("GET", "/api/me/recommendations", token);
  check("recommendations from saved ratings", recs.status === 200 && recs.json?.recommendations?.length === 10,
    `CF weight ${Math.round((recs.json?.cfWeight || 0) * 100)}%`);
  (recs.json?.recommendations || []).slice(0, 5).forEach((b, i) => console.log(`        ${i + 1}. ${b.title} - ${b.reasonText}`));

  const near = await api("GET", "/api/me/recommendations?city=Jerusalem&mode=filter", token);
  check("recommendations + libraries in Jerusalem (filter)",
    near.status === 200 && near.json?.recommendations?.every((b) => b.availability),
    `${near.json?.nearby?.available}/${near.json?.recommendations?.length} available`);

  console.log(`\n${pass} passed, ${fail} failed.`);
  if (fail) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exitCode = 1;
});
