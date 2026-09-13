import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { applyConnectStatus, readStatus } from "@/lib/connect";
import { stripeWebhookConfigured } from "@/lib/env";

/**
 * Stripe webhook receiver.
 *
 * Handles the Accounts v2 capability event, which is what actually completes
 * the Trainee -> Trainer elevation: Stripe often finishes verifying an account
 * minutes or hours after the trainer has closed the onboarding tab, so the
 * return-page sync alone would leave people stuck as trainees.
 *
 * The v1 `account.updated` event is deliberately not handled - v2 accounts do
 * not emit it, and leaving a handler for it would look like coverage we do not
 * have.
 *
 * M3 adds the payment and transfer events on the same plumbing.
 */

// The signature is computed over the raw bytes, so the body must not be parsed
// or re-encoded before verification.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** v2 account events we act on. */
const RECIPIENT_CAPABILITY_EVENT =
  "v2.core.account[configuration.recipient].capability_status_updated";
const RECIPIENT_UPDATED_EVENT = "v2.core.account[configuration.recipient].updated";

type AnyEvent = {
  id: string;
  type: string;
  data?: { object?: Record<string, unknown> };
  related_object?: { id?: string };
};

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

  let event: AnyEvent;
  try {
    event = stripe.webhooks.constructEvent(
      raw,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!,
    ) as unknown as AnyEvent;
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
    if (event.type === RECIPIENT_CAPABILITY_EVENT || event.type === RECIPIENT_UPDATED_EVENT) {
      // A v2 event carries the account id rather than the whole account, so the
      // authoritative state is fetched rather than trusted from the payload.
      const accountId =
        event.related_object?.id ??
        (event.data?.object as { id?: string } | undefined)?.id;

      if (!accountId) {
        console.warn("[stripe/webhook] capability event with no account id", event.id);
      } else {
        const user = await prisma.user.findUnique({ where: { stripeAccountId: accountId } });
        if (!user) {
          console.warn("[stripe/webhook] event for unknown account", accountId);
        } else {
          const account = await stripe.v2.core.accounts.retrieve(accountId, {
            include: ["configuration.recipient", "requirements"],
          });
          await applyConnectStatus(
            user.id,
            readStatus(account as unknown as Parameters<typeof readStatus>[0]),
          );
        }
      }
    }
    // Unhandled types are acknowledged so Stripe stops retrying them.

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
