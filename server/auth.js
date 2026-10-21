/**
 * Login check for the API - Neon Auth (Managed Better Auth).
 *
 * The website signs the user in with Neon Auth (email + password). It then
 * sends a short-lived token (JWT, 15 minutes) with every request:
 *     Authorization: Bearer <token>
 * Here we check the token's signature against Neon Auth's public keys
 * (JWKS) - no password ever reaches this server. The token's `sub` is the
 * user's id in neon_auth."user"; the matching app profile (table users) is
 * created on the first request.
 *
 * Needs in .env:  NEON_AUTH_BASE_URL=<the Auth URL from the Neon Console> (or NEON_AUTH_URL)
 * Package:        npm install jose
 *
 * Based on Neon's docs: https://neon.com/docs/auth/guides/plugins/jwt
 */

const AUTH_URL = (process.env.NEON_AUTH_URL || process.env.NEON_AUTH_BASE_URL || "").replace(/\/$/, "");

let verifierPromise = null;
function getVerifier() {
  if (!verifierPromise) {
    // jose is an ES module - loaded once, with Neon Auth's public keys (cached by jose)
    verifierPromise = import("jose").then((jose) => ({
      jose,
      jwks: jose.createRemoteJWKSet(new URL(`${AUTH_URL}/.well-known/jwks.json`)),
      issuer: new URL(AUTH_URL).origin,
    }));
  }
  return verifierPromise;
}

/** Express middleware: 401 unless a valid Neon Auth token; sets req.user */
function requireUser(db) {
  return async (req, res, next) => {
    try {
      if (!AUTH_URL) return res.status(500).json({ error: "server is missing NEON_AUTH_BASE_URL in .env" });
      const m = (req.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
      if (!m) return res.status(401).json({ error: "login required" });

      const { jose, jwks, issuer } = await getVerifier();
      let payload;
      try {
        ({ payload } = await jose.jwtVerify(m[1], jwks, { issuer }));
      } catch {
        return res.status(401).json({ error: "invalid or expired token - sign in again" });
      }
      if (!payload.sub) return res.status(401).json({ error: "token has no user" });

      // The app profile - created on the first request of a new account
      let { rows } = await db.query(
        `SELECT id, user_type, library_id, preferred_city, onboarded_at FROM users WHERE auth_user_id = $1;`,
        [payload.sub]
      );
      if (!rows[0]) {
        ({ rows } = await db.query(
          `INSERT INTO users (auth_user_id) VALUES ($1)
           ON CONFLICT (auth_user_id) DO UPDATE SET auth_user_id = EXCLUDED.auth_user_id
           RETURNING id, user_type, library_id, preferred_city, onboarded_at;`,
          [payload.sub]
        ));
      }
      req.user = { ...rows[0], authUserId: payload.sub, email: payload.email || null };
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requireUser, AUTH_URL };
