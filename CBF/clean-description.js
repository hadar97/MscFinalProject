/**
 * Clean a book description before it is turned into an embedding (CBF).
 *
 * The embedding model (all-MiniLM-L6-v2) reads only the beginning of the text,
 * so every marketing sentence at the start ("this new foiled edition is
 * available for a limited period", "#1 New York Times bestseller") takes the
 * place of the story. This removes, sentence by sentence:
 *   - sentences only about the book as a PRODUCT (copies sold, awards won,
 *     "now a major motion picture", "this edition includes", "Praise for ...")
 *   - marketing PHRASES inside a sentence that also tells the story
 *     ("New York Times bestselling author X tells..." -> "X tells...")
 *   - quotes from reviews ('"Gripping." - Publishers Weekly')
 *   - the same sentence a second time
 * and HTML tags / entities.
 * Safety net: if too little would be left, the original text is kept.
 *
 *   const { cleanDescription } = require("./clean-description");
 *
 * Preview on the goodbooks CSV (no database):
 *   node CBF/clean-description.js ./data/books_enriched.csv          stats + 15 examples
 *   node CBF/clean-description.js ./data/books_enriched.csv --all    every changed book (long)
 */

// Whole sentences that are only about the BOOK AS A PRODUCT (never the story)
const PRODUCT_SENTENCE = [
  /\b(copies|million readers)\b.*\b(sold|in print|worldwide)\b/i,
  /\bnow a (major )?(motion picture|movie|film|netflix|hbo|tv|television)\b/i,
  /\bsoon to be a (major )?(motion picture|movie|film|series)\b/i,
  /\b(available for a limited|now available|available for the first time|available in paperback|available again)\b/i,
  /^\s*(an? |the )?[\w#'’ ]{0,40}best[- ]?seller[.!]?\s*$/i, // "A NEW YORK TIMES #1 Bestseller." 
  /\blimited (time|period)\b/i,
  /\bthis (new |special |revised )?edition (contains|includes|features|has)\b/i,
  /^\s*bonus\b/i,
  /\b(includes|featuring) (a |an )?(bonus|exclusive|reading group guide|discussion questions|excerpt|sneak peek)\b/i,
  /^\s*(praise for|advance praise|about the author|from the (author|publisher))\b/i,
  /\b(won|winner of|awarded) the (pulitzer|national book award|man booker|booker|newbery|caldecott|hugo|nebula|edgar)\b/i,
  /^\s*#\s*\d/, // "#1 bestseller ..."
];

// Marketing PHRASES inside a sentence that also tells the story - only the
// phrase goes: "New York Times bestselling author David Levithan tells the
// story of Harry and Craig" -> "David Levithan tells the story of Harry and Craig"
const PHRASES = [
  [/^\s*from (the )?([\w'’-]+ ){0,6}(author|creator|writer|novelist)s? of [^,]+?,?\s+comes\s+/i, ""],
  [/\bin this (stunning |new |special |beautiful |gorgeous )*(\d+\w* )?(anniversary |collector'?s |deluxe |special |new |revised |expanded |movie[- ]tie[- ]in |illustrated |definitive )+edition,?\s*/i, ""],
  [/(?<![\w#])(the )?(#\s*1 |number one )?((new york times|usa today|wall street journal|internationally|international|national|award[- ]winning|rita award[- ]winning|acclaimed|million[- ]copy)[-, ]+(and )?)*best[- ]?selling (author|novelist|writer|ebook author)s?,?\s+/gi, ""],
];

const decode = (s) =>
  s.replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

// Split into sentences, but not after initials or short abbreviations ("M. Leighton", "U. S.", "Dr.")
const ABBREV = /(^|\s)([A-Z]|Mr|Mrs|Ms|Dr|St|Jr|Sr|Vol|No|vs|etc|U\.S|U\.K|Mt|Ft)\.$/;
function sentences(s) {
  const parts = s.split(/(?<=[.!?]["'”’)]*)\s+/);
  const out = [];
  for (const p of parts) {
    if (out.length && ABBREV.test(out[out.length - 1])) out[out.length - 1] += " " + p;
    else out.push(p);
  }
  return out;
}

// A quote from a review: mostly a quote, then a dash and a source
const isReviewQuote = (s) => /^["“].{0,300}["”]\s*[-–—]\s*\S/.test(s.trim()) || /^\s*[-–—]\s*[A-Z][\w .&']{2,60}$/.test(s.trim());

/**
 * @param {string} text
 * @param {{minKeep?: number}} [opts] minKeep: keep the original if fewer characters would remain
 * @returns {{text: string, removed: string[]}}  removed = whole sentences and phrases taken out
 */
function cleanDescription(text, { minKeep = 120 } = {}) {
  // "Bestseller.In the" -> "Bestseller. In the" (missing space after a sentence)
  const original = decode(String(text || "")).replace(/([a-z]{2,}[.!?]["'”’)]?)([A-Z#])/g, "$1 $2");
  if (!original) return { text: "", removed: [] };
  const seen = new Set();
  const kept = [];
  const removed = [];
  for (const raw of sentences(original)) {
    let s = raw.trim();
    if (!s) continue;
    const key = s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    if (key.length > 20 && seen.has(key)) { removed.push(s); continue; } // repeated sentence
    seen.add(key);
    // marketing phrases first, then: is what is left only about the product?
    const whole = s;
    for (const [re, to] of PHRASES) s = s.replace(re, to);
    s = s.replace(/^[\s,;:–—-]+/, "").replace(/\s{2,}/g, " ");
    if (PRODUCT_SENTENCE.some((re) => re.test(s)) || isReviewQuote(whole)) { removed.push(whole); continue; }
    if (s !== whole) removed.push(`(phrase) ${whole.slice(0, 70)}…`);
    if (s) kept.push(s.charAt(0).toUpperCase() + s.slice(1));
  }
  const cleaned = kept.join(" ").trim();
  if (cleaned.length < Math.min(minKeep, original.length * 0.5)) return { text: original, removed: [] }; // safety net
  return { text: cleaned, removed };
}

module.exports = { cleanDescription };

// ---- preview: node CBF/clean-description.js ./data/books_enriched.csv ----
if (require.main === module) {
  const fs = require("fs");
  const { parse } = require("csv-parse/sync");
  const file = process.argv.find((a) => a.endsWith(".csv")) || "./data/books_enriched.csv";
  const all = process.argv.includes("--all");
  const rows = parse(fs.readFileSync(file), { columns: true, bom: true, relax_quotes: true });
  let changed = 0, kept = 0, chars = 0, charsAfter = 0;
  const examples = [];
  for (const r of rows) {
    const before = decode(r.description || "");
    if (!before) continue;
    const { text, removed } = cleanDescription(r.description);
    chars += before.length; charsAfter += text.length;
    if (removed.length) { changed++; examples.push({ title: r.title, removed, after: text }); }
    else if (text !== before) kept++;
  }
  console.log(`Books: ${rows.length}   descriptions changed: ${changed} (${((changed / rows.length) * 100).toFixed(1)}%)`);
  console.log(`Text removed: ${(((chars - charsAfter) / chars) * 100).toFixed(1)}% of all description text`);
  const pick = all ? examples : examples.filter((_, i) => i % Math.max(1, Math.floor(examples.length / 15)) === 0).slice(0, 15);
  for (const e of pick) {
    console.log(`\n=== ${e.title}`);
    for (const s of e.removed) console.log(`  - REMOVED: ${s.slice(0, 160)}`);
    if (process.argv.includes("--full")) console.log(`  + FULL:   ${e.after}`);
    console.log(`  + STARTS: ${e.after.slice(0, 160)}...`);
  }
}
