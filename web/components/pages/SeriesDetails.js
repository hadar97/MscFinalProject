"use client";

// One series (app/series/[name]/page.js): all its books in reading order,
// which ones you rated, and the next one to read. Box sets at the end.
import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Cover from "@/components/Cover";
import { api } from "@/lib/api";

const num = (n) => (Number.isInteger(n) ? n : n.toFixed(1));
const year = (d) => (d ? String(d).slice(0, 4) : null);

export default function SeriesDetails({ name }) {
  const [series, setSeries] = useState(null);
  const [mine, setMine] = useState(new Map());
  const [error, setError] = useState(null);

  useEffect(() => {
    api(`/api/series?name=${encodeURIComponent(name)}`, { auth: false }).then(setSeries).catch((e) => setError(e.message));
    api("/api/me/ratings").then((r) => setMine(new Map(r.ratings.map((x) => [Number(x.bookId), x.rating])))).catch(() => {});
  }, [name]);

  if (error) return <AppShell><p role="alert" className="text-rust-dark">Could not load this series: {error}</p></AppShell>;
  if (!series) return <AppShell><p className="text-muted">Loading…</p></AppShell>;

  const rated = series.books.filter((b) => mine.has(b.id)).length;
  const nextId = series.books.find((b) => !mine.has(b.id))?.id;

  return (
    <AppShell>
      <div className="flex flex-col gap-12">
        <Link href="/for-you" className="text-sm no-underline">← Back to your picks</Link>

        <header className="flex flex-col gap-3">
          <span className="eyebrow">Series</span>
          <h1 className="m-0 font-serif text-5xl font-semibold leading-none md:text-[58px]">{series.name}</h1>
          <span className="text-lg text-ink-soft">
            {[series.author, `${series.books.length} ${series.books.length === 1 ? "book" : "books"}`, rated ? `you rated ${rated}` : null].filter(Boolean).join(" · ")}
          </span>
          {rated > 0 && (
            <div className="mt-1 h-1.5 w-full max-w-[360px] overflow-hidden rounded-full bg-sand" role="progressbar" aria-label="Books you rated in this series" aria-valuenow={rated} aria-valuemin={0} aria-valuemax={series.books.length}>
              <div className="h-full rounded-full bg-moss" style={{ width: `${(rated / series.books.length) * 100}%` }} />
            </div>
          )}
        </header>

        <ol className="m-0 grid list-none gap-x-5 gap-y-8 p-0 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]">
          {series.books.map((b) => (
            <li key={b.id}>
              <Link href={`/books/${b.id}`} className="flex flex-col gap-2 text-ink no-underline hover:text-rust">
                <span className="text-xs font-bold uppercase tracking-wider text-muted">Book {num(b.number)}</span>
                <div className="relative">
                  <Cover book={b} className={mine.has(b.id) ? "opacity-80" : ""} />
                  {b.id === nextId && <span className="absolute right-2 top-2 rounded-full bg-parchment px-2 py-1 text-[11px] font-bold text-rust">UP NEXT</span>}
                  {mine.has(b.id) && (
                    <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-parchment px-2 py-1 text-[11px] font-bold text-moss-dark">
                      <span aria-hidden="true">★</span> {mine.get(b.id)}<span className="sr-only"> stars, you rated it</span>
                    </span>
                  )}
                </div>
                <span className="text-sm font-bold leading-snug">{b.title}</span>
                {year(b.published_date) && <span className="text-[13px] text-muted">{year(b.published_date)}</span>}
              </Link>
            </li>
          ))}
        </ol>

        {series.collections.length > 0 && (
          <section aria-labelledby="collections" className="flex flex-col gap-4">
            <h2 id="collections" className="m-0 font-serif text-[30px] font-semibold">Box sets &amp; collections</h2>
            <div className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(130px,1fr))]">
              {series.collections.map((b) => (
                <Link key={b.id} href={`/books/${b.id}`} className="flex flex-col gap-2 text-ink no-underline hover:text-rust">
                  <Cover book={b} small />
                  <span className="text-[13px] font-bold leading-snug">{b.title}</span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
