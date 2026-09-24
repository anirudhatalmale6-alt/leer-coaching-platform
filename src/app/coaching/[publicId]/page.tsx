import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { signPlayback, storageConfigured } from "@/lib/storage/r2";
import { devShortcutsEnabled } from "@/lib/env";
import { describeStatus, platformFeeCents, trainerShareCents, type RoomStatus } from "@/lib/escrow";
import { mayViewRoom, settleApprovalIfLapsed, settleIfExpired } from "@/lib/rooms";
import RoomView from "./room-view";

/**
 * The coaching room.
 *
 * SESSION GUARD: the obfuscated URL only stops the room being enumerated - it
 * is not the security boundary. Access is the paying trainee and their trainer
 * and nobody else, checked server-side on every render, however the link was
 * obtained. A signed-out visitor is sent to sign in; a signed-in stranger gets
 * a 404 rather than a 403, because confirming the room exists is itself a
 * disclosure.
 */
export default async function CoachingRoomPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await params;
  const session = await auth();

  const room = await prisma.coachingRoom.findUnique({
    where: { publicId },
    include: {
      trainer: { select: { id: true, name: true, username: true } },
      trainee: { select: { id: true, name: true, email: true } },
    },
  });

  if (!room) notFound();

  if (!session?.user?.id) {
    redirect(`/signin?next=${encodeURIComponent(`/coaching/${publicId}`)}`);
  }
  if (!mayViewRoom(room, session.user.id)) notFound();

  /**
   * Settle anything the clock has already decided, rather than waiting for the
   * next scheduled sweep - Vercel's free tier runs cron once a day, which
   * would stretch a 24 hour promise to as much as 48.
   *
   * Two separate deadlines: the coach failing to deliver (cancel the
   * authorisation) and the trainee's approval window lapsing (pay the coach).
   * Both are no-ops unless genuinely due, and both claim their transition
   * conditionally, so neither can race the sweep.
   */
  const settled =
    (await settleIfExpired(room)) || (await settleApprovalIfLapsed(room));
  if (settled) {
    const fresh = await prisma.coachingRoom.findUnique({ where: { publicId } });
    if (fresh) {
      room.status = fresh.status;
      room.closeReason = fresh.closeReason;
    }
  }

  const isTrainer = session.user.id === room.trainerId;

  // Playback is a fresh short-lived signature per view; the bucket is private.
  let videoUrl: string | null = null;

  /**
   * DEVELOPMENT ONLY: a room whose clip is a local sample.
   *
   * Without this a coaching room cannot be exercised locally at all - the
   * bucket only accepts the deployed origins, so the video never loads, the
   * canvas has no viewport, and every pointer lands "outside the video". That
   * silently made the annotation fix untestable, which is how a broken save
   * path survived in the first place.
   *
   * Gated on the same flag as the other dev shortcuts and deleted with them
   * before launch - see DEPLOY.md.
   */
  if (devShortcutsEnabled && room.videoKey.startsWith("dev-local/")) {
    videoUrl = "/sample-coaching-a.mp4";
  } else if (storageConfigured()) {
    try {
      videoUrl = await signPlayback(room.videoKey, 3600);
    } catch {
      videoUrl = null;
    }
  }

  return (
    <RoomView
      publicId={room.publicId}
      status={room.status as RoomStatus}
      statusLabel={describeStatus(room.status as RoomStatus, isTrainer ? "trainer" : "trainee")}
      isTrainer={isTrainer}
      trainerName={room.trainer.name ?? room.trainer.username ?? "Your coach"}
      traineeName={room.trainee.name ?? "Trainee"}
      priceCents={room.priceCents}
      trainerShare={trainerShareCents(room.priceCents)}
      platformFee={platformFeeCents(room.priceCents)}
      currency={room.currency}
      videoUrl={videoUrl}
      deliverDueAt={room.deliverDueAt?.toISOString() ?? null}
      annotations={room.annotations}
      focusNote={room.focusNote}
      videoCodec={room.videoCodec}
      approveDueAt={room.approveDueAt?.toISOString() ?? null}
      disputeReason={room.disputeReason}
      refundProposedByMe={
        room.refundProposedById ? room.refundProposedById === session.user.id : null
      }
      refundReason={room.refundReason}
      closeReason={room.closeReason}
      payoutSent={Boolean(room.transferId)}
      resubmitCount={room.resubmitCount}
    />
  );
}
