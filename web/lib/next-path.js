// Where to go after signing in (or agreeing to the terms): the page the user asked for.
// Only a path inside this site is accepted - never another website ("//evil.com", "/\evil.com", "https://...").
export function safeNext(n, fallback = "/for-you") {
  if (typeof n !== "string" || !n.startsWith("/") || n.startsWith("//") || n.startsWith("/\\")) return fallback;
  if (n.startsWith("/auth")) return fallback; // never back to the sign-in page itself
  return n;
}
