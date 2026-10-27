"use client";

// /consent - shown by components/ConsentGate.js when the user has not agreed to
// the current Terms of Use / Privacy Policy yet (an older account, or a policy changed).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { safeNext } from "@/lib/next-path";
import Logo from "@/components/Logo";
import ConsentChecks from "@/components/ConsentChecks";
import { api } from "@/lib/api";
import { SITE } from "@/lib/site";

// only a path inside this site ("/for-you"), never another website

export default function ConsentPage() {
  const router = useRouter();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // a returning user keeps their research choice (the box starts as they left it)
  const [research, setResearch] = useState(null);
  useEffect(() => {
    api("/api/me/consents").then((c) => setResearch(Boolean(c.current?.research?.granted))).catch(() => setResearch(false));
  }, []);

  async function submit(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api("/api/me/consents", {
        method: "POST",
        body: { terms: form.get("terms") === "on", privacy: form.get("terms") === "on", age16: form.get("age16") === "on", research: form.get("research") === "on", source: "consent_page" },
      });
      router.replace(safeNext(new URLSearchParams(window.location.search).get("next")));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full">
      <header className="border-b border-line px-6 py-4 md:px-12"><Logo href="/" /></header>
      <main className="mx-auto flex max-w-[560px] flex-col gap-6 px-6 py-14">
        <div className="flex flex-col gap-2">
          <span className="eyebrow">Before you continue</span>
          <h1 className="m-0 font-serif text-[44px] font-semibold leading-tight">Our terms, in plain words</h1>
          <p className="m-0 text-ink-soft">
            {SITE.name} is a student project. We use your ratings only to recommend books to you – never sold, no ads.
            Please read and confirm the documents below (updated {SITE.policyDate}).
          </p>
        </div>
        <form onSubmit={submit} className="card flex flex-col gap-5 p-6">
          {research === null ? <p className="m-0 text-muted">Loading…</p> : <ConsentChecks defaultResearch={research} />}
          {error && <p role="alert" className="m-0 text-sm text-rust-dark">{error}</p>}
          <button disabled={busy || research === null} className="btn btn-primary">{busy ? "Saving…" : "Continue"}</button>
        </form>
      </main>
    </div>
  );
}
