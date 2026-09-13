import type Stripe from "stripe";
import { prisma } from "./prisma";
import { getStripe } from "./stripe";
import { appUrl } from "./env";

/**
 * Stripe Connect onboarding and the Trainee -> Trainer role elevation.
 *
 * ACCOUNTS V2. Stripe now refuses v1 account creation for new Connect
 * integrations - the API returns "Stripe no longer recommends Accounts v1 for
 * new Connect integrations. Create connected accounts with POST
 * /v2/core/accounts instead." So there is no `type: "express"` here; the old
 * account types are replaced by three independent dimensions (dashboard, fees
 * collector, losses collector).
 *
 * Architecture note, because it drives the capability choice: LEER settles with
 * SEPARATE CHARGES AND TRANSFERS. The trainee's card is charged on the LEER
 * platform account, and the trainer's 80% arrives later as a transfer. The
 * connected account therefore never processes a card itself.
 *
 * Consequence: a trainer is a RECIPIENT, not a merchant. We request
 * `stripe_balance.stripe_transfers` and deliberately do NOT request the
 * merchant configuration or card_payments - Stripe's own guidance is that
 * requesting them for a recipient is unnecessary and lengthens onboarding.
 */

/**
 * Countries a trainer may onboard from.
 *
 * Stripe requires `identity.country` at account creation and it is not
 * comfortably changeable afterwards, so it must be collected up front rather
 * than defaulted. LEER is pitched as a global platform, so defaulting everyone
 * to the platform's own country would quietly strand every trainer outside it.
 *
 * This is the Stripe Connect recipient set; extend it as Stripe does.
 */
export const SUPPORTED_COUNTRIES = [
  { code: "AU", name: "Australia" },
  { code: "AT", name: "Austria" },
  { code: "BE", name: "Belgium" },
  { code: "BR", name: "Brazil" },
  { code: "CA", name: "Canada" },
  { code: "HR", name: "Croatia" },
  { code: "CY", name: "Cyprus" },
  { code: "CZ", name: "Czechia" },
  { code: "DK", name: "Denmark" },
  { code: "EE", name: "Estonia" },
  { code: "FI", name: "Finland" },
  { code: "FR", name: "France" },
  { code: "DE", name: "Germany" },
  { code: "GR", name: "Greece" },
  { code: "HK", name: "Hong Kong" },
  { code: "HU", name: "Hungary" },
  { code: "IE", name: "Ireland" },
  { code: "IT", name: "Italy" },
  { code: "JP", name: "Japan" },
  { code: "LV", name: "Latvia" },
  { code: "LT", name: "Lithuania" },
  { code: "LU", name: "Luxembourg" },
  { code: "MY", name: "Malaysia" },
  { code: "MT", name: "Malta" },
  { code: "MX", name: "Mexico" },
  { code: "NL", name: "Netherlands" },
  { code: "NZ", name: "New Zealand" },
  { code: "NO", name: "Norway" },
  { code: "PL", name: "Poland" },
  { code: "PT", name: "Portugal" },
  { code: "RO", name: "Romania" },
  { code: "SG", name: "Singapore" },
  { code: "SK", name: "Slovakia" },
  { code: "SI", name: "Slovenia" },
  { code: "ES", name: "Spain" },
  { code: "SE", name: "Sweden" },
  { code: "CH", name: "Switzerland" },
  { code: "TH", name: "Thailand" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
] as const;

export function isSupportedCountry(code: string): boolean {
  return SUPPORTED_COUNTRIES.some((c) => c.code === code);
}

/** Marketplace defaults for a hold-and-release platform. */
const RECIPIENT_CONFIG = {
  dashboard: "express",
  // The platform owns pricing and absorbs negative balances. `losses_collector:
  // "stripe"` is rejected outright with separate charges and transfers, and
  // the platform must own liability for transfer reversals during disputes.
  responsibilities: {
    fees_collector: "application",
    losses_collector: "application",
  },
} as const;

/** Local mirror of the bits of a connected account we care about. */
export type ConnectStatus = {
  /** `stripe_balance.stripe_transfers` capability status. */
  transfersStatus: string | null;
  /** Whether Stripe is still asking the trainer for information. */
  requirementsOutstanding: boolean;
};

type V2Account = {
  id: string;
  configuration?: {
    recipient?: {
      capabilities?: {
        stripe_balance?: {
          stripe_transfers?: { status?: string; status_details?: unknown[] };
        };
      };
    };
  };
  requirements?: { summary?: unknown; entries?: unknown[] };
  metadata?: Record<string, string> | null;
};

export function readStatus(account: V2Account): ConnectStatus {
  const transfers =
    account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers;
  const entries = account.requirements?.entries;
  return {
    transfersStatus: transfers?.status ?? null,
    requirementsOutstanding: Array.isArray(entries) ? entries.length > 0 : false,
  };
}

/**
 * The single definition of "this person may sell coaching".
 *
 * Under Accounts v2 the deprecated v1 fields (`charges_enabled`,
 * `payouts_enabled`, `details_submitted`) must not be used - Stripe's guidance
 * is to read the capability status directly. For a marketplace recipient that
 * is `stripe_balance.stripe_transfers`.
 *
 * "active" is the only value that means money can actually reach this trainer.
 * A brand-new account reports "restricted" with requirements_past_due even
 * though the person has just clicked through onboarding, and elevating on
 * anything weaker produces a trainer who can accept a booking and then never be
 * paid - with the trainee's money already sitting in escrow. There is a test
 * for exactly that case.
 */
export function qualifiesAsTrainer(status: ConnectStatus): boolean {
  return status.transfersStatus === "active";
}

/** Derive a unique public handle for leersports.com/<username>. */
async function allocateUsername(seed: string): Promise<string> {
  const base =
    seed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 20) || "trainer";

  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? base : `${base}${attempt + 1}`;
    const taken = await prisma.user.findUnique({ where: { username: candidate } });
    if (!taken) return candidate;
  }
  return `${base}${Date.now().toString(36)}`;
}

