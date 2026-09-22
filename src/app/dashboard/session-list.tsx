import Link from "next/link";
import type { RoomStatus } from "@/lib/escrow";

export type SessionRow = {
  publicId: string;
  /** The other person in the room, from the viewer's side. */
  counterparty: string;
  role: "trainee" | "trainer";
  status: RoomStatus;
  statusLabel: string;
  priceCents: number;
  yourShareCents: number;
  currency: string;
  createdAt: string;
};

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

const TONE: Record<string, string> = {
  released: "bg-[var(--accent)]/15 text-[var(--accent)]",
  refunded: "bg-[var(--warn)]/15 text-[var(--warn)]",
  cancelled: "bg-[var(--warn)]/15 text-[var(--warn)]",
  disputed: "bg-[var(--warn)]/15 text-[var(--warn)]",
};

/**
 * Every room the viewer is part of, in either role, in any state.
 *
 * WHY THIS EXISTS, and why it is not a "history feature"
 *
 * A trainee had no list of their bookings anywhere. The coach's queue is
 * filtered to `trainerId`, so somebody who booked a pass, closed the tab and
 * came back to the dashboard saw nothing at all - no sign they had ever paid.
 * Their only route back to the room they bought was browser history or the
 * Stripe receipt email.
 *
 * That is a hole in the booking flow rather than a missing feature: a buyer
 * who cannot find what they bought is broken. Closed rooms are included for
 * the same reason - a released or refunded session used to vanish, which is
 * exactly when somebody wants to go back and check what happened.
 */
export default function SessionList({ sessions }: { sessions: SessionRow[] }) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <h2 className="text-xs font-semibold tracking-[0.2em] text-[var(--muted)]">
        YOUR SESSIONS
      </h2>

      {sessions.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--muted)]">
          Nothing yet. Sessions you book, and sessions booked with you, both
          show up here.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {sessions.map((s) => (
            <li key={s.publicId}>
              <Link
                href={`/coaching/${s.publicId}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 transition hover:border-[var(--muted)]"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {s.role === "trainee" ? "Coaching from " : "Coaching for "}
                    {s.counterparty}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    {new Date(s.createdAt).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                    {" · "}
                    {/* The trainee sees what they paid; the coach sees what
                        they earn. Showing a coach the gross would have them
                        expecting 100% of it. */}
                    {s.role === "trainee"
                      ? money(s.priceCents, s.currency)
                      : `${money(s.yourShareCents, s.currency)} to you`}
                  </p>
                </div>

                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                    TONE[s.status] ?? "bg-[var(--surface)] text-[var(--muted)]"
                  }`}
                >
                  {s.statusLabel}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
