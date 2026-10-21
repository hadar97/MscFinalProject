"use client";

// Top bar for signed-in pages: logo, main menu, account
import Link from "next/link";
import { usePathname } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import Logo from "./Logo";

const LINKS = [
  { href: "/for-you", label: "For you" },
  { href: "/search", label: "Search" },
  { href: "/chat", label: "Ask BookBridge" },
  { href: "/shelf", label: "My shelf" },
  { href: "/insights", label: "Insights" },
];

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
      <Link href="/account" aria-label="My account" className="flex h-10 w-10 items-center justify-center rounded-full bg-moss font-bold text-cream no-underline hover:text-cream">
        {initial}
      </Link>
    </header>
  );
}
