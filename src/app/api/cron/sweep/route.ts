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
