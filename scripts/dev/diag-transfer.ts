import { PrismaClient } from "@prisma/client";
import Stripe from "stripe";
async function main() {
  const p = new PrismaClient({ datasources: { db: { url: process.env.PROD_DB! } } });
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const room = await p.coachingRoom.findFirst({
    where: { status: "released", transferId: null },
    include: { trainer: { select: { stripeAccountId: true } } },
  });
  if (!room) { console.log("no stuck room"); return; }
  console.log("room:", room.publicId, "id:", room.id, "price:", room.priceCents);

  // Does a transfer already exist for this room?
  const existing = await stripe.transfers.list({ transfer_group: room.id, limit: 5 });
  console.log("existing transfers for this group:", existing.data.length,
              existing.data.map(t => ({ id: t.id, amount: t.amount, dest: t.destination })));

  // Reproduce the retry exactly as the deployed code does it.
  try {
    const t = await stripe.transfers.create({
      amount: Math.floor(room.priceCents * 0.8),
      currency: room.currency,
      destination: room.trainer.stripeAccountId!,
      transfer_group: room.id,
      metadata: { leerRoomId: room.id, leerRetry: "1" },
    }, { idempotencyKey: `leer-transfer-${room.id}` });
    console.log("RETRY SUCCEEDED:", t.id);
  } catch (e: any) {
    console.log("RETRY FAILED");
    console.log("  type:", e.type, " code:", e.code);
    console.log("  message:", (e.message ?? "").slice(0, 300));
  }
  await p.$disconnect();
}
main().catch(e => console.log("FAILED:", e.message?.slice(0,300)));
