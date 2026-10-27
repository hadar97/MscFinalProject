"use client";

// The Insights page: personal reading analytics from GET /api/me/insights
// (server/insights.js). Every number here is checked against the raw data by
// server/test-insights.js (the proposal's "100% match to the raw event log").
import { useEffect, useState } from "react";
import Link from "next/link";
import BookshelfLoader from "@/components/BookshelfLoader";
import { api } from "@/lib/api";

const MONTH = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
const fmt = (n) => (n ?? 0).toLocaleString("en-US");

export function Tile({ label, value, sub }) {
  return (
    <div className="card flex flex-col gap-1 p-5">
      <span className="text-sm text-muted">{label}</span>
      <span className="font-serif text-[40px] font-semibold leading-none text-ink">{value}</span>
      {sub && <span className="text-[13px] text-muted">{sub}</span>}
    </div>
  );
}

export function Section({ id, title, intro, children }) {
  return (
    <section aria-labelledby={id} className="card flex flex-col gap-5 p-6 md:p-7">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="m-0 font-serif text-[30px] font-semibold">{title}</h2>
        {intro && <p className="m-0 text-ink-soft">{intro}</p>}
      </div>
      {children}
    </section>
  );
}

// Grouped columns per month: finished (rust) + rated in the app (blue). Hover/focus shows the values.
function ActivityChart({ data }) {
  const max = Math.max(1, ...data.flatMap((d) => [d.finished, d.rated]));
  const empty = data.every((d) => !d.finished && !d.rated);
  if (empty) return <p className="m-0 text-muted">No activity in the last 12 months yet. Mark books as finished or rate them in the app, and they will show up here.</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-5 text-[13px] text-ink-soft" aria-hidden="true">
        <span className="flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: "var(--chart-1)" }} />Finished</span>
        <span className="flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: "var(--chart-2)" }} />Rated in the app</span>
      </div>
      <div className="relative flex h-[200px] items-end gap-1.5 border-b border-[var(--chart-grid)] sm:gap-3" aria-hidden="true">
        {data.map((d, i) => (
          <div key={d.month} tabIndex={0} className="bar-hit relative flex h-full min-w-0 flex-1 items-end justify-center gap-[2px] outline-none">
            {[["finished", "var(--chart-1)"], ["rated", "var(--chart-2)"]].map(([k, c]) => (
              <div key={k} className="w-full max-w-[18px] rounded-t-[4px]" style={{ height: `${(d[k] / max) * 100}%`, minHeight: d[k] ? 3 : 0, background: c }} />
            ))}
            {/* the tip opens inward at the edges, so it never sticks out of the page */}
            <div className={`bar-tip absolute -top-14 z-10 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-xs text-parchment ${i < 3 ? "left-0" : i > data.length - 4 ? "right-0" : "left-1/2 -translate-x-1/2"}`}>
              {MONTH(d.month)}: {d.finished} finished · {d.rated} rated
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
        <caption>Books finished and rated per month</caption>
        <thead><tr><th>Month</th><th>Finished</th><th>Rated in the app</th></tr></thead>
        <tbody>{data.map((d) => <tr key={d.month}><td>{d.month}</td><td>{d.finished}</td><td>{d.rated}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

// Horizontal bars, one series. Value label at the end of each bar (text in ink, not the bar color).
export function HBars({ rows, max, label, value, tag }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {rows.map((r) => (
        <li key={label(r)} className="grid grid-cols-[minmax(120px,220px)_1fr] items-center gap-3">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] leading-snug">{label(r)}{tag?.(r)}</span>
          <span className="flex items-center gap-2">
            <span className="h-3 rounded-r-[4px]" style={{ width: `${Math.max(2, (value(r) / max) * 100)}%`, background: "var(--chart-1)" }} />
            <span className="text-sm text-ink-soft">{value(r)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function InsightsView({ preview = null }) {
  const [data, setData] = useState(preview); // preview: sample data for a design check, never in the app
  const [error, setError] = useState(null);
  useEffect(() => { if (!preview) api("/api/me/insights").then(setData).catch((e) => setError(e.message)); }, [preview]);

  if (error) return <p role="alert" className="text-rust-dark">Could not load your insights: {error}</p>;
  if (!data) return <BookshelfLoader label="Counting your shelves…" />;

  const { totals, activity, taste, ratingStyle, series, notForMe, topAuthors } = data;
  const topLoved = taste.loved[0];
  const chosenLabels = taste.chosen.map((c) => c.label);
  const surprise = topLoved && !topLoved.chosen;
  const distMax = Math.max(1, ...ratingStyle.distribution.map((d) => d.count));

  if (!totals.read && !totals.tbr) {
    return (
      <div className="card flex flex-col items-start gap-4 p-8">
        <h1 className="m-0 font-serif text-4xl font-semibold">Your reading insights</h1>
        <p className="m-0 text-ink-soft">Rate a few books or mark them as finished, and this page will show your reading patterns.</p>
        <Link href="/rate-more" className="btn btn-primary">Rate some books</Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-2">
        <span className="eyebrow">Reading insights</span>
        <h1 className="m-0 font-serif text-5xl font-semibold leading-tight md:text-[54px]">Your reading, at a glance</h1>
        <p className="m-0 text-ink-soft">Built only from your own ratings, your TBR and the books you mark as finished.</p>
      </div>

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
        <Tile label="Books read" value={fmt(totals.read)} sub={`${fmt(totals.rated)} rated · ${fmt(totals.finished)} finished`} />
        <Tile label="Pages read" value={fmt(totals.pagesRead)} sub={totals.booksWithPages < totals.read ? `${totals.booksWithPages} of ${totals.read} books have a page count` : "across your read books"} />
        <Tile label="Average rating" value={totals.avgRating ?? "–"} sub={totals.avgRating ? "out of 5 stars" : "no ratings yet"} />
        <Tile label="On your TBR" value={fmt(totals.tbr)} sub={totals.oldestTbr ? `waiting longest: ${totals.oldestTbr.title}` : "nothing saved yet"} />
      </div>

      <Section id="activity" title="Your reading over time" intro="Books you finished and books you rated in the app, per month (last 12 months). Ratings from the sign-up questionnaire are not shown here.">
        <ActivityChart data={activity} />
      </Section>

      <div className="grid gap-7 lg:grid-cols-2">
        <Section id="taste" title="What you said vs. what you love"
          intro={taste.lovedBooks ? `Genres of the ${taste.lovedBooks} books you rated 4–5 stars, next to the genres you picked when you signed up.` : "Rate books 4–5 stars to see which genres you really love."}>
          {surprise && chosenLabels.length > 0 && (
            <p className="m-0 rounded-xl bg-rust-soft px-4 py-3 text-[15px] text-rust-dark">
              You picked {chosenLabels.join(", ")} – but the books you love most are <strong>{topLoved.label}</strong>.
            </p>
          )}
          {taste.loved.length > 0 && (
            <HBars rows={taste.loved} max={Math.max(...taste.loved.map((g) => g.count))} label={(g) => g.label} value={(g) => g.count}
              tag={(g) => g.chosen ? <span className="shrink-0 whitespace-nowrap rounded-full bg-moss-soft px-2 py-0.5 text-[11px] text-moss-dark">picked at sign-up</span> : null} />
          )}
        </Section>

        <Section id="rating" title="How you rate"
          intro={ratingStyle.generousThan !== null ? `Your average is ${ratingStyle.avg}; readers on average give ${ratingStyle.readersAvg}. You rate more generously than ${ratingStyle.generousThan}% of readers.` : "Your ratings, star by star."}>
          <HBars rows={[...ratingStyle.distribution].reverse()} max={distMax} label={(d) => `${"★".repeat(d.stars)}`} value={(d) => d.count} />
        </Section>
      </div>

      <div className="grid gap-7 lg:grid-cols-2">
        <Section id="series" title="Series in progress" intro={series.completed ? `You have finished ${series.completed} series.` : "Series you started and haven’t finished."}>
          {series.inProgress.length === 0 ? <p className="m-0 text-muted">No series in progress.</p> : (
            <ul className="m-0 flex list-none flex-col gap-4 p-0">
              {series.inProgress.map((s) => (
                <li key={s.name} className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Link href={`/series/${encodeURIComponent(s.name)}`} className="font-bold text-ink no-underline hover:text-rust">{s.name}</Link>
                    <span className="text-sm text-ink-soft">{s.read} of {s.total}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-sand" role="progressbar" aria-label={`${s.name}: ${s.read} of ${s.total} read`} aria-valuenow={s.read} aria-valuemin={0} aria-valuemax={s.total}>
                    <div className="h-full rounded-full" style={{ width: `${(s.read / s.total) * 100}%`, background: "var(--chart-1)" }} />
                  </div>
                  {s.nextBookId && <Link href={`/books/${s.nextBookId}`} className="self-start text-sm">Next in the series →</Link>}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="authors" title="Favourite authors" intro="Authors of the books you rated 4–5 stars.">
          {topAuthors.length === 0 ? <p className="m-0 text-muted">Rate books 4–5 stars to see your favourite authors.</p> : (
            <HBars rows={topAuthors} max={Math.max(...topAuthors.map((a) => a.count))} label={(a) => a.name} value={(a) => a.count} />
          )}
          {notForMe.count > 0 && (
            <p className="m-0 border-t border-line pt-4 text-[15px] text-ink-soft">
              You marked {notForMe.count} {notForMe.count === 1 ? "book" : "books"} “Not for me”
              {notForMe.genres.length ? <>, mostly {notForMe.genres.slice(0, 2).map((g) => g.label).join(" and ")}</> : null}. We won’t suggest them again.
            </p>
          )}
        </Section>
      </div>
    </div>
  );
}
