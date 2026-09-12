import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { qualifiesAsTrainer, readStatus } from "../src/lib/connect";
import type Stripe from "stripe";

/**
 * The role rule is the whole of M1, so it is tested directly rather than only
 * through the UI.
 */
describe("qualifiesAsTrainer", () => {
  test("elevates a fully onboarded account", () => {
    assert.equal(
      qualifiesAsTrainer({
        detailsSubmitted: true,
        transfersActive: true,
        payoutsEnabled: true,
        chargesEnabled: false,
      }),
      true,
    );
  });

  test("does NOT elevate when Stripe is still verifying", () => {
    // details_submitted=true is the trap: the form is done, but Stripe has not
    // enabled transfers yet. Elevating here creates a trainer who can take a
    // booking and never be paid.
    assert.equal(
      qualifiesAsTrainer({
        detailsSubmitted: true,
        transfersActive: false,
        payoutsEnabled: false,
        chargesEnabled: false,
      }),
      false,
    );
  });

  test("does NOT elevate when payouts are blocked", () => {
    assert.equal(
      qualifiesAsTrainer({
        detailsSubmitted: true,
        transfersActive: true,
        payoutsEnabled: false,
        chargesEnabled: false,
      }),
      false,
    );
  });

  test("does NOT elevate an abandoned onboarding", () => {
    assert.equal(
      qualifiesAsTrainer({
        detailsSubmitted: false,
        transfersActive: false,
        payoutsEnabled: false,
        chargesEnabled: false,
      }),
      false,
    );
  });

  test("card_payments alone is not enough", () => {
    // Under separate charges and transfers the connected account never takes a
    // card, so charges_enabled must not be able to elevate anyone on its own.
    assert.equal(
      qualifiesAsTrainer({
        detailsSubmitted: true,
        transfersActive: false,
        payoutsEnabled: true,
        chargesEnabled: true,
      }),
      false,
    );
  });
});

describe("readStatus", () => {
  test("reads the transfers capability, not charges", () => {
    const account = {
      details_submitted: true,
      payouts_enabled: true,
      charges_enabled: false,
      capabilities: { transfers: "active" },
    } as unknown as Stripe.Account;

    const status = readStatus(account);
    assert.equal(status.transfersActive, true);
    assert.equal(status.chargesEnabled, false);
    assert.equal(qualifiesAsTrainer(status), true);
  });

  test("treats a pending capability as inactive", () => {
    const account = {
      details_submitted: true,
      payouts_enabled: true,
      charges_enabled: true,
      capabilities: { transfers: "pending" },
    } as unknown as Stripe.Account;

    assert.equal(readStatus(account).transfersActive, false);
  });

  test("survives an account with no capabilities object", () => {
    const account = { details_submitted: false } as unknown as Stripe.Account;
    const status = readStatus(account);
    assert.equal(status.transfersActive, false);
    assert.equal(qualifiesAsTrainer(status), false);
  });
});
