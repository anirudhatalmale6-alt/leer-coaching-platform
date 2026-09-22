import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  DELIVERY_WINDOW_HOURS,
  MAX_PRICE_CENTS,
  MIN_PRICE_CENTS,
  approvalDeadline,
  canTransition,
  deliveryDeadline,
  isAutoApprovable,
  isExpired,
  isTerminal,
  isValidPrice,
  mayAcceptRefund,
  platformFeeCents,
  refundCostsPlatformFee,
  trainerShareCents,
  type RoomStatus,
} from "../src/lib/escrow";

describe("the 80/20 split", () => {
  test("splits a clean amount exactly", () => {
    assert.equal(trainerShareCents(10_000), 8_000);
    assert.equal(platformFeeCents(10_000), 2_000);
  });

  test("the two halves ALWAYS reconcile to the amount charged", () => {
    // The property that actually matters. If these ever fail to sum, the
    // platform is either inventing money or losing it.
    for (let cents = MIN_PRICE_CENTS; cents <= MAX_PRICE_CENTS; cents += 1) {
      const trainer = trainerShareCents(cents);
      const fee = platformFeeCents(cents);
      assert.equal(trainer + fee, cents, `split failed at ${cents}`);
      assert.ok(Number.isInteger(trainer), `non-integer trainer share at ${cents}`);
      assert.ok(Number.isInteger(fee), `non-integer fee at ${cents}`);
      assert.ok(trainer >= 0 && fee >= 0, `negative component at ${cents}`);
    }
  });

  test("an odd cent goes to the platform, never invented", () => {
    // 3333 * 0.8 = 2666.4. The trainer gets 2666, LEER keeps 667.
    assert.equal(trainerShareCents(3_333), 2_666);
    assert.equal(platformFeeCents(3_333), 667);
    assert.equal(2_666 + 667, 3_333);
  });

  test("never produces a fractional cent, which Stripe would reject", () => {
    for (const cents of [3_001, 4_999, 7_777, 12_345, 49_999]) {
      assert.ok(Number.isInteger(trainerShareCents(cents)), `fraction at ${cents}`);
    }
  });

  test("floating point cannot creep in", () => {
    // 0.1 + 0.2 !== 0.3. Guard that nobody 'simplifies' this to float maths.
    assert.equal(trainerShareCents(3_000), 2_400);
    assert.notEqual(3_000 * 0.8, 2_400.0000000000005); // sanity on the constant
    assert.equal(trainerShareCents(3_000) + platformFeeCents(3_000), 3_000);
  });

  test("rejects a non-integer or negative amount rather than guessing", () => {
    assert.throws(() => trainerShareCents(10.5));
    assert.throws(() => trainerShareCents(-100));
  });

  test("zero splits to zero, without dividing by anything", () => {
    assert.equal(trainerShareCents(0), 0);
    assert.equal(platformFeeCents(0), 0);
  });
});

describe("price bounds from the spec", () => {
  test("accepts the documented range", () => {
    assert.equal(isValidPrice(MIN_PRICE_CENTS), true);
    assert.equal(isValidPrice(MAX_PRICE_CENTS), true);
    assert.equal(isValidPrice(5_000), true);
  });

  test("rejects outside it", () => {
    assert.equal(isValidPrice(MIN_PRICE_CENTS - 1), false);
    assert.equal(isValidPrice(MAX_PRICE_CENTS + 1), false);
    assert.equal(isValidPrice(0), false);
  });

  test("rejects a fractional price outright", () => {
    assert.equal(isValidPrice(3_000.5), false);
  });
});

describe("delivery deadline", () => {
  test("is exactly 24 hours after payment", () => {
    const paid = new Date("2026-09-13T10:00:00.000Z");
    assert.equal(deliveryDeadline(paid).toISOString(), "2026-09-14T10:00:00.000Z");
    assert.equal(DELIVERY_WINDOW_HOURS, 24);
  });

  test("survives a daylight-saving boundary, because it is pure UTC maths", () => {
    // Adding "1 day" in local time would shift by 23 or 25 hours here.
    const beforeDst = new Date("2026-10-24T23:30:00.000Z");
    const due = deliveryDeadline(beforeDst);
    assert.equal(due.getTime() - beforeDst.getTime(), 24 * 60 * 60 * 1000);
  });
});

