"use client";

// "My account" - the first page that talks to the BookBridge API with the
// login token: shows the profile from GET /api/me. If this works, the whole
// chain works: website -> Neon Auth -> token -> API -> database.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { authClient } from "@/lib/auth/client";
import { api, clearToken } from "@/lib/api";
import AppShell from "@/components/AppShell";
import AuthorSection from "@/components/AuthorSection";

export default function AccountPage() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [error, setError] = useState(null);
  const [consents, setConsents] = useState(null);
  const [savingResearch, setSavingResearch] = useState(false);

  useEffect(() => {
    api("/api/me").then(setMe).catch((e) => setError(e.message));
    api("/api/me/consents").then(setConsents).catch(() => {});
  }, []);

  // optional research consent - can be given or withdrawn at any time (saved as a new row)
  async function setResearch(granted) {
    setSavingResearch(true);
    try {
      const r = await api("/api/me/consents", { method: "POST", body: { research: granted, source: "account" } });
      setConsents((c) => ({ ...c, current: r.current }));
    } finally {
      setSavingResearch(false);
    }
  }
  const agreedOn = consents?.current?.terms?.at ? new Date(consents.current.terms.at).toLocaleDateString("en-GB") : null;

  async function signOut() {
    await authClient.signOut();
    clearToken();
    router.push("/");
    router.refresh();
  }

  return (
    <AppShell width="max-w-[720px]">
      <div className="flex items-center justify-between">
        <h1 className="m-0 font-serif text-5xl font-semibold">My account</h1>
        <button onClick={signOut} className="btn btn-outline px-4 py-2 text-sm">Sign out</button>
      </div>
      {error && <p className="mt-6 text-rust-dark">Could not load your profile: {error}</p>}
      {!me && !error && <p className="mt-6 text-muted">Loading...</p>}
      {me && (
        <dl className="card mt-6 grid grid-cols-[10rem_1fr] gap-y-3 p-6 text-[15px]">
          <dt className="text-muted">Name</dt><dd>{me.name}</dd>
          <dt className="text-muted">Email</dt><dd>{me.email}</dd>
          <dt className="text-muted">Account type</dt><dd>{me.userType}</dd>
          <dt className="text-muted">Questionnaire</dt><dd>{me.onboarded ? "Done" : "Not yet"}</dd>
          <dt className="text-muted">Genres</dt><dd>{me.genres.join(", ") || "-"}</dd>
          <dt className="text-muted">Books rated</dt><dd>{me.ratingsCount}</dd>
        </dl>
      )}
      {me && me.userType !== "librarian" && <AuthorSection />}
      {consents && (
        <section aria-labelledby="privacy" className="card mt-6 flex flex-col gap-4 p-6 text-[15px]">
          <h2 id="privacy" className="m-0 font-serif text-3xl font-semibold">Privacy</h2>
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--color-rust)]" disabled={savingResearch}
              checked={Boolean(consents.current?.research?.granted)} onChange={(e) => setResearch(e.target.checked)} />
            <span>Allow my ratings to be used, anonymized, in academic research on book recommendations. <span className="text-muted">Optional – the app works the same either way.</span></span>
          </label>
          <p className="m-0 text-ink-soft">
            {agreedOn ? `You agreed to the Terms of Use and the Privacy Policy on ${agreedOn}. ` : ""}
            Read them again: <Link href="/terms">Terms of Use</Link> · <Link href="/privacy">Privacy Policy</Link>.
          </p>
          <p className="m-0 text-ink-soft">To see, correct or delete your data, or delete your account, write to <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.</p>
        </section>
      )}
    </AppShell>
  );
}
