/**
 * Consent versions and rules (table user_consents, db/create-consent-table.js).
 *
 * When the Terms of Use or the Privacy Policy change in a way users should
 * know about, change its version here (the date of the change) AND the date
 * on the page (web/app/terms, web/app/privacy). Every user is then asked to
 * agree again the next time they open the app.
 */

const CONSENT_VERSIONS = {
  terms: "2026-10-26",
  privacy: "2026-10-26",
  age_16: "2026-10-25",
  research: "2026-10-25",
};

// Without these the app cannot be used; research is optional
const REQUIRED = ["terms", "privacy", "age_16"];
const SOURCES = new Set(["signup", "consent_page", "account"]);

// body keys from the website -> consent types
const BODY_KEYS = { terms: "terms", privacy: "privacy", age16: "age_16", research: "research" };

/** The user's current choice per type (the latest row of each type) */
async function currentConsents(db, userId) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (consent_type) consent_type, version, granted, created_at
     FROM user_consents WHERE user_id = $1
     ORDER BY consent_type, created_at DESC, id DESC;`,
    [userId]
  );
  const current = {};
  for (const r of rows) current[r.consent_type] = { granted: r.granted, version: r.version, at: r.created_at };
  return current;
}

/** Does the user still have to agree to something (new user, or a policy changed)? */
function consentNeeded(current) {
  return REQUIRED.some((t) => !current[t] || !current[t].granted || current[t].version !== CONSENT_VERSIONS[t]);
}

module.exports = { CONSENT_VERSIONS, REQUIRED, SOURCES, BODY_KEYS, currentConsents, consentNeeded };
