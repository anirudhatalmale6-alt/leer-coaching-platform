/**
 * Environment access in one place.
 *
 * The MVP has to be runnable before every third-party account exists, so
 * missing keys are reported as "this integration is not configured" rather than
 * crashing the whole app at boot. What is NOT tolerated is a half-configured
 * integration in production - see assertProductionConfig().
 */

export const appUrl =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "http://localhost:3000";

export const googleConfigured = Boolean(
  process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET,
);

export const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY);

export const stripeWebhookConfigured = Boolean(process.env.STRIPE_WEBHOOK_SECRET);

/**
 * Dev-only shortcuts (passwordless sign-in, simulated Stripe onboarding) exist
 * so the app can be demonstrated before Google and Stripe credentials arrive.
 *
 * Two independent conditions must hold, so setting the flag in a production
 * environment by accident still does not open the door.
 */
export const devShortcutsEnabled =
  process.env.NODE_ENV !== "production" && process.env.LEER_DEV_LOGIN === "1";

/** Fail loudly at boot if production is missing something it cannot work without. */
export function assertProductionConfig() {
  if (process.env.NODE_ENV !== "production") return;

  const missing: string[] = [];
  if (!process.env.AUTH_SECRET) missing.push("AUTH_SECRET");
  if (!process.env.DATABASE_URL) missing.push("DATABASE_URL");
  if (!googleConfigured) missing.push("AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET");
  if (!stripeConfigured) missing.push("STRIPE_SECRET_KEY");
  if (!stripeWebhookConfigured) missing.push("STRIPE_WEBHOOK_SECRET");

  if (missing.length) {
    throw new Error(`LEER cannot start in production, missing: ${missing.join(", ")}`);
  }
  if (process.env.LEER_DEV_LOGIN === "1") {
    throw new Error("LEER_DEV_LOGIN must never be set in production");
  }
}
