"use client";

// Makes sure the signed-in user has agreed to the CURRENT Terms of Use and
// Privacy Policy (and is 16+). Shown on every signed-in page, renders nothing.
//  - Just signed up: the choices from the sign-up form (cookie bb_consent,
//    set by app/auth/sign-up/actions.js) are saved now.
//  - Older account, or a policy changed (server/consents.js): go to /consent.
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";

function takeSignupChoices() {
  const m = document.cookie.match(/(?:^|; )bb_consent=([^;]*)/);
  if (!m) return null;
  document.cookie = "bb_consent=; Max-Age=0; path=/";
  try { return JSON.parse(decodeURIComponent(m[1])); } catch { return {}; }
}

export default function ConsentGate() {
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    if (path.startsWith("/consent")) return;
    let cancelled = false;
    (async () => {
      try {
        const c = await api("/api/me/consents");
        if (!c.needed || cancelled) return;
        const choices = takeSignupChoices();
        if (choices) {
          await api("/api/me/consents", {
            method: "POST",
            body: { terms: true, privacy: true, age16: true, research: Boolean(choices.research), source: "signup" },
          });
          return;
        }
        router.replace(`/consent?next=${encodeURIComponent(path + window.location.search)}`);
      } catch {
        // the API is down or the session ended - lib/api.js handles that; never block the page here
      }
    })();
    return () => { cancelled = true; };
  }, [path, router]);
  return null;
}