/** Reserved words that must never become a trainer URL, since
 *  leersports.com/<username> shares its namespace with the app's own routes. */
const RESERVED = new Set([
  "api", "auth", "dashboard", "connect", "coaching", "login", "logout",
  "signin", "signout", "admin", "settings", "about", "terms", "privacy",
  "support", "static", "_next", "favicon", "leer", "upload", "canvas", "room",
]);

/**
 * Create (or reuse) the trainer's connected account and return a fresh
 * onboarding link. Account links are single-use and short-lived, so this runs
 * again every time the trainer starts or resumes onboarding.
 */
export async function startOnboarding(userId: string, country: string): Promise<string> {
  const stripe = getStripe();
  if (!stripe) throw new Error("Stripe is not configured");
  if (!isSupportedCountry(country)) {
    throw new Error(`Stripe payouts are not available in ${country} yet.`);
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("User not found");

  let accountId = user.stripeAccountId;
  let applied: string[] | undefined;

  if (!accountId) {
    const account = await createRecipientAccount(stripe, user, country);
    accountId = account.id;
    applied = account.applied_configurations;
    await prisma.user.update({
      where: { id: user.id },
      data: { stripeAccountId: accountId, stripeCountry: country },
    });
  } else {
    const existing = await stripe.v2.core.accounts.retrieve(accountId);
    applied = existing.applied_configurations;
  }

  /**
   * The link's configurations MUST match what is actually on the account.
   * Stripe rejects a mismatch with "The configurations in the request must
   * match the applied configurations on the account in order to use
   * v2/core/account_links" - which is exactly what happens for a trainer in a
   * country that forced the merchant configuration on us. Reading them back
   * from the account keeps the two in step without guessing.
   */
  const configurations = (applied ?? ["recipient"]).filter(
    (c): c is "recipient" | "merchant" => c === "recipient" || c === "merchant",
  );

  const link = await stripe.v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        configurations: configurations.length ? configurations : ["recipient"],
        refresh_url: `${appUrl}/connect/refresh`,
        return_url: `${appUrl}/connect/return`,
      },
    },
  });

  return link.url;
}


