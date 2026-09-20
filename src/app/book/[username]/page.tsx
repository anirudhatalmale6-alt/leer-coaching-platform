import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { getPublicProfile } from "@/lib/profile-store";
import { formatPrice, isSellable } from "@/lib/profile";
import BookingFlow from "./booking-flow";

/**
 * Book a coaching pass: upload the clip, say what to look at, then pay.
 *
 * A page rather than the spec's modal. The step that actually takes time is a
 * 100MB upload from a phone, and a modal that must stay open through it is a
 * tab-close away from losing the whole thing - a full page survives a rotation,
 * a notification, and the browser reclaiming memory behind it.
 */
export default async function BookPage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ cancelled?: string }>;
}) {
  const { username } = await params;
  const { cancelled } = await searchParams;

  const trainer = await getPublicProfile(username);
  if (!trainer || !trainer.isTrainer) notFound();

  // Sign in first, then come back here rather than landing on the dashboard -
  // the visitor arrived to buy something specific.
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/signin?next=${encodeURIComponent(`/book/${trainer.username}`)}`);
  }

  if (!isSellable(trainer)) {
    return (
      <main className="mx-auto w-full max-w-lg flex-1 px-5 py-16 text-center">
        <h1 className="text-xl font-semibold">Not taking bookings</h1>
        <p className="mt-3 text-sm text-[var(--muted)]">
          {trainer.name ?? trainer.username} has paused new coaching requests.
        </p>
        <Link href={`/${trainer.username}`} className="mt-6 inline-block text-sm underline">
          Back to their page
        </Link>
      </main>
    );
  }

  const ownPage = session.user.id === trainer.id;

  return (
    <main className="flex-1">
      <div className="mx-auto w-full max-w-lg px-5 py-10">
        <Link href={`/${trainer.username}`} className="text-sm text-[var(--muted)] hover:underline">
          &larr; {trainer.name ?? trainer.username}
        </Link>

        <h1 className="mt-4 text-2xl font-semibold">Book 1:1 video coaching</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          {trainer.name ?? trainer.username} &middot;{" "}
          {formatPrice(trainer.coachingPriceCents)} &middot; delivered within 24 hours
        </p>

        {cancelled && (
          <p className="mt-6 rounded-lg border border-[var(--warn)]/40 bg-[var(--warn)]/10 p-4 text-sm text-[var(--warn)]">
            Payment was cancelled - nothing was charged. Your clip is still
            uploaded, so you can start again below.
          </p>
        )}

        {ownPage ? (
          <p className="mt-8 rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">
            This is your own coaching page. You cannot book yourself.
          </p>
        ) : (
          <div className="mt-8">
            <BookingFlow
              username={trainer.username!}
              priceLabel={formatPrice(trainer.coachingPriceCents)}
            />
          </div>
        )}
      </div>
    </main>
  );
}
