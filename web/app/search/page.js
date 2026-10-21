"use client";

// Search the catalog by title
import { useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Cover from "@/components/Cover";
import { SearchIcon } from "@/components/Icons";
import { api } from "@/lib/api";

export default function SearchPage() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [searched, setSearched] = useState("");

  async function search(e) {
    e.preventDefault();
    const term = q.trim();
    if (term.length < 2) { setError("Type at least 2 letters."); return; }
    setError(null);
    try {
      const r = await api(`/api/books/search?q=${encodeURIComponent(term)}`, { auth: false });
      setResults(r.books); setSearched(term);
    } catch (err) { setError(err.message); }
  }

  return (
    <AppShell width="max-w-[1000px]">
      <div className="flex flex-col gap-6">
        <h1 className="m-0 font-serif text-5xl font-semibold">Find a book</h1>
        <form onSubmit={search} role="search" className="flex items-center gap-3 rounded-full border border-line-strong bg-cream py-1.5 pl-5 pr-2">
          <span className="text-muted"><SearchIcon /></span>
          <label htmlFor="q" className="sr-only">Search by title</label>
          <input id="q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title" className="flex-1 border-0 bg-transparent py-2.5 text-[17px] text-ink outline-none" />
          <button className="btn btn-dark px-5 py-2.5">Search</button>
        </form>
        {error && <p role="alert" className="m-0 text-rust-dark">{error}</p>}
        {results && <span className="text-sm text-muted">{results.length} result{results.length === 1 ? "" : "s"} for “{searched}”</span>}
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {(results || []).map((b) => (
            <li key={b.id} className="card flex flex-wrap items-center gap-4 px-4 py-3.5">
              <Cover book={b} small className="w-[52px] flex-none" />
              <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1">
                <Link href={`/books/${b.id}`} className="text-[17px] font-bold text-ink no-underline hover:text-rust">{b.title}</Link>
                <span className="text-sm text-muted">{(b.authors || []).join(", ")}</span>
              </div>
              <Link href={`/books/${b.id}`} className="rounded-full border border-line-strong px-4 py-2.5 text-sm text-ink no-underline hover:border-ink">View</Link>
            </li>
          ))}
        </ul>
      </div>
    </AppShell>
  );
}
