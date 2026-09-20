"use client";

import { useState } from "react";

/**
 * Payout status and the way into Stripe, per the spec's top banner.
 *
 * The status shown is `stripe_transfers`, because that is the one that decides
 * whether this trainer can be booked at all. `payouts` is shown alongside it
 * rather than merged in: a trainer can be perfectly able to earn into their
 * Stripe balance while their bank details are still being verified, and
 * collapsing the two into one light would make a working account look broken.
 */
export default function PayoutBanner({
  transfersStatus,
  payoutsBlocked,
  country,
  bankName,
  last4,
  hasAccount,
}: {
  transfersStatus: string | null;
  payoutsBlocked: boolean;
  country: string | null;
  bankName: string | null;
  last4: string | null;
  hasAccount: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = transfersStatus === "active";

  async function openStripe() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/connect/dashboard", { method: "POST" });
      const data = (await res.json()) as { url?: string; error?: string };
      if (res.ok && data.url) {
        window.open(data.url, "_blank", "noopener,noreferrer");
      } else {
        setError(data.error ?? "Could not open Stripe.");
      }
    } catch {
      setError("Network error. Please try again.");
    }
    setBusy(false);
  }

  const destination = last4
    ? `${country ?? ""} ${bankName ? `${bankName} ` : ""}(**** ${last4})`.trim()
    : country
      ? `${country} - no bank account added yet`
      : "Not set up yet";

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-[var(--muted)]">
            STRIPE PAYOUT STATUS
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span
              aria-hidden
              className={`h-2 w-2 rounded-full ${
                active ? "bg-[var(--accent)]" : "bg-[var(--warn)]"
              }`}
            />
            <span className={`font-semibold ${active ? "text-[var(--accent)]" : "text-[var(--warn)]"}`}>
              {active ? "ACTIVE" : (transfersStatus ?? "NOT STARTED").toUpperCase()}
            </span>
          </div>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Payout account: <span className="text-[var(--foreground)]">{destination}</span>
          </p>
          {active && payoutsBlocked && (
            <p className="mt-2 max-w-md text-xs text-[var(--warn)]">
              You can be booked and you are earning, but Stripe is still
              verifying your bank details before it will pay out. Nothing is
              blocked on LEER&apos;s side.
            </p>
          )}
        </div>

        {hasAccount && (
          <div className="text-right">
            <button
              onClick={openStripe}
              disabled={busy}
              className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-semibold transition hover:border-[var(--muted)] disabled:opacity-50"
            >
              {busy ? "Opening..." : "Manage Stripe Express dashboard"}
            </button>
            {error && (
              <p className="mt-2 max-w-xs text-xs text-[var(--warn)]">{error}</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
