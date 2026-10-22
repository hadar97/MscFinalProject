"use client";

// The main page: 10 picks from the hybrid model, with the optional library filter.
// "Recommend me more" adds 10 new picks at a time, up to MAX_BOOKS in all
// (the server is told which books are already on the page).
// Rating a book or "Not for me" removes its card, says so in a small message,
// and puts a NEW pick in its place - asked from the server AFTER the rating
// was saved, so the new pick already uses it.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import RecCard from "@/components/RecCard";
import BookshelfLoader from "@/components/BookshelfLoader";
import Toast, { useToast } from "@/components/Toast";
import { scrollIntoViewSoon } from "@/lib/scroll";
import { api } from "@/lib/api";

const CITIES = ["Jerusalem", "Tel Aviv-Yafo"];
const PAGE = 10;
const MAX_BOOKS = 50;

export default function ForYouPage() {
  const [me, setMe] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [near, setNear] = useState(false);
  const [where, setWhere] = useState("Jerusalem"); // a city, or "here" = my location
  const [mode, setMode] = useState("filter");
  const [coords, setCoords] = useState(null);
  const [hidden, setHidden] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [noMore, setNoMore] = useState(false);
  const [toast, showToast] = useToast();
  const seen = useRef(new Set()); // every book shown on this page - never asked for again
  const moreRef = useRef(null);

  useEffect(() => {
    api("/api/me").then((m) => {
      setMe(m);
      if (m.preferredCity) setWhere(m.preferredCity);
    }).catch((e) => setError(e.message));
  }, []);

  // the address for one page of picks (null while waiting for my location)
  const query = useCallback((exclude = []) => {
    const q = new URLSearchParams({ count: String(PAGE) });
    if (exclude.length) q.set("exclude", exclude.join(","));
    if (near) {
      if (where === "here") {
        if (!coords) return null;
        q.set("lat", coords.lat); q.set("lng", coords.lng); q.set("radiusKm", "10");
      } else q.set("city", where);
      q.set("mode", mode);
    }
    return `/api/me/recommendations?${q}`;
  }, [near, where, mode, coords]);

  const load = useCallback(async () => {
    const url = query();
    if (!url) return;
    setLoading(true);
    try {
      const r = await api(url);
      seen.current = new Set(r.recommendations.map((b) => b.id));
      setError(null); setData(r); setHidden([]); setNoMore(r.recommendations.length < PAGE);
    }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [query]);

  async function loadMore() {
    const url = query([...seen.current]);
    if (!url) return;
    setLoadingMore(true);
    scrollIntoViewSoon(moreRef); // show the loader, then the new books appear right there
    try {
      const r = await api(url);
      r.recommendations.forEach((b) => seen.current.add(b.id));
      setData((d) => ({ ...d, recommendations: [...d.recommendations, ...r.recommendations] }));
      if (r.recommendations.length < PAGE) setNoMore(true);
    } catch (e) { setError(e.message); }
    finally { setLoadingMore(false); }
  }

  useEffect(() => { if (me?.onboarded) load(); }, [me, load]); // eslint-disable-line react-hooks/set-state-in-effect

  // A card was rated / dismissed: hide it now, then fill its place with a new pick
  async function replaceCard(id, message) {
    setHidden((h) => [...h, id]);
    showToast(`${message} Finding a new pick for you…`);
    const url = query([...seen.current]);
    if (!url) return;
    try {
      const r = await api(url);
      const fresh = r.recommendations.find((b) => !seen.current.has(b.id));
      if (!fresh) return showToast(message);
      seen.current.add(fresh.id);
      setData((d) => ({ ...d, recommendations: d.recommendations.map((b) => (b.id === id ? { ...fresh, fresh: true } : b)) }));
      setHidden((h) => h.filter((x) => x !== id));
      showToast(`${message} “${fresh.title}” took its place.`);
    } catch {
      showToast(message);
    }
  }

  function pickMyLocation() {
    setWhere("here");
    if (coords) return;
    navigator.geolocation?.getCurrentPosition(
      (p) => setCoords({ lat: p.coords.latitude.toFixed(4), lng: p.coords.longitude.toFixed(4) }),
      () => { setError("Could not get your location – choose a city instead."); setWhere("Jerusalem"); }
    );
  }

  const books = (data?.recommendations || []).filter((b) => !hidden.includes(b.id));
  const total = data?.recommendations.length || 0;
  const canLoadMore = data && !loading && !noMore && total < MAX_BOOKS;

  return (
    <AppShell>
      <div className="flex flex-col gap-7">
        <div className="flex flex-col gap-2">
          <span className="eyebrow">Picked for you</span>
          <h1 className="m-0 font-serif text-5xl font-semibold leading-tight md:text-[54px]">Ten books for a slow autumn evening</h1>
          {me && (
            <p className="m-0 text-ink-soft">
              Based on {me.ratingsCount} book{me.ratingsCount === 1 ? "" : "s"} you rated{me.genres.length ? ` and your genres` : ""}. <Link href="/rate-more">Rate more</Link> to sharpen them.
            </p>
          )}
        </div>

        {me && !me.onboarded && (
          <div className="card flex flex-col items-start gap-4 p-8">
            <h2 className="m-0 font-serif text-3xl font-semibold">Let&apos;s get to know your taste</h2>
            <p className="m-0 text-ink-soft">Two quick steps: choose a few genres and rate books you have read.</p>
            <Link href="/onboarding/genres" className="btn btn-primary">Start the 2-minute quiz</Link>
          </div>
        )}

        {me?.onboarded && (
          <section aria-label="Libraries" className="card flex flex-wrap items-center gap-5 rounded-[18px] px-5 py-4">
            <button type="button" role="switch" aria-checked={near} onClick={() => setNear(!near)} className="flex cursor-pointer items-center gap-3 bg-transparent p-0 text-ink">
              <span className={`relative inline-block h-[26px] w-[46px] rounded-full transition-colors ${near ? "bg-moss" : "bg-[#CBBBA3]"}`}>
                <span className={`absolute top-[3px] h-5 w-5 rounded-full bg-cream transition-all ${near ? "left-[23px]" : "left-[3px]"}`} />
              </span>
              <span className="font-bold">Available at a library near me</span>
            </button>
            {near && (
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-ink-soft">Where
                  <select value={where} onChange={(e) => (e.target.value === "here" ? pickMyLocation() : setWhere(e.target.value))}
                    className="rounded-[10px] border border-line-strong bg-parchment px-3 py-2 text-ink">
                    {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    <option value="here">Near my location (10 km)</option>
                  </select>
                </label>
                <div role="group" aria-label="Show" className="flex overflow-hidden rounded-full border border-line-strong text-sm">
                  {[["filter", "Only available"], ["boost", "Available first"]].map(([m, label]) => (
                    <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
                      className={`cursor-pointer px-3.5 py-2 ${mode === m ? "bg-ink text-parchment" : "bg-cream text-ink"}`}>{label}</button>
                  ))}
                </div>
                <span className="text-xs text-muted">Demo inventory</span>
              </div>
            )}
          </section>
        )}

        {error && <p role="alert" className="text-rust-dark">{error}</p>}
        {me?.onboarded && (loading || (!data && !error)) && <BookshelfLoader label="Choosing your books…" />}
        {data && !loading && books.length === 0 && <p className="text-muted">No books match – try another city or “Available first”.</p>}

        <div className={`grid gap-x-5 gap-y-7 [grid-template-columns:repeat(auto-fill,minmax(190px,1fr))] ${loading ? "hidden" : ""}`}>
          {books.map((b) => (
            <div key={b.id} className={b.fresh ? "fresh-in" : ""}>
              <RecCard book={b} showAvailability={near}
                onDismiss={(id) => replaceCard(id, "Hidden – we won't suggest it again.")}
                onRated={(id, n) => replaceCard(id, `Rated ${n}★ – thanks!`)} />
            </div>
          ))}
        </div>

        <div ref={moreRef}>{loadingMore && <BookshelfLoader label="Finding 10 more…" />}</div>
        {!loadingMore && canLoadMore && (
          <div className="flex flex-col items-center gap-2 pt-4">
            <button type="button" onClick={loadMore} className="btn btn-dark">Recommend me more</button>
            <span className="text-sm text-muted">{total} of up to {MAX_BOOKS} picks</span>
          </div>
        )}
        {data && !loading && !loadingMore && !canLoadMore && total > PAGE && (
          <p className="pt-4 text-center text-sm text-muted">That&apos;s {total} picks – rate a few of them to get fresh ones.</p>
        )}
      </div>
      <Toast toast={toast} />
    </AppShell>
  );
}
