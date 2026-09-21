/**
 * Turning Stripe's outstanding-requirement list into something a trainer can act on.
 *
 * WHY THIS EXISTS
 *
 * Stripe reports requirements as dotted field paths -
 * `identity.individual.date_of_birth.day` - and reports them per component, so
 * a single question ("what is your date of birth?") arrives as three separate
 * entries. Rendering that list raw gives a coach on a phone four alarming rows
 * of jargon for what is really two short questions.
 *
 * THE DISTINCTION THAT MATTERS MOST
 *
 * A requirement carries a deadline status. `currently_due` genuinely blocks -
 * Stripe wants it now. `eventually_due` does NOT: the account is active, money
 * moves, and Stripe will ask later.
 *
 * Collapsing the two is what made a perfectly healthy account look broken on
 * LEER's own dashboard - a trainer who had finished onboarding, whose transfers
 * and payouts were both active, was shown "Stripe has everything it needs: Not
 * yet". That reads as "do it again", which is exactly the drop-off this is
 * meant to prevent.
 */

export type RequirementDeadline = "currently_due" | "eventually_due" | "past_due" | string;

export type RawRequirement = {
  description?: string;
  awaiting_action_from?: string;
  /**
   * THE deadline field. Confirmed against a live account dump - an entry has
   * `minimum_deadline`, and there is NO top-level `deadline`.
   *
   * This was originally written as `deadline`, a field that does not exist, so
   * every requirement read as undefined and fell through to "blocking" - which
   * reproduced the exact bug this module was written to fix. The unit tests
   * passed because the fixture had been invented rather than copied from a
   * real response.
   */
  minimum_deadline?: { status?: RequirementDeadline };
  /** Per-capability detail. `minimum_deadline` is the aggregate of these. */
  impact?: {
    restricts_capabilities?: {
      capability?: string;
      deadline?: { status?: RequirementDeadline };
    }[];
  };
};

/** The soonest deadline Stripe attaches to this requirement, if any. */
function deadlineOf(entry: RawRequirement): RequirementDeadline | undefined {
  if (entry.minimum_deadline?.status) return entry.minimum_deadline.status;

  // Fall back to the per-capability impacts. "Soonest wins" - if a requirement
  // blocks one capability now and another later, it blocks now.
  const statuses = (entry.impact?.restricts_capabilities ?? [])
    .map((r) => r.deadline?.status)
    .filter((s): s is RequirementDeadline => Boolean(s));
  if (statuses.length === 0) return undefined;
  if (statuses.includes("past_due")) return "past_due";
  if (statuses.includes("currently_due")) return "currently_due";
  return statuses[0];
}

export type Requirements = {
  /** Stripe wants these now; the account is limited until they arrive. */
  blocking: string[];
  /** Stripe will want these later. The account works in the meantime. */
  upcoming: string[];
};

/**
 * Field paths to plain English.
 *
 * Longest prefix wins, so `identity.individual.date_of_birth.day` collapses
 * into the same question as `.month` and `.year` rather than appearing three
 * times.
 */
const LABELS: [prefix: string, label: string][] = [
  ["identity.individual.date_of_birth", "Your date of birth"],
  ["identity.individual.id_numbers.us_ssn_last_4", "The last 4 digits of your SSN"],
  ["identity.individual.id_numbers", "Your tax or ID number"],
  ["identity.individual.address", "Your home address"],
  ["identity.individual.phone", "Your phone number"],
  ["identity.individual.email", "Your email address"],
  ["identity.individual.name", "Your legal name"],
  ["identity.individual.verification.document", "A photo of your ID"],
  ["identity.individual", "Your personal details"],
  ["identity.business_details.address", "Your business address"],
  ["identity.business_details.registration_number", "Your business registration number"],
  ["identity.business_details", "Your business details"],
  ["identity.attestations.terms_of_service", "Accepting Stripe's terms"],
  ["identity.attestations", "A confirmation from you"],
  ["configuration.recipient.default_outbound_destination", "Your bank account"],
  ["default_outbound_destination", "Your bank account"],
  ["external_account", "Your bank account"],
];

function label(description: string): string {
  let best = "";
  let found = "";
  for (const [prefix, text] of LABELS) {
    if (description.startsWith(prefix) && prefix.length > best.length) {
      best = prefix;
      found = text;
    }
  }
  if (found) return found;

  // Unknown field: show the last meaningful segment rather than the whole path
  // or nothing at all. Better a slightly technical word than a silent gap.
  const tail = description.split(".").filter(Boolean).pop() ?? description;
  return tail.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** Group Stripe's entries into "blocks you" and "not yet", de-duplicated. */
export function summariseRequirements(entries: RawRequirement[]): Requirements {
  const blocking: string[] = [];
  const upcoming: string[] = [];

  for (const entry of entries) {
    if (!entry?.description) continue;
    // Something Stripe is doing at its end is not a job for the trainer.
    if (entry.awaiting_action_from && entry.awaiting_action_from !== "user") continue;

    const text = label(entry.description);
    const status = deadlineOf(entry);
    const target = status === "eventually_due" ? upcoming : blocking;
    if (!target.includes(text)) target.push(text);
  }

  // A requirement that blocks should not also be listed as upcoming.
  return { blocking, upcoming: upcoming.filter((u) => !blocking.includes(u)) };
}

/** Is Stripe holding this account back right now? */
export function isBlocked(requirements: Requirements): boolean {
  return requirements.blocking.length > 0;
}

export function serialiseRequirements(requirements: Requirements): string {
  return JSON.stringify(requirements);
}

export function parseRequirements(raw: string | null): Requirements {
  if (!raw) return { blocking: [], upcoming: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<Requirements>;
    return {
      blocking: Array.isArray(parsed.blocking) ? parsed.blocking : [],
      upcoming: Array.isArray(parsed.upcoming) ? parsed.upcoming : [],
    };
  } catch {
    return { blocking: [], upcoming: [] };
  }
}
