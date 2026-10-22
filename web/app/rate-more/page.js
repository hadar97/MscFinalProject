"use client";

// "Rate more" (from For you): ~20 books from YOUR genres that you have not
// rated yet - the same choice as the questionnaire, without the books you
// already rated. Ratings are saved to your account; "Show other books" saves
// what you rated and brings 20 new ones.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import Cover from "@/components/Cover";
import Stars from "@/components/Stars";
import { api } from "@/lib/api";

export default function RateMorePage() {
  const router = useRouter();
  const [genres, setGenres] = useState([]);
  const [labels, setLabels] = useState({});
  const [books, setBooks] = useState(null);
  const [stars, setStars] = useState({}); // bookId -> 1..5 (missing / 0 = haven't read)
  const [savedCount, setSavedCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const shown = useRef([]); // books shown before ("haven't read") - not shown again

  const load = useCallback(async () => {
    setBooks(null);
    try {
      const r = await api("/api/me/rate-more", { method: "POST", body: { skip: shown.current } });
      shown.current.push(...r.books.map((b) => b.id));
      setGenres(r.genres);
      setBooks(r.books);
      setStars({});
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load(); // eslint-disable-line react-hooks/set-state-in-effect
    api("/api/onboarding/questionnaire", { auth: false }).then((q) => {
      const opts = q.steps.find((s) => s.id === "genres").options;
      setLabels(Object.fromEntries(opts.map((o) => [o.value, o.label])));
    }).catch(() => {});
  }, [load]);

  const groups = useMemo(() => {
    if (!books) return [];
    return genres.map((g) => ({ key: g, books: books.filter((b) => b.genre === g) })).filter((x) => x.books.length);
  }, [books, genres]);

  const ratedNow = Object.entries(stars).filter(([, n]) => n > 0);

  async function save() {
    if (!ratedNow.length) return 0;
    await api("/api/me/ratings", { method: "POST", body: { ratings: ratedNow.map(([id, n]) => ({ bookId: Number(id), rating: n })) } });
    setSavedCount((c) => c + ratedNow.length);
    return ratedNow.length;
  }

  async function run(fn) {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const total = savedCount + ratedNow.length;

  return (
    <AppShell>
      <div className="flex flex-col gap-9 pb-28">
        <Link href="/for-you" className="text-sm no-underline">← Back to your picks</Link>
        <header className="flex flex-col gap-2.5">
          <span className="eyebrow">Rate more</span>
          <h1 className="m-0 font-serif text-5xl font-semibold md:text-[52px]">Books you may have read</h1>
          <p className="m-0 max-w-[680px] text-lg text-ink-soft">
            Well-known books from your genres that you haven&apos;t rated yet. Rate the ones you know – leave the rest.{" "}
            <Link href="/onboarding/genres">Change your genres</Link>
          </p>
        </header>

        {error && <p role="alert" className="text-rust-dark">{error}</p>}
        {!books && !error && <p className="text-muted">Choosing books for you…</p>}
        {books && books.length === 0 && <p className="text-muted">You have rated every book we would ask about in your genres. <Link href="/onboarding/genres">Try other genres</Link>.</p>}

        {groups.map((g) => (
          <section key={g.key} className="flex flex-col gap-4">
            <h2 className="m-0 border-b border-line pb-2 font-serif text-3xl font-semibold">{labels[g.key] || g.key}</h2>
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
              {g.books.map((b) => (
                <article key={b.id} className="card flex gap-3.5 p-3.5">
                  <Cover book={b} small className="w-[72px] flex-none" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <h3 className="m-0 text-[15px] font-bold leading-snug">{b.title}</h3>
                    <span className="text-[13px] text-muted">{b.authors?.[0]}</span>
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
      </div>

      <div className="fixed inset-x-0 bottom-0 flex flex-wrap items-center justify-between gap-4 border-t border-line bg-cream px-6 py-4 md:px-12">
        <span className="text-ink-soft" aria-live="polite">{total} rated{savedCount ? ` · ${savedCount} saved` : ""}</span>
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={busy || !books} onClick={() => run(async () => { await save(); await load(); })} className="btn btn-outline">
            Show other books
          </button>
          <button type="button" disabled={busy || !books} onClick={() => run(async () => { await save(); router.push("/for-you"); })} className="btn btn-primary">
            {busy ? "Saving…" : "Update my picks"}
          </button>
        </div>
      </div>
    </AppShell>
  );
}
