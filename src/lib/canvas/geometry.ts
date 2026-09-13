/**
 * Geometry for the analysis canvas.
 *
 * Annotations are stored in NORMALISED video coordinates (0..1 on each axis),
 * never in screen pixels. A coach marking a knee angle on a 27" monitor and a
 * trainee opening the same feedback on a phone must see the line on the same
 * part of the body, and the canvas is letterboxed differently on each. Storing
 * pixels would silently drift the annotation off the subject.
 */

export type Point = { x: number; y: number };

/** Where the video actually sits inside the canvas once letterboxed. */
export type Viewport = {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};

/**
 * Fit a video of `videoW x videoH` into `canvasW x canvasH` preserving aspect
 * ratio (the "contain" fit), returning the letterboxed rectangle.
 */
export function fitContain(
  videoW: number,
  videoH: number,
  canvasW: number,
  canvasH: number,
): Viewport {
  if (videoW <= 0 || videoH <= 0 || canvasW <= 0 || canvasH <= 0) {
    return { offsetX: 0, offsetY: 0, width: 0, height: 0 };
  }
  const scale = Math.min(canvasW / videoW, canvasH / videoH);
  const width = videoW * scale;
  const height = videoH * scale;
  return {
    offsetX: (canvasW - width) / 2,
    offsetY: (canvasH - height) / 2,
    width,
    height,
  };
}

/** Screen pixel -> normalised video coordinate. */
export function toNormalised(p: Point, v: Viewport): Point {
  if (v.width === 0 || v.height === 0) return { x: 0, y: 0 };
  return { x: (p.x - v.offsetX) / v.width, y: (p.y - v.offsetY) / v.height };
}

/** Normalised video coordinate -> screen pixel. */
export function toScreen(p: Point, v: Viewport): Point {
  return { x: v.offsetX + p.x * v.width, y: v.offsetY + p.y * v.height };
}

/** True when a normalised point is inside the video, not the letterbox bars. */
export function isInsideVideo(p: Point): boolean {
  return p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
}

/**
 * Interior angle at `vertex` between the rays to `a` and `b`, in degrees.
 *
 * IMPORTANT: the angle is measured in the video's own pixel space, not in
 * normalised space. Normalised coordinates squash the axes independently on a
 * non-square video, which changes measured angles - a true 90 degree elbow on a
 * 16:9 clip reads as about 119 degrees if you compute it from normalised values.
 * `aspect` is videoWidth / videoHeight and undoes that.
 */
export function angleAt(vertex: Point, a: Point, b: Point, aspect: number): number {
  const v1 = { x: (a.x - vertex.x) * aspect, y: a.y - vertex.y };
  const v2 = { x: (b.x - vertex.x) * aspect, y: b.y - vertex.y };

  const m1 = Math.hypot(v1.x, v1.y);
  const m2 = Math.hypot(v2.x, v2.y);
  if (m1 === 0 || m2 === 0) return 0;

  const cos = (v1.x * v2.x + v1.y * v2.y) / (m1 * m2);
  // Guard against floating point pushing this a hair outside [-1, 1], which
  // would make Math.acos return NaN and blank the readout.
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
}

/** Length of a line in video pixels, for a readout that means something. */
export function lineLength(a: Point, b: Point, videoW: number, videoH: number): number {
  return Math.hypot((b.x - a.x) * videoW, (b.y - a.y) * videoH);
}

/** Hit test for grabbing an existing handle, in screen space. */
export function nearestHandle(
  target: Point,
  handles: Point[],
  viewport: Viewport,
  radiusPx = 12,
): number {
  let best = -1;
  let bestDist = radiusPx;
  handles.forEach((h, i) => {
    const s = toScreen(h, viewport);
    const d = Math.hypot(s.x - target.x, s.y - target.y);
    if (d <= bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}
