"use client";

// Author insights (the "My books" tab of /insights): how readers respond to the
// author's books. Data: GET /api/me/author/insights and .../audience
// (server/author-insights.js); every number is checked against the raw data by
// server/test-author-insights.js. Counts only - the author never sees who.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Cover from "@/components/Cover";
import BookshelfLoader from "@/components/BookshelfLoader";
import { Tile, Section, HBars } from "./InsightsView";
import { api } from "@/lib/api";

const MONTH = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
const fmt = (n) => (n ?? 0).toLocaleString("en-US");
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const avgOf = (dist) => { const n = dist.reduce((s, x) => s + x, 0); return n ? Math.round((dist.reduce((s, x, i) => s + x * (i + 1), 0) / n) * 100) / 100 : null; };
const addArrays = (a, b) => a.map((x, i) => x + b[i]);

// "All books" = the books added together (averages from the star counts, so they stay exact)
function combine(books, months) {
  const sum = (k) => books.reduce((s, b) => s + b[k], 0);
  const distribution = books.reduce((d, b) => addArrays(d, b.distribution), [0, 0, 0, 0, 0]);
  const withGr = books.filter((b) => b.goodreads);
  const grDist = withGr.reduce((d, b) => addArrays(d, b.goodreads.distribution), [0, 0, 0, 0, 0]);
  return {
    id: "all", title: "All my books",
    ratings: sum("ratings"), loved: sum("loved"), tbrNow: sum("tbrNow"), addedToTbr: sum("addedToTbr"), finished: sum("finished"),
    notForMe: sum("notForMe"), reviews: sum("reviews"), posts: sum("posts"), replies: sum("replies"),
    distribution, avgRating: avgOf(distribution),
    goodreads: withGr.length ? { ratings: grDist.reduce((s, x) => s + x, 0), distribution: grDist, avgRating: avgOf(grDist), books: withGr.length } : null,
    inDataset: withGr.length > 0,
    trend: months.map((m, i) => ({ month: m, ...["rated", "addedToTbr", "finished"].reduce((o, k) => ({ ...o, [k]: books.reduce((s, b) => s + b.trend[i][k], 0) }), {}) })),
  };
}

