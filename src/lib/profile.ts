/**
 * Trainer profile: validation and normalisation.
 *
 * Pure functions, no database and no Stripe, for the same reason escrow.ts is
 * pure - this is the file that decides what a stranger on the internet is
 * allowed to put on a public page, and every rule in it needs to be directly
 * testable.
 *
 * Two things here are security, not tidiness:
 *
 * 1. The username shares a URL namespace with the app's own routes
 *    (leersports.com/<username> sits alongside /dashboard, /signin, /api).
 *    Next.js resolves a static route before a dynamic one, so a trainer who
 *    claimed "dashboard" would not break the app - their page would simply be
 *    unreachable forever, which is worse, because it fails silently.
 *
 * 2. Portfolio links are rendered as href attributes. Anything that is not
 *    plainly http(s) is rejected: `javascript:` in an href is script execution
 *    on the trainer's own public page.
 */

import { MAX_PRICE_CENTS, MIN_PRICE_CENTS } from "./escrow";

/** Specialty categories, exactly as the client's UI spec lists them. */
export const CATEGORIES = [
  "Men's Physique",
  "Classic Physique",
  "Bodybuilding",
  "Bikini & Women's Fitness",
  "Powerlifting & Strength",
  "General Fitness & Diet",
] as const;

export type Category = (typeof CATEGORIES)[number];

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

export const MAX_PORTFOLIO_LINKS = 5;
export const MAX_BIO_LENGTH = 160;
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

/**
 * Words that must never become a trainer URL.
 *
 * Kept deliberately wide: it includes routes that do not exist yet (pricing,
 * blog, help) because taking a handle back from a trainer who has already put
 * it in their Instagram bio is not something we can do later.
 */
export const RESERVED_USERNAMES = new Set([
  "_next", "about", "account", "admin", "api", "auth", "billing", "blog",
  "book", "canvas", "checkout", "coaching", "connect", "contact", "dashboard",
  "docs", "favicon", "help", "home", "leer", "leersports", "login", "logout",
  "new", "pricing", "privacy", "profile", "public", "register", "room",
  "rooms", "settings", "signin", "signout", "signup", "static", "support",
  "terms", "trainer", "trainers", "upload", "uploads", "user", "users",
]);

export type Check<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * Validate and normalise a claimed handle.
 *
 * Case is folded to lower: usernames are compared as the URL is, and letting
 * "JohnDoe" and "johndoe" both exist would hand two trainers the same page.
 */
export function normaliseUsername(input: string): Check<string> {
  const value = input.trim().toLowerCase();

  if (value.length < USERNAME_MIN) {
    return { ok: false, reason: `Usernames are at least ${USERNAME_MIN} characters.` };
  }
  if (value.length > USERNAME_MAX) {
    return { ok: false, reason: `Usernames are at most ${USERNAME_MAX} characters.` };
  }
  if (!/^[a-z0-9_]+$/.test(value)) {
    return { ok: false, reason: "Letters, numbers and underscores only." };
  }
  // A handle that is only underscores, or starts with one, reads as broken in a
  // bio link and is indistinguishable from a typo.
  if (!/^[a-z0-9]/.test(value)) {
    return { ok: false, reason: "Start with a letter or a number." };
  }
  if (RESERVED_USERNAMES.has(value)) {
    return { ok: false, reason: "That name is reserved. Please pick another." };
  }
  return { ok: true, value };
}

/** One line, no newlines, trimmed. Empty is allowed - it clears the field. */
export function normaliseBio(input: string): Check<string> {
  // Collapse any whitespace run, including the newlines a paste brings with it,
  // so a multi-line paste cannot stretch the public card.
  const value = input.replace(/\s+/g, " ").trim();
  if (value.length > MAX_BIO_LENGTH) {
    return { ok: false, reason: `Keep the bio under ${MAX_BIO_LENGTH} characters.` };
  }
  return { ok: true, value };
}

/**
 * Accept whatever a trainer pastes for a social handle and store the handle.
 *
 * People paste "@name", "name", and the full profile URL in roughly equal
 * measure. Storing the bare handle means the public page can build a correct
 * link itself rather than trusting a pasted URL to point where it claims.
 */
export function normaliseInstagram(input: string): Check<string> {
  return normaliseHandle(input, {
    host: /(^|\.)instagram\.com$/i,
    allowed: /^[a-zA-Z0-9._]{1,30}$/,
    label: "Instagram",
  });
}

export function normaliseYouTube(input: string): Check<string> {
  return normaliseHandle(input, {
    host: /(^|\.)(youtube\.com|youtu\.be)$/i,
    // YouTube handles allow hyphens; Instagram's do not.
    allowed: /^[a-zA-Z0-9._-]{1,30}$/,
    label: "YouTube",
  });
}

