import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { applyConnectStatus, readStatus } from "@/lib/connect";
import { stripeWebhookConfigured } from "@/lib/env";

/**
 * Stripe webhook receiver.
 *
 * M1 handles account.updated, which is what actually completes the Trainee ->
 * Trainer elevation: Stripe frequently finishes verifying an account minutes or
 * hours after the user has closed the onboarding tab, so the return-page sync
 * alone would leave people stuck as trainees.
 *
 * M3 adds the payment and transfer events on the same plumbing.
 */

// The signature is computed over the raw bytes, so the body must not be parsed
// or re-encoded before verification.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const stripe = getStripe();
  if (!stripe || !stripeWebhookConfigured) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      raw,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch (err) {
    // An unverified body is not logged in full - it is attacker-controlled.
    console.error("[stripe/webhook] signature verification failed", (err as Error).message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Stripe retries on any non-2xx and also replays events; without this guard a
  // replay would re-run the side effects below.
  const seen = await prisma.processedWebhookEvent.findUnique({ where: { id: event.id } });
  if (seen) return NextResponse.json({ received: true, duplicate: true });

  try {
    switch (event.type) {
      case "account.updated": {
        const account = event.data.object as Stripe.Account;
        const userId = account.metadata?.leerUserId;

        // Fall back to a lookup by account id: metadata can be edited away in
        // the Stripe dashboard, but the stored account id cannot.
        const user = userId
          ? await prisma.user.findUnique({ where: { id: userId } })
          : await prisma.user.findUnique({ where: { stripeAccountId: account.id } });

        if (!user) {
          console.warn("[stripe/webhook] account.updated for unknown account", account.id);
          break;
        }

        await applyConnectStatus(user.id, readStatus(account));
        break;
      }

      default:
        // Unhandled types are acknowledged so Stripe stops retrying them.
        break;
    }

    await prisma.processedWebhookEvent.create({
      data: { id: event.id, type: event.type },
    });

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[stripe/webhook] handler failed", event.type, err);
    // 500 so Stripe retries - the event is deliberately NOT marked processed.
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }
}