function TrendChart({ data }) {
  const max = Math.max(1, ...data.flatMap((d) => [d.rated, d.addedToTbr]));
  if (data.every((d) => !d.rated && !d.addedToTbr && !d.finished)) {
    return <p className="m-0 text-muted">No reader activity in the last 12 months yet. As readers rate your book or add it to their TBR, it shows up here.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-5 text-[13px] text-ink-soft" aria-hidden="true">
        <span className="flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: "var(--chart-1)" }} />Added to TBR</span>
        <span className="flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: "var(--chart-2)" }} />Rated</span>
      </div>
      <div className="relative flex h-[200px] items-end gap-1.5 border-b border-[var(--chart-grid)] sm:gap-3" aria-hidden="true">
        {data.map((d, i) => (
          <div key={d.month} tabIndex={0} className="bar-hit relative flex h-full min-w-0 flex-1 items-end justify-center gap-[2px] outline-none">
            {[["addedToTbr", "var(--chart-1)"], ["rated", "var(--chart-2)"]].map(([k, c]) => (
              <div key={k} className="w-full max-w-[18px] rounded-t-[4px]" style={{ height: `${(d[k] / max) * 100}%`, minHeight: d[k] ? 3 : 0, background: c }} />
            ))}
            <div className={`bar-tip absolute -top-14 z-10 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-xs text-parchment ${i < 3 ? "left-0" : i > data.length - 4 ? "right-0" : "left-1/2 -translate-x-1/2"}`}>
              {MONTH(d.month)}: {d.addedToTbr} added to TBR · {d.rated} rated · {d.finished} finished
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 sm:gap-3" aria-hidden="true">
        {data.map((d) => (
          <span key={d.month} className="min-w-0 flex-1 text-center text-[11px] text-muted">
            <span className="hidden sm:inline">{MONTH(d.month)}</span><span className="sm:hidden">{MONTH(d.month).charAt(0)}</span>
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>Readers per month</caption>
        <thead><tr><th>Month</th><th>Added to TBR</th><th>Rated</th><th>Finished</th></tr></thead>
        <tbody>{data.map((d) => <tr key={d.month}><td>{d.month}</td><td>{d.addedToTbr}</td><td>{d.rated}</td><td>{d.finished}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

// Star by star, as a share of each group's ratings: BookBridge readers vs the Goodreads readers
function CompareStars({ bb, gr }) {
  const bbN = bb.reduce((s, x) => s + x, 0);
  const grN = gr ? gr.reduce((s, x) => s + x, 0) : 0;
  const rows = [5, 4, 3, 2, 1].map((s) => ({ stars: s, bb: pct(bb[s - 1], bbN), gr: gr ? pct(gr[s - 1], grN) : null }));
  const max = Math.max(1, ...rows.flatMap((r) => [r.bb, r.gr ?? 0]));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-5 text-[13px] text-ink-soft" aria-hidden="true">
        <span className="flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: "var(--chart-1)" }} />BookBridge readers</span>
        {gr && <span className="flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: "var(--chart-2)" }} />Goodreads readers</span>}
      </div>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {rows.map((r) => (
          <li key={r.stars} className="grid grid-cols-[4.5rem_1fr] items-center gap-3">
            <span className="text-[15px]" aria-label={`${r.stars} stars`}>{"★".repeat(r.stars)}</span>
            <span className="flex flex-col gap-1">
              {[["bb", "var(--chart-1)", "BookBridge"], ...(gr ? [["gr", "var(--chart-2)", "Goodreads"]] : [])].map(([k, c, name]) => (
                <span key={k} className="flex items-center gap-2">
                  <span className="h-2.5 rounded-r-[4px]" style={{ width: `${Math.max(1, (r[k] / max) * 100)}%`, background: c }} />
                  <span className="text-xs text-ink-soft"><span className="sr-only">{name}: </span>{r[k]}%</span>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Audience({ bookId, preview }) {
  const [data, setData] = useState(preview?.[bookId] || null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (preview) return;
    let alive = true; // (a new book remounts this part - see key= below - so it starts empty)
    api(`/api/me/author/insights/audience?book=${bookId}`).then((d) => alive && setData(d)).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [bookId, preview]);

  if (error) return <p role="alert" className="m-0 text-rust-dark">Could not load this part: {error}</p>;
  if (!data) return <p className="m-0 text-muted">Looking at your readers…</p>;
  const { readers, genres, alsoLoved, minReaders } = data;
  const total = readers.app + readers.dataset;
  const basis = [readers.app ? `${fmt(readers.app)} on BookBridge` : null, readers.dataset ? `${readers.sampled ? "a sample of " : ""}${fmt(readers.dataset)} Goodreads readers` : null].filter(Boolean).join(" and ");

  return (
    <div className="grid gap-7 lg:grid-cols-2">
      <Section id="readers-genres" title="Who your readers are"
        intro={genres ? `Genres picked at sign-up by the ${readers.app} BookBridge readers who rated it 4–5 stars.` : null}>
        {genres?.length
          ? <HBars rows={genres} max={100} label={(g) => g.label} value={(g) => g.share} tag={() => null} />
          : <p className="m-0 text-muted">We show this once at least {minReaders} BookBridge readers have rated it 4–5 stars, so no reader can be recognised.</p>}
        {genres?.length > 0 && <p className="m-0 text-[13px] text-muted">Numbers are the % of those readers who picked each genre.</p>}
      </Section>

      <Section id="also-loved" title="Readers who loved it also loved"
        intro={total >= minReaders ? `Based on the readers who rated it 4–5 stars (${basis}). Sorted by how much MORE than readers in general they love each book.` : null}>
        {alsoLoved.length === 0
          ? <p className="m-0 text-muted">{total >= minReaders ? "No book stands out yet – what they love, readers in general love just as much." : `We show this once at least ${minReaders} readers have rated it 4–5 stars.`}</p>
          : (
            <ul className="m-0 grid list-none gap-4 p-0 [grid-template-columns:repeat(auto-fill,minmax(96px,1fr))]">
              {alsoLoved.map((b) => (
                <li key={b.id}>
                  <Link href={`/books/${b.id}`} className="flex flex-col gap-1.5 text-ink no-underline hover:text-rust">
                    <Cover book={b} small />
                    <span className="text-[13px] font-bold leading-snug">{b.title}</span>
                    <span className="text-xs text-ink-soft">{b.share}% of your readers{b.generalShare !== null ? ` · ${b.generalShare}% of all` : ""}</span>
                    {b.lift >= 1.2 && <span className="self-start rounded-full bg-moss-soft px-2 py-0.5 text-[11px] font-bold text-moss-dark">{b.lift.toFixed(1)}× more</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
      </Section>
    </div>
  );
}

export default function AuthorInsightsView({ preview = null }) {
  const [data, setData] = useState(preview?.insights || null); // preview: sample data for a design check, never in the app
  const [error, setError] = useState(null);
  const [pick, setPick] = useState("all");
  useEffect(() => { if (!preview) api("/api/me/author/insights").then(setData).catch((e) => setError(e.message)); }, [preview]);
  const all = useMemo(() => (data?.books.length ? combine(data.books, data.months) : null), [data]);

  if (error) return <p role="alert" className="text-rust-dark">Could not load your author insights: {error}</p>;
  if (!data) return <BookshelfLoader label="Counting your readers…" />;

  const single = data.books.length === 1;
  const b = single ? data.books[0] : pick === "all" ? all : data.books.find((x) => x.id === pick);
  const talk = b.reviews + b.posts + b.replies;

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-2">
        <span className="eyebrow">Author insights</span>
        <h1 className="m-0 font-serif text-5xl font-semibold leading-tight md:text-[54px]">How readers respond to {single ? <em>{b.title}</em> : "your books"}</h1>
        <p className="m-0 text-ink-soft">Counts and averages only – you never see who rated, saved or wrote.</p>
      </div>

      {!single && (
        <div role="tablist" aria-label="Which book" className="flex flex-wrap gap-2">
          {[{ id: "all", title: "All my books" }, ...data.books].map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={pick === x.id} onClick={() => setPick(x.id)}
              className={`cursor-pointer rounded-full border px-4 py-2 text-sm ${pick === x.id ? "border-ink bg-ink text-parchment" : "border-line-strong bg-transparent text-ink hover:border-rust hover:text-rust"}`}>
              {x.title}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
        <Tile label="Ratings on BookBridge" value={fmt(b.ratings)} sub={b.avgRating ? `average ${b.avgRating} ★` : "no ratings yet"} />
        <Tile label="Loved it" value={b.ratings ? `${pct(b.loved, b.ratings)}%` : "–"} sub={b.ratings ? `${fmt(b.loved)} rated it 4–5 stars` : "of the readers who rate it"} />
        <Tile label="On a TBR now" value={fmt(b.tbrNow)} sub={`${fmt(b.addedToTbr)} ${b.addedToTbr === 1 ? "reader has" : "readers have"} added it`} />
        <Tile label="Finished it" value={fmt(b.finished)} sub="readers who marked it finished" />
        <Tile label="Conversation" value={fmt(talk)} sub={`${b.reviews} reviews · ${b.posts} posts · ${b.replies} replies`} />
      </div>

      <Section id="trend" title="Readers over time" intro="Readers adding it to their TBR (first time) and rating it, per month – last 12 months. Hover a month for the books finished too.">
        <TrendChart data={b.trend} />
        {b.notForMe > 0 && (
          <p className="m-0 border-t border-line pt-4 text-[15px] text-ink-soft">
            {fmt(b.notForMe)} {b.notForMe === 1 ? "reader" : "readers"} marked it “Not for me” when it was suggested to them – their taste was elsewhere, and it won’t be suggested to them again.
          </p>
        )}
      </Section>

      <Section id="compare" title="BookBridge readers vs. Goodreads readers"
        intro={b.goodreads
          ? `Average ${b.avgRating ?? "–"} from ${fmt(b.ratings)} BookBridge ratings, ${b.goodreads.avgRating} from ${fmt(b.goodreads.ratings)} ratings in the Goodreads dataset${b.goodreads.books && b.goodreads.books < data.books.length ? ` (${b.goodreads.books} of your ${data.books.length} books ${b.goodreads.books === 1 ? "is" : "are"} in it)` : ""}.`
          : "This book is not in the Goodreads dataset, so here are the BookBridge ratings on their own."}>
        {b.ratings || b.goodreads
          ? <CompareStars bb={b.distribution} gr={b.goodreads?.distribution || null} />
          : <p className="m-0 text-muted">No ratings yet.</p>}
      </Section>

      <Audience key={b.id} bookId={b.id} preview={preview?.audience} />

      <p className="m-0 text-[13px] text-muted">
        Want readers to find you? Pin a message for them in your book’s discussion, and fill in your <Link href="/account#author">author page</Link>.
      </p>
    </div>
  );
}
