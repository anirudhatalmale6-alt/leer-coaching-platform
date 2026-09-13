import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { qualifiesAsTrainer, readStatus } from "../src/lib/connect";

/**
 * The role rule is the whole of M1, so it is tested directly rather than only
 * through the UI.
 *
 * These assert the ACCOUNTS V2 model. Stripe refuses v1 account creation for
 * new Connect integrations, and for a v2 recipient the deprecated v1 fields
 * (charges_enabled / payouts_enabled / details_submitted) must not be consulted
 * at all - the capability status is the only truth.
 */

/** Build the shape v2 returns, so the tests exercise the real parser. */
function v2Account(transfersStatus: string | null, requirementEntries = 0) {
  return {
    id: "acct_test",
    configuration: transfersStatus
      ? {
          recipient: {
            capabilities: {
              stripe_balance: { stripe_transfers: { status: transfersStatus } },
            },
          },
        }
      : undefined,
    requirements: { entries: Array.from({ length: requirementEntries }, () => ({})) },
  };
}

describe("qualifiesAsTrainer (Accounts v2)", () => {
  test("elevates only when stripe_transfers is active", () => {
    assert.equal(qualifiesAsTrainer(readStatus(v2Account("active"))), true);
  });

  test("does NOT elevate a freshly created account", () => {
    // Verified against the live Stripe test API: a brand-new v2 recipient comes
    // back as "restricted" with requirements_past_due. Elevating here creates a
    // trainer who can take a booking and never be paid - and by then the
    // trainee's money is already in escrow.
    assert.equal(
      qualifiesAsTrainer(readStatus(v2Account("restricted", 3))),
      false,
    );
  });

  test("does NOT elevate while the capability is merely pending", () => {
    assert.equal(qualifiesAsTrainer(readStatus(v2Account("pending"))), false);
  });

  test("does NOT elevate when the capability was never requested", () => {
    assert.equal(qualifiesAsTrainer(readStatus(v2Account("unrequested"))), false);
  });

  test("does NOT elevate an account with no recipient configuration at all", () => {
    assert.equal(qualifiesAsTrainer(readStatus(v2Account(null))), false);
  });

  test("an unknown future status is treated as not-active, never as active", () => {
    // Stripe can add statuses. Anything we do not recognise must fail closed:
    // the cost of a false negative is a trainer waiting, the cost of a false
    // positive is money stuck in escrow with nobody able to receive it.
    assert.equal(qualifiesAsTrainer(readStatus(v2Account("some_new_status"))), false);
  });
});

describe("readStatus (Accounts v2)", () => {
  test("reads the recipient transfers capability", () => {
    const s = readStatus(v2Account("active"));
    assert.equal(s.transfersStatus, "active");
    assert.equal(s.requirementsOutstanding, false);
  });

  test("reports outstanding requirements", () => {
    const s = readStatus(v2Account("restricted", 2));
    assert.equal(s.transfersStatus, "restricted");
    assert.equal(s.requirementsOutstanding, true);
  });

  test("survives an account with no configuration or requirements", () => {
    const s = readStatus({ id: "acct_test" });
    assert.equal(s.transfersStatus, null);
    assert.equal(s.requirementsOutstanding, false);
    assert.equal(qualifiesAsTrainer(s), false);
  });

  test("v1-shaped fields cannot elevate anyone", () => {
    // A v1 account object would have charges_enabled / payouts_enabled and no
    // configuration.recipient. Feeding one in must produce "not a trainer"
    // rather than silently reading a deprecated field.
    const v1Shaped = {
      id: "acct_v1",
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
    } as unknown as Parameters<typeof readStatus>[0];
    assert.equal(qualifiesAsTrainer(readStatus(v1Shaped)), false);
  });
});
