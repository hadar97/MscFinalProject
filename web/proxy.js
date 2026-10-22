// Pages that need a signed-in user. Others are redirected to the sign-in page.
// (Next.js 16 calls this file proxy.js - it used to be middleware.js.)
import { auth } from "@/lib/auth/server";

export default auth.middleware({
  loginUrl: "/auth/sign-in",
});

export const config = {
  matcher: [
    "/account/:path*",
    "/for-you/:path*",
    "/onboarding/:path*",
    "/books/:path*",
    "/series/:path*",
    "/rate-more/:path*",
    "/search/:path*",
    "/shelf/:path*",
    "/chat/:path*",
    "/insights/:path*",
  ],
};
