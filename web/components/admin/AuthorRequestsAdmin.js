"use client";

// Admin page: review "become an author" requests (project team only - the
// server checks the signed-in email against ADMIN_EMAILS). Server: server/admin-routes.js.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Cover from "@/components/Cover";
import { api } from "@/lib/api";

const when = (d) => new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const STATUS = { pending: "bg-sand text-[#5E4A2A]", approved: "bg-moss-soft text-moss-dark", rejected: "bg-rust-soft text-rust-dark" };

function BookPicker({ chosen, setChosen }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => {
      api(`/api/books/search?q=${encodeURIComponent(q.trim())}`, { auth: false }).then((r) => setResults(r.books)).catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  const shown = q.trim().length < 2 ? [] : results;
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-sm font-medium">Link books
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the catalog by title…" className="field font-normal" />
      </label>
      {shown.length > 0 && (
        <ul className="m-0 flex max-h-64 list-none flex-col gap-1 overflow-auto rounded-xl border border-line bg-parchment p-2">
          {shown.map((b) => {
            const on = chosen.some((c) => c.id === b.id);
            return (
              <li key={b.id}>
                <button type="button" onClick={() => setChosen(on ? chosen.filter((c) => c.id !== b.id) : [...chosen, b])}
                  className={`flex w-full cursor-pointer items-center gap-3 rounded-lg p-1.5 text-left ${on ? "bg-moss-soft" : "bg-transparent hover:bg-cream"}`}>
                  <Cover book={b} small className="w-8 flex-none" />
                  <span className="flex-1 text-sm"><span className="font-bold">{b.title}</span> <span className="text-muted">– {b.authors?.[0] || "?"} · #{b.id}</span></span>
                  <span className="text-xs text-moss-dark">{on ? "✓ chosen" : "add"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {chosen.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {chosen.map((b) => (
            <span key={b.id} className="flex items-center gap-2 rounded-full bg-moss-soft px-3 py-1 text-sm text-moss-dark">
              {b.title}
              <button type="button" aria-label={`Remove ${b.title}`} onClick={() => setChosen(chosen.filter((c) => c.id !== b.id))} className="cursor-pointer bg-transparent p-0 text-moss-dark">×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function RequestCard({ r, focused, onDone }) {
  const [chosen, setChosen] = useState([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function decide(kind) {
    if (kind === "reject" && !window.confirm(`Reject the request from ${r.penName}?`)) return;
    setBusy(true); setError(null);
    try {
      await api(`/api/admin/author-requests/${r.id}/${kind}`, { method: "POST", body: kind === "approve" ? { bookIds: chosen.map((b) => b.id), note } : { note } });
      window.dispatchEvent(new Event("bb-admin-changed")); // the bell in the header updates at once
      onDone();
    } catch (err) { setError(err.message); setBusy(false); }
  }
  return (
    <article id={`req-${r.id}`} className={`card flex flex-col gap-4 p-6 ${focused ? "ring-2 ring-rust" : ""}`}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="m-0 font-serif text-2xl font-semibold">
          #{r.id} ·{" "}
          {r.linkedCount > 0
            ? <Link href={`/authors/${r.userId}`} title="Author page – all the books linked to this author">{r.penName}</Link>
            : r.penName}
        </h2>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold uppercase ${STATUS[r.status]}`}>{r.status}</span>
        <span className="ml-auto text-sm text-muted">{when(r.createdAt)}</span>
      </div>
      <dl className="m-0 grid grid-cols-[7rem_1fr] gap-y-2 text-[15px]">
        <dt className="text-muted">From</dt><dd className="m-0">{r.name} · <a href={`mailto:${r.email}`}>{r.email}</a> <span className="text-muted">({r.userType})</span></dd>
        <dt className="text-muted">Books</dt><dd className="m-0 whitespace-pre-wrap break-words">{r.books}</dd>
        {r.message && (<><dt className="text-muted">Message</dt><dd className="m-0 whitespace-pre-wrap break-words">{r.message}</dd></>)}
        {r.linkedCount > 0 && (<><dt className="text-muted">Author of</dt><dd className="m-0">{r.linkedCount} {r.linkedCount === 1 ? "book" : "books"} already · <Link href={`/authors/${r.userId}`}>author page →</Link></dd></>)}
        {r.note && (<><dt className="text-muted">Note</dt><dd className="m-0">{r.note}</dd></>)}
      </dl>
      {r.status === "pending" && (
        <div className="flex flex-col gap-4 border-t border-line pt-4">
          <p className="m-0 text-sm text-ink-soft">Check that this person really is the author (publisher page, website, social media) before approving.</p>
          <BookPicker chosen={chosen} setChosen={setChosen} />
          <label className="flex flex-col gap-1.5 text-sm font-medium">Note to the user <span className="font-normal text-muted">(shown on their Account page – optional)</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2} className="field resize-y font-normal" placeholder="e.g. Welcome! / Please add a link to your publisher page" />
          </label>
          {error && <p role="alert" className="m-0 text-sm text-rust-dark">{error}</p>}
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={busy || !chosen.length} onClick={() => decide("approve")} className="btn btn-primary">
              {chosen.length ? `Approve – link ${chosen.length} ${chosen.length === 1 ? "book" : "books"}` : "Choose books to approve"}
            </button>
            <button type="button" disabled={busy} onClick={() => decide("reject")} className="btn btn-outline">Reject</button>
          </div>
        </div>
      )}
    </article>
  );
}

export default function AuthorRequestsAdmin({ focusId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [all, setAll] = useState(false);
  const [signedInAs, setSignedInAs] = useState(null);
  const load = useCallback(() => {
    api(`/api/admin/author-requests${all ? "?status=all" : ""}`).then((r) => { setData(r); setError(null); }).catch((e) => {
      setError(e.message);
      if (e.message.includes("project team")) api("/api/me").then((m) => setSignedInAs(m.email)).catch(() => {});
    });
  }, [all]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (data && focusId) document.getElementById(`req-${focusId}`)?.scrollIntoView({ block: "center" });
  }, [data, focusId]);

  return (
    <AppShell width="max-w-[900px]">
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="eyebrow">Admin</span>
            <h1 className="m-0 font-serif text-5xl font-semibold">Author requests</h1>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-soft">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="h-4 w-4 accent-[var(--color-rust)]" /> Show decided requests too
          </label>
        </div>
        {error && (
          <p role="alert" className="text-rust-dark">
            {error.includes("project team")
              ? <>This page is for the BookBridge project team only. {signedInAs ? <>You are signed in as <strong>{signedInAs}</strong> – sign out and sign in with the project account.</> : "Sign in with the project account."}</>
              : error.includes("no such address") ? "The server does not know this page yet – replace server/server.js and restart the server." : error}
          </p>
        )}
        {!data && !error && <p className="text-muted">Loading…</p>}
        {data && data.requests.length === 0 && <p className="text-muted">{all ? "No requests yet." : "No pending requests – all done."}</p>}
        {data?.requests.map((r) => <RequestCard key={r.id} r={r} focused={r.id === focusId} onDone={load} />)}
      </div>
    </AppShell>
  );
}
