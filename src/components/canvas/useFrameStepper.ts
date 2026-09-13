"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_FPS,
  clampFrame,
  estimateFps,
  frameToTime,
  timeToFrame,
  totalFrames,
} from "@/lib/canvas/frames";

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    cb: (now: number, meta: { mediaTime: number; presentedFrames: number }) => void,
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/**
 * Frame-accurate control of an HTMLVideoElement.
 *
 * Seeking is the mechanism rather than a pre-decoded frame buffer, deliberately.
 * A 60s 720p clip is roughly 1800 frames; held as raw RGBA that is about 6.6 GB,
 * so "decode the clip into memory" is not an option at any quality worth
 * analysing. Browsers already decode from the nearest keyframe on seek, and with
 * a 2s keyframe interval a backwards step costs at most ~60 frames of decode -
 * single-digit milliseconds on anything made this decade.
 */
export function useFrameStepper(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [fps, setFps] = useState(DEFAULT_FPS);
  const [duration, setDuration] = useState(0);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [fpsMeasured, setFpsMeasured] = useState(false);

  const fpsRef = useRef(fps);
  fpsRef.current = fps;

  /**
   * The frame the coach intends to be on.
   *
   * This, not video.currentTime, is the source of truth while stepping. Setting
   * currentTime is asynchronous: the element does not report the new time until
   * the seek completes, so deriving "the next frame" from currentTime means two
   * quick clicks both compute from the same stale value and one of them is
   * silently lost. Holding the arrow key would then skip frames - exactly the
   * thing frame-by-frame analysis exists to avoid.
   */
  const frameRef = useRef(0);

  // Frame rate is measured from real presentation metadata during the first
  // stretch of playback rather than assumed.
  const sampleRef = useRef<{ mediaTime: number; presentedFrames: number } | null>(null);

  const onLoadedMetadata = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setDuration(v.duration || 0);
    setReady(true);
  }, [videoRef]);

  /**
   * Pick up metadata that arrived before React was listening.
   *
   * A cached or local clip can reach HAVE_METADATA before the onLoadedMetadata
   * prop is attached - and React remounts this component twice in development -
   * so relying on the event alone loses the duration entirely. The symptom is
   * quiet and nasty: stepping still works because it reads video.duration
   * directly, but the readout says "frame 0010 / 0" and the scrubber has a
   * range of zero, so the clip looks empty.
   *
   * durationchange also covers streams whose length is only known later.
   */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const sync = () => {
      if (v.readyState >= 1 /* HAVE_METADATA */) {
        setDuration(v.duration || 0);
        setReady(true);
      }
    };
    sync();

    v.addEventListener("loadedmetadata", sync);
    v.addEventListener("durationchange", sync);
    return () => {
      v.removeEventListener("loadedmetadata", sync);
      v.removeEventListener("durationchange", sync);
    };
  }, [videoRef]);

  /** Seek to an absolute frame. The request is authoritative immediately. */
  const seekToFrame = useCallback(
    (target: number) => {
      const v = videoRef.current;
      if (!v || !v.duration) return;
      const next = clampFrame(target, v.duration, fpsRef.current);
      frameRef.current = next;
      v.currentTime = frameToTime(next, fpsRef.current);
      setFrame(next);
    },
    [videoRef],
  );

  const step = useCallback(
    (delta: number) => {
      const v = videoRef.current;
      if (!v) return;
      if (!v.paused) {
        v.pause();
        setPlaying(false);
        // Playback has been advancing frameRef; resume stepping from whatever
        // is actually on screen.
        frameRef.current = timeToFrame(v.currentTime, fpsRef.current);
      }
      seekToFrame(frameRef.current + delta);
    },
    [seekToFrame, videoRef],
  );

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
      // Snap to the frame actually on screen, so stepping continues from what
      // the coach is looking at rather than a fractional time.
      const shown = timeToFrame(v.currentTime, fpsRef.current);
      frameRef.current = shown;
      setFrame(shown);
    }
  }, [videoRef]);

  // Track the presented frame while playing, and measure the rate.
  useEffect(() => {
    const v = videoRef.current as VideoWithFrameCallback | null;
    if (!v || typeof v.requestVideoFrameCallback !== "function") return;

    let handle = 0;
    let cancelled = false;

    const onFrame = (_now: number, meta: { mediaTime: number; presentedFrames: number }) => {
      if (cancelled) return;

      // Only follow presentation during playback. After a seek the callback
      // also fires, reporting the decoded frame's own start time - which can
      // round to the frame below the one that was requested and would drag the
      // readout backwards a frame every single step.
      if (!v.paused) {
        const shown = timeToFrame(meta.mediaTime, fpsRef.current);
        frameRef.current = shown;
        setFrame(shown);

        // Frame rate may ONLY be measured across continuous playback.
        //
        // This callback also fires once per completed seek, and stepping
        // produces samples like "6 presented frames spanning 2 seconds of media"
        // - a perfectly plausible-looking 3 fps. That poisons every frame
        // number afterwards and, because the end of the clip is derived from
        // fps, it also clamps the timeline to a fraction of its real length.
        // Symptom seen in testing: after a few 10-frame jumps the playhead
        // refused to pass frame 29 on a 300 frame clip.
        if (!sampleRef.current) {
          sampleRef.current = meta;
        } else {
          const measured = estimateFps(sampleRef.current, meta);
          if (measured) {
            setFps(measured);
            setFpsMeasured(true);
            sampleRef.current = null;
          }
        }
      } else {
        // Paused, or mid-seek: discard any part-built sample so playback starts
        // measuring from a clean pair.
        sampleRef.current = null;
      }
      handle = v.requestVideoFrameCallback!(onFrame);
    };

    handle = v.requestVideoFrameCallback(onFrame);
    return () => {
      cancelled = true;
      v.cancelVideoFrameCallback?.(handle);
    };
  }, [videoRef, ready]);

  // Keyboard: the shortcuts a coach actually reaches for.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      // Never hijack typing in the text-label input.
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;

      if (e.key === "ArrowRight") { e.preventDefault(); step(e.shiftKey ? 10 : 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); step(e.shiftKey ? -10 : -1); }
      else if (e.key === " ") { e.preventDefault(); togglePlay(); }
      else if (e.key === "Home") { e.preventDefault(); seekToFrame(0); }
      else if (e.key === "End") {
        e.preventDefault();
        const v = videoRef.current;
        if (v?.duration) seekToFrame(totalFrames(v.duration, fpsRef.current) - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, togglePlay, seekToFrame, videoRef]);

  return {
    fps,
    fpsMeasured,
    duration,
    frame,
    playing,
    ready,
    frameCount: duration ? totalFrames(duration, fps) : 0,
    step,
    seekToFrame,
    togglePlay,
    onLoadedMetadata,
    setPlaying,
  };
}
