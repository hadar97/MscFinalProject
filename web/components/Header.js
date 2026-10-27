"use client";

// Top bar for signed-in pages: logo, main menu, account
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { api } from "@/lib/api";
import { BellIcon } from "./Icons";
import Logo from "./Logo";

const LINKS = [
  { href: "/for-you", label: "For you" },
  { href: "/search", label: "Search" },
  { href: "/chat", label: "Ask BookBridge" },
  { href: "/shelf", label: "My shelf" },
  { href: "/insights", label: "Insights" },
];

// Admins only (the project mail): a bell with the number of author requests waiting.
// Asked when a page opens, every minute, and right after an approve / reject
// (the admin page sends the "bb-admin-changed" event). A regular reader is asked once.
let notAdmin = false;
function AdminBell({ path }) {
  const [pending, setPending] = useState(null); // null = not an admin (or not known yet) - show nothing
  useEffect(() => {
    if (notAdmin) return;
    let alive = true;
    const check = () => {
      if (document.visibilityState === "hidden") return;
      api("/api/admin/summary")
        .then((s) => {
          if (!alive) return;
          if (!s.admin) { notAdmin = true; setPending(null); return; }
          setPending(s.pendingAuthorRequests);
        })
        .catch(() => {}); // the bell is optional - never disturb the page
    };
    check();
    const timer = setInterval(check, 60_000);
    window.addEventListener("bb-admin-changed", check);
    return () => { alive = false; clearInterval(timer); window.removeEventListener("bb-admin-changed", check); };
  }, [path]);
  if (pending === null) return null;
  const label = pending ? `${pending} author ${pending === 1 ? "request" : "requests"} waiting for approval` : "No author requests waiting";
  return (
    <Link href="/admin/author-requests" aria-label={label} title={label}
      className="relative flex h-10 w-10 items-center justify-center rounded-full text-ink no-underline hover:bg-cream hover:text-rust">
      <BellIcon />
      {pending > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-rust px-1 text-[11px] font-bold leading-none text-cream">
          {pending > 9 ? "9+" : pending}
        </span>
      )}
    </Link>
  );
}

export default function Header() {
  const path = usePathname();
  const { data: session } = authClient.useSession();
  const initial = (session?.user?.name || "R").trim().charAt(0).toUpperCase();
  return (
    <header className="flex flex-wrap items-center justify-between gap-5 border-b border-line px-6 py-4 md:px-12">
      <Logo href="/for-you" />
      <nav aria-label="Main" className="flex flex-wrap gap-x-6 gap-y-2 text-[15px]">
        {LINKS.map((l) => {
          const active = path === l.href || path.startsWith(l.href + "/");
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={active ? "border-b-2 border-rust pb-1 font-bold text-rust no-underline" : "text-ink no-underline hover:text-rust"}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
      <div className="flex items-center gap-2">
        <AdminBell path={path} />
        <Link href="/account" aria-label="My account" className="flex h-10 w-10 items-center justify-center rounded-full bg-moss font-bold text-cream no-underline hover:text-cream">
          {initial}
        </Link>
      </div>
    </header>
  );
}