describe("the sweep's expiry rule", () => {
  const due = new Date("2026-09-14T10:00:00.000Z");
  const after = new Date("2026-09-14T10:00:01.000Z");
  const before = new Date("2026-09-14T09:59:59.000Z");

  test("sweeps an undelivered room past its deadline", () => {
    assert.equal(isExpired({ status: "awaiting_delivery", deliverDueAt: due }, after), true);
  });

  test("does not sweep before the deadline", () => {
    assert.equal(isExpired({ status: "awaiting_delivery", deliverDueAt: due }, before), false);
  });

  test("sweeps exactly ON the deadline", () => {
    assert.equal(isExpired({ status: "awaiting_delivery", deliverDueAt: due }, due), true);
  });

  test("NEVER sweeps a room the trainer already delivered", () => {
    // The money-losing case: the coach did the work, the sweep refunds anyway.
    assert.equal(isExpired({ status: "delivered", deliverDueAt: due }, after), false);
  });

  test("never sweeps a released, refunded or cancelled room", () => {
    for (const status of ["released", "refunded", "cancelled"]) {
      assert.equal(isExpired({ status, deliverDueAt: due }, after), false, status);
    }
  });

  test("never sweeps a room that was never paid for", () => {
    assert.equal(isExpired({ status: "awaiting_payment", deliverDueAt: due }, after), false);
  });

  test("a room with no deadline is never swept", () => {
    assert.equal(isExpired({ status: "awaiting_delivery", deliverDueAt: null }, after), false);
  });
});

describe("state machine", () => {
  test("follows the happy path", () => {
    assert.equal(canTransition("awaiting_payment", "awaiting_delivery"), true);
    assert.equal(canTransition("awaiting_delivery", "delivered"), true);
    assert.equal(canTransition("delivered", "released"), true);
  });

  test("allows the timeout refund", () => {
    assert.equal(canTransition("awaiting_delivery", "refunded"), true);
  });

  test("a released room can NEVER be released or refunded again", () => {
    // Double-release means paying a trainer twice out of a single charge.
    assert.equal(canTransition("released", "released"), false);
    assert.equal(canTransition("released", "refunded"), false);
    assert.equal(isTerminal("released"), true);
  });

  test("a refunded room can never then be released", () => {
    assert.equal(canTransition("refunded", "released"), false);
    assert.equal(isTerminal("refunded"), true);
  });

  test("cannot skip delivery straight to released", () => {
    assert.equal(canTransition("awaiting_delivery", "released"), false);
  });

  test("cannot release something that was never paid for", () => {
    assert.equal(canTransition("awaiting_payment", "released"), false);
    assert.equal(canTransition("awaiting_payment", "delivered"), false);
  });

  test("cannot go backwards", () => {
    assert.equal(canTransition("delivered", "awaiting_delivery"), false);
    assert.equal(canTransition("awaiting_delivery", "awaiting_payment"), false);
  });

  test("every status is covered by the table", () => {
    const all: RoomStatus[] = [
      "awaiting_payment",
      "awaiting_delivery",
      "delivered",
      "released",
      "refunded",
      "cancelled",
    ];
    for (const s of all) {
      // Throws or returns undefined if a status were missing from TRANSITIONS.
      assert.equal(typeof isTerminal(s), "boolean", s);
    }
  });
});

