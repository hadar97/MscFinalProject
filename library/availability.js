/**
 * Library availability - the post-processing step from the proposal
 * ("re-ranks the candidate list by the book's availability in a library
 * within a defined radius of the user").
 *
 * Used ONLY when the user asks for it (the `nearby` option). Without it the
 * recommendations are exactly as before - and the offline evaluation results
 * do not change, because this step runs after the model.
 *
 *   nearby = {
 *     location: { lat, lng }, radiusKm: 10     // branches within a radius, or
 *     city: "Jerusalem"                        // branches in a city, or
 *     libraryIds: [3, 7]                       // specific branches (e.g. "Jerusalem Central")
 *     mode: "filter" | "boost"                 // default "filter"
 *     gamma: 0.1                               // boost strength (mode "boost")
 *   }
 *
 *   filter - only books with a copy on the shelf in those branches
 *   boost  - all books, but available ones move up:
 *              score = position score (1 at the top .. 0 at the bottom of the pool)
 *                    + gamma * availability   (1 = on the shelf right next to the
 *                                              user, 0.5 at the radius edge, 0 = not available)
 *            = the proposal's "+ γ × availability_boost"
 *
 * The inventory is SIMULATED for now (library/simulate-inventory.js); every
 * answer says so (`simulated: true`). A real source only needs to fill
 * library_inventory - nothing here changes.
 */

const { CITY_ALIASES, CITIES } = require("./libraries-data");

const DEFAULT_RADIUS_KM = 10;
const MAX_RADIUS_KM = 50;
const DEFAULT_GAMMA = 0.1; // chosen by library/tune-gamma.js: most availability gain with the taste top-3 fully kept
const BRANCHES_SHOWN = 3; // nearest branches listed per book

class NearbyError extends Error {}

/** Checks and normalizes the `nearby` option (throws NearbyError on bad input). */
function parseNearby(nearby) {
  if (!nearby || typeof nearby !== "object") throw new NearbyError("nearby must be an object");
  const mode = nearby.mode ?? "filter";
  if (!["filter", "boost"].includes(mode)) throw new NearbyError('nearby.mode must be "filter" or "boost"');
  const gamma = nearby.gamma === undefined ? DEFAULT_GAMMA : Number(nearby.gamma);
  if (!(gamma >= 0 && gamma <= 2)) throw new NearbyError("nearby.gamma must be between 0 and 2");

  const out = { mode, gamma, lat: null, lng: null, radiusKm: null, city: null, libraryIds: null };
  if (nearby.location) {
    const lat = Number(nearby.location.lat);
    const lng = Number(nearby.location.lng);
    if (!(lat >= 29 && lat <= 34 && lng >= 34 && lng <= 36)) throw new NearbyError("nearby.location must be a point in Israel");
    const r = nearby.radiusKm === undefined ? DEFAULT_RADIUS_KM : Number(nearby.radiusKm);
    if (!(r > 0 && r <= MAX_RADIUS_KM)) throw new NearbyError(`nearby.radiusKm must be 1-${MAX_RADIUS_KM}`);
    Object.assign(out, { lat, lng, radiusKm: r });
  } else if (nearby.city) {
    const city = CITY_ALIASES[String(nearby.city).trim().toLowerCase()] || CITY_ALIASES[String(nearby.city).trim()];
    if (!city) throw new NearbyError(`unknown city: ${nearby.city} (supported: ${CITIES.join(", ")})`);
    out.city = city;
  } else if (Array.isArray(nearby.libraryIds) && nearby.libraryIds.length) {
    const ids = nearby.libraryIds.map(Number);
    if (ids.some((id) => !Number.isInteger(id) || id <= 0) || ids.length > 50) throw new NearbyError("bad libraryIds");
    out.libraryIds = ids;
  } else {
    throw new NearbyError("nearby needs location (+ radiusKm), city, or libraryIds");
  }
  return out;
}

/**
 * Where are these books on the shelf right now?
 * @returns Map(bookId -> { nearest: {...}, branches: [...], branchCount, simulated })
 */
