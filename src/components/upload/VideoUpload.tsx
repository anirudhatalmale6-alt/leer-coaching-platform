"use client";

import { useCallback, useRef, useState } from "react";
import {
  browserCanPlay,
  codecWarning,
  detectCodecFromFile,
  type CodecReport,
} from "@/lib/video/codec";

const MAX_BYTES = 100 * 1024 * 1024;
const MAX_SECONDS = 60;
const ACCEPT = ["video/mp4", "video/webm", "video/quicktime"];

type Stage =
  | "idle"
  | "checking"
  | "codec-warning"
  | "signing"
  | "uploading"
  | "done"
  | "error";

/**
 * Read a clip's duration and dimensions without uploading it.
 *
 * Checking locally means a trainee who picked a 3 minute clip is told
 * immediately, instead of watching a 90MB upload crawl to completion and only
 * then being rejected. The server validates size and type again regardless -
 * this is a courtesy, not a security boundary.
 */
function probe(file: File): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;

    const cleanup = () => URL.revokeObjectURL(url);

    v.onloadedmetadata = () => {
      const out = { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
      cleanup();
      // Infinity shows up for some WebM files whose duration is only in the
      // cluster headers; treat it as unknown rather than as "too long".
      if (!Number.isFinite(out.duration)) reject(new Error("Could not read the clip's length."));
      else resolve(out);
    };
    v.onerror = () => {
      cleanup();
      reject(new Error("That file could not be read as a video."));
    };
    v.src = url;
  });
}

