/**
 * The escrow state machine and its money arithmetic.
 *
 * Pure functions only - no Stripe, no database. Everything here is directly
 * testable, because this is the file where a mistake costs somebody real money.
 *
 * THE FLOW
 *
 *   awaiting_payment
 *        | trainee's card is authorised (capture_method: manual)
 *        v
 *   awaiting_delivery ------ 24h passes with no delivery ------> refunded
 *        |                   (authorisation cancelled: the trainee
 *        | trainer delivers   was never actually charged)
 *        v
 *   delivered  -------- trainee approves, or the approval window lapses ----->  released
 *                                                     (80% transferred to trainer)
 *
 * WHY AUTHORISE-THEN-CAPTURE RATHER THAN CHARGE-THEN-REFUND
 *
 * If the trainer never shows up, cancelling an authorisation means the trainee
 * was never charged at all: no refund fee, no chargeback exposure, and nothing
 * on their statement to be confused by. A refund would cost the platform the
 * processing fee on every no-show.
 *
 * WHY WE CAPTURE ON DELIVERY RATHER THAN ON APPROVAL
 *
 * Stripe cancels uncaptured PaymentIntents after 7 days by default. The
 * approval and revision windows in the spec can run past that, so an
 * authorisation held until approval would be voided by Stripe with the work
 * already done. Capturing at delivery moves the money into the platform
 * balance, where it can sit as long as the dispute rules need.
 */

export const PLATFORM_FEE_BPS = 2000; // 20%, in basis points
export const DELIVERY_WINDOW_HOURS = 24;

/**
 * How long the trainee has to approve or dispute after the coach delivers.
 *
 * The client settled this: 24h auto-approval wins and the spec's 72h revision
 * window is scrapped. When it lapses with no dispute, the cron releases the
 * money - the coach has done the work and must not wait on an inattentive
 * trainee.
 */
export const APPROVAL_WINDOW_HOURS = 24;

/**
 * How many times a coach may answer a dispute with revised work.
 *
 * Each resubmission gives the trainee a fresh 24 hours to look, which is only
 * fair - but it also restarts the clock, so an uncapped loop would let a room
 * ping-pong indefinitely and quietly destroy the auto-approval promise. Two is
 * enough for "I misread the lift" and "I missed your note"; beyond that the
 * disagreement is not about the drawing, and the honest exits are approval or
 * a mutual refund.
 */
export const MAX_RESUBMITS = 2;

/** May the coach still answer this dispute with revised work? */
export function mayResubmit(room: { status: string; resubmitCount: number }): boolean {
  return room.status === "disputed" && room.resubmitCount < MAX_RESUBMITS;
}

/** Coaching pass price bounds, from the spec. */
export const MIN_PRICE_CENTS = 30_00;
export const MAX_PRICE_CENTS = 500_00;

export type RoomStatus =
  | "awaiting_payment"
  | "awaiting_delivery"
  | "delivered"
  | "disputed"
  | "released"
  | "refunded"
  | "cancelled";

/**
 * The trainer's cut, in the smallest currency unit.
 *
 * Integer arithmetic throughout, and the platform takes the remainder. Doing
 * this in floats would eventually hand a trainer a fraction of a cent, which
 * Stripe rejects outright; rounding the trainer's share DOWN means the split
 * always sums back to exactly the amount charged, with any odd cent staying
 * with the platform rather than being conjured from nowhere.
 *
 * NOTE: this is NOT `application_fee_amount`. Under separate charges and
 * transfers the platform collects its fee by transferring LESS than it
 * captured; application_fee_amount belongs to destination and direct charges
 * and Stripe rejects it here.
 */
export function trainerShareCents(priceCents: number): number {
  if (!Number.isInteger(priceCents) || priceCents < 0) {
    throw new Error("priceCents must be a non-negative integer");
  }
  return Math.floor((priceCents * (10_000 - PLATFORM_FEE_BPS)) / 10_000);
}

/** What LEER keeps. Defined as the remainder so the two always reconcile. */
export function platformFeeCents(priceCents: number): number {
  return priceCents - trainerShareCents(priceCents);
}

export function isValidPrice(priceCents: number): boolean {
  return (
    Number.isInteger(priceCents) &&
    priceCents >= MIN_PRICE_CENTS &&
    priceCents <= MAX_PRICE_CENTS
  );
}

/** When the trainer's 24 hours run out. */
export function deliveryDeadline(paidAt: Date): Date {
  return new Date(paidAt.getTime() + DELIVERY_WINDOW_HOURS * 60 * 60 * 1000);
}

/** When the trainee's window to approve or dispute runs out. */
export function approvalDeadline(deliveredAt: Date): Date {
  return new Date(deliveredAt.getTime() + APPROVAL_WINDOW_HOURS * 60 * 60 * 1000);
}

