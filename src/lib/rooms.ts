import { randomBytes } from "node:crypto";
import { prisma } from "./prisma";
import { getStripe } from "./stripe";
import {
  canTransition,
  deliveryDeadline,
  isValidPrice,
  trainerShareCents,
  type RoomStatus,
} from "./escrow";

/**
 * Coaching rooms: purchase, delivery, approval, and the timeout sweep.
 *
 * Every state change goes through `advance()`, which refuses illegal
 * transitions AND writes conditionally on the current status. That second part
 * is what makes double-spending impossible: two concurrent approvals both see
 * "delivered", but only one UPDATE matches, so only one transfer is created.
 */

/** Unguessable room URL, per the spec's leersports.com/coaching/a8f9-4b21-x99z. */
export function generatePublicId(): string {
  const hex = randomBytes(9).toString("hex"); // 18 chars, 72 bits
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 18)}`;
}

export class RoomError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/**
 * Move a room to a new status, atomically.
 *
 * `updateMany` with the expected status in the WHERE clause is deliberate: it
 * compiles to a single conditional UPDATE, so if another request has already
 * moved the room, this one matches zero rows and we know to stop. A
 * read-then-write would let two approvals both pass the check and both pay out.
 */
async function advance(
  roomId: string,
  from: RoomStatus,
  to: RoomStatus,
  data: Record<string, unknown> = {},
): Promise<boolean> {
  if (!canTransition(from, to)) {
    throw new RoomError(`Cannot go from ${from} to ${to}.`, 409);
  }
  const result = await prisma.coachingRoom.updateMany({
    where: { id: roomId, status: from },
    data: { status: to, ...data },
  });
  return result.count === 1;
}

/**
 * Trainee buys a coaching pass.
 *
 * The card is AUTHORISED, not charged. If the trainer never responds the
 * authorisation is cancelled and the trainee is never charged at all - no
 * refund fee, nothing on their statement to query.
 */
export async function createRoom(params: {
  traineeId: string;
  trainerId: string;
  videoKey: string;
  priceCents: number;
}) {
  const stripe = getStripe();
  if (!stripe) throw new RoomError("Payments are not configured.", 503);

  if (!isValidPrice(params.priceCents)) {
    throw new RoomError("That price is outside the allowed range.", 422);
  }
  if (params.traineeId === params.trainerId) {
    throw new RoomError("You cannot buy your own coaching pass.", 422);
  }

  const trainer = await prisma.user.findUnique({ where: { id: params.trainerId } });
  if (!trainer?.isTrainer || !trainer.stripeAccountId) {
    throw new RoomError("That coach is not accepting bookings.", 422);
  }
  // Re-check at purchase time rather than trusting the cached role flag: a
  // trainer whose capability lapsed between listing and checkout must not be
  // able to take money that can never be transferred to them.
  if (trainer.stripeTransfersStatus !== "active") {
    throw new RoomError("That coach cannot receive payouts right now.", 422);
  }

  const room = await prisma.coachingRoom.create({
    data: {
      publicId: generatePublicId(),
      traineeId: params.traineeId,
      trainerId: params.trainerId,
      videoKey: params.videoKey,
      priceCents: params.priceCents,
      status: "awaiting_payment",
    },
  });

  const intent = await stripe.paymentIntents.create({
    amount: params.priceCents,
    currency: room.currency,
    // Authorise now, capture when the trainer delivers.
    capture_method: "manual",
    // NOT application_fee_amount and NOT transfer_data: this is a separate
    // charge on the platform. The trainer's 80% is a separate transfer later,
    // and the 20% is simply what we do not transfer.
    //
    // payment_method_types is deliberately omitted so dynamic payment methods
    // apply - Stripe picks what is relevant for each trainee.
    metadata: { leerRoomId: room.id, leerPublicId: room.publicId },
  });

  await prisma.coachingRoom.update({
    where: { id: room.id },
    data: { paymentIntentId: intent.id },
  });

  return { room, clientSecret: intent.client_secret };
}

/**
 * The authorisation succeeded. Starts the trainer's 24 hour clock.
 *
 * Driven by the webhook rather than the browser: a trainee who closes the tab
 * mid-redirect must still get their room.
 */
export async function markPaid(roomId: string, paidAt = new Date()) {
  return advance(roomId, "awaiting_payment", "awaiting_delivery", {
    paidAt,
    deliverDueAt: deliveryDeadline(paidAt),
  });
}

/**
 * Trainer submits their feedback. This is where the money is actually captured.
 *
 * Capturing here rather than at approval is what keeps the room alive past
 * Stripe's 7-day uncaptured limit while the approval and revision windows run.
 */
export async function deliverRoom(roomId: string, trainerId: string, annotations: string) {
  const stripe = getStripe();
  if (!stripe) throw new RoomError("Payments are not configured.", 503);

  const room = await prisma.coachingRoom.findUnique({ where: { id: roomId } });
  if (!room) throw new RoomError("Room not found.", 404);
  if (room.trainerId !== trainerId) throw new RoomError("Not your room.", 403);
  if (room.status !== "awaiting_delivery") {
    throw new RoomError("This room is not awaiting delivery.", 409);
  }
  if (!room.paymentIntentId) throw new RoomError("This room has no payment.", 409);

  // Claim the transition BEFORE calling Stripe. If the capture then fails we
  // roll back; the alternative - capture first, write second - can take the
  // trainee's money and lose the record of why.
  const claimed = await advance(roomId, "awaiting_delivery", "delivered", {
    deliveredAt: new Date(),
    annotations,
  });
  if (!claimed) throw new RoomError("This room was already handled.", 409);

  try {
    await stripe.paymentIntents.capture(room.paymentIntentId);
  } catch (err) {
    await prisma.coachingRoom.updateMany({
      where: { id: roomId, status: "delivered" },
      data: { status: "awaiting_delivery", deliveredAt: null },
    });
    throw err;
  }

  return prisma.coachingRoom.findUnique({ where: { id: roomId } });
}

/**
 * Trainee accepts the feedback. Pays the trainer their 80%.
 *
 * The fee is collected by transferring less than was captured - Stripe rejects
 * application_fee_amount on a separate charge and transfer.
 */
export async function approveRoom(roomId: string, traineeId: string) {
  const stripe = getStripe();
  if (!stripe) throw new RoomError("Payments are not configured.", 503);

  const room = await prisma.coachingRoom.findUnique({
    where: { id: roomId },
    include: { trainer: true },
  });
  if (!room) throw new RoomError("Room not found.", 404);
  if (room.traineeId !== traineeId) throw new RoomError("Not your room.", 403);
  if (room.status !== "delivered") throw new RoomError("Nothing to approve yet.", 409);
  if (!room.trainer.stripeAccountId) throw new RoomError("Coach has no payout account.", 409);

  const claimed = await advance(roomId, "delivered", "released", {
    approvedAt: new Date(),
    closedAt: new Date(),
  });
  // Zero rows means a concurrent approval already paid out. Stop, do not
  // transfer again.
  if (!claimed) throw new RoomError("This room was already completed.", 409);

  const amount = trainerShareCents(room.priceCents);
  try {
    const transfer = await stripe.transfers.create(
      {
        amount,
        currency: room.currency,
        destination: room.trainer.stripeAccountId,
        transfer_group: room.id,
        metadata: { leerRoomId: room.id },
      },
      // Stripe deduplicates on this key, so a retry after a network timeout
      // cannot pay the trainer twice for one room.
      { idempotencyKey: `leer-transfer-${room.id}` },
    );
    await prisma.coachingRoom.update({
      where: { id: roomId },
      data: { transferId: transfer.id },
    });
  } catch (err) {
    // The room stays 'released' - the trainee has approved and the money is
    // captured. A failed transfer is an operational problem to retry, not a
    // reason to un-approve and re-charge anybody.
    console.error("[rooms] transfer failed for", room.id, err);
    await prisma.coachingRoom.update({
      where: { id: roomId },
      data: { closeReason: "payout_pending" },
    });
  }

  return prisma.coachingRoom.findUnique({ where: { id: roomId } });
}

/**
 * The 24 hour timeout. Cancels the authorisation so the trainee is never
 * charged. Called by the cron sweep, never by a user.
 */
export async function refundExpiredRoom(roomId: string) {
  const stripe = getStripe();
  if (!stripe) throw new RoomError("Payments are not configured.", 503);

  const room = await prisma.coachingRoom.findUnique({ where: { id: roomId } });
  if (!room || room.status !== "awaiting_delivery") return false;

  const claimed = await advance(roomId, "awaiting_delivery", "refunded", {
    closedAt: new Date(),
    closeReason: "trainer_timeout",
  });
  if (!claimed) return false;

  if (room.paymentIntentId) {
    try {
      const cancelled = await stripe.paymentIntents.cancel(room.paymentIntentId, {
        cancellation_reason: "abandoned",
      });
      await prisma.coachingRoom.update({
        where: { id: roomId },
        data: { refundId: cancelled.id },
      });
    } catch (err) {
      // Already captured somehow, or already cancelled. Leave the room
      // refunded and surface it - silently swallowing this would hide money
      // sitting in the platform balance with nobody expecting it.
      console.error("[rooms] cancel failed for", room.id, err);
      await prisma.coachingRoom.update({
        where: { id: roomId },
        data: { closeReason: "timeout_cancel_failed" },
      });
    }
  }
  return true;
}

/**
 * Who may open this room.
 *
 * The obfuscated URL is not the security boundary - it only stops the room
 * being enumerated. Access is the paying trainee and their trainer, nobody
 * else, however the link was obtained.
 */
export function mayViewRoom(
  room: { traineeId: string; trainerId: string },
  userId: string | undefined,
): boolean {
  if (!userId) return false;
  return userId === room.traineeId || userId === room.trainerId;
}
