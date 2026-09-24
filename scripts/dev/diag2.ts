import { PrismaClient } from "@prisma/client";
import Stripe from "stripe";
async function main() {
  const p = new PrismaClient({ datasources: { db: { url: process.env.PROD_DB! } } });
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const room = await p.coachingRoom.findFirst({
    where: { status: "released", transferId: null },
    include: { trainer: { select: { stripeAccountId: true } } },
  });
  if (!room) { console.log("nothing stuck"); return; }

  const existing = await stripe.transfers.list({ transfer_group: room.id, limit: 3 });
  console.log("transfers already for this room:", existing.data.length);

  const params = {
    amount: Math.floor(room.priceCents * 0.8),
    currency: room.currency,
    destination: room.trainer.stripeAccountId!,
    transfer_group: room.id,
    metadata: { leerRoomId: room.id },
  };

  console.log("\nA) same key, params identical to the original call:");
  try {
    const t = await stripe.transfers.create(params, { idempotencyKey: `leer-transfer-${room.id}` });
    console.log("   OK", t.id);
  } catch (e: any) {
    console.log("   FAILED", e.type, e.code, "-", (e.message ?? "").slice(0, 220));
  }

  const bal = await stripe.balance.retrieve();
  console.log("\navailable now:", JSON.stringify(bal.available));
  await p.$disconnect();
}
main().catch(e => console.log("FAILED:", e.message?.slice(0,300)));
