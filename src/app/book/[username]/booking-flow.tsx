"use client";

import { useCallback, useState } from "react";
import VideoUpload from "@/components/upload/VideoUpload";
import { MAX_FOCUS_NOTE } from "@/lib/profile";

/**
 * Upload the clip, then pay.
 *
 * The upload happens FIRST, before any money is involved, deliberately: a
 * trainee who pays and then discovers their clip will not upload has a support
 * ticket and a refund; one who cannot upload has simply not bought anything
 * yet. It also matches the client's spec, where the modal collects the video
 * before the payment button appears.
 */
export default function BookingFlow({
  username,
  priceLabel,
}: {
  username: string;
  priceLabel: string;
}) {
  const [videoKey, setVideoKey] = useState<string | null>(null);
  const [codec, setCodec] = useState<string | undefined>(undefined);
  const [focusNote, setFocusNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onUploaded = useCallback(
    ({ key, codec: detected }: { key: string; codec?: string }) => {
      setVideoKey(key);
      setCodec(detected);
      setError(null);
    },
    [],
  );

  async function proceed() {
    if (!videoKey) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trainerUsername: username, videoKey, focusNote, codec }),
      });
      const data = (await res.json()) as { checkoutUrl?: string; error?: string };
      if (res.ok && data.checkoutUrl) {
        // Full navigation, not a router push - this leaves the app for Stripe.
        window.location.href = data.checkoutUrl;
        return;
      }
      setError(data.error ?? "Could not start the payment.");
    } catch {
      setError("Network error. Please try again.");
    }
    // Only reached on failure; on success the browser is already leaving.
    setBusy(false);
  }

  return (
    <div>
      <p className="text-xs font-semibold tracking-[0.2em] text-[var(--muted)]">
        1. YOUR CLIP
      </p>
      <div className="mt-3">
        {videoKey ? (
          <div className="flex items-center justify-between gap-4 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-4 py-3">
            <span className="text-sm text-[var(--accent)]">Clip uploaded</span>
            <button
              onClick={() => setVideoKey(null)}
              className="rounded-md bg-[var(--surface-2)] px-3 py-1.5 text-xs transition hover:bg-[var(--border)]"
            >
              Choose another
            </button>
          </div>
        ) : (
          <VideoUpload onUploaded={onUploaded} />
        )}
      </div>

      <p className="mt-8 text-xs font-semibold tracking-[0.2em] text-[var(--muted)]">
        2. WHAT SHOULD YOUR COACH LOOK AT?
      </p>
      <textarea
        value={focusNote}
        onChange={(e) => setFocusNote(e.target.value.slice(0, MAX_FOCUS_NOTE))}
        rows={3}
        placeholder="e.g. Check my side-lat spread and lower back shape."
        className="mt-3 w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm outline-none focus:border-[var(--accent)]"
      />
      <p className="mt-1 text-right text-xs text-[var(--muted)]">
        {focusNote.length}/{MAX_FOCUS_NOTE} - optional
      </p>

      <button
        onClick={proceed}
        disabled={!videoKey || busy}
        className="mt-6 w-full rounded-xl bg-[var(--accent)] px-5 py-3.5 font-semibold text-[var(--on-accent)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-[var(--surface-2)] disabled:text-[var(--muted)]"
      >
        {busy ? "Opening secure payment..." : `Proceed to payment (${priceLabel})`}
      </button>

      {error && <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>}

      <p className="mt-4 text-center text-xs text-[var(--muted)]">
        Your card is authorised now and only charged when your coach delivers.
        If they miss the 24 hour window the authorisation is cancelled
        automatically.
      </p>
    </div>
  );
}
