/**
 * The genre list of the onboarding questionnaire, and how each genre maps to
 * the two kinds of books in the `books` table:
 *   goodreads - values of main_genres (10K books): the book's 2 MAIN genres -
 *               the first 2 of goodreads_genres, without "fiction",
 *               "nonfiction" and "books". goodreads_genres lists every genre
 *               readers shelved the book under, most common first, so the
 *               full list puts 1984 in "fantasy"; the first 2 do not.
 *   google    - values of categories, used ONLY for Google books
 *               (for 10K books `categories` is too general - "Fiction")
 *
 * One shared list for the whole project: the questionnaire (what the user
 * sees), the recommender (genre-aware popularity), and the chatbot (a genre
 * the LLM extracts from the conversation).
 *
 * Not in the list on purpose: "fiction", "nonfiction", "books" - they say
 * nothing about taste (most books have them).
 *
 * Run it to check how many books each genre has:
 *   node onboarding/genres.js
 *     rated   = books with ratings (10K) - can be shown by popularity
 *     unrated = Google books - only CBF can recommend them
 */

const GENRES = [
  // ---- Fiction ----
  { key: "fantasy",         label: "Fantasy",                 he: "פנטזיה",                goodreads: ["fantasy", "paranormal"], google: [] },
  { key: "science-fiction", label: "Science Fiction",         he: "מדע בדיוני",            goodreads: ["science-fiction"], google: [] },
  { key: "mystery-crime",   label: "Mystery & Crime",         he: "מתח ובלש",              goodreads: ["mystery", "crime"], google: ["True Crime"] },
  { key: "thriller",        label: "Thriller & Suspense",     he: "מותחן",                 goodreads: ["thriller", "suspense"], google: [] },
  { key: "romance",         label: "Romance",                 he: "רומנטיקה",              goodreads: ["romance", "chick-lit"], google: [] },
  { key: "historical",      label: "Historical Fiction",      he: "סיפורת היסטורית",       goodreads: ["historical-fiction"], google: [] },
  { key: "contemporary",    label: "Contemporary Fiction",    he: "סיפורת עכשווית",        goodreads: ["contemporary"], google: [] },
  { key: "classics",        label: "Classics",                he: "קלאסיקות",              goodreads: ["classics"], google: ["Literary Criticism"] },
  { key: "young-adult",     label: "Young Adult & Children",  he: "נוער וילדים",           goodreads: ["young-adult"], google: ["Juvenile Fiction", "Juvenile Nonfiction"] },
  { key: "horror",          label: "Horror",                  he: "אימה",                  goodreads: ["horror"], google: [] },
  { key: "comics",          label: "Comics & Graphic Novels", he: "קומיקס ורומן גרפי",     goodreads: ["graphic-novels", "comics", "manga"], google: [] },
  { key: "poetry-drama",    label: "Poetry & Drama",          he: "שירה ומחזות",           goodreads: ["poetry"], google: ["Drama", "Performing Arts"] },
  // ---- Nonfiction ----
  { key: "biography",       label: "Biography & Memoir",      he: "ביוגרפיה וזיכרונות",    goodreads: ["biography", "memoir"], google: ["Biography & Autobiography"] },
  { key: "history-politics",label: "History & Politics",      he: "היסטוריה ופוליטיקה",    goodreads: ["history"], google: ["History", "Political Science", "Law", "Social Science"] },
  { key: "science-nature",  label: "Science & Nature",        he: "מדע וטבע",              goodreads: ["science"], google: ["Science", "Nature", "Mathematics"] },
  { key: "psychology",      label: "Psychology & Self-Help",  he: "פסיכולוגיה ושיפור עצמי", goodreads: ["psychology", "self-help"], google: ["Family & Relationships"] },
  { key: "philosophy",      label: "Philosophy & Religion",   he: "פילוסופיה ודת",         goodreads: ["philosophy", "religion", "spirituality", "christian"], google: [] },
  { key: "business",        label: "Business & Economics",    he: "עסקים וכלכלה",          goodreads: ["business"], google: ["Economics"] },
  { key: "technology",      label: "Technology & Computers",  he: "טכנולוגיה ומחשבים",     goodreads: [], google: ["Computers", "Technology & Engineering"] },
  { key: "health",          label: "Health & Medicine",       he: "בריאות ורפואה",         goodreads: [], google: ["Medical", "Health & Fitness", "Health"] },
  { key: "arts",            label: "Art, Design & Music",     he: "אמנות, עיצוב ומוזיקה",  goodreads: ["art", "music"], google: ["Architecture", "Design", "Photography"] },
  { key: "lifestyle",       label: "Travel, Food & Hobbies",  he: "טיולים, אוכל ותחביבים", goodreads: ["travel", "cookbooks", "sports"], google: ["Gardening", "Crafts & Hobbies"] },
  { key: "education",       label: "Education & Language",    he: "חינוך ושפה",            goodreads: [], google: ["Education", "Language Arts & Disciplines", "Foreign Language Study", "Reference"] },
];

