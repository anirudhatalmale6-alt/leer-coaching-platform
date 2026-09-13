/**
 * Frame <-> time conversion for the analysis canvas.
 *
 * The browser gives you no API for a video's frame rate, so this measures it
 * from requestVideoFrameCallback metadata and falls back to a sane default.
 *
 * Why the seek target is nudged: seeking to exactly frame*n/fps lands on the
 * boundary between two frames, and which side you get is down to floating point
 * and the browser's rounding. Aiming at the MIDDLE of the frame's display
 * interval is unambiguous, so frame N always presents frame N.
 */

export const DEFAULT_FPS = 30;

/** Timestamp to aim at to be certain of landing on `frame`. */
export function frameToTime(frame: number, fps: number): number {
  return (frame + 0.5) / fps;
}

/** Which frame a timestamp belongs to. */
export function timeToFrame(time: number, fps: number): number {
  return Math.floor(time * fps + 1e-6);
}

export function totalFrames(duration: number, fps: number): number {
  return Math.max(1, Math.round(duration * fps));
}

export function clampFrame(frame: number, duration: number, fps: number): number {
  return Math.min(Math.max(0, frame), totalFrames(duration, fps) - 1);
}

/** mm:ss.mmm, for a readout a coach can quote back. */
export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

type FrameMeta = { mediaTime: number; presentedFrames: number };

/**
 * Estimate frame rate from two requestVideoFrameCallback samples.
 *
 * presentedFrames counts frames the compositor actually showed and mediaTime is
 * their position in the video, so the ratio is the real rate - including the
 * awkward ones (23.976, 29.97) that a hardcoded 30 would quietly get wrong,
 * drifting a whole frame every 33 seconds on a 29.97 clip.
 *
 * Returns null when the sample is too small to trust, so the caller can keep
 * its current estimate rather than jump to a bad one.
 */
export function estimateFps(first: FrameMeta, last: FrameMeta): number | null {
  const dFrames = last.presentedFrames - first.presentedFrames;
  const dTime = last.mediaTime - first.mediaTime;
  if (dFrames < 5 || dTime <= 0.1) return null;

  const raw = dFrames / dTime;
  // Second line of defence against a sample taken across a seek rather than
  // across playback: those produce absurdly low rates. No camera a trainee
  // will use records below 10 fps, so anything under that is measurement
  // noise, not a frame rate, and accepting it corrupts every frame number.
  if (!Number.isFinite(raw) || raw < 10 || raw > 240) return null;

  // Snap to the standard rates when we are within 2%, so a 29.97 clip reads as
  // 29.97 rather than 29.94 and frame numbers stay stable across sessions.
  //
  // Must pick the CLOSEST candidate, not the first one inside tolerance: 30 and
  // 29.97 are 0.1% apart, so a first-match scan labels a clean 30fps clip as
  // 29.97 and drifts it by nearly two frames over a 60 second video.
  const COMMON = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120];
  let best: number | null = null;
  let bestErr = Infinity;
  for (const c of COMMON) {
    const err = Math.abs(raw - c) / c;
    if (err < 0.02 && err < bestErr) {
      best = c;
      bestErr = err;
    }
  }
  if (best !== null) return best;

  return Math.round(raw * 1000) / 1000;
}

/** Does this browser expose frame-accurate presentation metadata? */
export function hasFrameCallback(): boolean {
  return (
    typeof HTMLVideoElement !== "undefined" &&
    "requestVideoFrameCallback" in HTMLVideoElement.prototype
  );
}
