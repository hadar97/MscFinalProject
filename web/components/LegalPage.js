// Layout for the Terms of Use and the Privacy Policy (readable without signing in)
import Link from "next/link";
import Logo from "./Logo";
import { SITE } from "@/lib/site";

export default function LegalPage({ title, children }) {
  return (
    <div className="min-h-full">
      <header className="flex items-center justify-between gap-4 border-b border-line px-6 py-4 md:px-12">
        <Logo href="/" />
        <nav className="flex gap-5 text-sm">
          <Link href="/terms">Terms of Use</Link>
          <Link href="/privacy">Privacy Policy</Link>
        </nav>
      </header>
      <main className="legal mx-auto w-full max-w-[760px] px-6 pb-20 pt-10 md:px-10">
        <h1 className="m-0 font-serif text-5xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted">Last updated: {SITE.policyDate}</p>
        {children}
      </main>
    </div>
  );
}