async function getAvailability(pool, bookIds, where) {
  if (!bookIds.length) return new Map();
  const { rows } = await pool.query(
    `WITH libs AS (
       SELECT id, name, city,
              CASE WHEN $2::float8 IS NULL THEN NULL ELSE
                2 * 6371 * asin(sqrt(
                  power(sin(radians(lat - $2::float8) / 2), 2) +
                  cos(radians($2::float8)) * cos(radians(lat)) *
                  power(sin(radians(lng - $3::float8) / 2), 2)))
              END AS km
       FROM libraries
       WHERE is_open
         AND ($2::float8 IS NULL OR lat IS NOT NULL)
         AND ($4::text IS NULL OR city = $4::text)
         AND ($5::int[] IS NULL OR id = ANY($5::int[]))
     )
     SELECT i.book_id, l.id AS library_id, l.name, l.city, l.km,
            i.copies_available, i.copies_total, i.source
     FROM library_inventory i
     JOIN libs l ON l.id = i.library_id
     WHERE i.book_id = ANY($1::int[])
       AND i.copies_available > 0
       AND ($6::float8 IS NULL OR l.km <= $6::float8)
     ORDER BY i.book_id, l.km NULLS LAST, i.copies_available DESC, l.id;`,
    [bookIds, where.lat, where.lng, where.city, where.libraryIds, where.radiusKm]
  );

  const byBook = new Map();
  for (const r of rows) {
    if (!byBook.has(r.book_id)) byBook.set(r.book_id, { branches: [], branchCount: 0, simulated: true });
    const a = byBook.get(r.book_id);
    a.branchCount++;
    if (r.source !== "simulated") a.simulated = false;
    if (a.branches.length < BRANCHES_SHOWN) {
      a.branches.push({
        libraryId: r.library_id,
        name: r.name,
        city: r.city,
        distanceKm: r.km === null ? null : Math.round(r.km * 10) / 10,
        copiesAvailable: r.copies_available,
        copiesTotal: r.copies_total,
      });
    }
  }
  for (const a of byBook.values()) a.nearest = a.branches[0];
  return byBook;
}

/**
 * Applies `nearby` to the hybrid's candidate pool.
 * @param picked  the hybrid's ranked pool (rated books first, new books marked isNew)
 * @param count   how many to return
 * @param slots   places for new books (as in the normal list)
 */
async function applyNearby(pool, picked, nearbyRaw, count, slots) {
  const where = parseNearby(nearbyRaw);
  const avail = await getAvailability(pool, picked.map((p) => p.id), where);
  const withAvail = (p) => ({ ...p, availability: avail.get(p.id) || null });

  const rated = picked.filter((p) => !p.isNew).map(withAvail);
  const fresh = picked.filter((p) => p.isNew).map(withAvail);
  let chosen;

  if (where.mode === "filter") {
    const freshA = fresh.filter((p) => p.availability).slice(0, slots);
    const ratedA = rated.filter((p) => p.availability).slice(0, count - freshA.length);
    // not enough rated books on the shelf -> more new books, if there are
    const extra = fresh.filter((p) => p.availability && !freshA.includes(p)).slice(0, count - freshA.length - ratedA.length);
    chosen = [...ratedA, ...freshA, ...extra];
  } else {
    // boost: position score + gamma * availability
    const boost = (p) => {
      if (!p.availability) return 0;
      const d = p.availability.nearest.distanceKm;
      return where.radiusKm && d !== null ? 1 - 0.5 * Math.min(1, d / where.radiusKm) : 1;
    };
    const rerank = (list) =>
      list
        .map((p, i) => ({ p, s: 1 - i / Math.max(1, list.length) + where.gamma * boost(p) }))
        .sort((a, b) => b.s - a.s)
        .map((x) => x.p);
    const freshB = rerank(fresh).slice(0, Math.min(slots, fresh.length));
    const ratedB = rerank(rated).slice(0, count - freshB.length);
    chosen = [...ratedB, ...freshB];
  }

  return {
    recommendations: chosen,
    nearby: {
      mode: where.mode,
      where: where.city ? { city: where.city } : where.libraryIds ? { libraryIds: where.libraryIds }
        : { location: { lat: where.lat, lng: where.lng }, radiusKm: where.radiusKm },
      available: chosen.filter((p) => p.availability).length,
      requested: count,
      // true while the inventory is simulated (library/simulate-inventory.js)
      simulated: chosen.every((p) => !p.availability || p.availability.simulated),
    },
  };
}

module.exports = { parseNearby, getAvailability, applyNearby, NearbyError, DEFAULT_RADIUS_KM };
