"use client";

// /insights: the reader's own insights, and - for an author - a second tab
// "My books" with how readers respond to their books. /insights#author opens it.
import { useEffect, useState } from "react";
import InsightsView from "./InsightsView";
import AuthorInsightsView from "./AuthorInsightsView";
import { api } from "@/lib/api";

export default function InsightsTabs() {
  const [isAuthor, setIsAuthor] = useState(false);
  const [tab, setTab] = useState("reading");
  useEffect(() => {
    api("/api/me/author")
      .then((a) => {
        if (!a.isAuthor || !a.books.length) return;
        setIsAuthor(true);
        if (window.location.hash === "#author") setTab("author");
      })
      .catch(() => {});
  }, []);
  function choose(t) {
    setTab(t);
    try { window.history.replaceState(null, "", t === "author" ? "#author" : window.location.pathname); } catch {}
  }

  return (
    <div className="flex flex-col gap-8">
      {isAuthor && (
        <div role="tablist" aria-label="Insights" className="flex gap-1 self-start rounded-full border border-line-strong p-1">
          {[["reading", "My reading"], ["author", "My books"]].map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => choose(k)}
              className={`cursor-pointer rounded-full px-5 py-2 text-sm font-bold ${tab === k ? "bg-rust text-cream" : "bg-transparent text-ink hover:text-rust"}`}>
              {label}
            </button>
          ))}
        </div>
      )}
      {tab === "author" ? <AuthorInsightsView /> : <InsightsView />}
    </div>
  );
}