/**
 * Should this room be auto-approved and paid out?
 *
 * THE STATUS CHECK IS THE SAFETY RULE. A disputed room has a different status,
 * so it can never be swept into a payout while the two sides are still
 * arguing - which would be the worst possible failure of this feature:
 * the platform paying out the money the trainee is actively contesting.
 */
export function isAutoApprovable(
  room: { status: string; approveDueAt: Date | null },
  now: Date,
): boolean {
  if (room.status !== "delivered") return false;
  if (!room.approveDueAt) return false;
  return room.approveDueAt.getTime() <= now.getTime();
}

/**
 * Who may still act on a mutual refund proposal.
 *
 * A proposal needs the OTHER party to accept it. Letting the proposer accept
 * their own would turn "mutual consent" into a one-sided refund button - a
 * trainee could take the feedback and then refund themselves.
 */
export function mayAcceptRefund(
  proposal: { proposedById: string | null },
  userId: string,
): boolean {
  return Boolean(proposal.proposedById) && proposal.proposedById !== userId;
}

/**
 * What a full refund costs the platform.
 *
 * MEASURED against the live Stripe test API, not assumed: on a $65.00 charge
 * Stripe took $2.19 and returned NONE of it on a full refund. The refund's
 * balance transaction carries `fee: 0` and no fee details, so the platform is
 * simply out the original processing fee.
 *
 * Consequence for the product: a refund is free for the trainee - they get
 * every cent back - but it is NOT free for LEER. Before delivery the money is
 * only authorised, so cancelling costs nothing; after delivery it has been
 * captured and a refund costs the fee. Cancel where possible, refund only
 * where necessary.
 */
export function refundCostsPlatformFee(room: { status: string }): boolean {
  // Only a captured payment has had a fee taken. Delivery is what captures.
  return room.status === "delivered" || room.status === "disputed";
}

/**
 * Legal transitions. Anything not listed is rejected.
 *
 * An allowlist rather than a set of `if` statements on purpose: a room that
 * has already been released must never be releasable again, and the only
 * reliable way to guarantee that is to make every transition enumerable and
 * testable.
 */
const TRANSITIONS: Record<RoomStatus, RoomStatus[]> = {
  awaiting_payment: ["awaiting_delivery", "cancelled"],
  awaiting_delivery: ["delivered", "refunded", "cancelled"],
  delivered: ["released", "refunded", "disputed"],
  /**
   * A dispute ends three ways: the trainee accepts after all, both sides agree
   * a refund, or THE COACH FIXES THE WORK AND RESUBMITS.
   *
   * That third path was missing, and its absence was a real hole. The room
   * told both people to "sort it out between you" while giving the coach no
   * means to do so - their only lever was offering a full refund, which forces
   * them to forfeit payment for work that might just need a clarifying line.
   *
   * It is capped rather than unlimited. Going back to `delivered` restarts the
   * approval clock, so without a limit the two of them could bounce a room
   * between states forever and the auto-approval guarantee would mean nothing.
   * See MAX_RESUBMITS.
   */
  disputed: ["released", "refunded", "delivered"],
  // Terminal.
  released: [],
  refunded: [],
  cancelled: [],
};

export function canTransition(from: RoomStatus, to: RoomStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminal(status: RoomStatus): boolean {
  return TRANSITIONS[status]?.length === 0;
}

/**
 * Is this room past its delivery deadline and still undelivered?
 *
 * Used by the sweep. Deliberately strict about the status: a room that has been
 * delivered, released or already refunded must never be swept, however old its
 * deadline is.
 */
export function isExpired(
  room: { status: string; deliverDueAt: Date | null },
  now: Date,
): boolean {
  if (room.status !== "awaiting_delivery") return false;
  if (!room.deliverDueAt) return false;
  return room.deliverDueAt.getTime() <= now.getTime();
}

/** Which side of the room the reader is on. */
export type Viewer = "trainee" | "trainer";

/**
 * Human-readable state, FROM THE READER'S SIDE.
 *
 * The same room means different things to the two people in it, and a single
 * label cannot serve both. "With your coach" told the coach that the work was
 * with their coach - they ARE the coach, and what they needed to know was that
 * it was waiting on them. A status line that describes somebody else's
 * situation is worse than no status line.
 *
 * Only the states where the two genuinely differ are split; the rest read the
 * same to everyone and are deliberately not duplicated.
 */
export function describeStatus(status: RoomStatus, viewer: Viewer = "trainee"): string {
  const isCoach = viewer === "trainer";
  switch (status) {
    case "awaiting_payment":
      return "Waiting for payment";
    case "awaiting_delivery":
      return isCoach ? "Waiting on you" : "With your coach";
    case "delivered":
      return isCoach ? "Delivered - awaiting approval" : "Feedback ready for review";
    case "disputed":
      return "Disputed - being resolved";
    case "released":
      return isCoach ? "Complete - you were paid" : "Complete - coach paid";
    case "refunded":
      return "Refunded";
    case "cancelled":
      return "Cancelled";
  }
}
