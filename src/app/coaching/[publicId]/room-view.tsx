"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AnalysisCanvas from "@/components/canvas/AnalysisCanvas";
import {
  parseAnnotations,
  serialiseAnnotations,
  type Annotation,
} from "@/lib/canvas/annotations";
import type { RoomStatus } from "@/lib/escrow";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { browserCanPlay } from "@/lib/video/codec";

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
  focusNote: string | null;
  videoCodec: string | null;
  approveDueAt: string | null;
  disputeReason: string | null;
  /** null = no proposal, true = I proposed it, false = the other side did. */
  refundProposedByMe: boolean | null;
  refundReason: string | null;
  closeReason: string | null;
  /** Whether the coach's transfer actually reached Stripe. */
  payoutSent: boolean;
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
  const router = useRouter();
  const [status, setStatus] = useState<RoomStatus>(props.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const countdown = useCountdown(props.deliverDueAt);
  const approvalCountdown = useCountdown(props.approveDueAt);

  /**
   * Will THIS browser decode the clip?
   *
   * Asked here rather than at upload because the answer that matters is the
   * one on the coach's machine. Chrome's HEVC support depends on the hardware
   * decoder, so the same clip opens on one laptop and shows a black rectangle
   * on another - and without this the coach has no way to tell a broken clip
   * from a broken platform.
   *
   * In an effect, not during render: canPlayType needs a DOM, and calling it
   * while rendering guarantees a server/client hydration mismatch.
   */
  /**
   * The coach's marks live here, not inside the canvas.
   *
   * They are seeded from what was delivered so a saved session redraws, and
   * they are what gets sent on delivery. Previously the canvas kept them to
   * itself and the deliver call posted a hardcoded empty list - so the marks
   * never reached the server and the trainee always saw a bare clip.
   */
  const [marks, setMarks] = useState<Annotation[]>(() =>
    parseAnnotations(props.annotations),
  );

  const [panel, setPanel] = useState<"none" | "dispute" | "refund">("none");
  const [note, setNote] = useState("");
  const [codecUnsupported, setCodecUnsupported] = useState(false);
  useEffect(() => {
    if (!props.videoCodec) return;
    const supported = browserCanPlay({
      codec: props.videoCodec as Parameters<typeof browserCanPlay>[0]["codec"],
      fourcc: null,
      risky: false,
    });
    setCodecUnsupported(supported === false);
  }, [props.videoCodec]);

  const post = useCallback(
    async (path: string, body: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/rooms/${props.publicId}/${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "That did not work.");
        if (data.status) setStatus(data.status as RoomStatus);
        setPanel("none");
        setNote("");
        // Re-render the server component so the refund proposal, the dispute
        // reason and the money figures all come from the database rather than
        // from whatever this component happens to be holding.
        router.refresh();
        return true;
      } catch (err) {
        setError((err as Error).message);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [props.publicId, router],
  );

  const act = useCallback(
    (what: "deliver" | "approve") =>
      post(
        what,
        // The coach's actual work, not an empty placeholder.
        what === "deliver" ? { annotations: serialiseAnnotations(marks) } : {},
      ),
    [post, marks],
  );

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            {/* A real way out. Relying on the browser's back button breaks the
                moment somebody arrives from a Stripe redirect or an emailed
                link, where "back" is the payment page or nothing at all. */}
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1 text-xs text-[var(--muted)] transition hover:text-[var(--foreground)]"
            >
              &larr; Back to dashboard
            </Link>
            <p className="mt-2 text-xs font-semibold tracking-[0.3em] text-[var(--muted)]">
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
            {/*
              The 80/20 split is the COACH's business, not the trainee's. A
              trainee is buying a coaching pass for one price; itemising how
              the platform divides it invites "so why am I paying you $100 to
              forward $400" and answers a question nobody asked.
            */}
            {props.isTrainer && (
              <p className="text-xs text-[var(--muted)]">
                you {money(props.trainerShare, props.currency)} &middot; LEER{" "}
                {money(props.platformFee, props.currency)}
              </p>
            )}
          </div>
        </div>

        {/* What the trainee asked the coach to look at. Shown to both, so the
            trainee can see the brief their coach is working to. */}
        {props.focusNote && (
          <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
            <p className="text-xs font-semibold tracking-[0.2em] text-[var(--muted)]">
              {props.isTrainer ? "WHAT THEY ASKED YOU TO LOOK AT" : "WHAT YOU ASKED FOR"}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm">{props.focusNote}</p>
          </div>
        )}

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
          <div
            className={`mt-6 rounded-lg border p-4 text-sm ${
              props.payoutSent
                ? "border-[var(--accent)]/30 bg-[var(--accent)]/5 text-[var(--accent)]"
                : "border-[var(--warn)]/40 bg-[var(--warn)]/10 text-[var(--warn)]"
            }`}
          >
            {/*
              NEVER claim a payout that has not happened.

              This banner used to say "has been transferred" the moment the
              room was approved, whether or not the transfer actually reached
              Stripe. It does not always: captured funds sit in the platform
              balance as PENDING before they are AVAILABLE, and a transfer
              against a balance that has not settled fails. That happened on
              the live account - the coach was told $400 had been sent while
              Stripe had sent nothing.
            */}
            {props.payoutSent ? (
              props.isTrainer ? (
                <>
                  Approved. {money(props.trainerShare, props.currency)} has been
                  transferred to your Stripe account.
                </>
              ) : (
                <>
                  Approved and closed. {props.trainerName} has been paid for
                  this session.
                </>
              )
            ) : props.isTrainer ? (
              <>
                Approved. Your {money(props.trainerShare, props.currency)} is
                queued for payout and will move as soon as the funds settle -
                usually within a day or two. Nothing is needed from you.
              </>
            ) : (
              <>
                Approved and closed. {props.trainerName}&rsquo;s payout is on
                its way.
              </>
            )}
          </div>
        )}

        {status === "refunded" && (
          <div className="mt-6 rounded-lg border border-[var(--warn)]/40 bg-[var(--warn)]/10 p-4 text-sm text-[var(--warn)]">
            {/* Two very different things end as "refunded" and they must not
                share a sentence: a coach who never showed up (nothing was ever
                charged) and a refund both sides agreed to after delivery. */}
            {props.closeReason === "mutual_refund" ? (
              <>
                Both of you agreed to a refund, and the full{" "}
                {money(props.priceCents, props.currency)} has been returned to{" "}
                {props.isTrainer ? props.traineeName : "you"}. It can take a few
                days to appear on the statement.
              </>
            ) : (
              <>
                The coach did not deliver in time. The authorisation was
                cancelled - the trainee was never charged, so there is nothing
                to refund.
              </>
            )}
          </div>
        )}

        {/* The approval clock, and the dispute that stops it. */}
        {status === "delivered" && (
          <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">
            {approvalCountdown === "overdue" ? (
              <>The approval window has passed, so this releases to the coach automatically.</>
            ) : (
              <>
                {props.isTrainer ? props.traineeName + " has " : "You have "}
                <span className="font-mono text-[var(--foreground)]">
                  {approvalCountdown ?? "--:--:--"}
                </span>{" "}
                to approve or raise a problem. After that it releases to the
                coach automatically.
              </>
            )}
          </div>
        )}

        {status === "disputed" && (
          <div className="mt-6 rounded-lg border border-[var(--warn)]/40 bg-[var(--warn)]/10 p-4">
            <p className="text-sm font-semibold text-[var(--warn)]">
              {props.isTrainer
                ? props.traineeName + " has raised a problem"
                : "You raised a problem"}
            </p>
            {props.disputeReason && (
              <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--foreground)]">
                {props.disputeReason}
              </p>
            )}
            <p className="mt-2 text-xs text-[var(--muted)]">
              Nothing is released while this is open - the automatic payout is
              paused. Sort it out between you: the trainee can approve once
              they are happy, or either of you can offer a full refund.
            </p>
          </div>
        )}

        {/* A live refund offer, awaiting the other side. */}
        {props.refundProposedByMe !== null && status !== "refunded" && (
          <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
            <p className="text-sm font-semibold">
              {props.refundProposedByMe
                ? "You have offered a full refund"
                : `${props.isTrainer ? props.traineeName : props.trainerName} has offered a full refund`}
            </p>
            {props.refundReason && (
              <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--muted)]">
                {props.refundReason}
              </p>
            )}
            <p className="mt-2 text-xs text-[var(--muted)]">
              {props.refundProposedByMe
                ? "Waiting for the other person to accept. Nothing has moved yet."
                : `Accepting returns the full ${money(props.priceCents, props.currency)} and closes this room.`}
            </p>

            <div className="mt-3 flex flex-wrap gap-3">
              {props.refundProposedByMe ? (
                <button
                  onClick={() => post("refund", { action: "withdraw" })}
                  disabled={busy}
                  className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm transition hover:border-[var(--muted)] disabled:opacity-50"
                >
                  Withdraw the offer
                </button>
              ) : (
                <button
                  onClick={() => post("refund", { action: "accept" })}
                  disabled={busy}
                  className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--on-accent)] transition hover:brightness-110 disabled:bg-[var(--surface-2)] disabled:text-[var(--muted)]"
                >
                  {busy ? "Refunding..." : "Accept the refund"}
                </button>
              )}
            </div>
          </div>
        )}

        {codecUnsupported && (
          <div className="mt-6 rounded-lg border border-[var(--warn)]/40 bg-[var(--warn)]/10 p-4 text-sm text-[var(--warn)]">
            This clip is {props.videoCodec === "hevc" ? "HEVC (H.265)" : props.videoCodec},
            which this browser cannot decode - the video below will very likely
            be black. Open this page in Safari, or on a Mac or iPhone, and it
            will play. Nothing is wrong with the file or the upload.
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {props.isTrainer && status === "awaiting_delivery" && (
            <button
              onClick={() => act("deliver")}
              disabled={busy}
              className="rounded-lg bg-[var(--accent)] px-5 py-2.5 font-semibold text-[var(--on-accent)] transition hover:brightness-110 disabled:bg-[var(--surface-2)] disabled:text-[var(--muted)]"
            >
              {busy ? "Submitting..." : "Submit feedback"}
            </button>
          )}

          {!props.isTrainer && status === "delivered" && (
            <button
              onClick={() => act("approve")}
              disabled={busy}
              className="rounded-lg bg-[var(--accent)] px-5 py-2.5 font-semibold text-[var(--on-accent)] transition hover:brightness-110 disabled:bg-[var(--surface-2)] disabled:text-[var(--muted)]"
            >
              {busy ? "Releasing..." : "Approve and pay the coach"}
            </button>
          )}

          {/* Approving is also how a dispute ends well: the trainee talks to
              their coach, is satisfied, and releases the money themselves. */}
          {!props.isTrainer && status === "disputed" && (
            <button
              onClick={() => act("approve")}
              disabled={busy}
              className="rounded-lg bg-[var(--accent)] px-5 py-2.5 font-semibold text-[var(--on-accent)] transition hover:brightness-110 disabled:bg-[var(--surface-2)] disabled:text-[var(--muted)]"
            >
              {busy ? "Releasing..." : "It is sorted - pay the coach"}
            </button>
          )}

          {!props.isTrainer && status === "delivered" && (
            <button
              onClick={() => setPanel(panel === "dispute" ? "none" : "dispute")}
              disabled={busy}
              className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm transition hover:border-[var(--muted)] disabled:opacity-50"
            >
              Something is wrong
            </button>
          )}

          {/* Either side may offer a refund, and only while there is money to
              return - once released or refunded there is nothing to offer. */}
          {props.refundProposedByMe === null &&
            ["awaiting_delivery", "delivered", "disputed"].includes(status) && (
              <button
                onClick={() => setPanel(panel === "refund" ? "none" : "refund")}
                disabled={busy}
                className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm text-[var(--muted)] transition hover:border-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-50"
              >
                Offer a full refund
              </button>
            )}

          {props.isTrainer && status === "delivered" && (
            <p className="text-sm text-[var(--muted)]">
              Delivered. Waiting for {props.traineeName} to approve.
            </p>
          )}

          {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
        </div>

        {panel !== "none" && (
          <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
            <p className="text-sm font-semibold">
              {panel === "dispute"
                ? "What was wrong with the feedback?"
                : "Offer a full refund"}
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {panel === "dispute"
                ? "Your coach sees this. Nothing is refunded automatically - it pauses the payout so the two of you can sort it out."
                : `The other person has to accept. If they do, the full ${money(props.priceCents, props.currency)} goes back to ${props.isTrainer ? props.traineeName : "you"} and the room closes.`}
            </p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 500))}
              rows={3}
              autoFocus
              placeholder={
                panel === "dispute"
                  ? "e.g. The analysis is of the wrong lift."
                  : "Optional - a short note about why."
              }
              className="mt-3 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            />
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                onClick={() =>
                  panel === "dispute"
                    ? post("dispute", { reason: note })
                    : post("refund", { action: "propose", reason: note })
                }
                disabled={busy || (panel === "dispute" && !note.trim())}
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--on-accent)] transition hover:brightness-110 disabled:bg-[var(--surface-2)] disabled:text-[var(--muted)]"
              >
                {busy
                  ? "Sending..."
                  : panel === "dispute"
                    ? "Raise the problem"
                    : "Send the offer"}
              </button>
              <button
                onClick={() => {
                  setPanel("none");
                  setNote("");
                }}
                className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--muted)] transition hover:text-[var(--foreground)]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="mt-8">
          {props.videoUrl ? (
            <AnalysisCanvas
              primary={{ id: "a", url: props.videoUrl, label: "Session" }}
              readOnly={!props.isTrainer}
              initialAnnotations={marks}
              onAnnotationsChange={setMarks}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-[var(--border)] p-10 text-center text-sm text-[var(--muted)]">
              The clip could not be loaded.
            </div>
          )}
        </div>

      </div>
    </main>
  );
}