const BY_KEY = new Map(GENRES.map((g) => [g.key, g]));

/**
 * Turns the user's chosen genre keys into the values to search for.
 * @param {string[]} keys e.g. ["fantasy", "technology"]
 * @returns {{goodreads: string[], google: string[]}}
 */
function expandGenres(keys) {
  const goodreads = new Set();
  const google = new Set();
  for (const k of keys) {
    const g = BY_KEY.get(k);
    if (!g) throw new Error(`Unknown genre: ${k}`);
    g.goodreads.forEach((x) => goodreads.add(x));
    g.google.forEach((x) => google.add(x));
  }
  return { goodreads: [...goodreads], google: [...google] };
}

/**
 * SQL condition: the book belongs to at least one of the chosen genres.
 * 10K books by main_genres, Google books by categories.
 * Use with parameters $a (goodreads text[]) and $b (google text[]).
 */
function genreCondition(goodreadsParam, googleParam, alias = "b") {
  return `((${alias}.goodbooks_id IS NOT NULL AND ${alias}.main_genres && ${goodreadsParam}::text[])
        OR (${alias}.goodbooks_id IS NULL AND ${alias}.categories && ${googleParam}::text[]))`;
}

module.exports = { GENRES, expandGenres, genreCondition };

// ---- self-check: node onboarding/genres.js ----
if (require.main === module) {
  const { Pool } = require("pg");
  require("dotenv").config();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  (async () => {
    console.log(`${"Genre".padEnd(26)}${"rated (10K)".padEnd(13)}unrated (Google)`);
    for (const g of GENRES) {
      const { goodreads, google } = expandGenres([g.key]);
      const { rows } = await pool.query(
        `SELECT count(*) FILTER (WHERE b.goodbooks_id IS NOT NULL)::int AS rated,
                count(*) FILTER (WHERE b.goodbooks_id IS NULL)::int     AS unrated
         FROM books b WHERE ${genreCondition("$1", "$2")};`,
        [goodreads, google]
      );
      const warn = rows[0].rated < 20 ? "   <- few rated books: onboarding picks will come from Google books" : "";
      console.log(`${g.label.padEnd(26)}${String(rows[0].rated).padEnd(13)}${rows[0].unrated}${warn}`);
    }
    // Values in the DB that no genre uses (so nothing is forgotten)
    const used = new Set(GENRES.flatMap((g) => [...g.goodreads, ...g.google]));
    const { rows: gr } = await pool.query(
      `SELECT g, count(*)::int AS n FROM books, unnest(goodreads_genres) g GROUP BY g ORDER BY n DESC;`);
    const { rows: gc } = await pool.query(
      `SELECT c, count(*)::int AS n FROM books, unnest(categories) c WHERE goodbooks_id IS NULL GROUP BY c ORDER BY n DESC;`);
    const unusedGr = gr.filter((r) => !used.has(r.g)).map((r) => `${r.g} (${r.n})`);
    const unusedGc = gc.filter((r) => !used.has(r.c) && r.n >= 5).map((r) => `${r.c} (${r.n})`);
    console.log(`\nNot mapped - goodreads: ${unusedGr.join(", ") || "none"}`);
    console.log(`Not mapped - Google (5+ books): ${unusedGc.join(", ") || "none"}`);
    await pool.end();
  })().catch(async (e) => {
    console.error("Fatal error:", e.message);
    await pool.end();
    process.exit(1);
  });
}