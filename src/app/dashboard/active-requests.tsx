"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

export type ActiveRequest = {
  publicId: string;
  traineeName: string;
  status: string;
  priceCents: number;
  currency: string;
  deliverDueAt: string | null;
};

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

/**
 * Time left on the 24 hour clock.
 *
 * Starts as null and is filled in by an effect. Rendering a countdown during
 * SSR guarantees a hydration mismatch - the server and the browser are never
 * on the same millisecond - and React replaces the whole subtree when that
 * happens.
 */
function useNow() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function Remaining({ deadline, now }: { deadline: string | null; now: number | null }) {
  const label = useMemo(() => {
    if (!deadline || now === null) return null;
    const left = new Date(deadline).getTime() - now;
    if (left <= 0) return "overdue";
    const h = Math.floor(left / 3_600_000);
    const m = Math.floor((left % 3_600_000) / 60_000);
    return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
  }, [deadline, now]);

  if (!label) return <span className="text-xs text-[var(--muted)]">&nbsp;</span>;

  // Under three hours is where a coach needs to feel the pressure.
  const urgent =
    label === "overdue" ||
    (deadline !== null && now !== null && new Date(deadline).getTime() - now < 3 * 3_600_000);

  return (
    <span className={`text-xs font-semibold ${urgent ? "text-[var(--warn)]" : "text-[var(--muted)]"}`}>
      {label === "overdue" ? "Past the 24h deadline" : label}
    </span>
  );
}

/**
 * The coach's queue: every room with money in escrow waiting on them.
 *
 * This is the one screen where being late costs the trainer real money - a
 * missed 24 hour window cancels the authorisation and they earn nothing for a
 * booking they already had - so the countdown is the loudest thing in the row.
 */
export default function ActiveRequests({ requests }: { requests: ActiveRequest[] }) {
  const now = useNow();

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <h2 className="text-xs font-semibold tracking-[0.2em] text-[var(--muted)]">
        ACTIVE COACHING REQUESTS
      </h2>

      {requests.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--muted)]">
          Nothing waiting on you. New bookings from your public page appear here.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {requests.map((r) => (
            <li
              key={r.publicId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3"
            >
              <div>
                <p className="text-sm font-semibold">{r.traineeName}</p>
                <p className="mt-0.5 flex items-center gap-2">
                  <span className="text-xs text-[var(--muted)]">
                    {money(r.priceCents, r.currency)}
                  </span>
                  <span className="text-xs text-[var(--muted)]">&middot;</span>
                  {r.status === "awaiting_delivery" ? (
                    <Remaining deadline={r.deliverDueAt} now={now} />
                  ) : (
                    <span className="text-xs text-[var(--muted)]">
                      Delivered - waiting for the trainee to approve
                    </span>
                  )}
                </p>
              </div>

              <Link
                href={`/coaching/${r.publicId}`}
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--on-accent)] transition hover:brightness-110"
              >
                Open coaching room
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
