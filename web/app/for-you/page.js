"use client";

// The main page: 10 picks from the hybrid model, with the optional library filter
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import RecCard from "@/components/RecCard";
import { api } from "@/lib/api";

const CITIES = ["Jerusalem", "Tel Aviv-Yafo"];

export default function ForYouPage() {
  const [me, setMe] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [near, setNear] = useState(false);
  const [where, setWhere] = useState("Jerusalem"); // a city, or "here" = my location
  const [mode, setMode] = useState("filter");
  const [coords, setCoords] = useState(null);
  const [hidden, setHidden] = useState([]);

  useEffect(() => {
    api("/api/me").then((m) => {
      setMe(m);
      if (m.preferredCity) setWhere(m.preferredCity);
    }).catch((e) => setError(e.message));
  }, []);

  const load = useCallback(async () => {
    const q = new URLSearchParams({ count: "10" });
    if (near) {
      if (where === "here") {
        if (!coords) return;
        q.set("lat", coords.lat); q.set("lng", coords.lng); q.set("radiusKm", "10");
      } else q.set("city", where);
      q.set("mode", mode);
    }
    try { const r = await api(`/api/me/recommendations?${q}`); setError(null); setData(r); setHidden([]); }
    catch (e) { setError(e.message); }
  }, [near, where, mode, coords]);

  useEffect(() => { if (me?.onboarded) load(); }, [me, load]);

  function pickMyLocation() {
    setWhere("here");
    if (coords) return;
    navigator.geolocation?.getCurrentPosition(
      (p) => setCoords({ lat: p.coords.latitude.toFixed(4), lng: p.coords.longitude.toFixed(4) }),
      () => { setError("Could not get your location – choose a city instead."); setWhere("Jerusalem"); }
    );
  }

  const books = (data?.recommendations || []).filter((b) => !hidden.includes(b.id));

  return (
    <AppShell>
      <div className="flex flex-col gap-7">
        <div className="flex flex-col gap-2">
          <span className="eyebrow">Picked for you</span>
          <h1 className="m-0 font-serif text-5xl font-semibold leading-tight md:text-[54px]">Ten books for a slow autumn evening</h1>
          {me && (
            <p className="m-0 text-ink-soft">
              Based on {me.ratingsCount} book{me.ratingsCount === 1 ? "" : "s"} you rated{me.genres.length ? ` and your genres` : ""}. <Link href="/onboarding/genres">Rate more</Link> to sharpen them.
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
        {me?.onboarded && !data && !error && <p className="text-muted">Choosing your books…</p>}
        {data && books.length === 0 && <p className="text-muted">No books match – try another city or “Available first”.</p>}

        <div className="grid gap-x-5 gap-y-7 [grid-template-columns:repeat(auto-fill,minmax(190px,1fr))]">
          {books.map((b) => (
            <RecCard key={b.id} book={b} showAvailability={near}
              onDismiss={(id) => setHidden((h) => [...h, id])}
              onRated={(id) => setHidden((h) => [...h, id])} />
          ))}
        </div>
      </div>
    </AppShell>
  );
}
