// The consent checkboxes - on the sign-up form and on /consent.
// age16 and terms are required (the browser will not submit without them, and
// the server checks again); research is optional.
import Link from "next/link";
import { SITE } from "@/lib/site";

export default function ConsentChecks({ defaultResearch = false }) {
  const box = "mt-1 h-4 w-4 flex-none accent-[var(--color-rust)]";
  return (
    <fieldset className="m-0 flex flex-col gap-3 border-0 p-0 text-sm text-ink-soft">
      <legend className="sr-only">Agreements</legend>
      <label className="flex items-start gap-2.5">
        <input type="checkbox" name="age16" required className={box} />
        <span>I am {SITE.minAge} or older.</span>
      </label>
      <label className="flex items-start gap-2.5">
        <input type="checkbox" name="terms" required className={box} />
        <span>
          I agree to the <Link href="/terms" target="_blank">Terms of Use</Link> and the{" "}
          <Link href="/privacy" target="_blank">Privacy Policy</Link>.
        </span>
      </label>
      <label className="flex items-start gap-2.5">
        <input type="checkbox" name="research" defaultChecked={defaultResearch} className={box} />
        <span>
          <span className="text-ink">Optional:</span> my ratings may be used, anonymized, in academic research on book
          recommendations. You can change this anytime in your account.
        </span>
      </label>
    </fieldset>
  );
}
