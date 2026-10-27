"use client";

// One recommended book: cover, reason, availability, and quick actions
import { useState } from "react";
import Link from "next/link";
import Cover from "./Cover";
import Stars from "./Stars";
import { BookmarkIcon, StarIcon, XIcon, PinIcon } from "./Icons";
import { api } from "@/lib/api";

const REASON_STYLE = {
  cf: "bg-moss-soft text-moss-dark",
  cbf: "bg-sand text-[#5E4A2A]",
  pop: "bg-rust-soft text-rust-dark",
};
const reasonKind = (r = "") => (r.includes("(CF)") ? "cf" : r.includes("(CBF)") ? "cbf" : "pop");

export default function RecCard({ book, showAvailability, onDismiss, onRated }) {
  const [saved, setSaved] = useState(false);
  const [rating, setRating] = useState(false);
  const [busy, setBusy] = useState(false);
  const author = book.authors?.[0] || ""; // first author only (not illustrators / translators)
  const series = book.series;

  async function save() {
    setBusy(true);
    try { await api("/api/me/events", { method: "POST", body: { bookId: book.id, type: saved ? "unsaved" : "saved" } }); setSaved(!saved); }
    finally { setBusy(false); }
  }
  async function rate(n) {
    setBusy(true);
    try { await api("/api/me/ratings", { method: "POST", body: { bookId: book.id, rating: n } }); setRating(false); onRated?.(book.id, n); }
    finally { setBusy(false); }
  }
  async function dismiss() {
    onDismiss?.(book.id);
    api("/api/me/events", { method: "POST", body: { bookId: book.id, type: "dismissed" } }).catch(() => {});
  }

  return (
    <article className="flex flex-col gap-2.5">
      <Link href={`/books/${book.id}`} className="relative block no-underline">
        <Cover book={book} />
        {book.isNew && <span className="absolute right-2.5 top-2.5 rounded-full bg-parchment px-2 py-1 text-[11px] font-bold text-moss">NEW</span>}
      </Link>
      <div className="flex flex-col gap-1">
        <Link href={`/books/${book.id}`} className="font-bold leading-snug text-ink no-underline hover:text-rust">{book.title}</Link>
        {author && <span className="text-[13px] text-muted">{author}</span>}
        {series && (
          <Link href={`/series/${encodeURIComponent(series.name)}`} className="text-[13px] italic text-ink-soft underline decoration-line-strong underline-offset-2 hover:text-rust">
            {series.name}, book {series.number}
            {series.more > 0 && <> · +{series.more} more in this series</>}
          </Link>
        )}
      </div>
      <span className={`self-start rounded-full px-2.5 py-1 text-xs ${REASON_STYLE[reasonKind(book.reason)]}`}>{book.reasonText || book.reason}</span>
      {showAvailability && (
        <span className={`flex items-start gap-1.5 text-[13px] ${book.availability ? "text-moss-dark" : "text-muted"}`}>
          <span className="mt-0.5"><PinIcon /></span>{book.availabilityText}
        </span>
      )}
      {rating ? (
        <Stars value={0} onChange={rate} size={20} label={`Rate ${book.title}`} />
      ) : (
        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={save} aria-pressed={saved} aria-label={saved ? "Remove from my TBR" : "Add to my TBR (to be read)"} data-tip={saved ? "Remove from my TBR" : "Add to my TBR"} className={`icon-btn ${saved ? "text-rust" : "text-ink"}`}><BookmarkIcon filled={saved} /></button>
          <button type="button" disabled={busy} onClick={() => setRating(true)} aria-label="Rate this book" data-tip="I read it – rate it" className="icon-btn text-ink"><StarIcon /></button>
          <button type="button" onClick={dismiss} aria-label="Not for me" data-tip="Not for me – hide it" className="icon-btn text-ink"><XIcon /></button>
        </div>
      )}
    </article>
  );
}
