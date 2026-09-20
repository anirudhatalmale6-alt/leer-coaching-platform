"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Rendered only when LEER_DEV_LOGIN=1 outside production. Lets the platform be
 * clicked through before Google OAuth credentials exist.
 */
export default function DevSignIn({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("trainer@example.com");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/dev/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (res.ok) {
      router.push(next);
      router.refresh();
    } else {
      setError("Dev sign-in failed");
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 rounded-lg border border-dashed border-[var(--border)] p-4">
      <p className="text-xs font-semibold tracking-widest text-[var(--muted)]">
        DEV MODE
      </p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Stands in for Google OAuth until credentials are issued. Disabled in
        production.
      </p>
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="mt-3 w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
        placeholder="you@example.com"
      />
      <button
        onClick={go}
        disabled={busy}
        className="mt-3 w-full rounded-md bg-[var(--surface-2)] px-4 py-2 text-sm font-semibold transition hover:bg-[var(--border)] disabled:opacity-50"
      >
        {busy ? "Signing in..." : "Dev sign in"}
      </button>
      {error && <p className="mt-2 text-xs text-[var(--danger)]">{error}</p>}
    </div>
  );
}
