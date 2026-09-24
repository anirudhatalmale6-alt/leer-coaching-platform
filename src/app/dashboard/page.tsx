import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import { appUrl, stripeConfigured, devShortcutsEnabled } from "@/lib/env";
import OnboardButton from "./onboard-button";
import DevConnect from "./dev-connect";
import ProfileEditor from "./profile-editor";
import PayoutBanner from "./payout-banner";
import ActiveRequests from "./active-requests";
import SessionList, { type SessionRow } from "./session-list";
import { getPayoutDestination, syncConnectStatus } from "@/lib/connect";
import { parseRequirements } from "@/lib/connect-requirements";
import { describeStatus, trainerShareCents, type RoomStatus } from "@/lib/escrow";
import { settleIfExpired } from "@/lib/rooms";
import Wordmark from "@/components/Wordmark";

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

  let user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { portfolioLinks: { orderBy: { position: "asc" }, select: { url: true } } },
  });
  if (!user) redirect("/signin");

  /**
   * Re-read the account from Stripe when the local mirror could be behind.
   *
   * Coming back from onboarding is the case that matters. Stripe does not
   * guarantee the account is final when it redirects, and the webhook may
   * arrive seconds later - so without this the trainer lands on a dashboard
   * still describing the state they had BEFORE they filled the form in. That
   * looks like the work did not take, which is what sends people round the
   * loop a second time.
   *
   * Deliberately not on every render: a settled account with nothing
   * outstanding would put a Stripe round trip in front of every page load for
   * no new information.
   */
  const mirrorMayBeStale =
    Boolean(user.stripeAccountId) &&
    (onboarding === "returned" ||
      !user.isTrainer ||
      user.stripeRequirementsOutstanding ||
      user.stripePayoutsStatus !== "active");

  if (mirrorMayBeStale) {
    try {
      await syncConnectStatus(user.id);
      user =
        (await prisma.user.findUnique({
          where: { id: user.id },
          include: { portfolioLinks: { orderBy: { position: "asc" }, select: { url: true } } },
        })) ?? user;
    } catch (err) {
      // Never let Stripe being slow stop the dashboard rendering. The stored
      // mirror is still shown, and the webhook will catch up.
      console.error("[dashboard] connect sync failed", err);
    }
  }

  const requirements = parseRequirements(user.stripeRequirements);

  /**
   * The coach's queue, and the payout destination behind the banner.
   *
   * Only fetched for trainers: a trainee has no Stripe account, and calling
   * Stripe on every dashboard render for nothing would put a network round
   * trip in front of every page load.
   */
  let activeRequests: {
    publicId: string;
    traineeName: string;
    status: string;
    priceCents: number;
    currency: string;
    deliverDueAt: string | null;
  }[] = [];
  let payout: Awaited<ReturnType<typeof getPayoutDestination>> = null;

  if (user.isTrainer) {
    const rooms = await prisma.coachingRoom.findMany({
      where: { trainerId: user.id, status: { in: ["awaiting_delivery", "delivered"] } },
      orderBy: { deliverDueAt: "asc" },
      include: { trainee: { select: { name: true, email: true } } },
    });

    // Settle anything already past its deadline before listing it, so a coach
    // is never shown a job they can no longer be paid for. Cheap and a no-op
    // unless a room is genuinely expired - see settleIfExpired().
    const live = [];
    for (const room of rooms) {
      if (room.status === "awaiting_delivery" && (await settleIfExpired(room))) continue;
      live.push(room);
    }

    activeRequests = live.map((room) => ({
      publicId: room.publicId,
      traineeName: room.trainee.name ?? room.trainee.email?.split("@")[0] ?? "Trainee",
      status: room.status,
      priceCents: room.priceCents,
      currency: room.currency,
      deliverDueAt: room.deliverDueAt?.toISOString() ?? null,
    }));

    if (user.stripeAccountId) {
      payout = await getPayoutDestination(user.stripeAccountId);
    }
  }

  /**
   * Every room this person is part of, in EITHER role.
   *
   * Queried for trainees too - that is the whole point. The coach's queue
   * above is filtered to trainerId, so without this a trainee who booked a
   * pass had no way back to it from anywhere in the app.
   */
  const mine = await prisma.coachingRoom.findMany({
    where: { OR: [{ traineeId: user.id }, { trainerId: user.id }] },
    orderBy: { createdAt: "desc" },
    take: 25,
    include: {
      trainee: { select: { name: true, email: true } },
      trainer: { select: { name: true, username: true } },
    },
  });

  const sessions: SessionRow[] = mine.map((room) => {
    const iAmTrainee = room.traineeId === user!.id;
    return {
      publicId: room.publicId,
      role: iAmTrainee ? "trainee" : "trainer",
      counterparty: iAmTrainee
        ? (room.trainer.name ?? room.trainer.username ?? "your coach")
        : (room.trainee.name ?? room.trainee.email?.split("@")[0] ?? "a trainee"),
      status: room.status as RoomStatus,
      // Each row is labelled from the side the viewer is on in THAT room -
      // the same person is the coach in some and the trainee in others.
      statusLabel: describeStatus(room.status as RoomStatus, iAmTrainee ? "trainee" : "trainer"),
      priceCents: room.priceCents,
      yourShareCents: trainerShareCents(room.priceCents),
      currency: room.currency,
      createdAt: room.createdAt.toISOString(),
    };
  });

  const publicUrl = user.username
    ? `${appUrl.replace(/^https?:\/\//, "")}/${user.username}`
    : null;

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-3xl px-6 py-14">
        <div className="flex items-start justify-between gap-6">
          <div>
            <Wordmark className="text-[var(--muted)]" />
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
          <>
            {/* Above the coach pitch on purpose: a trainee opening the
                dashboard is looking for the session they paid for, not for a
                recruitment ad. Only shown when they have one. */}
            {sessions.length > 0 && (
              <div className="mt-10">
                <SessionList sessions={sessions} />
              </div>
            )}

            <section className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
            {/*
              Somebody who has already started Stripe must NOT be shown "Connect
              a Stripe account" as though nothing happened. Coming back from the
              form to the same cold call-to-action is indistinguishable from
              having failed, and it is the single most likely moment for a
              trainer to give up.
            */}
            {user.stripeAccountId ? (
              <>
                <h2 className="text-lg font-semibold">Stripe is checking your details</h2>
                <p className="mt-2 max-w-lg text-sm leading-relaxed text-[var(--muted)]">
                  Your form is in. Stripe usually confirms within a minute or
                  two, and your account switches to Trainer on its own - you do
                  not need to fill anything in again. Refresh this page to check.
                </p>

                {requirements.blocking.length > 0 && (
                  <div className="mt-4 rounded-lg border border-[var(--warn)]/40 bg-[var(--warn)]/10 p-4">
                    <p className="text-sm text-[var(--warn)]">
                      Stripe still needs this from you:
                    </p>
                    <ul className="mt-1.5 list-disc pl-5 text-sm">
                      {requirements.blocking.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {stripeConfigured && <OnboardButton resume />}
              </>
            ) : (
              <>
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
              </>
            )}

            {devShortcutsEnabled && <DevConnect />}
            </section>
          </>
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
              <PayoutBanner
                transfersStatus={user.stripeTransfersStatus}
                payoutsStatus={user.stripePayoutsStatus}
                requirements={requirements}
                country={user.stripeCountry}
                bankName={payout?.bankName ?? null}
                last4={payout?.last4 ?? null}
                hasAccount={Boolean(user.stripeAccountId)}
              />
            </div>

            <div className="mt-6">
              <ActiveRequests requests={activeRequests} />
            </div>

            <div className="mt-6">
              <SessionList sessions={sessions} />
            </div>

            <div className="mt-6">
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

        {/*
          A raw diagnostic, not a status for the trainer.

          This panel used to be shown to everyone, and its "Stripe has
          everything it needs: Not yet" row is what told a fully active trainer
          - transfers AND payouts both live - that he still had work to do. The
          note was wrong too: most outstanding requirements are eventually_due
          and block nothing at all. The banner above is now the trainer-facing
          answer; this stays for debugging only.
        */}
        {devShortcutsEnabled && (
          <section data-dev-panel className="mt-8 rounded-xl border border-dashed border-[var(--border)] p-6">
            <h2 className="text-xs font-semibold tracking-[0.2em] text-[var(--muted)]">
              DEV - RAW CONNECT MIRROR
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
                label="Can pay out to a bank"
                ok={user.stripePayoutsStatus === "active"}
                note={`stripe_balance.payouts = ${user.stripePayoutsStatus ?? "not requested"}`}
              />
              <Row
                label="Nothing blocking"
                ok={requirements.blocking.length === 0}
                note={
                  requirements.blocking.length
                    ? `blocking: ${requirements.blocking.join(", ")}`
                    : `upcoming (non-blocking): ${requirements.upcoming.join(", ") || "none"}`
                }
              />
            </div>
            {user.stripeSyncedAt && (
              <p className="mt-4 text-xs text-[var(--muted)]">
                Last synced from Stripe {user.stripeSyncedAt.toISOString()}
              </p>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
