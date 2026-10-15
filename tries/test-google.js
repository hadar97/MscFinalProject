/**
 * Quick check: which kinds of Google Books queries work right now?
 * Sends 3 queries with the API key from .env and prints the status of each.
 *
 * Run: node test-google.js
 */

require("dotenv").config();

const API_KEY = process.env.GOOGLE_BOOKS_API_KEY;

const QUERIES = [
  { label: "Like import-books.js (subject)", q: "subject:fiction" },
  { label: "By ISBN",                        q: "isbn:0439023483" },
  { label: "By title + author",              q: "intitle:The Hunger Games inauthor:Suzanne Collins" },
];

async function check({ label, q }, withKey) {
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", q);
  url.searchParams.set("maxResults", 5);
  if (withKey) url.searchParams.set("key", API_KEY);

  const res = await fetch(url);
  let info = "";
  if (res.ok) {
    const data = await res.json();
    const first = data.items?.[0]?.volumeInfo?.title || "(no results)";
    info = `${data.totalItems ?? 0} results, first: "${first}"`;
  } else {
    const body = await res.text();
    const message = body.match(/"message":\s*"([^"]+)"/)?.[1] || body.slice(0, 120);
    info = message;
  }
  console.log(`${withKey ? "with key   " : "without key"} | ${label.padEnd(32)} | ${res.status} | ${info}`);
}

async function main() {
  console.log(`API key in .env: ${API_KEY ? "yes (" + API_KEY.slice(0, 6) + "...)" : "NO"}\n`);
  for (const query of QUERIES) {
    if (API_KEY) await check(query, true);
    await check(query, false);
  }
}

main().catch((err) => console.error("Fatal error:", err.message));
