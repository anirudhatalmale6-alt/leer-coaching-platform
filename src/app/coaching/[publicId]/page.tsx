import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { signPlayback, storageConfigured } from "@/lib/storage/r2";
import { describeStatus, platformFeeCents, trainerShareCents, type RoomStatus } from "@/lib/escrow";
import { mayViewRoom, settleIfExpired } from "@/lib/rooms";
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

  // If the trainer's 24 hours ran out, settle it now rather than waiting for
  // the next scheduled sweep - see settleIfExpired().
  if (await settleIfExpired(room)) {
    const settled = await prisma.coachingRoom.findUnique({ where: { publicId } });
    if (settled) room.status = settled.status;
  }

  const isTrainer = session.user.id === room.trainerId;

  // Playback is a fresh short-lived signature per view; the bucket is private.
  let videoUrl: string | null = null;
  if (storageConfigured()) {
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
      statusLabel={describeStatus(room.status as RoomStatus)}
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
    />
  );
}
