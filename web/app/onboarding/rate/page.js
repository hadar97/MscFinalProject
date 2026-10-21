"use client";

// Questionnaire, step 2: rate ~20 books from the chosen genres, then save and get picks
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import OnboardingHeader from "@/components/OnboardingHeader";
import Cover from "@/components/Cover";
import Stars from "@/components/Stars";
import { api } from "@/lib/api";
import { loadGenres } from "@/lib/onboarding-state";

export default function RatePage() {
  const router = useRouter();
  const [genres] = useState(() => loadGenres());
  const [labels, setLabels] = useState({});
  const [books, setBooks] = useState(null);
  const [stars, setStars] = useState({}); // bookId -> 1..5 (missing = haven't read)
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const g = genres;
    if (!g.length) { router.replace("/onboarding/genres"); return; }
    api("/api/onboarding/questionnaire", { auth: false }).then((q) => {
      const opts = q.steps.find((s) => s.id === "genres").options;
      setLabels(Object.fromEntries(opts.map((o) => [o.value, o.label])));
    }).catch(() => {});
    api("/api/onboarding/books", { method: "POST", body: { genres: g }, auth: false })
      .then((r) => setBooks(r.books))
      .catch((e) => setError(e.message));
  }, [router, genres]);

  const groups = useMemo(() => {
    if (!books) return [];
    return genres.map((g) => ({ key: g, books: books.filter((b) => b.genre === g) })).filter((x) => x.books.length);
  }, [books, genres]);

  const rated = Object.values(stars).filter(Boolean).length;

  async function finish() {
    setSaving(true);
    setError(null);
    try {
      await api("/api/me/onboarding", {
        method: "POST",
        body: { genres, answers: books.map((b) => ({ bookId: b.id, stars: stars[b.id] || null })) },
      });
      router.push("/for-you");
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  }

  return (
    <div className="min-h-full">
      <OnboardingHeader step={2} />
      <main className="mx-auto flex max-w-[1120px] flex-col gap-9 px-6 pb-32 pt-6 md:px-8">
        <div className="flex flex-col items-center gap-2.5 text-center">
          <h1 className="m-0 font-serif text-5xl font-semibold md:text-[52px]">Rate the books you have read</h1>
          <p className="m-0 max-w-[640px] text-lg text-ink-soft">Well-known books from your genres. Leave the rest as “Haven&apos;t read” – the more you rate, the sharper your picks.</p>
        </div>
        {error && <p role="alert" className="text-rust-dark">{error}</p>}
        {!books && !error && <p className="text-center text-muted">Choosing books for you…</p>}
        {groups.map((g) => (
          <section key={g.key} className="flex flex-col gap-4">
            <h2 className="m-0 border-b border-line pb-2 font-serif text-3xl font-semibold">{labels[g.key] || g.key}</h2>
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
              {g.books.map((b) => (
                <article key={b.id} className="card flex gap-3.5 p-3.5">
                  <Cover book={b} small className="w-[72px] flex-none" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <h3 className="m-0 text-[15px] font-bold leading-snug">{b.title}</h3>
                    <span className="text-[13px] text-muted">{(b.authors || []).join(", ")}</span>
                    <div className="mt-auto">
                      <Stars value={stars[b.id] || 0} onChange={(n) => setStars((s) => ({ ...s, [b.id]: n }))} label={`Rate ${b.title}`} />
                    </div>
                    <button type="button" aria-pressed={!stars[b.id]} onClick={() => setStars((s) => ({ ...s, [b.id]: 0 }))}
                      className={`cursor-pointer self-start rounded-full border px-2.5 py-1 text-xs text-ink-soft ${stars[b.id] ? "border-line-strong bg-cream" : "border-[#B9A88F] bg-sand"}`}>
                      Haven&apos;t read
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </main>
      <div className="fixed inset-x-0 bottom-0 flex flex-wrap items-center justify-between gap-4 border-t border-line bg-cream px-6 py-4 md:px-12">
        <span className="text-ink-soft" aria-live="polite">{rated} rated{books ? ` · ${books.length} books` : ""}</span>
        <div className="flex flex-wrap gap-3">
          <Link href="/onboarding/genres" className="btn btn-outline">Back</Link>
          <button type="button" onClick={finish} disabled={!books || saving} className="btn btn-primary">{saving ? "Picking your books…" : "Show my picks"}</button>
        </div>
      </div>
    </div>
  );
}
