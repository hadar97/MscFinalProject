"use client";

// The genres chosen on step 1, kept for step 2 (in this browser tab only)
const KEY = "bookbridge.onboarding.genres";

export function saveGenres(genres) {
  try { sessionStorage.setItem(KEY, JSON.stringify(genres)); } catch { /* private mode */ }
}
export function loadGenres() {
  try { return JSON.parse(sessionStorage.getItem(KEY) || "[]"); } catch { return []; }
}
