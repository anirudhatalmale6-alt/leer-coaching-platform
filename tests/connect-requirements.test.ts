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
 * The fixture is the real thing: these four entries are exactly what the live
 * Stripe test API returned for the client's own connected account, including
 * the `eventually_due` deadline that made a fully working account look broken.
 */
const LIVE_ENTRIES: RawRequirement[] = [
  {
    description: "identity.individual.date_of_birth.day",
    awaiting_action_from: "user",
    deadline: { status: "eventually_due" },
  },
  {
    description: "identity.individual.date_of_birth.month",
    awaiting_action_from: "user",
    deadline: { status: "eventually_due" },
  },
  {
    description: "identity.individual.date_of_birth.year",
    awaiting_action_from: "user",
    deadline: { status: "eventually_due" },
  },
  {
    description: "identity.individual.id_numbers.us_ssn_last_4",
    awaiting_action_from: "user",
    deadline: { status: "eventually_due" },
  },
];

describe("summariseRequirements - the live account's real entries", () => {
  test("NOTHING is blocking: these are eventually_due", () => {
    // This is the whole point. The account's transfers and payouts were both
    // active; treating these as blocking is what told a working trainer that
    // Stripe still needed something from them.
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
});

describe("summariseRequirements", () => {
  test("currently_due DOES block", () => {
    const r = summariseRequirements([
      { description: "identity.individual.address.line1", awaiting_action_from: "user", deadline: { status: "currently_due" } },
    ]);
    assert.deepEqual(r.blocking, ["Your home address"]);
    assert.equal(isBlocked(r), true);
  });

  test("past_due blocks too - anything that is not eventually_due does", () => {
    const r = summariseRequirements([
      { description: "identity.individual.verification.document", awaiting_action_from: "user", deadline: { status: "past_due" } },
    ]);
    assert.deepEqual(r.blocking, ["A photo of your ID"]);
  });

  test("a missing deadline is treated as blocking, not ignored", () => {
    // Failing safe: an unknown shape must not quietly downgrade a real block
    // into a footnote.
    const r = summariseRequirements([
      { description: "identity.individual.name", awaiting_action_from: "user" },
    ]);
    assert.deepEqual(r.blocking, ["Your legal name"]);
  });

  test("work Stripe is doing itself is not shown to the trainer", () => {
    const r = summariseRequirements([
      { description: "identity.individual.verification.document", awaiting_action_from: "stripe", deadline: { status: "currently_due" } },
    ]);
    assert.deepEqual(r, { blocking: [], upcoming: [] });
  });

  test("the same item never appears in both lists", () => {
    const r = summariseRequirements([
      { description: "identity.individual.address.line1", awaiting_action_from: "user", deadline: { status: "currently_due" } },
      { description: "identity.individual.address.city", awaiting_action_from: "user", deadline: { status: "eventually_due" } },
    ]);
    assert.deepEqual(r.blocking, ["Your home address"]);
    assert.deepEqual(r.upcoming, []);
  });

  test("longest matching prefix wins, so SSN is not just 'tax or ID number'", () => {
    const r = summariseRequirements([
      { description: "identity.individual.id_numbers.us_ssn_last_4", awaiting_action_from: "user", deadline: { status: "currently_due" } },
    ]);
    assert.deepEqual(r.blocking, ["The last 4 digits of your SSN"]);
  });

  test("an unmapped field still says something human, never nothing", () => {
    const r = summariseRequirements([
      { description: "identity.some_future_field.sub_part", awaiting_action_from: "user", deadline: { status: "currently_due" } },
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
