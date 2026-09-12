"use client";

import { useState } from "react";

export default function OnboardButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/connect/onboard", { method: "POST" });
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

  return (
    <div className="mt-5">
      <button
        onClick={start}
        disabled={busy}
        className="rounded-lg bg-[var(--accent)] px-5 py-2.5 font-semibold text-[#06240f] transition hover:brightness-110 disabled:opacity-50"
      >
        {busy ? "Opening Stripe..." : "Connect Stripe and become a Trainer"}
      </button>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </div>
  );
}
