// Pages that need a signed-in user. Others are redirected to the sign-in page.
// (Next.js 16 calls this file proxy.js - it used to be middleware.js.)
//
// The sign-in link gets ?next=<the page they asked for>, so after signing in the
// user lands back there (for example the admin link from the email:
// /admin/author-requests?id=7), not on /for-you.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";

const LOGIN = "/auth/sign-in";
const neon = auth.middleware({ loginUrl: LOGIN });

export default async function proxy(request) {
  const res = await neon(request);
  const location = res.headers.get("location");
  if (!location) return res;
  const to = new URL(location, request.url);
  if (to.origin !== request.nextUrl.origin || to.pathname !== LOGIN) return res; // not a "please sign in" redirect

  const login = new URL(LOGIN, request.url);
  login.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  const out = NextResponse.redirect(login, res.status);
  for (const cookie of res.headers.getSetCookie()) out.headers.append("Set-Cookie", cookie);
  return out;
}

export const config = {
  matcher: [
    "/account/:path*",
    "/for-you/:path*",
    "/onboarding/:path*",
    "/books/:path*",
    "/series/:path*",
    "/authors/:path*",
    "/rate-more/:path*",
    "/consent/:path*",
    "/admin/:path*",
    "/search/:path*",
    "/shelf/:path*",
    "/chat/:path*",
    "/insights/:path*",
  ],
};
