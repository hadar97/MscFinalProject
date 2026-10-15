/**
 * ייבוא ספרים מ-Google Books API לטבלת books ב-PostgreSQL
 *
 * הרעיון: Google Books מגביל כל שאילתה ל-40 תוצאות (maxResults) לעמוד,
 * ובפועל תוצאות הרלוונטיות "נגמרות" אחרי כמה עמודים גם אם totalItems גבוה.
 * כדי לכסות מגוון רחב יותר, מריצים הרבה שאילתות שונות (ז'אנרים/מילות מפתח)
 * ולא מסתמכים על שאילתה אחת.
 *
 * חלק מהז'אנרים ("young adult", "true crime", "crafts & hobbies",
 * "literary criticism", "comics") מוגדרים ב-Google Books עם טקסונומיה
 * חלשה - שאילתה בודדת עליהם מחזירה מעט מאוד תוצאות. לכן לז'אנרים האלה
 * יש כמה ניסוחי שאילתה חלופיים, שכולם נשמרים תחת אותו תיוג ז'אנר קנוני
 * (search_term) בטבלה - כך שהפילוח הסופי לפי ז'אנר נשאר נכון וקריא.
 *
 * הרצה: node import-books.js
 */

const { Pool } = require("pg");
require("dotenv").config();

const API_KEY = process.env.GOOGLE_BOOKS_API_KEY;
const MAX_RESULTS_PER_PAGE = 40; // המקסימום שגוגל מאפשר
const PAGES_PER_QUERY = 5; // עד כמה עמודים לרדת לכל שאילתה (5*40=200)
const DELAY_MS = 600; // עיכוב בין קריאות כדי לא לחטוף rate limit

