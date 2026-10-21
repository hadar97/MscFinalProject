"use client";

// Landing page (public)
import Link from "next/link";
import { authClient } from "@/lib/auth/client";
import Logo from "@/components/Logo";
import Leaf from "@/components/Leaf";

const COVERS = [
  { title: "The Night Circus", author: "Erin Morgenstern", bg: "#7A3B22", w: 150, rot: -6 },
  { title: "The Name of the Wind", author: "Patrick Rothfuss", bg: "#3F4A26", w: 180, rot: 0 },
  { title: "Rebecca", author: "Daphne du Maurier", bg: "#8C6A2F", w: 150, rot: 6 },
];
const STEPS = [
  { n: "01", title: "Pick 3–5 genres", body: "Fantasy, mystery, memoir – whatever you reach for first." },
  { n: "02", title: "Rate a few books", body: "Twenty well-known titles. Skip the ones you have not read." },
  { n: "03", title: "Get ten picks", body: "Right away, with a reason for each – and sharper as you rate." },
];

export default function Home() {
  const { data: session } = authClient.useSession();
  const signedIn = Boolean(session?.user);
  return (
    <div className="min-h-full">
      <header className="flex flex-wrap items-center justify-between gap-6 border-b border-line px-6 py-5 md:px-12">
        <Logo />
        <nav aria-label="Main" className="flex flex-wrap items-center gap-3">
          {signedIn ? (
            <Link href="/for-you" className="btn btn-dark">Go to your picks</Link>
          ) : (
            <>
              <Link href="/auth/sign-in" className="px-4 py-2.5 font-medium text-ink no-underline">Sign in</Link>
              <Link href="/auth/sign-up" className="btn btn-dark">Create account</Link>
            </>
          )}
        </nav>
      </header>

      <section className="relative mx-auto flex max-w-[1280px] flex-wrap items-center gap-14 overflow-hidden px-6 py-20 md:px-12">
        <Leaf size={120} color="#B8893B" vein={null} className="absolute right-[44%] top-9 rotate-[-28deg] opacity-20" />
        <Leaf size={70} color="#556030" vein={null} className="absolute bottom-10 left-8 rotate-[40deg] opacity-25" />
        <div className="relative flex flex-[1_1_460px] flex-col gap-6">
          <span className="eyebrow">Your reading companion</span>
          <h1 className="m-0 font-serif text-5xl font-semibold leading-[1.02] md:text-[68px]">
            Find the book that feels written for <em className="font-medium text-rust">you</em>.
          </h1>
          <p className="m-0 max-w-[520px] text-[19px] leading-relaxed text-ink-soft">
            Tell us what you love. BookBridge learns your taste from readers like you, shows why each book was picked, and where you can borrow it nearby.
          </p>
          <div className="flex flex-wrap gap-3.5">
            <Link href={signedIn ? "/onboarding/genres" : "/auth/sign-up"} className="btn btn-primary">Start the 2-minute quiz</Link>
            {!signedIn && <Link href="/auth/sign-in" className="btn btn-outline">I have an account</Link>}
          </div>
        </div>
        <div className="relative flex min-h-[440px] flex-[1_1_440px] justify-center">
          <div className="absolute top-8 h-[380px] w-[380px] rounded-full bg-sand" />
          <div className="relative flex items-end gap-4 pt-10">
            {COVERS.map((c) => (
              <div key={c.title} className="flex aspect-[2/3] flex-col justify-between rounded-md p-4 text-[#FBF4E8] shadow-[0_18px_40px_rgba(43,33,28,0.22)]" style={{ width: c.w, background: c.bg, transform: `rotate(${c.rot}deg)` }}>
                <span className="font-serif text-2xl font-semibold leading-tight">{c.title}</span>
                <span className="text-xs uppercase tracking-wider opacity-85">{c.author}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-line bg-cream">
        <div className="mx-auto grid max-w-[1280px] gap-10 px-6 py-20 md:grid-cols-3 md:px-12">
          <Feature title="Picked for your taste" color="#A24B25" icon={<path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM8 7h7M8 11h5" />}>
            Readers with taste like yours, books like the ones you love, and favourites in your genres – blended into ten picks, each with its reason.
          </Feature>
          <Feature title="On a shelf near you" color="#556030" icon={<><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>}>
            Turn on “near me” to see which picks are waiting at a library close by – Jerusalem and Tel Aviv-Yafo for now.
          </Feature>
          <Feature title="Just ask" color="#B8893B" icon={<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />}>
            “Something like Dune, but shorter.” Describe the book you want and refine it in conversation – only real books from our catalog.
          </Feature>
        </div>
      </section>

      <section className="mx-auto flex max-w-[1280px] flex-col gap-10 px-6 py-20 md:px-12">
        <h2 className="m-0 text-center font-serif text-[44px] font-semibold">How it works</h2>
        <div className="grid gap-7 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="card flex flex-col gap-3 rounded-[18px] p-8">
              <span className="font-serif text-5xl font-semibold leading-none text-rust">{s.n}</span>
              <h3 className="m-0 text-[19px] font-bold">{s.title}</h3>
              <p className="m-0 leading-relaxed text-ink-soft">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-ink text-parchment">
        <div className="mx-auto flex max-w-[980px] flex-col items-center gap-5 px-6 py-20 text-center md:px-12">
          <Leaf size={44} color="#C9874E" vein={null} />
          <p className="m-0 font-serif text-4xl italic leading-tight">
            In tests with 2,000 readers, more than a quarter of our top-ten picks were books they went on to love.
          </p>
          <span className="text-sm text-[#D9C9B4]">Offline evaluation on the goodbooks-10k dataset · Precision@10 = 27%</span>
          <Link href={signedIn ? "/for-you" : "/auth/sign-up"} className="btn mt-3 bg-parchment text-ink hover:bg-cream hover:text-ink">Find my next book</Link>
        </div>
      </section>

      <footer className="mx-auto flex max-w-[1280px] flex-wrap justify-between gap-4 px-6 py-8 text-sm text-muted md:px-12">
        <span>BookBridge · MSc graduation project</span>
        <span>Library availability is simulated for the demo</span>
      </footer>
    </div>
  );
}

function Feature({ title, color, icon, children }) {
  return (
    <div className="flex flex-col gap-3.5">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" aria-hidden="true">{icon}</svg>
      <h2 className="m-0 font-serif text-3xl font-semibold">{title}</h2>
      <p className="m-0 leading-relaxed text-ink-soft">{children}</p>
    </div>
  );
}
