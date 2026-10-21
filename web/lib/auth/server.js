// Neon Auth on the server side of the website (server actions, route handler, proxy).
// Docs: https://neon.com/docs/auth/quick-start/nextjs
import { createNeonAuth } from "@neondatabase/auth/next/server";

export const auth = createNeonAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL,
  cookies: {
    secret: process.env.NEON_AUTH_COOKIE_SECRET,
  },
});
