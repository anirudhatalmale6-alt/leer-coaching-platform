import Stripe from "stripe";
import { stripeConfigured } from "./env";

let cached: Stripe | null = null;

/** Returns null when Stripe is not configured, so callers handle it explicitly. */
export function getStripe(): Stripe | null {
  if (!stripeConfigured) return null;
  if (!cached) {
    cached = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      // Pinning the version means a Stripe-side upgrade cannot silently change
      // payout or account behaviour under a live marketplace.
      apiVersion: "2026-08-26.dahlia",
      appInfo: { name: "LEER", version: "0.1.0" },
    });
  }
  return cached;
}

/** True for keys that move real money. Used to keep test and live apart. */
export function isLiveKey(): boolean {
  return (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_live_");
}