function normaliseHandle(
  input: string,
  opts: { host: RegExp; allowed: RegExp; label: string },
): Check<string> {
  let value = input.trim();
  if (!value) return { ok: true, value: "" };

  if (/^https?:\/\//i.test(value)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return { ok: false, reason: `That does not look like a ${opts.label} link.` };
    }
    if (!opts.host.test(url.hostname)) {
      return { ok: false, reason: `That link is not on ${opts.label}.` };
    }
    // /@handle, /handle, /c/handle, /channel/handle - take the last meaningful
    // segment and let the character check below decide if it is usable.
    const segments = url.pathname.split("/").filter(Boolean);
    value = segments[segments.length - 1] ?? "";
  }

  value = value.replace(/^@+/, "");

  if (!value) return { ok: true, value: "" };
  if (!opts.allowed.test(value)) {
    return { ok: false, reason: `That is not a valid ${opts.label} handle.` };
  }
  return { ok: true, value };
}

/**
 * A portfolio embed URL.
 *
 * Only http(s) survives. `javascript:`, `data:` and friends are script
 * execution wearing a link's clothes, and this value ends up in an href on a
 * page the trainer sends their own audience to.
 */
export function normalisePortfolioUrl(input: string): Check<string> {
  const raw = input.trim();
  if (!raw) return { ok: true, value: "" };
  if (raw.length > 300) return { ok: false, reason: "That link is too long." };

  // Bare "instagram.com/reel/x" is what people paste; assume https rather than
  // rejecting it, but never assume a scheme for something that already has one.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, reason: "That does not look like a link." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "Links must start with http:// or https://." };
  }
  if (!url.hostname.includes(".")) {
    return { ok: false, reason: "That does not look like a link." };
  }
  return { ok: true, value: url.toString() };
}

/**
 * Clean a list of portfolio links: drop blanks, drop duplicates, cap at five.
 *
 * Returns the first failure rather than silently discarding a link the trainer
 * typed - a link that vanishes on save with no explanation reads as data loss.
 */
export function normalisePortfolioLinks(inputs: string[]): Check<string[]> {
  const out: string[] = [];
  for (const input of inputs) {
    const check = normalisePortfolioUrl(input);
    if (!check.ok) return check;
    if (!check.value) continue;
    if (out.includes(check.value)) continue;
    out.push(check.value);
  }
  if (out.length > MAX_PORTFOLIO_LINKS) {
    return { ok: false, reason: `Up to ${MAX_PORTFOLIO_LINKS} links.` };
  }
  return { ok: true, value: out };
}

/**
 * Parse a price a human typed ("50", "$50", "49.99") into cents.
 *
 * Deliberately NOT a float multiplication. Number("32.05") * 100 is
 * 3204.9999999999995, so the naive version stores a non-integer price, and
 * Stripe rejects a non-integer amount outright - the trainer's page simply
 * stops taking bookings, with nothing in the UI to explain why. (Plenty of
 * values, 49.99 among them, happen to come out exact, which is what makes this
 * class of bug survive casual testing.) Splitting on the decimal point is
 * exact for every input.
 */
export function parsePriceToCents(input: string): Check<number> {
  const raw = input.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    return { ok: false, reason: "Enter a price like 50 or 49.99." };
  }

  const [whole, fraction = ""] = raw.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));

  if (cents < MIN_PRICE_CENTS) {
    return { ok: false, reason: `The minimum is $${(MIN_PRICE_CENTS / 100).toFixed(2)}.` };
  }
  if (cents > MAX_PRICE_CENTS) {
    return { ok: false, reason: `The maximum is $${(MAX_PRICE_CENTS / 100).toFixed(2)}.` };
  }
  return { ok: true, value: cents };
}

export function formatPrice(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

/**
 * Is this profile complete enough to take money?
 *
 * The toggle alone is not enough. A public page with no name and no price is
 * not a shop, and letting somebody switch it on regardless produces a booking
 * button next to a blank card.
 */
export function isSellable(profile: {
  isTrainer: boolean;
  username: string | null;
  coachingEnabled: boolean;
  coachingPriceCents: number;
  stripeTransfersStatus: string | null;
}): boolean {
  return (
    profile.isTrainer &&
    Boolean(profile.username) &&
    profile.coachingEnabled &&
    profile.stripeTransfersStatus === "active" &&
    profile.coachingPriceCents >= MIN_PRICE_CENTS &&
    profile.coachingPriceCents <= MAX_PRICE_CENTS
  );
}

/** What the trainee may tell the coach to look at. Free-text, so it is capped. */
export const MAX_FOCUS_NOTE = 500;

export function normaliseFocusNote(input: string): Check<string> {
  const value = input.replace(/\r\n/g, "\n").trim();
  if (value.length > MAX_FOCUS_NOTE) {
    return { ok: false, reason: `Keep this under ${MAX_FOCUS_NOTE} characters.` };
  }
  return { ok: true, value };
}
