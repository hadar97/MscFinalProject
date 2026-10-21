"use client";

// "My account" - the first page that talks to the BookBridge API with the
// login token: shows the profile from GET /api/me. If this works, the whole
// chain works: website -> Neon Auth -> token -> API -> database.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { api, clearToken } from "@/lib/api";
import AppShell from "@/components/AppShell";

export default function AccountPage() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api("/api/me").then(setMe).catch((e) => setError(e.message));
  }, []);

  async function signOut() {
    await authClient.signOut();
    clearToken();
    router.push("/");
    router.refresh();
  }

  return (
    <AppShell width="max-w-[720px]">
      <div className="flex items-center justify-between">
        <h1 className="m-0 font-serif text-5xl font-semibold">My account</h1>
        <button onClick={signOut} className="btn btn-outline px-4 py-2 text-sm">Sign out</button>
      </div>
      {error && <p className="mt-6 text-rust-dark">Could not load your profile: {error}</p>}
      {!me && !error && <p className="mt-6 text-muted">Loading...</p>}
      {me && (
        <dl className="card mt-6 grid grid-cols-[10rem_1fr] gap-y-3 p-6 text-[15px]">
          <dt className="text-muted">Name</dt><dd>{me.name}</dd>
          <dt className="text-muted">Email</dt><dd>{me.email}</dd>
          <dt className="text-muted">Account type</dt><dd>{me.userType}</dd>
          <dt className="text-muted">Questionnaire</dt><dd>{me.onboarded ? "Done" : "Not yet"}</dd>
          <dt className="text-muted">Genres</dt><dd>{me.genres.join(", ") || "-"}</dd>
          <dt className="text-muted">Books rated</dt><dd>{me.ratingsCount}</dd>
        </dl>
      )}
    </AppShell>
  );
}
