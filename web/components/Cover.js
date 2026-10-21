"use client";

// A book cover: the real image from the catalog, or a warm colored cover with the title
import { useState } from "react";

const PALETTE = ["#7A3B22", "#3F4A26", "#8C6A2F", "#5B2A1E", "#2F3B33", "#6E4A2A", "#4A3A2E", "#8A4B2A", "#45512B", "#A0612F"];

export default function Cover({ book, className = "", small = false }) {
  const [broken, setBroken] = useState(false);
  const url = book?.thumbnail_url && !broken ? String(book.thumbnail_url).replace(/^http:/, "https:") : null;
  const bg = PALETTE[Math.abs(Number(book?.id) || 0) % PALETTE.length];
  const author = Array.isArray(book?.authors) ? book.authors[0] : book?.authors;
  return (
    <div className={`relative aspect-[2/3] overflow-hidden rounded-md shadow-[0_12px_26px_rgba(43,33,28,0.2)] ${className}`} style={{ background: bg }}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={`Cover of ${book.title}`} className="h-full w-full object-cover" onError={() => setBroken(true)} />
      ) : (
        <div className="flex h-full flex-col justify-between p-3 text-[#FBF4E8]">
          <span className={`font-serif font-semibold leading-tight ${small ? "text-[11px]" : "text-xl"}`}>{book?.title}</span>
          {!small && author && <span className="text-[11px] uppercase tracking-wider opacity-85">{author}</span>}
        </div>
      )}
    </div>
  );
}
