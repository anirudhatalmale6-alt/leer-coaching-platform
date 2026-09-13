import Link from "next/link";
import { auth } from "@/auth";

const steps = [
  {
    n: "01",
    title: "Sign in with Google",
    body: "One tap. Everyone starts as a Trainee - no forms, no role picker.",
  },
  {
    n: "02",
    title: "Connect Stripe to coach",
    body: "Finish Stripe onboarding and your account is elevated to Trainer automatically, with your own leersports.com URL.",
  },
  {
    n: "03",
    title: "Analyse, deliver, get paid",
    body: "Frame-by-frame canvas feedback within 24 hours. Escrow releases 80% to you on approval.",
  },
];

export default async function Home() {
  const session = await auth();

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-5xl px-6 py-20">
        <p className="text-xs font-semibold tracking-[0.3em] text-[var(--muted)]">
          LEER
        </p>
        <h1 className="mt-4 text-5xl font-semibold leading-tight tracking-tight">
          1:1 video coaching,
          <br />
          <span className="text-[var(--accent)]">analysed frame by frame.</span>
        </h1>
        <p className="mt-6 max-w-xl text-lg text-[var(--muted)]">
          Upload a clip. Your coach marks the angles, the lines and the moment it
          goes wrong, then sends it back inside 24 hours. Payment sits in escrow
          until you are happy with it.
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-4">
          {session?.user ? (
            <Link
              href="/dashboard"
              className="rounded-lg bg-[var(--accent)] px-6 py-3 font-semibold text-[#06240f] transition hover:brightness-110"
            >
              Go to dashboard
            </Link>
          ) : (
            <Link
              href="/signin"
              className="rounded-lg bg-[var(--accent)] px-6 py-3 font-semibold text-[#06240f] transition hover:brightness-110"
            >
              Get started
            </Link>
          )}
          <span className="text-sm text-[var(--muted)]">
            Free to join. Coaches keep 80%.
          </span>
        </div>

        <div className="mt-20 grid gap-5 sm:grid-cols-3">
          {steps.map((s) => (
            <div
              key={s.n}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6"
            >
              <div className="text-xs font-semibold tracking-widest text-[var(--accent)]">
                {s.n}
              </div>
              <h2 className="mt-3 font-semibold">{s.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
