import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { refundExpiredRoom } from "@/lib/rooms";

/**
 * The 24-hour timeout sweep, replacing the spec's BullMQ queue.
 *
 * BullMQ needs a worker - a process that holds a Redis connection open and
 * waits. Vercel runs functions per invocation and has no always-on process, so
 * there is nowhere for that worker to live in this deployment. A cron-driven
 * sweep produces identical user-visible behaviour for a 24 hour deadline, with
 * no extra host and no Redis bill.
 *
 * Idempotent by construction: it only touches rooms still in
 * `awaiting_delivery` past their deadline, and each refund claims the
 * transition conditionally, so running it twice - or two instances racing -
 * cannot refund the same room twice.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bounded so one sweep cannot run unboundedly long on a serverless timeout. */
const MAX_PER_RUN = 100;

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // Refuse rather than run open: an unauthenticated endpoint that cancels
  // payments is a denial-of-service button for anybody who finds the URL.
  if (!secret) return false;

  const header = req.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

async function sweep() {
  const now = new Date();

  const expired = await prisma.coachingRoom.findMany({
    where: { status: "awaiting_delivery", deliverDueAt: { lte: now } },
    select: { id: true, publicId: true },
    orderBy: { deliverDueAt: "asc" },
    take: MAX_PER_RUN,
  });

  const refunded: string[] = [];
  for (const room of expired) {
    try {
      if (await refundExpiredRoom(room.id)) refunded.push(room.publicId);
    } catch (err) {
      // One bad room must not stop the sweep for everyone else.
      console.error("[cron/sweep] failed for", room.publicId, err);
    }
  }

  // If we hit the cap there is more to do; say so rather than reporting a
  // clean run and quietly leaving trainees waiting.
  const truncated = expired.length === MAX_PER_RUN;
  return { checked: expired.length, refunded: refunded.length, rooms: refunded, truncated };
}

export async function GET(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const result = await sweep();
  console.log("[cron/sweep]", JSON.stringify(result));
  return NextResponse.json({ ok: true, ...result });
}

// Vercel Cron issues GET; POST is here so the sweep can also be triggered by an
// operator or a test without pretending to be cron.
export const POST = GET;