// מיפוי ז'אנר -> רשימת שאילתות. לרוב הז'אנרים שאילתה אחת מספיקה,
// אבל לז'אנרים "חלשים" יש כמה ניסוחים חלופיים כדי לכסות אותם טוב יותר -
// כולם נשמרים תחת אותו search_term קנוני (מפתח האובייקט).
const GENRE_QUERIES = {
  fiction: ["subject:fiction"],
  fantasy: ["subject:fantasy"],
  "science fiction": ["subject:science fiction", "sci-fi novel"],
  mystery: ["subject:mystery"],
  romance: ["subject:romance"],
  thriller: ["subject:thriller"],
  horror: ["subject:horror"],
  biography: ["subject:biography"],
  history: ["subject:history"],
  "self-help": ["subject:self-help"],
  business: ["subject:business"],
  philosophy: ["subject:philosophy"],
  poetry: ["subject:poetry"],
  psychology: ["subject:psychology"],
  cooking: ["subject:cooking"],
  travel: ["subject:travel"],
  art: ["subject:art"],
  science: ["subject:science"],
  technology: ["subject:technology"],
  "young adult": [
    "subject:young adult fiction",
    "young adult fantasy",
    "subject:juvenile fiction teen",
    "young adult romance novel",
  ],
  children: ["subject:children"],
  comics: ["subject:comics", "graphic novel", "subject:comics & graphic novels"],
  religion: ["subject:religion"],
  health: ["subject:health"],
  politics: ["subject:politics"],
  adventure: ["subject:adventure"],
  classics: ["subject:classics"],
  drama: ["subject:drama"],
  humor: ["subject:humor"],
  crime: ["subject:crime"],
  "true crime": [
    "true crime murder",
    "true crime investigation",
    "subject:true crime stories",
    "unsolved murder case book",
  ],
  western: ["subject:western"],
  sports: ["subject:sports"],
  education: ["subject:education"],
  law: ["subject:law"],
  medical: ["subject:medical"],
  economics: ["subject:economics"],
  parenting: ["subject:parenting"],
  "crafts & hobbies": [
    "subject:crafts & hobbies",
    "diy crafts guide",
    "subject:handicraft",
    "hobby crafts book",
  ],
  gardening: ["subject:gardening"],
  music: ["subject:music"],
  photography: ["subject:photography"],
  reference: ["subject:reference"],
  war: ["subject:war"],
  nature: ["subject:nature"],
  "foreign language study": ["subject:foreign language study"],
  computers: ["subject:computers"],
  mathematics: ["subject:mathematics"],
  architecture: ["subject:architecture"],
  fashion: ["subject:fashion"],
  sociology: ["subject:sociology"],
  "literary criticism": [
    "subject:literary criticism",
    "literary analysis essays",
    "subject:literary theory",
  ],
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS books (
      id SERIAL PRIMARY KEY,
      google_id TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      authors TEXT[],
      publisher TEXT,
      published_date TEXT,
      description TEXT,
      isbn_10 TEXT,
      isbn_13 TEXT,
      page_count INTEGER,
      categories TEXT[],
      average_rating NUMERIC,
      ratings_count INTEGER,
      language TEXT,
      thumbnail_url TEXT,
      search_term TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractIsbn(industryIdentifiers = [], type) {
  const found = industryIdentifiers.find((id) => id.type === type);
  return found ? found.identifier : null;
}

function mapVolumeToRow(volume, genre) {
  const info = volume.volumeInfo || {};
  return {
    google_id: volume.id,
    title: info.title || "Untitled",
    authors: info.authors || [],
    publisher: info.publisher || null,
    published_date: info.publishedDate || null,
    description: info.description || null,
    isbn_10: extractIsbn(info.industryIdentifiers, "ISBN_10"),
    isbn_13: extractIsbn(info.industryIdentifiers, "ISBN_13"),
    page_count: info.pageCount || null,
    categories: info.categories || [],
    average_rating: info.averageRating || null,
    ratings_count: info.ratingsCount || null,
    language: info.language || null,
    thumbnail_url: info.imageLinks ? info.imageLinks.thumbnail : null,
    search_term: genre, // הז'אנר הקנוני, לא בהכרח מחרוזת השאילתה עצמה
  };
}

async function insertBook(row) {
  const query = `
    INSERT INTO books (
      google_id, title, authors, publisher, published_date, description,
      isbn_10, isbn_13, page_count, categories, average_rating,
      ratings_count, language, thumbnail_url, search_term
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
    )
    ON CONFLICT (google_id) DO NOTHING;
  `;
  const values = [
    row.google_id,
    row.title,
    row.authors,
    row.publisher,
    row.published_date,
    row.description,
    row.isbn_10,
    row.isbn_13,
    row.page_count,
    row.categories,
    row.average_rating,
    row.ratings_count,
    row.language,
    row.thumbnail_url,
    row.search_term,
  ];
  const result = await pool.query(query, values);
  return result.rowCount > 0; // true אם באמת נוסף (לא היה כפילות)
}

const MAX_RETRIES = 4;

async function fetchPage(query, startIndex) {
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", query);
  url.searchParams.set("startIndex", startIndex);
  url.searchParams.set("maxResults", MAX_RESULTS_PER_PAGE);
  url.searchParams.set("key", API_KEY);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json();

    // 503/429 הן שגיאות זמניות של גוגל - שווה לנסות שוב עם המתנה גדלה
    const isRetryable = res.status === 503 || res.status === 429;
    if (!isRetryable || attempt === MAX_RETRIES) {
      throw new Error(`Google Books API error ${res.status}: ${await res.text()}`);
    }

    const backoff = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s, 8s
    console.log(`  ${query} (startIndex=${startIndex}): שגיאה ${res.status}, ניסיון חוזר בעוד ${backoff / 1000}s...`);
    await sleep(backoff);
  }
}

// מריץ שאילתה בודדת (query) עבור ז'אנר קנוני נתון (genre), עם pagination
async function importForQuery(query, genre) {
  let inserted = 0;
  let skipped = 0;

  for (let page = 0; page < PAGES_PER_QUERY; page++) {
    const startIndex = page * MAX_RESULTS_PER_PAGE;
    let data;
    try {
      data = await fetchPage(query, startIndex);
    } catch (err) {
      console.error(`  שגיאה בשליפת "${query}" (startIndex=${startIndex}):`, err.message);
      break;
    }

    const items = data.items || [];
    if (items.length === 0) break; // אין עוד תוצאות לשאילתה הזו

    for (const volume of items) {
      const row = mapVolumeToRow(volume, genre);
      const wasInserted = await insertBook(row);
      wasInserted ? inserted++ : skipped++;
    }

    await sleep(DELAY_MS);
  }

  return { inserted, skipped };
}

// מריץ את כל וריאציות השאילתה של ז'אנר נתון, ומסכם תוצאה אחת לז'אנר
async function importForGenre(genre, queries) {
  let totalInserted = 0;
  let totalSkipped = 0;

  for (const query of queries) {
    const { inserted, skipped } = await importForQuery(query, genre);
    totalInserted += inserted;
    totalSkipped += skipped;
  }

  console.log(`"${genre}": נוספו ${totalInserted}, דילוג (כפילות) ${totalSkipped}`);
  return { inserted: totalInserted, skipped: totalSkipped };
}

async function main() {
  if (!API_KEY) {
    console.error("חסר GOOGLE_BOOKS_API_KEY בקובץ .env");
    process.exit(1);
  }

  await ensureTable();

  let totalInserted = 0;
  let totalSkipped = 0;

  for (const [genre, queries] of Object.entries(GENRE_QUERIES)) {
    const { inserted, skipped } = await importForGenre(genre, queries);
    totalInserted += inserted;
    totalSkipped += skipped;
  }

  console.log(`\nסה"כ: נוספו ${totalInserted} ספרים חדשים, ${totalSkipped} כפילויות דולגו.`);
  await pool.end();
}

main().catch((err) => {
  console.error("שגיאה כללית:", err);
  process.exit(1);
});