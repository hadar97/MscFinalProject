"use client";

// Reviews and discussion of one book (inside the book page). Server: server/social-routes.js.
// User text is shown as plain text (React escapes it) with its line breaks kept.
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
function ago(date) {
  const s = (new Date(date) - Date.now()) / 1000;
  const steps = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [unit, sec] of steps) if (Math.abs(s) >= sec) return rtf.format(Math.round(s / sec), unit);
  return "just now";
}
const Stars = ({ n }) => <span aria-label={`${n} of 5 stars`} className="text-gold">{"★".repeat(n)}<span className="text-line-strong">{"★".repeat(5 - n)}</span></span>;
const AuthorBadge = () => <span className="rounded-full bg-rust px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-cream">Author</span>;

function Composer({ placeholder, initial = "", submitLabel, onSubmit, onCancel, autoFocus }) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await onSubmit(text.trim()); setText(""); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} maxLength={2000} rows={3} autoFocus={autoFocus}
        aria-label={placeholder} className="field resize-y text-[15px] leading-relaxed" />
      {error && <p role="alert" className="m-0 text-sm text-rust-dark">{error}</p>}
      <div className="flex items-center gap-3">
        <button disabled={busy || !text.trim()} className="btn btn-primary px-5 py-2 text-sm">{busy ? "Saving…" : submitLabel}</button>
        {onCancel && <button type="button" onClick={onCancel} className="cursor-pointer bg-transparent text-sm text-muted">Cancel</button>}
        <span className="ml-auto text-xs text-muted">{text.length}/2000</span>
      </div>
    </form>
  );
}

function Post({ post, canPin, onReply, onDelete, onPin, isReply }) {
  const [replying, setReplying] = useState(false);
  return (
    <li className={`flex flex-col gap-2 ${isReply ? "border-l-2 border-line pl-4" : "rounded-2xl border border-line bg-parchment p-4"} ${post.pinned ? "border-rust/50" : ""}`}>
      {post.pinned && <span className="text-xs font-bold uppercase tracking-wide text-rust">Pinned by the author</span>}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-bold text-ink">{post.name}</span>
        {post.isAuthor && <AuthorBadge />}
        <span className="text-muted">· {ago(post.createdAt)}</span>
      </div>
      <p className="m-0 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-[#3D3029]">{post.body}</p>
      <div className="flex flex-wrap gap-4 text-sm">
        {!isReply && <button type="button" onClick={() => setReplying(!replying)} className="cursor-pointer bg-transparent p-0 text-rust">Reply</button>}
        {canPin && !isReply && <button type="button" onClick={() => onPin(post.id, !post.pinned)} className="cursor-pointer bg-transparent p-0 text-ink-soft">{post.pinned ? "Unpin" : "Pin to top"}</button>}
        {post.mine && <button type="button" onClick={() => onDelete(post.id)} className="cursor-pointer bg-transparent p-0 text-muted">Delete</button>}
      </div>
      {replying && (
        <Composer placeholder="Write a reply…" submitLabel="Reply" autoFocus onCancel={() => setReplying(false)}
          onSubmit={async (text) => { await onReply(post.id, text); setReplying(false); }} />
      )}
      {post.replies?.length > 0 && (
        <ul className="m-0 mt-1 flex list-none flex-col gap-3 p-0">
          {post.replies.map((r) => <Post key={r.id} post={r} isReply onDelete={onDelete} />)}
        </ul>
      )}
    </li>
  );
}

export default function BookSocial({ bookId, myRating, preview = null }) {
  const [data, setData] = useState(preview); // preview: sample data for a design check, never in the app
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(() => api(`/api/social/books/${bookId}`).then(setData).catch((e) => setError(e.message)), [bookId]);
  useEffect(() => { if (!preview) load(); }, [load, preview]);

  if (error) return <p role="alert" className="text-rust-dark">Could not load the discussion: {error}</p>;
  if (!data) return null;

  const mine = data.reviews.find((r) => r.mine);
  const rated = myRating > 0;
  const post = (body, parentId) => api(`/api/social/books/${bookId}/posts`, { method: "POST", body: { body, parentId } }).then(load);
  const remove = async (id) => { if (window.confirm("Delete this post? Replies to it are deleted too.")) { await api(`/api/social/posts/${id}`, { method: "DELETE" }); load(); } };
  const pin = async (id, pinned) => { await api(`/api/social/posts/${id}/pin`, { method: "POST", body: { pinned } }); load(); };

  return (
    <div className="grid items-start gap-7 lg:grid-cols-2">
      <section aria-labelledby="reviews" className="card flex flex-col gap-5 rounded-[20px] p-7">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="reviews" className="m-0 font-serif text-[34px] font-semibold">Reader reviews</h2>
          <span className="text-sm text-muted">{data.reviews.length} {data.reviews.length === 1 ? "review" : "reviews"}</span>
        </div>
        {!rated ? (
          <p className="m-0 rounded-xl bg-parchment px-4 py-3 text-[15px] text-ink-soft">Rate this book above to write a review.</p>
        ) : !mine || editing ? (
          <Composer placeholder="What did you think? A few words help other readers." initial={mine?.body || ""} submitLabel={mine ? "Save review" : "Post review"}
            onCancel={mine ? () => setEditing(false) : undefined}
            onSubmit={async (body) => { await api(`/api/social/books/${bookId}/review`, { method: "PUT", body: { body } }); setEditing(false); load(); }} />
        ) : null}
        {data.reviews.length === 0 ? <p className="m-0 text-muted">No reviews yet{rated ? " – be the first." : "."}</p> : (
          <ul className="m-0 flex list-none flex-col gap-4 p-0">
            {data.reviews.map((r, i) => (
              <li key={i} className="flex flex-col gap-1.5 border-b border-line pb-4 last:border-b-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-bold text-ink">{r.mine ? "You" : r.name}</span>
                  {r.isAuthor && <AuthorBadge />}
                  {r.rating && <Stars n={r.rating} />}
                  <span className="text-muted">· {ago(r.updatedAt)}</span>
                </div>
                <p className="m-0 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-[#3D3029]">{r.body}</p>
                {r.mine && !editing && (
                  <div className="flex gap-4 text-sm">
                    <button type="button" onClick={() => setEditing(true)} className="cursor-pointer bg-transparent p-0 text-rust">Edit</button>
                    <button type="button" onClick={async () => { if (window.confirm("Delete your review?")) { await api(`/api/social/books/${bookId}/review`, { method: "DELETE" }); load(); } }}
                      className="cursor-pointer bg-transparent p-0 text-muted">Delete</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="discussion" className="card flex flex-col gap-5 rounded-[20px] p-7">
        <div className="flex flex-col gap-1">
          <h2 id="discussion" className="m-0 font-serif text-[34px] font-semibold">Discussion</h2>
          <p className="m-0 text-ink-soft">{data.me.isAuthor ? "You are an author of this book – your posts carry the Author badge, and you can pin one to the top." : "Talk about the book with other readers. Please avoid spoilers in the first line."}</p>
        </div>
        <Composer placeholder={data.me.isAuthor ? "Share something with your readers…" : "Start a conversation about this book…"} submitLabel="Post" onSubmit={(body) => post(body)} />
        {data.posts.length === 0 ? <p className="m-0 text-muted">No posts yet – start the conversation.</p> : (
          <ul className="m-0 flex list-none flex-col gap-4 p-0">
            {data.posts.map((p) => <Post key={p.id} post={p} canPin={data.me.isAuthor} onReply={(id, text) => post(text, id)} onDelete={remove} onPin={pin} />)}
          </ul>
        )}
      </section>
    </div>
  );
}
