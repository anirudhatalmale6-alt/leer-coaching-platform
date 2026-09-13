import AnalysisCanvas from "@/components/canvas/AnalysisCanvas";

/**
 * Canvas workbench.
 *
 * Loads two bundled test clips so the engine can be exercised before uploads
 * are wired to storage. Both clips have their frame number burned into every
 * frame, which turns "is the stepping frame-accurate?" from a claim into
 * something you can check with your eyes: the number on the video must always
 * match the counter underneath it.
 */
export default function CanvasPage() {
  return (
    <main className="flex-1">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <p className="text-xs font-semibold tracking-[0.3em] text-[var(--muted)]">
          LEER / MILESTONE 2
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Analysis canvas</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
          Frame-by-frame stepping, angle and line measurement, text labels and
          split-screen comparison. The burned-in FRAME number on the clip is the
          check: it must always match the counter below the video.
        </p>

        <div className="mt-8">
          <AnalysisCanvas
            primary={{ id: "a", url: "/sample-coaching-a.mp4", label: "Session 1" }}
            secondary={{ id: "b", url: "/sample-coaching-b.mp4", label: "Session 2" }}
          />
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <Note title="Why annotations are normalised">
            Marks are stored as 0..1 coordinates against the video, not screen
            pixels, so a knee angle drawn on a monitor lands on the same knee on
            a phone.
          </Note>
          <Note title="Why angles use pixel space">
            Normalised axes squash independently. A true 90° elbow on a 16:9 clip
            reads as about 119° if measured from normalised values, so the
            aspect ratio is applied first.
          </Note>
          <Note title="Why marks pin to frames">
            Each annotation belongs to a frame index rather than a timestamp, so
            a change in the measured frame rate cannot drift it onto the
            neighbouring frame.
          </Note>
        </div>
      </div>
    </main>
  );
}

function Note({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted)]">{children}</p>
    </div>
  );
}
