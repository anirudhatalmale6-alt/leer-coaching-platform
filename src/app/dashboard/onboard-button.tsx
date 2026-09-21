"use client";

import { useState } from "react";
import { SUPPORTED_COUNTRIES } from "@/lib/connect";

/**
 * `resume` is for a trainer who already has a Stripe account and is coming
 * back to finish. They must not be asked for their country again - Stripe
 * fixed it at account creation and it cannot be changed, so the picker would
 * be a pointless extra field at exactly the moment we are trying to remove
 * friction. The server uses the stored country for an existing account.
 */
export default function OnboardButton({ resume = false }: { resume?: boolean }) {
  const [country, setCountry] = useState("US");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/connect/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ country }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (res.ok && data.url) {
        // Full navigation, not a router push - this leaves the app for Stripe.
        window.location.href = data.url;
        return;
      }
      setError(data.error ?? "Could not start onboarding.");
    } catch {
      setError("Network error. Please try again.");
    }
    setBusy(false);
  }

  if (resume) {
    return (
      <div className="mt-5">
        <button
          onClick={start}
          disabled={busy}
          className="rounded-lg bg-[var(--accent)] px-5 py-2.5 font-semibold text-[var(--on-accent)] transition hover:brightness-110 disabled:bg-[var(--surface-2)] disabled:text-[var(--muted)]"
        >
          {busy ? "Opening Stripe..." : "Continue with Stripe"}
        </button>
        {error && <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mt-5">
      <label className="block text-xs font-semibold tracking-wide text-[var(--muted)]">
        WHERE IS YOUR BANK ACCOUNT?
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          disabled={busy}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
        >
          {SUPPORTED_COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>

        <button
          onClick={start}
          disabled={busy}
          className="rounded-lg bg-[var(--accent)] px-5 py-2.5 font-semibold text-[var(--on-accent)] transition hover:brightness-110 disabled:bg-[var(--surface-2)] disabled:text-[var(--muted)]"
        >
          {busy ? "Opening Stripe..." : "Connect Stripe and become a Trainer"}
        </button>
      </div>
      <p className="mt-2 text-xs text-[var(--muted)]">
        Stripe fixes this when the account is created and it cannot easily be
        changed later, so pick the country your payouts should land in.
      </p>
      {error && <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>}
    </div>
  );
}
