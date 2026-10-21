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

async function fetchToken() {
  const { data } = await authClient.token();
  let token = isJwt(data?.token) ? data.token : null;
  if (!token) {
    const session = await authClient.getSession(); // the JWT may also come with the session
    const t = session.data?.session?.token;
    if (isJwt(t)) token = t;
  }
  cached = token ? { token, exp: expiryOf(token) } : { token: null, exp: 0 };
  return token;
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

export async function api(path, { method = "GET", body, auth = true } = {}) {
  const send = async (force) => {
    const headers = { "Content-Type": "application/json" };
    if (auth) {
      const token = await getToken(force);
      if (!token) throw new Error("Not signed in - please sign in again");
      headers.Authorization = `Bearer ${token}`;
    }
    return fetch(`${API_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  };

  let res = await send(false);
  if (auth && res.status === 401) res = await send(true); // token expired meanwhile: once more, fresh
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `API error ${res.status}`);
  return json;
}
