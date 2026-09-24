import Stripe from "stripe";

/**
 * Test-mode only: add AVAILABLE balance.
 *
 * Card 4000 0000 0000 0077 settles straight to the available balance instead
 * of sitting pending, which is exactly the condition a transfer needs.
 */
async function main() {
  const key = process.env.STRIPE_SECRET_KEY!;
  if (!key.startsWith("sk_test_")) throw new Error("REFUSING: not a test key");
  const stripe = new Stripe(key);

  const before = await stripe.balance.retrieve();
  console.log("available before:", JSON.stringify(before.available));

  const pi = await stripe.paymentIntents.create({
    amount: 60000,
    currency: "usd",
    payment_method: "pm_card_bypassPending",
    confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    description: "LEER test-mode balance top-up so queued payouts can settle",
  });
  console.log("top-up:", pi.id, pi.status);

  const after = await stripe.balance.retrieve();
  console.log("available after :", JSON.stringify(after.available));
}
main().catch((e) => console.log("FAILED:", e.message?.slice(0, 300)));
