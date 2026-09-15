"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AnalysisCanvas from "@/components/canvas/AnalysisCanvas";
import type { RoomStatus } from "@/lib/escrow";

type Props = {
  publicId: string;
  status: RoomStatus;
  statusLabel: string;
  isTrainer: boolean;
  trainerName: string;
  traineeName: string;
  priceCents: number;
  trainerShare: number;
  platformFee: number;
  currency: string;
  videoUrl: string | null;
  deliverDueAt: string | null;
  annotations: string | null;
};

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

/** Live countdown to the trainer's 24 hour deadline. */
function useCountdown(deadlineIso: string | null) {
  const [now, setNow] = useState<number | null>(null);

  // Starts as null and is filled in by an effect: rendering a clock during SSR
  // guarantees a hydration mismatch, because the server and the browser are
  // never on the same millisecond.
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  return useMemo(() => {
    if (!deadlineIso || now === null) return null;
    const remaining = new Date(deadlineIso).getTime() - now;
    if (remaining <= 0) return "overdue";
    const h = Math.floor(remaining / 3_600_000);
    const m = Math.floor((remaining % 3_600_000) / 60_000);
    const s = Math.floor((remaining % 60_000) / 1000);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, [deadlineIso, now]);
}

export default function RoomView(props: Props) {
  const [status, setStatus] = useState<RoomStatus>(props.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const countdown = useCountdown(props.deliverDueAt);

  const act = useCallback(
    async (what: "deliver" | "approve") => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/rooms/${props.publicId}/${what}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(what === "deliver" ? { annotations: "[]" } : {}),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "That did not work.");
        setStatus(data.status as RoomStatus);
      } catch (err) {
        setError((err as Error).message);
      }
      setBusy(false);
    },
    [props.publicId],
  );

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.3em] text-[var(--muted)]">
              COACHING ROOM
            </p>
            <h1 className="mt-2 text-2xl font-semibold">
              {props.isTrainer ? props.traineeName : props.trainerName}
            </h1>
            <p className="mt-1 font-mono text-xs text-[var(--muted)]">
              /coaching/{props.publicId}
            </p>
          </div>

          <div className="text-right">
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                status === "released"
                  ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                  : status === "refunded" || status === "cancelled"
                    ? "bg-[var(--warn)]/15 text-[var(--warn)]"
                    : "bg-[var(--surface-2)] text-[var(--muted)]"
              }`}
            >
              {status === props.status ? props.statusLabel : status.replace("_", " ")}
            </span>
            <p className="mt-2 text-sm">
              {money(props.priceCents, props.currency)}
            </p>
            <p className="text-xs text-[var(--muted)]">
              coach {money(props.trainerShare, props.currency)} · LEER{" "}
              {money(props.platformFee, props.currency)}
            </p>
          </div>
        </div>

        {status === "awaiting_delivery" && (
          <div
            className={`mt-6 rounded-lg border p-4 text-sm ${
              countdown === "overdue"
                ? "border-[var(--warn)]/40 bg-[var(--warn)]/10 text-[var(--warn)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]"
            }`}
          >
            {countdown === "overdue" ? (
              <>Past the 24 hour deadline. The payment will be released back automatically.</>
            ) : (
              <>
                {props.isTrainer ? "You have " : "Your coach has "}
                <span className="font-mono text-[var(--foreground)]">
                  {countdown ?? "--:--:--"}
                </span>{" "}
                left to deliver. If the deadline passes, the payment is cancelled
                automatically and{" "}
                {props.isTrainer ? "the trainee" : "you"} are never charged.
              </>
            )}
          </div>
        )}

        {status === "released" && (
          <div className="mt-6 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-4 text-sm text-[var(--accent)]">
            Approved. {money(props.trainerShare, props.currency)} has been transferred
            to the coach.
          </div>
        )}

        {status === "refunded" && (
          <div className="mt-6 rounded-lg border border-[var(--warn)]/40 bg-[var(--warn)]/10 p-4 text-sm text-[var(--warn)]">
            The coach did not deliver in time. The authorisation was cancelled -
            the trainee was never charged, so there is nothing to refund.
          </div>
        )}

        <div className="mt-8">
          {props.videoUrl ? (
            <AnalysisCanvas
              primary={{ id: "a", url: props.videoUrl, label: "Session" }}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-[var(--border)] p-10 text-center text-sm text-[var(--muted)]">
              The clip could not be loaded.
            </div>
          )}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {props.isTrainer && status === "awaiting_delivery" && (
            <button
              onClick={() => act("deliver")}
              disabled={busy}
              className="rounded-lg bg-[var(--accent)] px-5 py-2.5 font-semibold text-[#06240f] transition hover:brightness-110 disabled:opacity-50"
            >
              {busy ? "Submitting..." : "Submit feedback"}
            </button>
          )}

          {!props.isTrainer && status === "delivered" && (
            <button
              onClick={() => act("approve")}
              disabled={busy}
              className="rounded-lg bg-[var(--accent)] px-5 py-2.5 font-semibold text-[#06240f] transition hover:brightness-110 disabled:opacity-50"
            >
              {busy ? "Releasing..." : "Approve and pay the coach"}
            </button>
          )}

          {props.isTrainer && status === "delivered" && (
            <p className="text-sm text-[var(--muted)]">
              Delivered. Waiting for {props.traineeName} to approve.
            </p>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
      </div>
    </main>
  );
}
