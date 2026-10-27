"use client";

// The author part of the Account page.
//  - A reader: "Are you an author?" - closed until they open it; inside, the
//    request form ("link me to my books"), and the status of their request.
//  - An author: "Your books" - their author page (pen name, bio, website - they
//    can edit it), the books linked to them, and "Add more of my books" (the
//    pen name is already filled in from what we know; it can be changed).
// Server: GET /api/me/author, PUT /api/me/author/profile, POST /api/me/author-request.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Cover from "@/components/Cover";
import { api } from "@/lib/api";

const day = (d) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

function RequestForm({ onSent, onCancel, again, penName }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(null);
    try {
      await api("/api/me/author-request", {
        method: "POST",
        body: { penName: f.get("penName"), books: f.get("books"), message: f.get("message"), confirm: f.get("confirm") === "on" },
      });
      onSent();
    } catch (err) { setError(err.message); setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="m-0 text-ink-soft">
        {again ? "Wrote another book? Tell us which, and we’ll link it to you." : "Wrote a book? Ask to be linked to it: your posts in its discussion get an Author badge, you can pin a message for your readers, you get your own author page, and insights about how readers respond to your book."}
      </p>
      <label className="flex flex-col gap-1.5 text-sm font-medium">Pen name
        <input name="penName" required maxLength={120} defaultValue={penName || ""} placeholder="The name on your books" className="field font-normal" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">{again ? "Which books?" : "Your books"}
        <textarea name="books" required maxLength={2000} rows={3} placeholder={"One per line – title, and a link if you have one\n(publisher page, Goodreads, your website)"} className="field resize-y font-normal" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">Anything else? <span className="font-normal text-muted">(optional)</span>
        <textarea name="message" maxLength={2000} rows={2} placeholder="How can we confirm it's you?" className="field resize-y font-normal" />
      </label>
      <label className="flex items-start gap-2.5 text-sm text-ink-soft">
        <input type="checkbox" name="confirm" required className="mt-1 h-4 w-4 accent-[var(--color-rust)]" />
        <span>I confirm that I am the author of these books.</span>
      </label>
      {error && <p role="alert" className="m-0 text-sm text-rust-dark">{error}</p>}
      <div className="flex flex-wrap gap-3">
        <button disabled={busy} className="btn btn-primary">{busy ? "Sending…" : "Send request"}</button>
        {onCancel && <button type="button" onClick={onCancel} className="btn btn-outline">Cancel</button>}
      </div>
    </form>
  );
}

