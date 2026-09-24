import { PrismaClient } from "@prisma/client";
import Stripe from "stripe";

/** Read-only: did the coach's transfer actually happen? */
async function main() {
  const p = new PrismaClient({ datasources: { db: { url: process.env.PROD_DB! } } });
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

  const rooms = await p.coachingRoom.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { trainer: { select: { username: true, stripeAccountId: true } } },
  });

  console.log(`rooms in prod: ${rooms.length}`);
  for (const r of rooms) {
    console.log(`\n--- ${r.publicId} ---`);
    console.log(`  status=${r.status} price=${r.priceCents} closeReason=${r.closeReason ?? "-"}`);
    console.log(`  paymentIntent=${r.paymentIntentId ?? "-"}`);
    console.log(`  transferId=${r.transferId ?? "NONE"}`);
    console.log(`  coach=${r.trainer.username} acct=${r.trainer.stripeAccountId ?? "-"}`);

    if (r.transferId) {
      try {
        const t = await stripe.transfers.retrieve(r.transferId);
        console.log(`  STRIPE TRANSFER: amount=${t.amount} dest=${t.destination} reversed=${t.reversed}`);
      } catch (e: any) {
        console.log(`  transfer lookup failed: ${e.message?.slice(0, 120)}`);
      }
    }
  }

  // Platform balance - a transfer needs AVAILABLE funds, not pending ones.
  const bal = await stripe.balance.retrieve();
  console.log("\nPLATFORM BALANCE");
  console.log("  available:", JSON.stringify(bal.available));
  console.log("  pending  :", JSON.stringify(bal.pending));

  await p.$disconnect();
}
main().catch((e) => console.log("FAILED:", e.message?.slice(0, 300)));