export default function VideoUpload({
  onUploaded,
}: {
  onUploaded: (result: {
    key: string;
    durationSeconds: number;
    codec?: string;
  }) => void;
}) {
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [unplayableHere, setUnplayableHere] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  /** Held back while the trainee decides what to do about a codec warning. */
  const pendingRef = useRef<{
    file: File;
    /** Null when the browser could not decode the clip to measure it. */
    duration: number | null;
    codec: CodecReport;
  } | null>(null);

  /**
   * Everything after the trainee has decided to go ahead.
   *
   * Separated from the checks so a codec warning can pause between the two:
   * the clip has already been measured, and pressing "Upload anyway" must not
   * re-run any of it.
   */
  const startUpload = useCallback(
    async (file: File, durationSeconds: number | null, codec: CodecReport) => {

      setError(null);
      setProgress(0);
      setStage("signing");
      let signed: { url: string; key: string; headers: Record<string, string> };
      try {
        const res = await fetch("/api/uploads/sign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contentType: file.type,
            size: file.size,
            // Omitted when unknown; the server validates it only if present,
            // and always enforces size and type regardless.
            ...(durationSeconds !== null ? { durationSeconds } : {}),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not prepare the upload.");
        signed = data;
      } catch (err) {
        setStage("error");
        setError((err as Error).message);
        return;
      }

      setStage("uploading");
      try {
        // XMLHttpRequest rather than fetch, purely for upload progress - fetch
        // still cannot report it, and a silent 100MB upload feels broken.
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", signed.url, true);
          Object.entries(signed.headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
          };
          xhr.onload = () =>
            xhr.status >= 200 && xhr.status < 300
              ? resolve()
              : reject(
                  new Error(
                    xhr.status === 0
                      ? "Upload blocked. The storage bucket's CORS policy needs to allow this site."
                      : `Storage rejected the upload (${xhr.status}).`,
                  ),
                );
          xhr.onerror = () =>
            reject(
              new Error("Upload blocked. The storage bucket's CORS policy needs to allow this site."),
            );
          xhr.send(file);
        });
      } catch (err) {
        setStage("error");
        setError((err as Error).message);
        return;
      }

      setStage("done");
      onUploaded({
        key: signed.key,
        durationSeconds: durationSeconds ?? 0,
        codec: codec.codec === "unknown" ? undefined : codec.codec,
      });
    },
    [onUploaded],
  );

  /**
   * Validate, check the codec, then measure.
   *
   * ORDER MATTERS, and getting it wrong is how this was first written.
   *
   * `probe()` asks the BROWSER to decode the clip to read its duration. On an
   * HEVC file in Chrome that fails - which is the whole problem this feature
   * exists to explain - so probing first meant the trainee got "That file
   * could not be read as a video" and the codec check never ran at all. The
   * single most common real failure produced the least useful message
   * possible. Unit tests could not catch it; driving a real browser did.
   *
   * Reading the codec is a walk over the file's box headers and never decodes
   * anything, so it works regardless of what the browser supports. It goes
   * first, and its answer is then used to explain a probe failure.
   */
  const handle = useCallback(
    async (file: File) => {
      setError(null);
      setWarning(null);
      setProgress(0);

      if (!ACCEPT.includes(file.type)) {
        setStage("error");
        setError("Use an MP4, WebM or MOV file.");
        return;
      }
      if (file.size > MAX_BYTES) {
        setStage("error");
        setError(`That clip is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is 100MB.`);
        return;
      }

      setStage("checking");

      // Never let a codec check stop an upload: it is advice, and a clip we
      // cannot parse is not a clip we should refuse.
      let codec: CodecReport = { codec: "unknown", fourcc: null, risky: false };
      try {
        codec = await detectCodecFromFile(file);
      } catch {
        /* keep the default */
      }
      const message = codecWarning(codec);

      let meta: { duration: number } | null = null;
      try {
        meta = await probe(file);
      } catch (err) {
        // The browser could not decode it. If we know why, say so - otherwise
        // fall back to the generic message.
        if (!message) {
          setStage("error");
          setError((err as Error).message);
          return;
        }
      }

      if (meta && meta.duration > MAX_SECONDS + 0.5) {
        setStage("error");
        setError(`That clip is ${meta.duration.toFixed(1)}s. The limit is 60s.`);
        return;
      }

      if (message) {
        // Duration may be unknown, because reading it needs a decoder this
        // browser does not have. The server treats it as optional and still
        // enforces size and type, so an upload is not blocked by not knowing.
        pendingRef.current = { file, duration: meta?.duration ?? null, codec };
        setWarning(message);
        setUnplayableHere(meta === null || browserCanPlay(codec) === false);
        setStage("codec-warning");
        return;
      }

      await startUpload(file, meta!.duration, codec);
    },
    [startUpload],
  );

  const busy = stage === "checking" || stage === "signing" || stage === "uploading";

  /**
   * The codec warning takes over the whole drop zone.
   *
   * Deliberately not a toast or a line of small print under the box: this is
   * the difference between a coach seeing the clip and seeing a black
   * rectangle, and the trainee is the only person who can fix it - once they
   * have left the page, nobody can.
   */
  if (stage === "codec-warning" && warning) {
    const pending = pendingRef.current;
    return (
      <div className="rounded-xl border border-[var(--warn)]/40 bg-[var(--warn)]/10 p-5">
        <p className="text-sm font-semibold text-[var(--warn)]">
          This clip may not play for your coach
        </p>
        <p className="mt-2 text-sm leading-relaxed text-[var(--foreground)]">{warning}</p>
        {unplayableHere && (
          <p className="mt-2 text-sm text-[var(--warn)]">
            Your own browser cannot play this file either, so this is not a
            hypothetical - it would very likely fail for your coach too.
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            onClick={() => {
              setStage("idle");
              setWarning(null);
              pendingRef.current = null;
              inputRef.current?.click();
            }}
            className="rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[var(--on-accent)] transition hover:brightness-110"
          >
            Choose a different file
          </button>
          <button
            onClick={() => {
              if (!pending) return;
              setWarning(null);
              void startUpload(pending.file, pending.duration, pending.codec);
            }}
            className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm text-[var(--muted)] transition hover:text-[var(--foreground)]"
          >
            Upload it anyway
          </button>
        </div>

        {/* The file input has to stay mounted for "Choose a different file". */}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT.join(",")}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handle(file);
            e.target.value = "";
          }}
        />
      </div>
    );
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void handle(file);
        }}
        onClick={() => !busy && inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition ${
          dragging
            ? "border-[var(--accent)] bg-[var(--accent)]/5"
            : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--muted)]"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT.join(",")}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handle(file);
            e.target.value = "";
          }}
        />

        {stage === "idle" && (
          <>
            <p className="font-semibold">Drop your clip here</p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              MP4, WebM or MOV. Up to 60 seconds and 100MB.
            </p>
          </>
        )}
        {stage === "checking" && (
          <p className="text-sm text-[var(--muted)]">Checking the clip...</p>
        )}
        {stage === "signing" && <p className="text-sm text-[var(--muted)]">Preparing upload...</p>}
        {stage === "uploading" && (
          <div className="w-full max-w-sm">
            <p className="text-sm font-semibold">Uploading {progress}%</p>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
              <div
                className="h-full bg-[var(--accent)] transition-[width]"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
        {stage === "done" && (
          <p className="font-semibold text-[var(--accent)]">Uploaded. Opening the canvas...</p>
        )}
        {stage === "error" && (
          <>
            <p className="font-semibold text-[var(--danger)]">{error}</p>
            <p className="mt-1 text-sm text-[var(--muted)]">Click to choose another file.</p>
          </>
        )}
      </div>
    </div>
  );
}
