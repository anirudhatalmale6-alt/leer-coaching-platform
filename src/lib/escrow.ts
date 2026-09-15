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

/** Coaching pass price bounds, from the spec. */
export const MIN_PRICE_CENTS = 30_00;
export const MAX_PRICE_CENTS = 500_00;

export type RoomStatus =
  | "awaiting_payment"
  | "awaiting_delivery"
  | "delivered"
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
  delivered: ["released", "refunded"],
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

/** Human-readable state for the room screen. */
export function describeStatus(status: RoomStatus): string {
  switch (status) {
    case "awaiting_payment":
      return "Waiting for payment";
    case "awaiting_delivery":
      return "With your coach";
    case "delivered":
      return "Feedback ready for review";
    case "released":
      return "Complete - coach paid";
    case "refunded":
      return "Refunded";
    case "cancelled":
      return "Cancelled";
  }
}
