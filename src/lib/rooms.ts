import { randomBytes } from "node:crypto";
import { prisma } from "./prisma";
import { getStripe } from "./stripe";
import { appUrl } from "./env";
import {
  canTransition,
  deliveryDeadline,
  isExpired,
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
 * THE PRICE IS READ FROM THE TRAINER'S PROFILE, NEVER FROM THE CALLER.
 *
 * This used to accept a priceCents argument that came from the request body,
 * which meant a trainee could book a $50 pass for the $30 minimum just by
 * editing the request. The only range check was that the number was within the
 * platform's bounds - which $30 is. Now the browser says which coach, and the
 * server decides what that costs.
 *
 * The card is AUTHORISED, not charged. If the trainer never responds the
 * authorisation is cancelled and the trainee is never charged at all - no
 * refund fee, nothing on their statement to query.
 */
export async function createRoom(params: {
  traineeId: string;
  trainerId: string;
  videoKey: string;
  videoCodec?: string;
  focusNote?: string;
}) {
  const stripe = getStripe();
  if (!stripe) throw new RoomError("Payments are not configured.", 503);

  if (params.traineeId === params.trainerId) {
    throw new RoomError("You cannot buy your own coaching pass.", 422);
  }

  const trainer = await prisma.user.findUnique({ where: { id: params.trainerId } });
  if (!trainer?.isTrainer || !trainer.stripeAccountId) {
    throw new RoomError("That coach is not accepting bookings.", 422);
  }
  if (!trainer.coachingEnabled) {
    throw new RoomError("This coach has paused new bookings.", 422);
  }
  // Re-check at purchase time rather than trusting the cached role flag: a
  // trainer whose capability lapsed between listing and checkout must not be
  // able to take money that can never be transferred to them.
  if (trainer.stripeTransfersStatus !== "active") {
    throw new RoomError("That coach cannot receive payouts right now.", 422);
  }

  const priceCents = trainer.coachingPriceCents;
  if (!isValidPrice(priceCents)) {
    // Only reachable if the bounds were tightened after a profile was saved.
    // Refusing is the safe side: charging an out-of-bounds price is worse than
    // a coach finding their page temporarily unbookable.
    throw new RoomError("This coach's price needs updating before they can be booked.", 422);
  }

  const room = await prisma.coachingRoom.create({
    data: {
      publicId: generatePublicId(),
      traineeId: params.traineeId,
      trainerId: params.trainerId,
      videoKey: params.videoKey,
      videoCodec: params.videoCodec ?? null,
      priceCents,
      focusNote: params.focusNote || null,
      status: "awaiting_payment",
    },
  });

  /**
   * Stripe Checkout, per the client's UI spec, with manual capture.
   *
   * The hosted page handles SCA, 3-D Secure and each country's payment methods
   * without LEER holding card data or building a card form - which matters for
   * a platform whose selling point is that trainers and trainees are anywhere.
   *
   * What it does NOT change is the escrow: `capture_method: manual` produces
   * exactly the same authorised PaymentIntent the direct integration did, so
   * delivery captures it, approval transfers 80%, and a timeout cancels it,
   * all unchanged.
   *
   * NOT application_fee_amount and NOT transfer_data: this is a separate charge
   * on the platform. The trainer's 80% is a separate transfer later, and the
   * 20% is simply what we do not transfer.
   */
  const checkout = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: room.currency,
            unit_amount: priceCents,
            product_data: {
              name: `1:1 video coaching with ${trainer.name ?? trainer.username ?? "your coach"}`,
              description: "Frame-by-frame video analysis delivered within 24 hours.",
            },
          },
        },
      ],
      payment_intent_data: {
        capture_method: "manual",
        // The webhook finds the room from here. It is set on the PaymentIntent
        // rather than only on the Session because amount_capturable_updated
        // carries the PaymentIntent, not the Session.
        metadata: { leerRoomId: room.id, leerPublicId: room.publicId },
      },
      metadata: { leerRoomId: room.id, leerPublicId: room.publicId },
      client_reference_id: room.id,
      success_url: `${appUrl}/coaching/${room.publicId}?paid=1`,
      cancel_url: `${appUrl}/book/${trainer.username ?? ""}?cancelled=1`,
    },
    // A double-clicked booking button must not open two rooms and two
    // authorisations on the same clip.
    { idempotencyKey: `leer-checkout-${room.id}` },
  );

  await prisma.coachingRoom.update({
    where: { id: room.id },
    data: { checkoutSessionId: checkout.id },
  });

  return { room, checkoutUrl: checkout.url };
}

/**
 * The authorisation succeeded. Starts the trainer's 24 hour clock.
 *
 * Driven by the webhook rather than the browser: a trainee who closes the tab
 * mid-redirect must still get their room.
 */
export async function markPaid(
  roomId: string,
  paidAt = new Date(),
  paymentIntentId?: string,
) {
  const moved = await advance(roomId, "awaiting_payment", "awaiting_delivery", {
    paidAt,
    deliverDueAt: deliveryDeadline(paidAt),
    // Checkout mints the PaymentIntent, so this is the first moment the room
    // learns its id - and delivery cannot capture without it.
    ...(paymentIntentId ? { paymentIntentId } : {}),
  });

  /**
   * Record the PaymentIntent even if the room had already moved on.
   *
   * Without this, a redelivered or out-of-order event leaves a paid room with
   * no paymentIntentId and delivery fails with "this room has no payment" -
   * money taken, work done, nothing capturable.
   */
  if (!moved && paymentIntentId) {
    await prisma.coachingRoom.updateMany({
      where: { id: roomId, paymentIntentId: null },
      data: { paymentIntentId },
    });
  }

  return moved;
}

/**
 * The trainee abandoned the hosted payment page and Stripe expired it.
 *
 * Without this the room sits in awaiting_payment forever, showing up as a live
 * booking to nobody's benefit. No money has moved, so there is nothing to
 * refund.
 */
export async function cancelAbandonedCheckout(sessionId: string) {
  const room = await prisma.coachingRoom.findUnique({
    where: { checkoutSessionId: sessionId },
  });
  if (!room || room.status !== "awaiting_payment") return false;
  return advance(room.id, "awaiting_payment", "cancelled", {
    closedAt: new Date(),
    closeReason: "checkout_abandoned",
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
 * Settle this one room if its deadline has passed.
 *
 * The scheduled sweep is the guarantee, but it cannot be the only mechanism:
 * Vercel's free tier allows a cron job only ONCE PER DAY, which would stretch
 * the promised "refunded after 24 hours" into as much as 48. Checking the room
 * whenever somebody actually looks at it means the common case - a trainee
 * coming back to see what happened - resolves immediately regardless of how
 * often the scheduler runs.
 *
 * Safe to call on every render: it is a no-op unless the room is genuinely
 * expired, and refundExpiredRoom claims the transition conditionally, so it
 * cannot race the sweep into a double refund.
 */
export async function settleIfExpired(room: {
  id: string;
  status: string;
  deliverDueAt: Date | null;
}): Promise<boolean> {
  if (!isExpired(room, new Date())) return false;
  try {
    return await refundExpiredRoom(room.id);
  } catch (err) {
    // Never let a settlement failure stop the page rendering - the scheduled
    // sweep will pick it up.
    console.error("[rooms] opportunistic settle failed for", room.id, err);
    return false;
  }
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
