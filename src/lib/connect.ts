import type Stripe from "stripe";
import { prisma } from "./prisma";
import { getStripe } from "./stripe";
import { appUrl } from "./env";

/**
 * Stripe Connect onboarding and the Trainee -> Trainer role elevation.
 *
 * Architecture note, because it drives a decision here that is easy to get
 * wrong: LEER settles with SEPARATE CHARGES AND TRANSFERS. The trainee's card
 * is charged on the LEER platform account, and the trainer's 80% arrives later
 * as a transfer. The connected account therefore never processes a card itself.
 *
 * Consequence: the capability an Express account needs is `transfers`, NOT
 * `card_payments`. Requesting card_payments would put the trainer through
 * onboarding questions for something they never do, and gating the role on
 * `charges_enabled` would leave perfectly payable trainers stuck as trainees.
 */

/** Shape of a connected account that we mirror locally. */
export type ConnectStatus = {
  detailsSubmitted: boolean;
  transfersActive: boolean;
  payoutsEnabled: boolean;
  chargesEnabled: boolean;
};

export function readStatus(account: Stripe.Account): ConnectStatus {
  return {
    detailsSubmitted: Boolean(account.details_submitted),
    transfersActive: account.capabilities?.transfers === "active",
    payoutsEnabled: Boolean(account.payouts_enabled),
    chargesEnabled: Boolean(account.charges_enabled),
  };
}

/**
 * The single definition of "this person may sell coaching".
 *
 * Deliberately stricter than "they finished the onboarding form": Stripe very
 * often returns details_submitted=true while still holding the account for
 * verification. Elevating on the form alone produces trainers who can take a
 * booking and then never be paid, which is the worst failure mode this platform
 * has - the money is already in escrow by then.
 */
export function qualifiesAsTrainer(status: ConnectStatus): boolean {
  return status.detailsSubmitted && status.transfersActive && status.payoutsEnabled;
}

/** Derive a unique public handle for leer.fit/<username>. */
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
  // Fall back to something that cannot collide rather than looping forever.
  return `${base}${Date.now().toString(36)}`;
}

/** Reserved words that must never become a trainer URL, since leer.fit/<username>
 *  shares its namespace with the app's own routes. */
const RESERVED = new Set([
  "api", "auth", "dashboard", "connect", "coaching", "login", "logout",
  "signin", "signout", "admin", "settings", "about", "terms", "privacy",
  "support", "static", "_next", "favicon", "leer",
]);

/**
 * Create (or reuse) the trainer's Express account and return a fresh onboarding
 * link. Account links are single-use and short-lived, so this is called again
 * every time the user starts or resumes onboarding.
 */
export async function startOnboarding(userId: string): Promise<string> {
  const stripe = getStripe();
  if (!stripe) throw new Error("Stripe is not configured");

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("User not found");

  let accountId = user.stripeAccountId;

  if (!accountId) {
    const account = await stripe.accounts.create({
      type: "express",
      email: user.email ?? undefined,
      // See the note at the top of this file: transfers only.
      capabilities: { transfers: { requested: true } },
      business_type: "individual",
      metadata: { leerUserId: user.id },
    });
    accountId = account.id;
    await prisma.user.update({
      where: { id: user.id },
      data: { stripeAccountId: accountId },
    });
  }

  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${appUrl}/connect/refresh`,
    return_url: `${appUrl}/connect/return`,
    type: "account_onboarding",
  });

  return link.url;
}

/**
 * Pull the live account from Stripe, mirror it locally, and elevate the role if
 * it now qualifies.
 *
 * Stripe's own account object is the only source of truth here - the role is
 * never set from anything the browser sends.
 */
export async function syncConnectStatus(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.stripeAccountId) return null;

  const stripe = getStripe();
  if (!stripe) return null;

  const account = await stripe.accounts.retrieve(user.stripeAccountId);
  return applyConnectStatus(user.id, readStatus(account));
}

/** Shared by the return page and the account.updated webhook. */
export async function applyConnectStatus(userId: string, status: ConnectStatus) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;

  const nowTrainer = qualifiesAsTrainer(status);

  // Allocate the public handle on the way up, once.
  let username = user.username;
  if (nowTrainer && !username) {
    const seed = user.email?.split("@")[0] ?? user.name ?? "trainer";
    const candidate = await allocateUsername(seed);
    username = RESERVED.has(candidate) ? `${candidate}1` : candidate;
  }

  return prisma.user.update({
    where: { id: user.id },
    data: {
      stripeDetailsSubmitted: status.detailsSubmitted,
      stripeTransfersActive: status.transfersActive,
      stripeChargesEnabled: status.chargesEnabled,
      stripePayoutsEnabled: status.payoutsEnabled,
      stripeSyncedAt: new Date(),
      isTrainer: nowTrainer,
      // Record the first elevation only, so a later Stripe hiccup that briefly
      // demotes someone does not rewrite their trainer-since date.
      trainerActiveAt: nowTrainer ? (user.trainerActiveAt ?? new Date()) : user.trainerActiveAt,
      username,
    },
  });
}
