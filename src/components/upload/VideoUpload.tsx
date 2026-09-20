"use client";

import { useCallback, useRef, useState } from "react";

const MAX_BYTES = 100 * 1024 * 1024;
const MAX_SECONDS = 60;
const ACCEPT = ["video/mp4", "video/webm", "video/quicktime"];

type Stage = "idle" | "checking" | "signing" | "uploading" | "done" | "error";

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
  onUploaded: (result: { key: string; durationSeconds: number }) => void;
}) {
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handle = useCallback(
    async (file: File) => {
      setError(null);
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
      let meta;
      try {
        meta = await probe(file);
      } catch (err) {
        setStage("error");
        setError((err as Error).message);
        return;
      }
      if (meta.duration > MAX_SECONDS + 0.5) {
        setStage("error");
        setError(`That clip is ${meta.duration.toFixed(1)}s. The limit is 60s.`);
        return;
      }

      setStage("signing");
      let signed: { url: string; key: string; headers: Record<string, string> };
      try {
        const res = await fetch("/api/uploads/sign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contentType: file.type,
            size: file.size,
            durationSeconds: meta.duration,
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
      onUploaded({ key: signed.key, durationSeconds: meta.duration });
    },
    [onUploaded],
  );

  const busy = stage === "checking" || stage === "signing" || stage === "uploading";

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
        {stage === "checking" && <p className="text-sm text-[var(--muted)]">Reading the clip...</p>}
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
