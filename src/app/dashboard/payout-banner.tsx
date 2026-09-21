"use client";

import { useState } from "react";
import type { Requirements } from "@/lib/connect-requirements";

/**
 * Payout status and the way into Stripe, per the spec's top banner.
 *
 * THE RULE THIS SCREEN LEARNED THE HARD WAY
 *
 * Do not report an account as unfinished because Stripe has outstanding
 * requirements. Most of them are `eventually_due`: the account is active,
 * bookings work, money moves, and Stripe will ask later.
 *
 * The client finished onboarding on a live account whose transfers AND payouts
 * were both active, and this dashboard told him "Stripe has everything it
 * needs: Not yet". He read that as being sent back through verification, which
 * is exactly the drop-off the onboarding flow is designed to avoid. The status
 * shown now comes from whether anything actually BLOCKS the account.
 */
export default function PayoutBanner({
  transfersStatus,
  payoutsStatus,
  requirements,
  country,
  bankName,
  last4,
  hasAccount,
}: {
  transfersStatus: string | null;
  payoutsStatus: string | null;
  requirements: Requirements;
  country: string | null;
  bankName: string | null;
  last4: string | null;
  hasAccount: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canBeBooked = transfersStatus === "active";
  const canBePaidOut = payoutsStatus === "active";
  const blocked = requirements.blocking.length > 0;
  const allGood = canBeBooked && canBePaidOut && !blocked;

  async function open(path: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      setError(data.error ?? "Could not open Stripe.");
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
    <section
      className={`rounded-xl border p-6 ${
        blocked
          ? "border-[var(--warn)]/40 bg-[var(--warn)]/5"
          : "border-[var(--border)] bg-[var(--surface)]"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-[var(--muted)]">
            STRIPE PAYOUT STATUS
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span
              aria-hidden
              className={`h-2 w-2 rounded-full ${
                allGood ? "bg-[var(--accent)]" : "bg-[var(--warn)]"
              }`}
            />
            <span
              className={`font-semibold ${allGood ? "text-[var(--accent)]" : "text-[var(--warn)]"}`}
            >
              {allGood
                ? "ACTIVE"
                : blocked
                  ? "ACTION NEEDED"
                  : (transfersStatus ?? "NOT STARTED").toUpperCase()}
            </span>
          </div>

          <p className="mt-2 text-sm text-[var(--muted)]">
            Payout account: <span className="text-[var(--foreground)]">{destination}</span>
          </p>

          {allGood && (
            <p className="mt-2 text-sm text-[var(--muted)]">
              You are fully set up. Bookings are open and payouts are running.
            </p>
          )}

          {/* Active for bookings, but the bank leg is not live yet. */}
          {canBeBooked && !canBePaidOut && !blocked && (
            <p className="mt-2 max-w-md text-xs text-[var(--muted)]">
              You can take bookings and you are earning. Stripe is still
              enabling payouts to your bank; nothing is blocked on LEER&apos;s
              side and you do not need to do anything.
            </p>
          )}

          {blocked && (
            <div className="mt-3 max-w-md">
              <p className="text-sm text-[var(--warn)]">
                Stripe needs this before your account can go further:
              </p>
              <ul className="mt-1.5 list-disc pl-5 text-sm text-[var(--foreground)]">
                {requirements.blocking.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {/*
            Upcoming items are shown quietly and only when nothing is blocking,
            so they read as "later" rather than as a problem. This is the exact
            line that used to say "Not yet" and send people back round the loop.
          */}
          {!blocked && requirements.upcoming.length > 0 && (
            <div className="mt-3 max-w-md">
              <p className="text-xs text-[var(--muted)]">
                Nothing to do right now. Stripe will ask for these later on, and
                you can add {requirements.upcoming.length > 1 ? "them" : "it"}{" "}
                any time from your Stripe dashboard:
              </p>
              {/* A list, not a lowercased inline sentence - "SSN" is an
                  acronym and reads as a typo when folded to "ssn". */}
              <ul className="mt-1 list-disc pl-5 text-xs text-[var(--muted)]">
                {requirements.upcoming.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {hasAccount && (
          <div className="text-right">
            <button
              onClick={() => open(blocked ? "/api/connect/onboard" : "/api/connect/dashboard")}
              disabled={busy}
              className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition disabled:bg-[var(--surface-2)] disabled:text-[var(--muted)] ${
                blocked
                  ? "bg-[var(--accent)] text-[var(--on-accent)] hover:brightness-110"
                  : "border border-[var(--border)] hover:border-[var(--muted)]"
              }`}
            >
              {busy
                ? "Opening..."
                : blocked
                  ? "Finish verification"
                  : "Manage Stripe Express dashboard"}
            </button>
            {error && <p className="mt-2 max-w-xs text-xs text-[var(--warn)]">{error}</p>}
          </div>
        )}
      </div>
    </section>
  );
}
