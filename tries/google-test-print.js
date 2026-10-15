/**
 * בדיקה בלבד: שולח ל-Google Books בדיוק את אותה בקשה כמו import-books.js
 * ומדפיס את הספרים ל-console. לא כותב לשום מקום (בלי DB).
 *
 * הרצה:
 *   node google-test-print.js                 ברירת מחדל: subject:fiction
 *   node google-test-print.js "harry potter"  כל שאילתה אחרת
 */

require("dotenv").config();

const API_KEY = process.env.GOOGLE_BOOKS_API_KEY;
const QUERY = process.argv[2] || "subject:fiction";
const MAX_RESULTS = 10;

async function main() {
  if (!API_KEY) {
    console.error("חסר GOOGLE_BOOKS_API_KEY בקובץ .env");
    process.exit(1);
  }

  // אותה בנייה בדיוק כמו fetchPage ב-import-books.js
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", QUERY);
  url.searchParams.set("startIndex", 0);
  url.searchParams.set("maxResults", MAX_RESULTS);
  url.searchParams.set("key", API_KEY);

  console.log(`שאילתה: ${QUERY}`);
  const res = await fetch(url);
  console.log(`סטטוס: ${res.status}\n`);

  if (!res.ok) {
    console.log(await res.text());
    return;
  }

  const data = await res.json();
  const items = data.items || [];
  console.log(`totalItems: ${data.totalItems ?? 0}, הוחזרו: ${items.length}\n`);

  items.forEach((volume, i) => {
    const info = volume.volumeInfo || {};
    console.log(`${i + 1}. ${info.title || "Untitled"}`);
    console.log(`   מחברים:   ${(info.authors || []).join(", ") || "-"}`);
    console.log(`   קטגוריות: ${(info.categories || []).join(", ") || "-"}`);
    console.log(`   שפה:      ${info.language || "-"}`);
    console.log(`   google_id: ${volume.id}\n`);
  });
}

main().catch((err) => console.error("שגיאה:", err.message));
