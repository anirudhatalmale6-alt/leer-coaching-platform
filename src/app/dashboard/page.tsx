import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import { appUrl, stripeConfigured, devShortcutsEnabled } from "@/lib/env";
import OnboardButton from "./onboard-button";
import DevConnect from "./dev-connect";
import ProfileEditor from "./profile-editor";

function Row({ label, ok, note }: { label: string; ok: boolean; note?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] py-3 last:border-0">
      <div>
        <div className="text-sm">{label}</div>
        {note && <div className="text-xs text-[var(--muted)]">{note}</div>}
      </div>
      <span
        className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
          ok
            ? "bg-[var(--accent)]/15 text-[var(--accent)]"
            : "bg-[var(--surface-2)] text-[var(--muted)]"
        }`}
      >
        {ok ? "Yes" : "Not yet"}
      </span>
    </div>
  );
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ onboarding?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const { onboarding } = await searchParams;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { portfolioLinks: { orderBy: { position: "asc" }, select: { url: true } } },
  });
  if (!user) redirect("/signin");

  const publicUrl = user.username
    ? `${appUrl.replace(/^https?:\/\//, "")}/${user.username}`
    : null;

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-3xl px-6 py-14">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-xs font-semibold tracking-[0.3em] text-[var(--muted)]">
              LEER
            </p>
            <h1 className="mt-2 text-3xl font-semibold">
              {user.name ?? user.email}
            </h1>
            <div className="mt-3 flex items-center gap-2">
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  user.isTrainer
                    ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                    : "bg-[var(--surface-2)] text-[var(--muted)]"
                }`}
              >
                {user.isTrainer ? "TRAINER" : "TRAINEE"}
              </span>
              {publicUrl && (
                <span className="text-xs text-[var(--muted)]">{publicUrl}</span>
              )}
            </div>
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] transition hover:text-[var(--foreground)]">
              Sign out
            </button>
          </form>
        </div>

        {onboarding === "expired" && (
          <div className="mt-8 rounded-lg border border-[var(--warn)]/40 bg-[var(--warn)]/10 p-4 text-sm text-[var(--warn)]">
            That onboarding link expired. Stripe links are single use - start a
            new one below.
          </div>
        )}

        {!user.isTrainer ? (
          <section className="mt-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
            <h2 className="text-lg font-semibold">Start coaching</h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
              Connect a Stripe account to sell coaching passes. Your role is
              elevated to Trainer automatically once Stripe confirms you can
              receive transfers and payouts - we never flip it on request.
            </p>

            {stripeConfigured ? (
              <OnboardButton />
            ) : (
              <p className="mt-5 rounded-lg border border-[var(--warn)]/40 bg-[var(--warn)]/10 p-4 text-sm text-[var(--warn)]">
                Stripe is not configured on this deployment yet. Add
                STRIPE_SECRET_KEY to enable onboarding.
              </p>
            )}

            {devShortcutsEnabled && <DevConnect />}
          </section>
        ) : (
          <>
            <section className="mt-10 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-6">
              <h2 className="text-lg font-semibold text-[var(--accent)]">
                You are a Trainer
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
                Your public page is live at{" "}
                <a
                  href={`/${user.username}`}
                  className="text-[var(--foreground)] underline underline-offset-4"
                >
                  {publicUrl}
                </a>
                . That is the link to put in your Instagram or YouTube bio.
              </p>
            </section>

            <div className="mt-8">
              <ProfileEditor
                appHost={appUrl.replace(/^https?:\/\//, "")}
                payoutsActive={user.stripeTransfersStatus === "active"}
                initial={{
                  username: user.username ?? "",
                  bio: user.bio ?? "",
                  category: user.category ?? "",
                  instagram: user.instagram ?? "",
                  youtube: user.youtube ?? "",
                  // Sent as the string the input holds, so the form round-trips
                  // what the trainer typed rather than reformatting it under them.
                  price: (user.coachingPriceCents / 100).toFixed(2),
                  coachingEnabled: user.coachingEnabled,
                  portfolio: user.portfolioLinks.map((l) => l.url),
                  hasAvatar: Boolean(user.avatarKey),
                }}
              />
            </div>
          </>
        )}

        <section className="mt-8 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="text-sm font-semibold tracking-wide text-[var(--muted)]">
            STRIPE CONNECT STATUS
          </h2>
          <div className="mt-4">
            <Row
              label="Stripe account created"
              ok={Boolean(user.stripeAccountId)}
              note={user.stripeAccountId ?? undefined}
            />
            <Row
              label="Can receive transfers"
              ok={user.stripeTransfersStatus === "active"}
              note={`stripe_balance.stripe_transfers = ${user.stripeTransfersStatus ?? "not requested"}`}
            />
            <Row
              label="Stripe has everything it needs"
              ok={!user.stripeRequirementsOutstanding}
              note="outstanding requirements block the transfers capability"
            />
          </div>
          {user.stripeSyncedAt && (
            <p className="mt-4 text-xs text-[var(--muted)]">
              Last synced from Stripe {user.stripeSyncedAt.toISOString()}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
