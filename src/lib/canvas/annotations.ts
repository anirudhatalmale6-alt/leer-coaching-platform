/**
 * Annotation model and its 2D-canvas drawing.
 *
 * Every annotation is pinned to a frame index, not a timestamp. A coach marks
 * the exact frame where the knee collapses; if that were stored as a float
 * second it would drift onto a neighbouring frame the moment the frame rate
 * estimate changed by a hair.
 */

import type { Point, Viewport } from "./geometry";
import { angleAt, lineLength, toScreen } from "./geometry";

export type Tool = "select" | "line" | "angle" | "text";

export type Annotation =
  | { id: string; kind: "line"; frame: number; source: SourceId; colour: string; points: [Point, Point] }
  | { id: string; kind: "angle"; frame: number; source: SourceId; colour: string; points: [Point, Point, Point] }
  | { id: string; kind: "text"; frame: number; source: SourceId; colour: string; points: [Point]; text: string };

/** Which pane an annotation belongs to in split-screen mode. */
export type SourceId = "a" | "b";

export const PALETTE = ["#4ade80", "#fbbf24", "#f87171", "#60a5fa", "#ffffff"];

/** How many points each tool needs before the annotation is complete. */
export const POINTS_REQUIRED: Record<Exclude<Tool, "select">, number> = {
  line: 2,
  angle: 3,
  text: 1,
};

export function createId(seq: number): string {
  return `a${seq.toString(36)}`;
}

const HANDLE_R = 5;

function drawHandle(ctx: CanvasRenderingContext2D, p: Point, v: Viewport, colour: string) {
  const s = toScreen(p, v);
  ctx.beginPath();
  ctx.arc(s.x, s.y, HANDLE_R, 0, Math.PI * 2);
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.stroke();
}

/** Text with a dark outline so it stays readable over any video content. */
function outlinedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, colour: string) {
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.75)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = colour;
  ctx.fillText(text, x, y);
}

export function drawAnnotation(
  ctx: CanvasRenderingContext2D,
  ann: Annotation,
  v: Viewport,
  aspect: number,
  videoW: number,
  videoH: number,
  selected: boolean,
) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.font = "600 14px ui-sans-serif, system-ui, sans-serif";
  ctx.textBaseline = "middle";

  const pts = ann.points.map((p) => toScreen(p, v));

  if (selected) {
    ctx.shadowColor = ann.colour;
    ctx.shadowBlur = 8;
  }

  if (ann.kind === "line") {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[1].x, pts[1].y);
    ctx.strokeStyle = ann.colour;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.shadowBlur = 0;

    const px = Math.round(lineLength(ann.points[0], ann.points[1], videoW, videoH));
    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    outlinedText(ctx, `${px} px`, mid.x + 8, mid.y - 8, ann.colour);
  }

  if (ann.kind === "angle") {
    const [a, vertex, b] = ann.points;
    const [sa, sv, sb] = pts;

    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sv.x, sv.y);
    ctx.lineTo(sb.x, sb.y);
    ctx.strokeStyle = ann.colour;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Arc between the two rays, sized to sit inside the shorter one.
    const r = Math.min(
      36,
      Math.hypot(sa.x - sv.x, sa.y - sv.y) * 0.5,
      Math.hypot(sb.x - sv.x, sb.y - sv.y) * 0.5,
    );
    if (r > 6) {
      const a1 = Math.atan2(sa.y - sv.y, sa.x - sv.x);
      const a2 = Math.atan2(sb.y - sv.y, sb.x - sv.x);
      let delta = a2 - a1;
      // Take the reflex-free direction so the arc matches the reported number.
      while (delta <= -Math.PI) delta += Math.PI * 2;
      while (delta > Math.PI) delta -= Math.PI * 2;
      ctx.beginPath();
      ctx.arc(sv.x, sv.y, r, a1, a1 + delta, delta < 0);
      ctx.lineWidth = 1.75;
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    const deg = angleAt(vertex, a, b, aspect);
    outlinedText(ctx, `${deg.toFixed(1)}°`, sv.x + 12, sv.y - 14, ann.colour);
  }

  if (ann.kind === "text") {
    ctx.shadowBlur = 0;
    ctx.font = "600 16px ui-sans-serif, system-ui, sans-serif";
    const label = ann.text || "...";
    const w = ctx.measureText(label).width;
    const x = pts[0].x;
    const y = pts[0].y;

    ctx.fillStyle = "rgba(8,12,18,0.78)";
    ctx.beginPath();
    ctx.roundRect(x - 8, y - 15, w + 16, 30, 6);
    ctx.fill();
    ctx.strokeStyle = ann.colour;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = ann.colour;
    ctx.fillText(label, x, y);
  }

  if (ann.kind !== "text") {
    ctx.shadowBlur = 0;
    ann.points.forEach((p) => drawHandle(ctx, p, v, ann.colour));
  }

  ctx.restore();
}

/**
 * Turn stored annotations back into drawable marks.
 *
 * This is the coach's delivered work coming out of the database, so it is
 * parsed defensively rather than trusted: a single malformed row must not
 * throw inside a render and take down a coaching room somebody paid for.
 * Anything unrecognised is dropped, and what remains is still drawable.
 *
 * Point counts are checked per kind because the renderer indexes into
 * `points` directly - a "line" carrying one point would throw on redraw,
 * which is exactly the sort of failure that only appears in production.
 */
export function parseAnnotations(raw: string | null | undefined): Annotation[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: Annotation[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;

    const kind = a.kind;
    if (kind !== "line" && kind !== "angle" && kind !== "text") continue;
    if (typeof a.id !== "string" || typeof a.colour !== "string") continue;
    if (typeof a.frame !== "number" || !Number.isFinite(a.frame) || a.frame < 0) continue;
    if (a.source !== "a" && a.source !== "b") continue;

    const points = a.points;
    if (!Array.isArray(points)) continue;
    if (points.length !== POINTS_REQUIRED[kind]) continue;
    if (!points.every((p) => p && typeof p === "object"
        && Number.isFinite((p as Point).x) && Number.isFinite((p as Point).y))) {
      continue;
    }
    if (kind === "text" && typeof a.text !== "string") continue;

    out.push(a as unknown as Annotation);
  }
  return out;
}

/** What gets sent to the server on delivery. */
export function serialiseAnnotations(annotations: Annotation[]): string {
  return JSON.stringify(annotations);
}
