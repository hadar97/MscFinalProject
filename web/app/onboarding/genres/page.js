"use client";

// Questionnaire, step 1: choose 3-5 genres (the list comes from the API)
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import OnboardingHeader from "@/components/OnboardingHeader";
import Leaf from "@/components/Leaf";
import { CheckIcon } from "@/components/Icons";
import { api } from "@/lib/api";
import { saveGenres, loadGenres } from "@/lib/onboarding-state";

export default function GenresPage() {
  const router = useRouter();
  const [step, setStep] = useState(null);
  const [picked, setPicked] = useState(() => loadGenres());
  const [error, setError] = useState(null);

  useEffect(() => {
    api("/api/onboarding/questionnaire", { auth: false })
      .then((q) => setStep(q.steps.find((s) => s.id === "genres")))
      .catch((e) => setError(e.message));
    // start from the saved genres (back from step 2), else from the profile
    if (!loadGenres().length) api("/api/me").then((me) => me.genres?.length && setPicked(me.genres)).catch(() => {});
  }, []);

  const min = step?.min ?? 3;
  const max = step?.max ?? 5;
  const toggle = (key) =>
    setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : p.length >= max ? p : [...p, key]));
  const ready = picked.length >= min && picked.length <= max;

  function next() {
    saveGenres(picked);
    router.push("/onboarding/rate");
  }

  return (
    <div className="relative min-h-full overflow-hidden">
      <Leaf size={180} color="#A24B25" vein={null} className="absolute -right-8 top-24 rotate-[30deg] opacity-15" />
      <OnboardingHeader step={1} />
      <main className="relative mx-auto flex max-w-[980px] flex-col gap-8 px-6 pb-16 pt-8 md:px-8">
        <div className="flex flex-col items-center gap-2.5 text-center">
          <h1 className="m-0 font-serif text-5xl font-semibold md:text-[52px]">What do you like to read?</h1>
          <p className="m-0 text-lg text-ink-soft">Choose {min} to {max} genres – we will start your shelf from here.</p>
        </div>
        {error && <p role="alert" className="text-rust-dark">Could not load the genres: {error}</p>}
        {step?.groups.map((g) => (
          <section key={g.id} className="flex flex-col gap-3.5">
            <h2 className="m-0 text-[13px] font-bold uppercase tracking-[0.15em] text-muted">{g.title}</h2>
            <div className="flex flex-wrap gap-2.5">
              {step.options.filter((o) => o.group === g.id).map((o) => {
                const on = picked.includes(o.value);
                return (
                  <button key={o.value} type="button" aria-pressed={on} onClick={() => toggle(o.value)}
                    className={`flex cursor-pointer items-center gap-2 rounded-full border px-[18px] py-[11px] text-[15px] ${on ? "border-rust bg-rust text-cream" : "border-line-strong bg-cream text-ink hover:border-ink"}`}>
                    {on && <CheckIcon />}{o.label}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
          <span className="text-[15px] text-ink-soft" aria-live="polite">
            {picked.length} of {max} selected{picked.length < min ? ` – choose at least ${min - picked.length} more` : ""}
          </span>
          <button type="button" onClick={next} disabled={!ready} className="btn btn-primary">Continue</button>
        </div>
      </main>
    </div>
  );
}