describe("disputes and auto-approval (P2-M3)", () => {
  test("a delivered room can be disputed", () => {
    assert.equal(canTransition("delivered", "disputed"), true);
  });

  test("a dispute ends only as released or refunded", () => {
    assert.equal(canTransition("disputed", "released"), true);
    assert.equal(canTransition("disputed", "refunded"), true);
    // Going back would restart the approval clock and make the auto-approval
    // deadline meaningless.
    assert.equal(canTransition("disputed", "delivered"), false);
    assert.equal(canTransition("disputed", "cancelled"), false);
    assert.equal(canTransition("disputed", "disputed"), false);
  });

  test("a dispute cannot be raised once the money has moved", () => {
    assert.equal(canTransition("released", "disputed"), false);
    assert.equal(canTransition("refunded", "disputed"), false);
    assert.equal(canTransition("cancelled", "disputed"), false);
  });

  test("you cannot dispute before the coach has delivered", () => {
    // There is nothing to dispute yet, and the timeout refund already covers
    // a coach who never shows up.
    assert.equal(canTransition("awaiting_delivery", "disputed"), false);
    assert.equal(canTransition("awaiting_payment", "disputed"), false);
  });

  test("disputed is not terminal, released and refunded are", () => {
    assert.equal(isTerminal("disputed"), false);
    assert.equal(isTerminal("released"), true);
    assert.equal(isTerminal("refunded"), true);
  });
});

describe("approvalDeadline", () => {
  test("is 24 hours after delivery", () => {
    const delivered = new Date("2026-09-21T10:00:00.000Z");
    assert.equal(approvalDeadline(delivered).toISOString(), "2026-09-22T10:00:00.000Z");
  });
});

describe("isAutoApprovable", () => {
  const now = new Date("2026-09-22T12:00:00.000Z");
  const past = new Date("2026-09-22T11:00:00.000Z");
  const future = new Date("2026-09-22T13:00:00.000Z");

  test("releases a delivered room once the window has lapsed", () => {
    assert.equal(isAutoApprovable({ status: "delivered", approveDueAt: past }, now), true);
  });

  test("waits while the window is still open", () => {
    assert.equal(isAutoApprovable({ status: "delivered", approveDueAt: future }, now), false);
  });

  test("NEVER auto-approves a disputed room", () => {
    // The worst failure this feature could have: paying out money the trainee
    // is actively contesting.
    assert.equal(isAutoApprovable({ status: "disputed", approveDueAt: past }, now), false);
  });

  test("ignores rooms in every other state", () => {
    for (const status of ["awaiting_payment", "awaiting_delivery", "released", "refunded", "cancelled"]) {
      assert.equal(
        isAutoApprovable({ status, approveDueAt: past }, now),
        false,
        `${status} must not auto-approve`,
      );
    }
  });

  test("a room with no deadline is never swept", () => {
    assert.equal(isAutoApprovable({ status: "delivered", approveDueAt: null }, now), false);
  });

  test("the boundary releases rather than hanging", () => {
    assert.equal(isAutoApprovable({ status: "delivered", approveDueAt: now }, now), true);
  });
});

describe("mayAcceptRefund", () => {
  test("the other party may accept", () => {
    assert.equal(mayAcceptRefund({ proposedById: "trainer-1" }, "trainee-1"), true);
  });

  test("THE PROPOSER MAY NOT ACCEPT THEIR OWN", () => {
    // Otherwise "mutual consent" is a one-sided refund button: a trainee could
    // take the feedback and then refund themselves.
    assert.equal(mayAcceptRefund({ proposedById: "trainee-1" }, "trainee-1"), false);
  });

  test("nothing to accept when nobody has proposed", () => {
    assert.equal(mayAcceptRefund({ proposedById: null }, "trainee-1"), false);
  });
});

describe("refundCostsPlatformFee", () => {
  test("after capture, the platform eats Stripe's fee", () => {
    // Measured on the live test API: a $65.00 charge cost $2.19 and the refund
    // returned none of it.
    assert.equal(refundCostsPlatformFee({ status: "delivered" }), true);
    assert.equal(refundCostsPlatformFee({ status: "disputed" }), true);
  });

  test("before capture there is nothing to lose - it is only an authorisation", () => {
    assert.equal(refundCostsPlatformFee({ status: "awaiting_delivery" }), false);
    assert.equal(refundCostsPlatformFee({ status: "awaiting_payment" }), false);
  });
});
