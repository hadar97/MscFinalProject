/**
 * The onboarding questionnaire - texts and structure for the website.
 *
 * One source of truth: the screens, the Hebrew/English texts, the rules
 * (how many genres, star labels...) and the API the screens call.
 * The genre list comes from genres.js, so the questionnaire and the
 * recommender always use the same genres.
 *
 * Flow (what we built and measured - see the project report):
 *   1. welcome    - what the questionnaire is for
 *   2. genres     - choose 3-5 genres                (as in the proposal)
 *   3. rateBooks  - ~20 books from those genres, rate each 1-5 stars or
 *                   "haven't read"                    (our addition: gives CF
 *                                                     real ratings from day 1)
 *   4. authors    - OPTIONAL, not built yet (enabled: false) - the proposal
 *                   mentions "genres / authors"
 *   5. freeText   - OPTIONAL, not built yet (enabled: false)
 *   6. done       - "preparing your recommendations" -> recommendations page
 *
 * Use it:
 *   backend:  const { QUESTIONNAIRE } = require("./onboarding/questionnaire");
 *             (e.g. GET /api/onboarding/questionnaire returns it as JSON)
 *   frontend: node onboarding/questionnaire.js > questionnaire.json
 *             and import the JSON in the React/Next.js app
 */

const { GENRES } = require("./genres");

// The first 12 genres in genres.js are fiction, the rest nonfiction
const FICTION_KEYS = new Set([
  "fantasy", "science-fiction", "mystery-crime", "thriller", "romance", "historical",
  "contemporary", "classics", "young-adult", "horror", "comics", "poetry-drama",
]);

// Genres that exist only in Google books (no reader ratings) - fewer books
// in the questionnaire, and books of these genres are recommended by CBF
const GOOGLE_ONLY = new Set(GENRES.filter((g) => g.goodreads.length === 0).map((g) => g.key));

