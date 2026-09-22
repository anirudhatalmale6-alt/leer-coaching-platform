import Link from "next/link";
import { auth } from "@/auth";
import Wordmark from "@/components/Wordmark";

/**
 * The landing page, aimed at COACHES.
 *
 * Copy supplied by the client, 22 Sep, and used verbatim except for two lines
 * that promised things the platform does not do. Both are marked below with
 * what was claimed and why it was changed - a coach recruited on a promise the
 * product breaks in its first 24 hours is worse than no coach.
 */
const steps = [
  {
    n: "01",
    title: "Claim Your Link",
    /**
     * CLIENT'S LINE: "...Get your custom leersports.com/yourname card
     * instantly."
     *
     * Not true as built. A username is only allocated once Stripe confirms the
     * account can receive transfers (see applyConnectStatus) - signing in with
     * Google leaves you a Trainee with no handle. Promising the card
     * "instantly" would have every new coach looking for a page that does not
     * exist yet.
     */
    body: "Sign in with Google in 5 seconds. Your custom leersports.com/yourname card is ready the moment Stripe clears you.",
  },
  {
    n: "02",
    title: "Connect Stripe",
    body: "Link your bank in 1 minute. Payouts drop straight to your account with zero friction.",
  },
  {
    n: "03",
    title: "Draw, Deliver, Get Paid",
    /**
     * CLIENT'S LINE: "...Escrow releases funds as soon as you deliver."
     *
     * Delivering CAPTURES the payment into the LEER balance; the coach's 80%
     * is transferred on approval, or automatically 24 hours later if the
     * trainee does nothing (payOutTrainer). Promising release on delivery
     * would have coaches expecting money that is, by design, still in escrow.
     */
    body: "Frame-by-frame canvas feedback in under 180 seconds. Escrow releases your 80% on approval - automatically after 24 hours.",
  },
];

export default async function Home() {
  const session = await auth();

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-5xl px-6 py-20">
        {/* The lockup is its own block so the tagline badge below starts on a
            fresh line rather than flowing alongside the slogan. */}
        <div>
          <Wordmark size="lg" slogan className="text-[var(--muted)]" />
        </div>

        <p className="mt-10 inline-block rounded-full border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-4 py-1.5 text-xs font-bold tracking-[0.18em] text-[var(--accent)]">
          NO COACHING, NO PAY.
        </p>

        <h1 className="font-display mt-5 max-w-3xl text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl">
          Stop Answering Free DMs.
          <br />
          <span className="text-[var(--accent)]">Your Expertise Isn&rsquo;t Free.</span>
        </h1>

        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[var(--muted)]">
          You spent years building your body and knowledge. Stop leaving money
          on the table. Turn your bio into a high-ticket video pass&mdash;charge
          $100+ per breakdown and get paid guaranteed via 24h Stripe Escrow.
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-4">
          <Link
            href={session?.user ? "/dashboard" : "/signin"}
            className="rounded-lg bg-[var(--accent)] px-6 py-3.5 font-bold tracking-wide text-[var(--on-accent)] transition hover:brightness-110"
          >
            {session?.user ? "GO TO YOUR DASHBOARD" : "MONETIZE YOUR BIO NOW"}
          </Link>
          <span className="text-sm text-[var(--muted)]">
            No monthly subscription fees. Keep 80% of every pass.
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
              <h2 className="font-display mt-3 font-bold">{s.title}</h2>
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
