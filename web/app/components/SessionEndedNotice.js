"use client";

// On the sign-in page: "your session ended" - shown once, after lib/api.js
// sent the user here because the login was no longer valid.
import { useEffect, useState } from "react";

export default function SessionEndedNotice() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      if (sessionStorage.getItem("bb-session-ended")) {
        sessionStorage.removeItem("bb-session-ended");
        setShow(true); // eslint-disable-line react-hooks/set-state-in-effect
      }
    } catch {}
  }, []);
  if (!show) return null;
  return (
    <p role="status" className="m-0 rounded-xl border border-line-strong bg-cream px-4 py-3 text-sm text-ink-soft">
      Your session ended – please sign in again. Your ratings and shelf are saved.
    </p>
  );
}
