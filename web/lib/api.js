"use client";

// Calls to the BookBridge API (Express, server/server.js) from the browser.
// Sends the Neon Auth login token (a JWT, valid 15 minutes), so the API knows
// who the user is (/api/me...).
//
// The token is kept in memory and reused until a minute before it expires,
// and requests that start together share ONE token request. (Asking Neon
// Auth for a new token on every call, several at once, could return
// something that is not a JWT - the API then answered "invalid or expired
// token".) If the API still answers 401, we get a fresh token and retry once.
//
// Getting a token can fail for a moment (seen right after opening the site):
// we try 3 times, a little apart. Only if Neon Auth itself then says there is
// NO session do we sign out and go to the sign-in page (which says why). If
// the session is fine but no token came, we show an error and keep the user
// signed in - a passing hiccup must never log anyone out.
import { authClient } from "@/lib/auth/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

let cached = { token: null, exp: 0 };
let pending = null;

const isJwt = (t) => typeof t === "string" && t.split(".").length === 3;

function expiryOf(jwt) {
  try {
    const payload = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return Number(payload.exp) || 0;
  } catch {
    return 0;
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Three ways to get the token, tried in order (the first two are Neon Auth's
// client; the third asks the site's own auth route directly - the address you
// can open in the browser, /api/auth/token). Whichever gives a JWT wins.
async function tokenFromClient() {
  const { data, error } = await authClient.token();
  if (error) console.warn("[auth] authClient.token():", error.message || error);
  return data?.token;
}
async function tokenFromSession() {
  const s = await authClient.getSession();
  return s?.data?.session?.token;
}
async function tokenFromRoute() {
  const res = await fetch("/api/auth/token", { credentials: "include", cache: "no-store" });
  if (!res.ok) { console.warn(`[auth] /api/auth/token answered ${res.status}`); return null; }
  return (await res.json().catch(() => null))?.token;
}

async function fetchToken() {
  let token = null;
  for (let attempt = 1; attempt <= 3 && !token; attempt++) {
    for (const [name, get] of [["client", tokenFromClient], ["session", tokenFromSession], ["route", tokenFromRoute]]) {
      try {
        const t = await get();
        if (isJwt(t)) { token = t; if (name !== "client") console.info(`[auth] token from ${name}`); break; }
      } catch (err) {
        console.warn(`[auth] ${name} (attempt ${attempt}):`, err?.message || err);
      }
    }
    if (!token && attempt < 3) await wait(300 * attempt);
  }
  cached = token ? { token, exp: expiryOf(token) } : { token: null, exp: 0 };
  return token;
}

// Is there really a signed-in session? (asks Neon Auth, not the browser's cached copy)
async function hasSession() {
  try {
    const s = await authClient.getSession({ query: { disableCookieCache: true } });
    return Boolean(s?.data?.user);
  } catch {
    return true; // cannot tell (network) - do not log the user out
  }
}

// detail: what went wrong, shown in the browser console (F12) to find the cause
async function noTokenError(detail) {
  if (!(await hasSession())) return sessionEnded();
  console.warn("[auth] signed in, but no usable token:", detail);
  return new Error("Could not confirm your login with the server just now – please refresh the page.");
}

async function getToken(force = false) {
  const now = Date.now() / 1000;
  if (!force && cached.token && cached.exp - 60 > now) return cached.token;
  if (!pending) pending = fetchToken().finally(() => { pending = null; });
  return pending;
}

export function clearToken() {
  cached = { token: null, exp: 0 };
}

let leaving = false;
function sessionEnded() {
  clearToken();
  if (typeof window !== "undefined" && !leaving && !window.location.pathname.startsWith("/auth")) {
    leaving = true;
    try { sessionStorage.setItem("bb-session-ended", "1"); } catch {}
    // a full page load on purpose: after signing out, nothing of the old session stays in memory
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    authClient.signOut().catch(() => {}).finally(() => window.location.assign(`/auth/sign-in?next=${next}`));
  }
  return new Error("Your session ended – taking you to sign in…");
}

export async function api(path, { method = "GET", body, auth = true } = {}) {
  const send = async (force) => {
    const headers = { "Content-Type": "application/json" };
    if (auth) {
      const token = await getToken(force);
      if (!token) throw await noTokenError("Neon Auth gave no token (see the [auth] lines above)");
      headers.Authorization = `Bearer ${token}`;
    }
    return fetch(`${API_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  };

  let res = await send(false);
  if (auth && res.status === 401) res = await send(true); // token expired meanwhile: once more, fresh
  if (auth && res.status === 401) {
    const info = await res.json().catch(() => null);
    throw await noTokenError(`the API refused the token (reason: ${info?.reason || "unknown"}) - see the server window`);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `API error ${res.status}`);
  return json;
}
