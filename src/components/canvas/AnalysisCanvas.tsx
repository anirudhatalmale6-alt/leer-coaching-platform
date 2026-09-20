"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRenderer, type FrameRenderer, type Rect } from "@/lib/canvas/renderer";
import {
  fitContain,
  isInsideVideo,
  nearestHandle,
  toNormalised,
  type Point,
  type Viewport,
} from "@/lib/canvas/geometry";
import {
  PALETTE,
  POINTS_REQUIRED,
  createId,
  drawAnnotation,
  type Annotation,
  type SourceId,
  type Tool,
} from "@/lib/canvas/annotations";
import { formatTimecode, hasFrameCallback } from "@/lib/canvas/frames";
import { useFrameStepper } from "./useFrameStepper";

export type CanvasSource = { id: SourceId; url: string; label: string };

type Props = {
  primary: CanvasSource;
  /** Second clip for the split-screen comparison. Optional. */
  secondary?: CanvasSource;
};

/**
 * The coaching analysis canvas.
 *
 * Two stacked surfaces: a WebGL canvas that composites the video frames, and a
 * 2D canvas above it for annotations. Pointer events land on the 2D layer,
 * which owns the coordinate maths, and the WebGL layer just paints pixels.
 */
export default function AnalysisCanvas({ primary, secondary }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const videoARef = useRef<HTMLVideoElement>(null);
  const videoBRef = useRef<HTMLVideoElement>(null);
  const rendererRef = useRef<FrameRenderer | null>(null);
  const labelInputRef = useRef<HTMLInputElement>(null);

  const [split, setSplit] = useState(false);
  const [tool, setTool] = useState<Tool>("line");
  const [colour, setColour] = useState(PALETTE[0]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [pending, setPending] = useState<Point[]>([]);
  const [seq, setSeq] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [renderMode, setRenderMode] = useState<"webgl2" | "2d" | null>(null);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [textDraft, setTextDraft] = useState<{ point: Point; source: SourceId } | null>(null);
  const [textValue, setTextValue] = useState("");
  const [offsetB, setOffsetB] = useState(0);

  const stepper = useFrameStepper(videoARef);
  const dragRef = useRef<{ id: string; index: number } | null>(null);

  /**
   * Focus the label box when it opens.
   *
   * The autoFocus attribute is unreliable here: the element mounts in the same
   * commit as the pointer event that created it, and the canvas keeps focus, so
   * the coach places a label and then types into nothing. Focusing in an effect
   * runs after the node is in the document and actually works.
   */
  useEffect(() => {
    if (!textDraft) return;
    // Deferred by a frame on purpose. The draft opens on pointerdown, but the
    // browser finishes the click afterwards and moves focus to the clicked
    // element - a canvas, which is not focusable - landing focus on <body> and
    // silently discarding everything the coach types. Focusing after the click
    // has settled is the only thing that sticks.
    const id = requestAnimationFrame(() => labelInputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [textDraft]);

  // --- layout -------------------------------------------------------------

  /** Rectangles, in CSS pixels, that each video occupies. */
  const panes = useMemo((): Record<SourceId, Rect | null> => {
    const { w, h } = size;
    if (!w || !h) return { a: null, b: null };
    if (!split || !secondary) return { a: { x: 0, y: 0, w, h }, b: null };
    const half = w / 2;
    return { a: { x: 0, y: 0, w: half, h }, b: { x: half, y: 0, w: half, h } };
  }, [size, split, secondary]);

  const viewports = useMemo((): Record<SourceId, Viewport | null> => {
    const out: Record<SourceId, Viewport | null> = { a: null, b: null };
    (["a", "b"] as SourceId[]).forEach((id) => {
      const pane = panes[id];
      const video = id === "a" ? videoARef.current : videoBRef.current;
      if (!pane || !video?.videoWidth) return;
      const fit = fitContain(video.videoWidth, video.videoHeight, pane.w, pane.h);
      out[id] = { ...fit, offsetX: fit.offsetX + pane.x, offsetY: fit.offsetY + pane.y };
    });
    return out;
  }, [panes, size, stepper.ready]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // --- WebGL renderer -----------------------------------------------------

  useEffect(() => {
    const canvas = glCanvasRef.current;
    if (!canvas) return;
    const { renderer, fallbackReason: reason } = createRenderer(canvas);
    rendererRef.current = renderer;
    setRenderMode(renderer.mode);
    setFallbackReason(reason);
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  /** Repaint both layers. Driven by rAF so it coalesces with the compositor. */
  const paint = useCallback(() => {
    const renderer = rendererRef.current;
    const drawCanvas = drawCanvasRef.current;
    if (!renderer || !drawCanvas || !size.w || !size.h) return;

    const dpr = window.devicePixelRatio || 1;
    renderer.resize(size.w, size.h, dpr);
    renderer.clear();

    const sources: { id: SourceId; video: HTMLVideoElement | null }[] = [
      { id: "a", video: videoARef.current },
      { id: "b", video: videoBRef.current },
    ];
    sources.forEach(({ id, video }) => {
      const pane = panes[id];
      const vp = viewports[id];
      if (!pane || !vp || !video) return;
      renderer.draw(
        id,
        video,
        { x: vp.offsetX, y: vp.offsetY, w: vp.width, h: vp.height },
        dpr,
      );
    });

    // --- annotation layer ---
    const ratio = Math.min(dpr, 2);
    const cw = Math.round(size.w * ratio);
    const ch = Math.round(size.h * ratio);
    if (drawCanvas.width !== cw || drawCanvas.height !== ch) {
      drawCanvas.width = cw;
      drawCanvas.height = ch;
    }
    const ctx = drawCanvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    if (split && secondary && panes.b) {
      ctx.save();
      ctx.strokeStyle = "rgba(140,160,190,0.45)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(panes.b.x, 0);
      ctx.lineTo(panes.b.x, size.h);
      ctx.stroke();
      ctx.restore();
    }

    const currentFrame = stepper.frame;
    annotations.forEach((ann) => {
      if (ann.frame !== currentFrame) return;
      if (ann.source === "b" && !(split && secondary)) return;
      const vp = viewports[ann.source];
      const video = ann.source === "a" ? videoARef.current : videoBRef.current;
      if (!vp || !video?.videoWidth) return;
      drawAnnotation(
        ctx,
        ann,
        vp,
        video.videoWidth / video.videoHeight,
        video.videoWidth,
        video.videoHeight,
        ann.id === selected,
      );
    });

    // In-progress annotation: show the points placed so far.
    if (pending.length) {
      const vp = viewports.a;
      if (vp) {
        ctx.save();
        ctx.fillStyle = colour;
        pending.forEach((p) => {
          const s = { x: vp.offsetX + p.x * vp.width, y: vp.offsetY + p.y * vp.height };
          ctx.beginPath();
          ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.restore();
      }
    }
  }, [size, panes, viewports, annotations, stepper.frame, selected, pending, colour, split, secondary]);

  /**
   * Repaint on demand, not every animation frame.
   *
   * A paused canvas has nothing new to show, but an unconditional rAF loop still
   * re-uploads two 720p textures 60 times a second. That pins a CPU core while a
   * coach sits studying one frame - the exact thing they spend most of their
   * time doing - and on a phone it is a battery fire. While playing we do need
   * every frame, so the loop keeps running then.
   */
  const dirtyRef = useRef(true);
  useEffect(() => {
    dirtyRef.current = true;
  }, [paint]);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const a = videoARef.current;
      const live = Boolean(a && !a.paused && !a.ended);
      if (live || dirtyRef.current) {
        dirtyRef.current = false;
        paint();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [paint]);

  // A completed seek means new pixels are available even though no React state
  // changed, so the canvas has to be told to repaint.
  useEffect(() => {
    const markDirty = () => {
      dirtyRef.current = true;
    };
    const videos = [videoARef.current, videoBRef.current].filter(Boolean) as HTMLVideoElement[];
    videos.forEach((v) => {
      v.addEventListener("seeked", markDirty);
      v.addEventListener("loadeddata", markDirty);
    });
    return () =>
      videos.forEach((v) => {
        v.removeEventListener("seeked", markDirty);
        v.removeEventListener("loadeddata", markDirty);
      });
  }, [stepper.ready]);

  // --- keep the comparison clip in step ------------------------------------

  useEffect(() => {
    const b = videoBRef.current;
    if (!b || !split) return;
    const a = videoARef.current;
    if (!a) return;
    // Offset lets a coach align two takes that start at different moments.
    const target = Math.max(0, a.currentTime + offsetB);
    if (Math.abs(b.currentTime - target) > 0.01) b.currentTime = target;
  }, [stepper.frame, split, offsetB]);

  // --- pointer handling ----------------------------------------------------

  /** Which pane a screen point falls in, and its normalised coordinate. */
  const locate = useCallback(
    (clientX: number, clientY: number) => {
      const rect = drawCanvasRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const screen = { x: clientX - rect.left, y: clientY - rect.top };
      const order: SourceId[] = split && secondary ? ["a", "b"] : ["a"];
      for (const id of order) {
        const vp = viewports[id];
        if (!vp) continue;
        const norm = toNormalised(screen, vp);
        if (isInsideVideo(norm)) return { source: id, norm, screen };
      }
      return null;
    },
    [viewports, split, secondary],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const hit = locate(e.clientX, e.clientY);
      if (!hit) return;
      (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);

      if (tool === "select") {
        // Grab a handle on an annotation shown on this frame.
        for (const ann of annotations) {
          if (ann.frame !== stepper.frame || ann.source !== hit.source) continue;
          const vp = viewports[ann.source];
          if (!vp) continue;
          const idx = nearestHandle(hit.screen, ann.points, vp);
          if (idx >= 0) {
            dragRef.current = { id: ann.id, index: idx };
            setSelected(ann.id);
            return;
          }
        }
        setSelected(null);
        return;
      }

      if (tool === "text") {
        setTextDraft({ point: hit.norm, source: hit.source });
        setTextValue("");
        return;
      }

      const need = POINTS_REQUIRED[tool];
      const next = [...pending, hit.norm];
      if (next.length < need) {
        setPending(next);
        return;
      }

      const id = createId(seq);
      setSeq((s) => s + 1);
      const base = { id, frame: stepper.frame, source: hit.source, colour };
      const created: Annotation =
        tool === "line"
          ? { ...base, kind: "line", points: [next[0], next[1]] }
          : { ...base, kind: "angle", points: [next[0], next[1], next[2]] };
      setAnnotations((prev) => [...prev, created]);
      setPending([]);
      setSelected(id);
    },
    [locate, tool, pending, seq, stepper.frame, colour, annotations, viewports],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const hit = locate(e.clientX, e.clientY);
      if (!hit) return;
      setAnnotations((prev) =>
        prev.map((ann) => {
          if (ann.id !== drag.id) return ann;
          const points = [...ann.points];
          points[drag.index] = hit.norm;
          return { ...ann, points } as Annotation;
        }),
      );
    },
    [locate],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const commitText = useCallback(() => {
    if (!textDraft || !textValue.trim()) {
      setTextDraft(null);
      return;
    }
    const id = createId(seq);
    setSeq((s) => s + 1);
    setAnnotations((prev) => [
      ...prev,
      {
        id,
        kind: "text",
        frame: stepper.frame,
        source: textDraft.source,
        colour,
        points: [textDraft.point],
        text: textValue.trim(),
      },
    ]);
    setTextDraft(null);
    setTextValue("");
  }, [textDraft, textValue, seq, stepper.frame, colour]);

  const deleteSelected = useCallback(() => {
    if (!selected) return;
    setAnnotations((prev) => prev.filter((a) => a.id !== selected));
    setSelected(null);
  }, [selected]);

  const framesWithAnnotations = useMemo(() => {
    const set = new Set<number>();
    annotations.forEach((a) => set.add(a.frame));
    return set;
  }, [annotations]);

  const onThisFrame = annotations.filter((a) => a.frame === stepper.frame).length;

  // --- render --------------------------------------------------------------

  return (
    <div className="flex flex-col gap-3">
      <Toolbar
        tool={tool}
        setTool={(t) => { setTool(t); setPending([]); }}
        colour={colour}
        setColour={setColour}
        split={split}
        setSplit={setSplit}
        canSplit={Boolean(secondary)}
        onDelete={deleteSelected}
        canDelete={Boolean(selected)}
        onClearFrame={() =>
          setAnnotations((prev) => prev.filter((a) => a.frame !== stepper.frame))
        }
        onClearAll={() => { setAnnotations([]); setSelected(null); }}
        annotationCount={annotations.length}
      />

      <div
        ref={wrapRef}
        className="relative w-full overflow-hidden rounded-xl border border-[var(--border)] bg-black"
        style={{ aspectRatio: "16 / 9" }}
      >
        <canvas ref={glCanvasRef} className="absolute inset-0 h-full w-full" />
        <canvas
          ref={drawCanvasRef}
          className="absolute inset-0 h-full w-full touch-none"
          style={{ cursor: tool === "select" ? "default" : "crosshair" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />

        {/* The video elements are the decoders. They are never shown directly. */}
        <video
          ref={videoARef}
          src={primary.url}
          className="pointer-events-none absolute h-px w-px opacity-0"
          onLoadedMetadata={stepper.onLoadedMetadata}
          playsInline
          muted
          preload="auto"
          crossOrigin="anonymous"
        />
        {secondary && (
          <video
            ref={videoBRef}
            src={secondary.url}
            className="pointer-events-none absolute h-px w-px opacity-0"
            playsInline
            muted
            preload="auto"
            crossOrigin="anonymous"
          />
        )}

        {/* pointer-events-none is essential: this sits on top of the annotation
            canvas, and without it the notice silently swallows every click the
            coach makes on the video. */}
        {renderMode && (
          <div
            className={`pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/70 px-2.5 py-1 text-xs ${
              fallbackReason ? "text-[var(--warn)]" : "text-[var(--muted)]"
            }`}
            title={fallbackReason ?? "Frames composited on the GPU"}
          >
            {fallbackReason ? "Software rendering - WebGL2 unavailable" : "WebGL2"}
          </div>
        )}

        {split && secondary && (
          <>
            <PaneLabel side="left">{primary.label}</PaneLabel>
            <PaneLabel side="right">{secondary.label}</PaneLabel>
          </>
        )}

        {textDraft && (
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 shadow-xl">
            <input
              ref={labelInputRef}
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitText();
                if (e.key === "Escape") setTextDraft(null);
              }}
              placeholder="Label this moment"
              className="w-64 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
            />
            <button
              onClick={commitText}
              className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-[var(--on-accent)]"
            >
              Add
            </button>
          </div>
        )}
      </div>

      <Transport
        stepper={stepper}
        annotatedFrames={framesWithAnnotations}
        onThisFrame={onThisFrame}
      />

      {split && secondary && (
        <div className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm">
          <span className="text-[var(--muted)]">Align {secondary.label}</span>
          <input
            type="range"
            min={-3}
            max={3}
            step={1 / (stepper.fps || 30)}
            value={offsetB}
            onChange={(e) => setOffsetB(Number(e.target.value))}
            className="flex-1 accent-[var(--accent)]"
          />
          <span className="w-20 text-right font-mono text-xs text-[var(--muted)]">
            {offsetB >= 0 ? "+" : ""}
            {offsetB.toFixed(2)}s
          </span>
        </div>
      )}
    </div>
  );
}

function PaneLabel({ side, children }: { side: "left" | "right"; children: React.ReactNode }) {
  return (
    <span
      className={`pointer-events-none absolute top-3 rounded-md bg-black/60 px-2.5 py-1 text-xs font-semibold ${
        side === "left" ? "left-3" : "right-3"
      }`}
    >
      {children}
    </span>
  );
}

function Toolbar(props: {
  tool: Tool;
  setTool: (t: Tool) => void;
  colour: string;
  setColour: (c: string) => void;
  split: boolean;
  setSplit: (b: boolean) => void;
  canSplit: boolean;
  onDelete: () => void;
  canDelete: boolean;
  onClearFrame: () => void;
  onClearAll: () => void;
  annotationCount: number;
}) {
  const tools: { id: Tool; label: string; hint: string }[] = [
    { id: "select", label: "Select", hint: "Drag existing points" },
    { id: "line", label: "Line", hint: "Two points" },
    { id: "angle", label: "Angle", hint: "Point, vertex, point" },
    { id: "text", label: "Text", hint: "Label a moment" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2">
      {tools.map((t) => (
        <button
          key={t.id}
          title={t.hint}
          onClick={() => props.setTool(t.id)}
          className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
            props.tool === t.id
              ? "bg-[var(--accent)] text-[var(--on-accent)]"
              : "bg-[var(--surface-2)] text-[var(--foreground)] hover:bg-[var(--border)]"
          }`}
        >
          {t.label}
        </button>
      ))}

      <span className="mx-1 h-6 w-px bg-[var(--border)]" />

      {PALETTE.map((c) => (
        <button
          key={c}
          onClick={() => props.setColour(c)}
          aria-label={`Colour ${c}`}
          className={`h-6 w-6 rounded-full border-2 transition ${
            props.colour === c ? "border-white" : "border-transparent"
          }`}
          style={{ background: c }}
        />
      ))}

      <span className="mx-1 h-6 w-px bg-[var(--border)]" />

      <button
        onClick={() => props.setSplit(!props.split)}
        disabled={!props.canSplit}
        className={`rounded-md px-3 py-1.5 text-sm font-semibold transition disabled:opacity-40 ${
          props.split
            ? "bg-[var(--accent)] text-[var(--on-accent)]"
            : "bg-[var(--surface-2)] hover:bg-[var(--border)]"
        }`}
      >
        Split screen
      </button>

      <div className="ml-auto flex items-center gap-2">
        <span className="text-xs text-[var(--muted)]">{props.annotationCount} marks</span>
        <button
          onClick={props.onDelete}
          disabled={!props.canDelete}
          className="rounded-md bg-[var(--surface-2)] px-3 py-1.5 text-sm transition hover:bg-[var(--border)] disabled:opacity-40"
        >
          Delete
        </button>
        <button
          onClick={props.onClearFrame}
          className="rounded-md bg-[var(--surface-2)] px-3 py-1.5 text-sm transition hover:bg-[var(--border)]"
        >
          Clear frame
        </button>
        <button
          onClick={props.onClearAll}
          className="rounded-md bg-[var(--surface-2)] px-3 py-1.5 text-sm transition hover:bg-[var(--border)]"
        >
          Clear all
        </button>
      </div>
    </div>
  );
}

function Transport({
  stepper,
  annotatedFrames,
  onThisFrame,
}: {
  stepper: ReturnType<typeof useFrameStepper>;
  annotatedFrames: Set<number>;
  onThisFrame: number;
}) {
  const { frame, frameCount, fps, fpsMeasured, duration, playing } = stepper;

  // Browser-only capability check, deferred to an effect so the server and the
  // first client render agree.
  const [frameCallbackMissing, setFrameCallbackMissing] = useState(false);
  useEffect(() => setFrameCallbackMissing(!hasFrameCallback()), []);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => stepper.seekToFrame(0)}
          className="rounded-md bg-[var(--surface-2)] px-3 py-2 text-sm transition hover:bg-[var(--border)]"
          title="Home"
        >
          ⏮
        </button>
        <button
          onClick={() => stepper.step(-1)}
          className="rounded-md bg-[var(--surface-2)] px-3 py-2 text-sm transition hover:bg-[var(--border)]"
          title="Previous frame (Left arrow)"
        >
          ◀ 1
        </button>
        <button
          onClick={stepper.togglePlay}
          className="rounded-md bg-[var(--accent)] px-5 py-2 text-sm font-semibold text-[var(--on-accent)] transition hover:brightness-110"
          title="Play / pause (Space)"
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button
          onClick={() => stepper.step(1)}
          className="rounded-md bg-[var(--surface-2)] px-3 py-2 text-sm transition hover:bg-[var(--border)]"
          title="Next frame (Right arrow)"
        >
          1 ▶
        </button>
        <button
          onClick={() => stepper.step(10)}
          className="rounded-md bg-[var(--surface-2)] px-3 py-2 text-sm transition hover:bg-[var(--border)]"
          title="Forward 10 frames (Shift + Right arrow)"
        >
          10 ▶▶
        </button>

        <div className="ml-auto flex items-center gap-4 font-mono text-xs text-[var(--muted)]">
          <span>
            frame{" "}
            <span className="text-[var(--foreground)]">
              {String(frame).padStart(4, "0")}
            </span>{" "}
            / {frameCount ? frameCount - 1 : 0}
          </span>
          <span>{formatTimecode(frameCount ? frame / fps : 0)}</span>
          <span title={fpsMeasured ? "Measured from playback" : "Assumed until playback measures it"}>
            {fps} fps{fpsMeasured ? "" : "?"}
          </span>
          {onThisFrame > 0 && (
            <span className="text-[var(--accent)]">{onThisFrame} on frame</span>
          )}
        </div>
      </div>

      <div className="relative mt-3">
        <input
          type="range"
          min={0}
          max={Math.max(0, frameCount - 1)}
          value={frame}
          onChange={(e) => stepper.seekToFrame(Number(e.target.value))}
          className="w-full accent-[var(--accent)]"
          aria-label="Timeline"
        />
        {/* Ticks where annotations exist, so a trainee can find the feedback. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-2">
          {[...annotatedFrames].map((f) => (
            <span
              key={f}
              className="absolute top-0 h-2 w-0.5 bg-[var(--accent)]"
              style={{ left: `${frameCount > 1 ? (f / (frameCount - 1)) * 100 : 0}%` }}
            />
          ))}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-[var(--muted)]">
        <span>
          Arrows step 1 frame, Shift+Arrow steps 10, Space plays. Total{" "}
          {formatTimecode(duration)}
        </span>
        {/* Rendered from state, not called during render: the server has no
            HTMLVideoElement, so calling it inline makes the server and client
            disagree and React throws away the whole tree on hydration. */}
        {frameCallbackMissing && (
          <span className="text-[var(--warn)]">
            This browser lacks frame presentation callbacks - stepping still works,
            the live frame counter is less precise during playback.
          </span>
        )}
      </div>
      <div className="sr-only" data-testid="frame-readout">
        {frame}
      </div>
    </div>
  );
}
