"use client";

import { useCallback, useState } from "react";
import VideoUpload from "@/components/upload/VideoUpload";
import AnalysisCanvas from "@/components/canvas/AnalysisCanvas";

/**
 * Upload, then analyse. Once the clip is in storage we ask for a short-lived
 * playback URL and hand it straight to the canvas - the same component the
 * coach uses, so there is one code path rather than two.
 */
export default function UploadFlow() {
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);

  const onUploaded = useCallback(async ({ key: objectKey }: { key: string }) => {
    setKey(objectKey);
    setError(null);
    try {
      const res = await fetch("/api/uploads/playback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: objectKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not open the clip.");
      setPlaybackUrl(data.url);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  if (playbackUrl) {
    return (
      <div>
        <div className="mb-4 flex items-center justify-between gap-4 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-4 py-3">
          <span className="text-sm text-[var(--accent)]">
            Uploaded and streaming from private storage
          </span>
          <button
            onClick={() => {
              setPlaybackUrl(null);
              setKey(null);
            }}
            className="rounded-md bg-[var(--surface-2)] px-3 py-1.5 text-xs transition hover:bg-[var(--border)]"
          >
            Upload another
          </button>
        </div>
        <AnalysisCanvas primary={{ id: "a", url: playbackUrl, label: "Your clip" }} />
        {key && (
          <p className="mt-3 break-all font-mono text-xs text-[var(--muted)]">{key}</p>
        )}
      </div>
    );
  }

  return (
    <>
      <VideoUpload onUploaded={onUploaded} />
      {error && <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>}
    </>
  );
}