// The author's page details - shown, or edited in place
function ProfileEditor({ userId, profile, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function save(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(null);
    try {
      await api("/api/me/author/profile", { method: "PUT", body: { penName: f.get("penName"), bio: f.get("bio"), website: f.get("website") } });
      setEditing(false);
      onSaved();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  if (!editing) {
    return (
      <div className="flex flex-col gap-2 rounded-xl bg-parchment px-5 py-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="font-serif text-2xl font-semibold">{profile.penName}</span>
          {profile.website && <a href={profile.website} target="_blank" rel="noopener noreferrer nofollow" className="text-sm">{host(profile.website)} ↗</a>}
        </div>
        {profile.bio
          ? <p className="m-0 whitespace-pre-line text-ink-soft">{profile.bio}</p>
          : <p className="m-0 text-sm text-muted">No bio yet – a few lines about you help readers get to know you.</p>}
        <div className="mt-1 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <Link href={`/authors/${userId}`}>View your author page →</Link>
          <button type="button" onClick={() => setEditing(true)} className="cursor-pointer bg-transparent p-0 text-rust">Edit</button>
        </div>
      </div>
    );
  }
  return (
    <form onSubmit={save} className="flex flex-col gap-4 rounded-xl bg-parchment px-5 py-4">
      <label className="flex flex-col gap-1.5 text-sm font-medium">Pen name
        <input name="penName" required maxLength={120} defaultValue={profile.penName} className="field font-normal" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">About you <span className="font-normal text-muted">(optional)</span>
        <textarea name="bio" maxLength={2000} rows={4} defaultValue={profile.bio || ""} placeholder="A few lines for your readers" className="field resize-y font-normal" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">Website <span className="font-normal text-muted">(optional)</span>
        <input name="website" maxLength={300} defaultValue={profile.website || ""} placeholder="https://yoursite.com" className="field font-normal" />
      </label>
      {error && <p role="alert" className="m-0 text-sm text-rust-dark">{error}</p>}
      <div className="flex flex-wrap gap-3">
        <button disabled={busy} className="btn btn-primary">{busy ? "Saving…" : "Save"}</button>
        <button type="button" onClick={() => { setEditing(false); setError(null); }} className="btn btn-outline">Cancel</button>
      </div>
    </form>
  );
}

function RequestStatus({ r, isAuthor }) {
  if (r?.status === "pending") {
    return (
      <p className="m-0 rounded-xl bg-sand px-4 py-3 text-[#5E4A2A]">
        Your request (as <strong>{r.penName}</strong>) was sent on {day(r.createdAt)}. We’ll check it and update you here.
      </p>
    );
  }
  if (r?.status === "rejected") {
    return (
      <p className="m-0 rounded-xl bg-rust-soft px-4 py-3 text-rust-dark">
        We couldn’t confirm your request from {day(r.createdAt)}.{r.note ? ` ${r.note}` : ""} You can send a new one.
      </p>
    );
  }
  if (r?.status === "approved" && !isAuthor) {
    return <p className="m-0 rounded-xl bg-moss-soft px-4 py-3 text-moss-dark">Your request was approved{r.note ? ` – ${r.note}` : ""}.</p>;
  }
  return null;
}

const Chevron = ({ open }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"
    className={`shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}><path d="M6 9l6 6 6-6" /></svg>
);

export default function AuthorSection() {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);       // the reader's "Are you an author?" box
  const [showForm, setShowForm] = useState(false); // the author's "Add more of my books"
  const load = useCallback(() => api("/api/me/author").then(setData).catch(() => setData(null)), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (window.location.hash === "#author") setOpen(true); }, []); // eslint-disable-line react-hooks/set-state-in-effect
  if (!data) return null;
  const r = data.request;

  // ---- an author: "Your books" ----
  if (data.isAuthor && data.books.length) {
    return (
      <section id="author" aria-labelledby="author-title" className="card mt-6 flex flex-col gap-5 p-6 text-[15px]">
        <h2 id="author-title" className="m-0 font-serif text-3xl font-semibold">Your books</h2>
        {data.profile && <ProfileEditor userId={data.userId} profile={data.profile} onSaved={load} />}
        <p className="m-0 text-ink-soft">
          You are linked as the author of these books. Your posts in their discussions carry the Author badge.{" "}
          <Link href="/insights#author">See how readers respond →</Link>
        </p>
        <ul className="m-0 grid list-none gap-4 p-0 [grid-template-columns:repeat(auto-fill,minmax(110px,1fr))]">
          {data.books.map((b) => (
            <li key={b.id}><Link href={`/books/${b.id}`} className="flex flex-col gap-1.5 text-sm font-bold text-ink no-underline hover:text-rust"><Cover book={b} small />{b.title}</Link></li>
          ))}
        </ul>
        <RequestStatus r={r} isAuthor />
        {r?.status !== "pending" && (
          showForm
            ? <RequestForm again penName={data.penName} onCancel={() => setShowForm(false)} onSent={() => { setShowForm(false); load(); }} />
            : <button type="button" onClick={() => setShowForm(true)} className="cursor-pointer self-start bg-transparent p-0 text-rust">+ Add more of my books</button>
        )}
      </section>
    );
  }

  // ---- a reader: "Are you an author?" (closed until opened) ----
  const status = r?.status === "pending" ? "Request sent" : r?.status === "rejected" ? "Not confirmed" : null;
  return (
    <section id="author" className="card mt-6 text-[15px]">
      <h2 className="m-0">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="author-body"
          className="flex w-full cursor-pointer items-center gap-3 bg-transparent p-6 text-left font-serif text-3xl font-semibold text-ink">
          <span className="flex-1">Are you an author?</span>
          {status && <span className="rounded-full bg-sand px-2.5 py-0.5 font-sans text-xs font-bold uppercase text-[#5E4A2A]">{status}</span>}
          <Chevron open={open} />
        </button>
      </h2>
      {open && (
        <div id="author-body" className="flex flex-col gap-4 px-6 pb-6">
          <RequestStatus r={r} isAuthor={false} />
          {r?.status !== "pending" && <RequestForm penName={data.penName} onSent={load} />}
        </div>
      )}
    </section>
  );
}
