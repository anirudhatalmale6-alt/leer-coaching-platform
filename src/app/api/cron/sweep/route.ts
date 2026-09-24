import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autoApproveRoom, refundExpiredRoom, retryPendingPayouts } from "@/lib/rooms";

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

type AuthResult = "ok" | "wrong-credentials" | "anonymous";

/**
 * Distinguish "wrong credentials" from "no credentials", deliberately.
 *
 * The endpoint used to answer 404 for every failure, so that a stranger who
 * found the URL could not tell it existed. That is sound against a scanner -
 * but it also meant a MISCONFIGURED SCHEDULER got the identical 404, which is
 * indistinguishable from a typo in the path. That cost a real debugging round
 * trip: the path was correct all along and the header was not.
 *
 * So: someone who sends no Authorization header at all still gets 404 and
 * learns nothing. Someone who sends one that does not match is plainly an
 * operator wiring up a cron job, and gets a 401 that says so. A scanner does
 * not send bearer tokens; a broken cron job does.
 */
function authorise(req: Request): AuthResult {
  const secret = process.env.CRON_SECRET;
  // Refuse rather than run open: an unauthenticated endpoint that cancels
  // payments is a denial-of-service button for anybody who finds the URL.
  if (!secret) return "anonymous";

  const header = req.headers.get("authorization");
  if (!header || !header.trim()) return "anonymous";
  if (header === `Bearer ${secret}`) return "ok";
  return "wrong-credentials";
}

async function sweep() {
  const now = new Date();

  // 1. Coaches who never delivered. The authorisation is cancelled, so the
  //    trainee is never charged at all.
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

  /**
   * 2. Feedback delivered, approval window lapsed, nobody disputed. Pay the
   *    coach.
   *
   * THE STATUS FILTER IS THE SAFETY RULE. Only `delivered` is selected, and a
   * disputed room has a different status, so this can never pay out money the
   * trainee is actively contesting. `autoApproveRoom` claims the same
   * transition conditionally, so a dispute raised between this query and the
   * update loses nothing - the update simply matches zero rows.
   */
  const lapsed = await prisma.coachingRoom.findMany({
    where: { status: "delivered", approveDueAt: { lte: now } },
    select: { id: true, publicId: true },
    orderBy: { approveDueAt: "asc" },
    take: MAX_PER_RUN,
  });

  const released: string[] = [];
  for (const room of lapsed) {
    try {
      await autoApproveRoom(room.id);
      released.push(room.publicId);
    } catch (err) {
      console.error("[cron/sweep] auto-approve failed for", room.publicId, err);
    }
  }

  /**
   * 3. Coaches who were approved but whose transfer never went through.
   *
   * Captured funds are PENDING before they are AVAILABLE, so a payout made
   * moments after capture can fail on balance and leave money owed with only a
   * log line to show for it. Retrying here is what turns that into a
   * self-healing state instead of a silent debt.
   */
  const payouts = await retryPendingPayouts(MAX_PER_RUN);

  // If we hit either cap there is more to do; say so rather than reporting a
  // clean run and quietly leaving people waiting.
  const truncated = expired.length === MAX_PER_RUN || lapsed.length === MAX_PER_RUN;
  return {
    checked: expired.length + lapsed.length,
    refunded: refunded.length,
    released: released.length,
    payoutsRetried: payouts.attempted,
    payoutsPaid: payouts.paid,
    rooms: refunded,
    releasedRooms: released,
    truncated,
  };
}

export async function GET(req: Request) {
  const auth = authorise(req);

  if (auth === "anonymous") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (auth === "wrong-credentials") {
    // Never echo the expected value - just confirm the route exists and the
    // header is the thing that is wrong.
    return NextResponse.json(
      {
        error: "Unauthorized",
        hint: "This route exists. Send: Authorization: Bearer <CRON_SECRET>, using the CRON_SECRET from this project's environment variables.",
      },
      { status: 401 },
    );
  }
  const result = await sweep();
  console.log("[cron/sweep]", JSON.stringify(result));
  return NextResponse.json({ ok: true, ...result });
}

// Vercel Cron issues GET; POST is here so the sweep can also be triggered by an
// operator or a test without pretending to be cron.
export const POST = GET;
