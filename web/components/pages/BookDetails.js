"use client";

// One book (rendered by app/books/[id]/page.js): details, your rating, save / finished, where to borrow it, similar books
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Cover from "@/components/Cover";
import Stars from "@/components/Stars";
import BookshelfLoader from "@/components/BookshelfLoader";
import { scrollIntoViewSoon } from "@/lib/scroll";
import { api } from "@/lib/api";

const CITIES = ["Jerusalem", "Tel Aviv-Yafo"];
const SIMILAR_PAGE = 6; // "Show more" adds 6, the server stops at 30
const year = (d) => (d ? String(d).slice(0, 4) : null);

export default function BookDetails({ id }) {
  const [book, setBook] = useState(null);
  const [similar, setSimilar] = useState(null); // null = loading
  const [similarMore, setSimilarMore] = useState(false);
  const [loadingSimilar, setLoadingSimilar] = useState(false);
  const moreRef = useRef(null);
  const [myRating, setMyRating] = useState(0);
  const [city, setCity] = useState("Jerusalem");
  const [avail, setAvail] = useState(null);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    api(`/api/books/${id}`, { auth: false }).then(setBook).catch((e) => setError(e.message));
    api(`/api/books/${id}/similar?count=${SIMILAR_PAGE}`, { auth: false })
      .then((r) => { setSimilar(r.books); setSimilarMore(r.hasMore); })
      .catch(() => setSimilar([]));
    api("/api/me/ratings").then((r) => setMyRating(r.ratings.find((x) => String(x.bookId) === String(id))?.rating || 0)).catch(() => {});
    api("/api/me").then((m) => m.preferredCity && setCity(m.preferredCity)).catch(() => {});
  }, [id]);

  useEffect(() => {
    api(`/api/books/${id}/availability?city=${encodeURIComponent(city)}`, { auth: false })
      .then((r) => setAvail({ city, ...r }))
      .catch(() => setAvail({ city, availability: null }));
  }, [id, city]);

  async function moreSimilar() {
    setLoadingSimilar(true);
    scrollIntoViewSoon(moreRef); // show the loader; the new books appear right there
    try {
      const r = await api(`/api/books/${id}/similar?count=${SIMILAR_PAGE}&offset=${similar.length}`, { auth: false });
      setSimilar((s) => [...s, ...r.books]);
      setSimilarMore(r.hasMore);
    } catch { setSimilarMore(false); }
    finally { setLoadingSimilar(false); }
  }

  async function rate(n) {
    await api("/api/me/ratings", { method: "POST", body: { bookId: Number(id), rating: n } });
    setMyRating(n);
    setMsg("Thanks – your picks will use this rating.");
  }
  async function event(type, text) {
    await api("/api/me/events", { method: "POST", body: { bookId: Number(id), type } });
    setMsg(text);
  }

  if (error) return <AppShell><p role="alert" className="text-rust-dark">Could not load this book: {error}</p></AppShell>;
  if (!book) return <AppShell><BookshelfLoader label="Taking the book off the shelf…" /></AppShell>;

  const authors = (book.authors || []).join(", ");
  const genres = book.main_genres?.length ? book.main_genres : book.categories || [];
  const desc = book.description || "";
  const short = desc.length > 520 && !showAll ? desc.slice(0, 520).replace(/\s+\S*$/, "") + "…" : desc;
  const meta = [authors, year(book.published_date), book.page_count ? `${book.page_count} pages` : null].filter(Boolean).join(" · ");
  const branches = avail?.availability?.branches || [];

  return (
    <AppShell>
      <div className="flex flex-col gap-14">
        <Link href="/for-you" className="text-sm no-underline">← Back to your picks</Link>

        <section className="flex flex-wrap items-start gap-14">
          <div className="flex-[0_1_300px]"><Cover book={book} className="shadow-[0_24px_50px_rgba(43,33,28,0.28)]" /></div>
          <div className="flex flex-[1_1_520px] flex-col gap-5">
            <div className="flex flex-col gap-2">
              <h1 className="m-0 font-serif text-5xl font-semibold leading-none md:text-[58px]">{book.title}</h1>
              <span className="text-lg text-ink-soft">{meta}</span>
              {book.series && (
                <Link href={`/series/${encodeURIComponent(book.series.name)}`} className="self-start text-base italic text-rust">
                  {book.series.number !== null ? `Book ${book.series.number} of ${book.series.total} in ${book.series.name}` : `Part of ${book.series.name}`} →
                </Link>
              )}
            </div>
            {genres.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {genres.map((g) => <span key={g} className="rounded-full border border-line-strong px-3 py-1.5 text-[13px] capitalize">{g.replace(/-/g, " ")}</span>)}
              </div>
            )}
            {desc && (
              <p className="m-0 text-[17px] leading-relaxed text-[#3D3029]">
                {short} {desc.length > 520 && <button type="button" onClick={() => setShowAll(!showAll)} className="cursor-pointer bg-transparent p-0 font-medium text-rust">{showAll ? "Show less" : "Read more"}</button>}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3.5">
              <span className="font-bold">Your rating</span>
              <Stars value={myRating} onChange={rate} size={28} label="Your rating" />
            </div>
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={() => event("saved", "Saved to your shelf.")} className="btn btn-primary">Save for later</button>
              <button type="button" onClick={() => event("finished", "Marked as finished – rate it to improve your picks.")} className="btn btn-outline">I finished it</button>
              <Link href="/chat" className="btn border border-line-strong font-medium text-ink">Ask about this book</Link>
            </div>
            {msg && <p role="status" className="m-0 text-sm text-moss-dark">{msg}</p>}
          </div>
        </section>

        <section aria-labelledby="where" className="card flex flex-col gap-4 rounded-[20px] p-7">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <h2 id="where" className="m-0 font-serif text-[34px] font-semibold">Where to borrow it</h2>
            <label className="flex items-center gap-2 text-sm text-ink-soft">City
              <select value={city} onChange={(e) => setCity(e.target.value)} className="rounded-[10px] border border-line-strong bg-parchment px-3 py-2 text-ink">
                {CITIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
          </div>
          {avail?.city !== city ? <p className="m-0 text-muted">Checking the shelves…</p> : branches.length === 0 ? (
            <p className="m-0 text-muted">Not on the shelf in {city} right now.</p>
          ) : (
            <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
              {branches.map((b) => (
                <div key={b.libraryId} className="flex flex-col gap-1.5 rounded-[14px] border border-line bg-parchment p-4">
                  <span className="font-bold">{b.name}</span>
                  <span className="text-sm font-medium text-moss-dark">{b.copiesAvailable} of {b.copiesTotal} {b.copiesTotal === 1 ? "copy" : "copies"} on the shelf</span>
                </div>
              ))}
            </div>
          )}
          <span className="text-xs text-muted">Demo inventory – not real-time library data.</span>
        </section>

        {similar === null && <BookshelfLoader label="Finding similar books…" />}
        {similar?.length > 0 && (
          <section aria-labelledby="similar" className="flex flex-col gap-4">
            <h2 id="similar" className="m-0 font-serif text-[34px] font-semibold">Similar in spirit</h2>
            <div className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]">
              {similar.map((s) => (
                <Link key={s.id} href={`/books/${s.id}`} className="flex flex-col gap-2 text-ink no-underline hover:text-rust">
                  <Cover book={s} />
                  <span className="text-sm font-bold leading-snug">{s.title}</span>
                  <span className="text-[13px] text-muted">{s.authors?.[0]}</span>
                </Link>
              ))}
            </div>
            <div ref={moreRef}>{loadingSimilar && <BookshelfLoader label="Finding more…" />}</div>
            {similarMore && !loadingSimilar && (
              <div className="flex justify-center">
                <button type="button" onClick={moreSimilar} className="btn btn-outline">Show {SIMILAR_PAGE} more</button>
              </div>
            )}
          </section>
        )}
      </div>
    </AppShell>
  );
}