/**
 * Create the trainer's connected account, adapting to the country's rules.
 *
 * A trainer only ever RECEIVES money, so in principle the recipient
 * configuration alone is right - and for a US trainer on a US platform, it is.
 *
 * It is not universal. Verified against the live Stripe test API: US accepts a
 * recipient-only account, while GB, DE, CA, AU and SG all reject it with
 * `capability_not_available_without_other_capability` - "stripe_balance
 * .stripe_transfers cannot be requested without configuration.merchant
 * .capabilities.card_payments". Cross-border recipients need the merchant
 * configuration as well.
 *
 * Rather than hardcode that list - which would silently rot as Stripe changes
 * per-country rules - we ask for the minimum, and widen only when Stripe tells
 * us to. The trainer in a country that allows it gets the shorter onboarding.
 */
async function createRecipientAccount(
  stripe: NonNullable<ReturnType<typeof getStripe>>,
  user: { id: string; email: string | null; name: string | null },
  country: string,
) {
  const base: Omit<Stripe.V2.Core.AccountCreateParams, "configuration"> = {
    contact_email: user.email ?? undefined,
    display_name: user.name ?? undefined,
    // Stripe rejects creation without this (identity_country_required) and it
    // is not comfortably changed later, so the trainer chooses it up front
    // rather than inheriting the platform's country.
    identity: { entity_type: "individual" as const, country },
    dashboard: RECIPIENT_CONFIG.dashboard,
    defaults: { responsibilities: RECIPIENT_CONFIG.responsibilities },
    include: ["configuration.recipient", "requirements"],
    metadata: { leerUserId: user.id },
  };

  const recipientOnly = {
    recipient: {
      capabilities: { stripe_balance: { stripe_transfers: { requested: true } } },
    },
  };

  try {
    return await stripe.v2.core.accounts.create({
      ...base,
      configuration: recipientOnly,
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== "capability_not_available_without_other_capability") throw err;

    return stripe.v2.core.accounts.create({
      ...base,
      configuration: {
        ...recipientOnly,
        merchant: { capabilities: { card_payments: { requested: true } } },
      },
    });
  }
}

/**
 * Pull the live account from Stripe, mirror it locally, and elevate the role if
 * it now qualifies. Stripe's own account object is the only source of truth -
 * the role is never set from anything the browser sends.
 */
export async function syncConnectStatus(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.stripeAccountId) return null;

  const stripe = getStripe();
  if (!stripe) return null;

  const account = await stripe.v2.core.accounts.retrieve(user.stripeAccountId, {
    include: ["configuration.recipient", "requirements"],
  });
  return applyConnectStatus(user.id, readStatus(account as unknown as V2Account));
}

/** Shared by the return page and the capability webhook. */
export async function applyConnectStatus(userId: string, status: ConnectStatus) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;

  const nowTrainer = qualifiesAsTrainer(status);

  let username = user.username;
  if (nowTrainer && !username) {
    const seed = user.email?.split("@")[0] ?? user.name ?? "trainer";
    const candidate = await allocateUsername(seed);
    username = RESERVED.has(candidate) ? `${candidate}1` : candidate;
  }

  return prisma.user.update({
    where: { id: user.id },
    data: {
      stripeTransfersStatus: status.transfersStatus,
      stripeRequirementsOutstanding: status.requirementsOutstanding,
      stripeSyncedAt: new Date(),
      isTrainer: nowTrainer,
      // Record the first elevation only, so a later Stripe hiccup that briefly
      // demotes someone does not rewrite their trainer-since date.
      trainerActiveAt: nowTrainer ? (user.trainerActiveAt ?? new Date()) : user.trainerActiveAt,
      username,
    },
  });
}

/** Kept for the webhook, which receives a Stripe.Event of unknown shape. */
export type { Stripe };
