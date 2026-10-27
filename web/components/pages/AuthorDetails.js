"use client";

// An author's page (app/authors/[id]/page.js): pen name, bio, website and the
// books linked to them. Reached from the author's name on a book page, the
// admin page, or the author's own Account page.
import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Cover from "@/components/Cover";
import BookshelfLoader from "@/components/BookshelfLoader";
import { api } from "@/lib/api";

const year = (d) => (d ? String(d).slice(0, 4) : null);
const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

export default function AuthorDetails({ id }) {
  const [author, setAuthor] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { api(`/api/authors/${id}`).then(setAuthor).catch((e) => setError(e.message)); }, [id]);

  if (error) return <AppShell><p role="alert" className="text-rust-dark">Could not load this author: {error}</p></AppShell>;
  if (!author) return <AppShell><BookshelfLoader label="Finding the author…" /></AppShell>;

  return (
    <AppShell>
      <div className="flex flex-col gap-12">
        <header className="flex flex-col gap-3">
          <span className="eyebrow">Author on BookBridge</span>
          <h1 className="m-0 font-serif text-5xl font-semibold leading-none md:text-[58px]">{author.penName}</h1>
          <span className="text-lg text-ink-soft">
            {author.books.length} {author.books.length === 1 ? "book" : "books"}
            {author.website && <> · <a href={author.website} target="_blank" rel="noopener noreferrer nofollow">{host(author.website)} ↗</a></>}
          </span>
          {author.bio && <p className="m-0 max-w-[680px] whitespace-pre-line text-[17px] leading-relaxed text-[#3D3029]">{author.bio}</p>}
          {author.isMe && (
            <Link href="/account#author" className="self-start text-sm">This is your page – edit it on your Account page</Link>
          )}
        </header>

        <ul className="m-0 grid list-none gap-x-5 gap-y-8 p-0 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]">
          {author.books.map((b) => (
            <li key={b.id}>
              <Link href={`/books/${b.id}`} className="flex flex-col gap-2 text-ink no-underline hover:text-rust">
                <Cover book={b} />
                <span className="text-sm font-bold leading-snug">{b.title}</span>
                {year(b.published_date) && <span className="text-[13px] text-muted">{year(b.published_date)}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </AppShell>
  );
}
