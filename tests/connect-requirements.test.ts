import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  isBlocked,
  parseRequirements,
  serialiseRequirements,
  summariseRequirements,
  type RawRequirement,
} from "../src/lib/connect-requirements";

/**
 * THE FIXTURE IS COPIED FROM A LIVE RESPONSE, NOT INVENTED.
 *
 * This matters more than it sounds. The first version of this file used a
 * made-up shape with a top-level `deadline` field. No such field exists - an
 * entry carries `minimum_deadline` - so the code read undefined for every
 * requirement and classified them all as blocking, which is precisely the bug
 * this module was written to fix. The tests passed the whole time, because
 * they were testing my guess against itself.
 *
 * Below is the real entry returned by the client's own connected account,
 * verbatim apart from formatting.
 */
const LIVE_ENTRY: RawRequirement = {
  awaiting_action_from: "user",
  description: "identity.individual.date_of_birth.day",
  impact: {
    restricts_capabilities: [
      {
        capability: "stripe_balance.payouts",
        deadline: { status: "eventually_due" },
      },
    ],
  },
  minimum_deadline: { status: "eventually_due" },
};

const LIVE_ENTRIES: RawRequirement[] = [
  LIVE_ENTRY,
  { ...LIVE_ENTRY, description: "identity.individual.date_of_birth.month" },
  { ...LIVE_ENTRY, description: "identity.individual.date_of_birth.year" },
  { ...LIVE_ENTRY, description: "identity.individual.id_numbers.us_ssn_last_4" },
];

describe("the live account's real entries", () => {
  test("NOTHING is blocking: these are eventually_due", () => {
    // The account's transfers and payouts were both active. Treating these as
    // blocking is what told a working trainer he still had to verify.
    const r = summariseRequirements(LIVE_ENTRIES);
    assert.deepEqual(r.blocking, []);
    assert.equal(isBlocked(r), false);
  });

  test("three date-of-birth entries collapse into one question", () => {
    const r = summariseRequirements(LIVE_ENTRIES);
    assert.deepEqual(r.upcoming, [
      "Your date of birth",
      "The last 4 digits of your SSN",
    ]);
  });

  test("the deadline is read from minimum_deadline, the field that exists", () => {
    // Guards the exact regression: reading a non-existent field makes
    // everything look blocking.
    const r = summariseRequirements([
      { description: "identity.individual.name", awaiting_action_from: "user", minimum_deadline: { status: "eventually_due" } },
    ]);
    assert.deepEqual(r, { blocking: [], upcoming: ["Your legal name"] });
  });

  test("falls back to impact deadlines when minimum_deadline is absent", () => {
    const r = summariseRequirements([
      {
        description: "identity.individual.name",
        awaiting_action_from: "user",
        impact: { restricts_capabilities: [{ deadline: { status: "eventually_due" } }] },
      },
    ]);
    assert.deepEqual(r.upcoming, ["Your legal name"]);
  });

  test("soonest impact wins - blocking one capability now beats later", () => {
    const r = summariseRequirements([
      {
        description: "identity.individual.name",
        awaiting_action_from: "user",
        impact: {
          restricts_capabilities: [
            { deadline: { status: "eventually_due" } },
            { deadline: { status: "currently_due" } },
          ],
        },
      },
    ]);
    assert.deepEqual(r.blocking, ["Your legal name"]);
  });
});

describe("summariseRequirements", () => {
  test("currently_due DOES block", () => {
    const r = summariseRequirements([
      { description: "identity.individual.address.line1", awaiting_action_from: "user", minimum_deadline: { status: "currently_due" } },
    ]);
    assert.deepEqual(r.blocking, ["Your home address"]);
    assert.equal(isBlocked(r), true);
  });

  test("past_due blocks too - anything that is not eventually_due does", () => {
    const r = summariseRequirements([
      { description: "identity.individual.verification.document", awaiting_action_from: "user", minimum_deadline: { status: "past_due" } },
    ]);
    assert.deepEqual(r.blocking, ["A photo of your ID"]);
  });

  test("NO deadline at all is treated as blocking, not ignored", () => {
    // Failing safe. An unknown shape must not quietly downgrade a real block
    // into a footnote - but note this is also what bit us when the field name
    // was wrong, so the fail-safe is not a substitute for reading real data.
    const r = summariseRequirements([
      { description: "identity.individual.name", awaiting_action_from: "user" },
    ]);
    assert.deepEqual(r.blocking, ["Your legal name"]);
  });

  test("work Stripe is doing itself is not shown to the trainer", () => {
    const r = summariseRequirements([
      { description: "identity.individual.verification.document", awaiting_action_from: "stripe", minimum_deadline: { status: "currently_due" } },
    ]);
    assert.deepEqual(r, { blocking: [], upcoming: [] });
  });

  test("the same item never appears in both lists", () => {
    const r = summariseRequirements([
      { description: "identity.individual.address.line1", awaiting_action_from: "user", minimum_deadline: { status: "currently_due" } },
      { description: "identity.individual.address.city", awaiting_action_from: "user", minimum_deadline: { status: "eventually_due" } },
    ]);
    assert.deepEqual(r.blocking, ["Your home address"]);
    assert.deepEqual(r.upcoming, []);
  });

  test("longest matching prefix wins, so SSN is not just 'tax or ID number'", () => {
    const r = summariseRequirements([
      { description: "identity.individual.id_numbers.us_ssn_last_4", awaiting_action_from: "user", minimum_deadline: { status: "currently_due" } },
    ]);
    assert.deepEqual(r.blocking, ["The last 4 digits of your SSN"]);
  });

  test("an unmapped field still says something human, never nothing", () => {
    const r = summariseRequirements([
      { description: "identity.some_future_field.sub_part", awaiting_action_from: "user", minimum_deadline: { status: "currently_due" } },
    ]);
    assert.deepEqual(r.blocking, ["Sub part"]);
  });

  test("junk in does not throw", () => {
    assert.deepEqual(summariseRequirements([]), { blocking: [], upcoming: [] });
    assert.deepEqual(
      summariseRequirements([{}, { description: "" }] as RawRequirement[]),
      { blocking: [], upcoming: [] },
    );
  });
});

describe("round trip", () => {
  test("survives storage", () => {
    const r = summariseRequirements(LIVE_ENTRIES);
    assert.deepEqual(parseRequirements(serialiseRequirements(r)), r);
  });

  test("a corrupt or missing value is empty, not a crash", () => {
    assert.deepEqual(parseRequirements(null), { blocking: [], upcoming: [] });
    assert.deepEqual(parseRequirements("not json"), { blocking: [], upcoming: [] });
    assert.deepEqual(parseRequirements('{"blocking":"nope"}'), { blocking: [], upcoming: [] });
  });
});
