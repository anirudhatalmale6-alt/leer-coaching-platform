"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * DEV MODE control panel for the role elevation rules.
 *
 * Each button feeds a different Stripe account state through the real
 * applyConnectStatus(). The middle one is the case that matters: Stripe says
 * the form is done but the account is still being verified, and LEER correctly
 * refuses to elevate - because a trainer who can take a booking but cannot be
 * paid is the worst state this platform can produce.
 */
export default function DevConnect() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function send(label: string, body: Record<string, boolean>) {
    setBusy(label);
    await fetch("/api/dev/simulate-connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    router.refresh();
    setBusy(null);
  }

  const cases: { label: string; body: Record<string, boolean> }[] = [
    {
      label: "Fully onboarded",
      body: { detailsSubmitted: true, transfersActive: true, payoutsEnabled: true },
    },
    {
      label: "Form done, still verifying",
      body: { detailsSubmitted: true, transfersActive: false, payoutsEnabled: false },
    },
    {
      label: "Abandoned halfway",
      body: { detailsSubmitted: false, transfersActive: false, payoutsEnabled: false },
    },
  ];

  return (
    <div className="mt-6 rounded-lg border border-dashed border-[var(--border)] p-4">
      <p className="text-xs font-semibold tracking-widest text-[var(--muted)]">
        DEV MODE - SIMULATED STRIPE STATES
      </p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Runs the real role-elevation code against a fake account status. Proves
        the rules, not Stripe itself. Disabled in production.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {cases.map((c) => (
          <button
            key={c.label}
            onClick={() => send(c.label, c.body)}
            disabled={busy !== null}
            className="rounded-md bg-[var(--surface-2)] px-3 py-1.5 text-xs font-semibold transition hover:bg-[var(--border)] disabled:opacity-50"
          >
            {busy === c.label ? "..." : c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