// The texts are written in Hebrew and English ({ he, en }); the app is in
// ENGLISH, so the exported QUESTIONNAIRE keeps only the English texts
// (see toEnglish below). The Hebrew stays here in case a Hebrew version is added.
const QUESTIONNAIRE_TEXTS = {
  version: 2,
  language: "en",
  direction: "ltr",

  steps: [
    // ---------------------------------------------------------------- 1
    {
      id: "welcome",
      type: "intro",
      enabled: true,
      title: { he: "ברוכים הבאים ל-BookBridge!", en: "Welcome to BookBridge!" },
      body: {
        he: "כדי שנוכל להמליץ לכם על ספרים שבאמת מתאימים לכם, נשאל כמה שאלות קצרות על הטעם שלכם. זה לוקח בערך שתי דקות.",
        en: "To recommend books that really fit you, we'll ask a few short questions about your taste. It takes about two minutes.",
      },
      primaryButton: { he: "בואו נתחיל", en: "Let's start" },
      secondaryButton: { he: "דלגו בינתיים", en: "Skip for now" },
      // Skipping is allowed: the user gets the most liked books overall
      // (getHybridRecommendations with no ratings and no genres).
    },

    // ---------------------------------------------------------------- 2
    {
      id: "genres",
      type: "multiSelect",
      enabled: true,
      title: { he: "מה אתם אוהבים לקרוא?", en: "What do you like to read?" },
      subtitle: { he: "בחרו בין 3 ל-5 ז'אנרים", en: "Choose 3 to 5 genres" },
      min: 3,
      max: 5,
      // Shown as two groups of chips/cards
      groups: [
        { id: "fiction", title: { he: "סיפורת", en: "Fiction" } },
        { id: "nonfiction", title: { he: "עיון", en: "Nonfiction" } },
      ],
      options: GENRES.map((g) => ({
        value: g.key,                              // sent to the API
        label: { he: g.he, en: g.label },
        group: FICTION_KEYS.has(g.key) ? "fiction" : "nonfiction",
      })),
      errors: {
        tooFew: { he: "בחרו לפחות 3 ז'אנרים", en: "Choose at least 3 genres" },
        tooMany: { he: "אפשר לבחור עד 5 ז'אנרים", en: "You can choose up to 5 genres" },
      },
      counter: { he: "נבחרו {n} מתוך 5", en: "{n} of 5 selected" },
      primaryButton: { he: "המשך", en: "Continue" },
    },

    // ---------------------------------------------------------------- 3
    {
      id: "rateBooks",
      type: "rating",
      enabled: true,
      title: { he: "דרגו ספרים שקראתם", en: "Rate books you've read" },
      subtitle: {
        he: "הנה ספרים מהז'אנרים שבחרתם. דרגו את מה שקראתם, ועל השאר סמנו \"לא קראתי\".",
        en: "Here are books from your genres. Rate the ones you've read and mark the rest \"haven't read\".",
      },
      // The books come from the API (getOnboardingBooks) - about 20,
      // already grouped by genre; show the genre name above each group.
      source: "POST /api/onboarding/books",
      bookCount: 20,
      groupByGenre: true,
      stars: {
        min: 1,
        max: 5,
        labels: [
          { value: 1, he: "לא אהבתי בכלל", en: "Didn't like it at all" },
          { value: 2, he: "לא אהבתי", en: "Didn't like it" },
          { value: 3, he: "בסדר", en: "It was OK" },
          { value: 4, he: "אהבתי", en: "Liked it" },
          { value: 5, he: "אהבתי מאוד", en: "Loved it" },
        ],
      },
      notRead: { value: null, label: { he: "לא קראתי", en: "Haven't read" } },
      // Not required, but recommendations get better with more ratings
      recommendedMin: 3,
      hint: {
        he: "ככל שתדרגו יותר ספרים, ההמלצות יהיו מדויקות יותר.",
        en: "The more books you rate, the better your recommendations.",
      },
      // Shown when the user rated fewer than recommendedMin and presses Continue
      lowRatingsConfirm: {
        he: "דירגתם פחות מ-3 ספרים. אפשר להמשיך, אבל ההמלצות יהיו כלליות יותר. להמשיך בכל זאת?",
        en: "You rated fewer than 3 books. You can continue, but recommendations will be more general. Continue anyway?",
      },
      googleOnlyGenres: [...GOOGLE_ONLY], // these genres get half the books (less known books)
      primaryButton: { he: "המשך", en: "Continue" },
      backButton: { he: "חזרה לז'אנרים", en: "Back to genres" },
    },

    // ---------------------------------------------------------------- 4
    {
      id: "authors",
      type: "search",
      enabled: false, // NOT BUILT YET - the proposal mentions authors next to genres
      optional: true,
      title: { he: "יש סופרים שאתם אוהבים במיוחד?", en: "Any authors you especially like?" },
      subtitle: { he: "לא חובה. הקלידו שם וחפשו", en: "Optional. Type a name to search" },
      placeholder: { he: "למשל: J. K. Rowling", en: "e.g. J. K. Rowling" },
      max: 5,
      primaryButton: { he: "המשך", en: "Continue" },
      skipButton: { he: "דלג", en: "Skip" },
    },

    // ---------------------------------------------------------------- 5
    {
      id: "freeText",
      type: "text",
      enabled: false, // NOT BUILT YET - would be embedded with MiniLM and matched by CBF
      optional: true,
      title: { he: "ספרו לנו במילים שלכם", en: "Tell us in your own words" },
      subtitle: {
        he: "לא חובה. איזה ספר הייתם רוצים לקרוא עכשיו?",
        en: "Optional. What kind of book would you like to read now?",
      },
      placeholder: {
        he: "למשל: משהו מותח עם גיבורה חזקה, לא ארוך מדי",
        en: "e.g. something suspenseful with a strong heroine, not too long",
      },
      maxLength: 300,
      primaryButton: { he: "סיום", en: "Finish" },
      skipButton: { he: "דלג", en: "Skip" },
    },

    // ---------------------------------------------------------------- 6
    {
      id: "done",
      type: "loading",
      enabled: true,
      title: { he: "מכינים לכם המלצות...", en: "Preparing your recommendations..." },
      body: {
        he: "עוד רגע תראו 10 ספרים שבחרנו במיוחד בשבילכם.",
        en: "In a moment you'll see 10 books picked just for you.",
      },
      submit: "POST /api/onboarding/submit",
      next: "/recommendations",
    },
  ],

  // Texts for the recommendations page: the `reason` the recommender returns
  // for each book -> what to show under the book
  reasonLabels: {
    "Readers with similar taste liked it (CF)": {
      he: "קוראים עם טעם דומה לשלכם אהבו אותו",
      en: "Readers with similar taste liked it",
    },
    "Popular in your genres": { he: "פופולרי בז'אנרים שבחרתם", en: "Popular in your genres" },
    "Popular with readers": { he: "פופולרי בקרב קוראים", en: "Popular with readers" },
    "Similar in content to books you liked - new, no ratings yet (CBF)": {
      he: "דומה בתוכן לספרים שאהבתם",
      en: "Similar in content to books you liked",
    },
  },

  // What the screens send and get back (implemented with onboarding.js and
  // hybrid/hybrid-recommender.js)
  api: {
    "POST /api/onboarding/books": {
      request: { genres: ["fantasy", "technology"] },
      response: "[{ id, title, authors, thumbnail_url, goodbooks_id, genre }, ...]  (~20 books)",
      backend: "getOnboardingBooks(genres)",
    },
    "POST /api/onboarding/submit": {
      request: {
        genres: ["fantasy", "technology"],
        answers: [{ bookId: 1930, stars: 5 }, { bookId: 2041, stars: null }],
      },
      response: "{ cfWeight, genres, recommendations: [{ id, title, authors, thumbnail_url, reason, score }, ...] }  (10 books)",
      backend:
        "ratings = answersToRatings(answers); save ratings + genres for the user; " +
        "getHybridRecommendations(ratings, 10, { genres })",
    },
  },
};

// { he, en } -> "en text";  { value, he, en } -> { value, label: "en text" }
function toEnglish(x) {
  if (Array.isArray(x)) return x.map(toEnglish);
  if (!x || typeof x !== "object") return x;
  if ("en" in x && "he" in x) {
    const { he, en, ...rest } = x; // eslint-disable-line no-unused-vars
    return Object.keys(rest).length ? { ...toEnglish(rest), label: en } : en;
  }
  return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, toEnglish(v)]));
}

const QUESTIONNAIRE = toEnglish(QUESTIONNAIRE_TEXTS);

module.exports = { QUESTIONNAIRE };

// node onboarding/questionnaire.js > questionnaire.json  -> JSON for the frontend
if (require.main === module) {
  process.stdout.write(JSON.stringify(QUESTIONNAIRE, null, 2) + "\n");
}
