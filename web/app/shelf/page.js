"use client";

// My shelf: books I rated, saved and finished
import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Cover from "@/components/Cover";
import Stars from "@/components/Stars";
import { XIcon } from "@/components/Icons";
import { api } from "@/lib/api";

const TABS = [["rated", "Rated"], ["saved", "Saved"], ["finished", "Finished"]];
const SOURCE = { onboarding: "From the questionnaire", app: "Rated in the app", chat: "Rated in a chat" };

export default function ShelfPage() {
  const [tab, setTab] = useState("rated");
  const [ratings, setRatings] = useState(null);
  const [shelf, setShelf] = useState({ saved: [], finished: [] });
  const [error, setError] = useState(null);

  useEffect(() => {
    api("/api/me/ratings").then((r) => setRatings(r.ratings)).catch((e) => setError(e.message));
    api("/api/me/shelf").then(setShelf).catch(() => {});
  }, []);

  async function removeRating(bookId) {
    await api(`/api/me/ratings/${bookId}`, { method: "DELETE" });
    setRatings((r) => r.filter((x) => x.bookId !== bookId));
  }
  async function unsave(bookId) {
    await api("/api/me/events", { method: "POST", body: { bookId, type: "unsaved" } });
    setShelf((s) => ({ ...s, saved: s.saved.filter((b) => b.id !== bookId) }));
  }

  const counts = { rated: ratings?.length ?? 0, saved: shelf.saved.length, finished: shelf.finished.length };
  const list = tab === "rated"
    ? (ratings || []).map((r) => ({ id: r.bookId, title: r.title, authors: r.authors, thumbnail_url: r.thumbnail_url, rating: r.rating, source: r.source }))
    : shelf[tab];

  return (
    <AppShell width="max-w-[1100px]">
      <div className="flex flex-col gap-7">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="flex flex-col gap-1.5">
            <h1 className="m-0 font-serif text-5xl font-semibold">My shelf</h1>
            <span className="text-ink-soft">{counts.rated} rated · {counts.saved} saved · {counts.finished} finished</span>
          </div>
          <Link href="/onboarding/genres" className="text-sm">Change my genres</Link>
        </div>
        <div role="tablist" aria-label="Shelf" className="flex gap-1.5 border-b border-line">
          {TABS.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
              className={`cursor-pointer bg-transparent px-4 py-3 ${tab === key ? "border-b-2 border-rust font-bold text-rust" : "text-ink-soft"}`}>
              {label} ({counts[key]})
            </button>
          ))}
        </div>
        {error && <p role="alert" className="text-rust-dark">{error}</p>}
        {list.length === 0 && ratings && (
          <p className="text-muted">Nothing here yet. <Link href="/for-you">Find something to read</Link>.</p>
        )}
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
          {list.map((b) => (
            <article key={`${tab}-${b.id}`} className="card flex items-center gap-4 p-4">
              <Cover book={b} small className="w-16 flex-none" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Link href={`/books/${b.id}`} className="font-bold text-ink no-underline hover:text-rust">{b.title}</Link>
                <span className="text-[13px] text-muted">{(b.authors || []).join(", ")}</span>
                {tab === "rated" && <><Stars value={b.rating} size={18} /><span className="text-xs text-muted">{SOURCE[b.source] || ""}</span></>}
              </div>
              {tab === "rated" && <button type="button" onClick={() => removeRating(b.id)} aria-label={`Remove rating of ${b.title}`} className="icon-btn text-ink"><XIcon /></button>}
              {tab === "saved" && <button type="button" onClick={() => unsave(b.id)} aria-label={`Remove ${b.title} from saved`} className="icon-btn text-ink"><XIcon /></button>}
            </article>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
