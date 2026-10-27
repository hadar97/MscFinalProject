"use client";

// Hidden "next" field for the sign-in form: the page to return to after signing in (?next=...).
import { useSearchParams } from "next/navigation";

export default function NextField() {
  const next = useSearchParams().get("next");
  return next ? <input type="hidden" name="next" value={next} /> : null;
}
