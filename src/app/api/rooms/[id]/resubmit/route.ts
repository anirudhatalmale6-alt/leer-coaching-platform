import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { RoomError, resubmitRoom } from "@/lib/rooms";

const Body = z.object({ annotations: z.string().max(500_000) });

/**
 * Coach answers a dispute with revised feedback.
 *
 * Separate from /deliver because the money is already captured - this only
 * replaces the marks and restarts the trainee's review window.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { id: publicId } = await ctx.params;
  const room = await prisma.coachingRoom.findUnique({ where: { publicId } });
  // 404 rather than 403 for anyone else: confirming the room exists is itself
  // a disclosure.
  if (!room || room.trainerId !== session.user.id) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  try {
    const updated = await resubmitRoom(room.id, session.user.id, parsed.data.annotations);
    return NextResponse.json({
      status: updated?.status,
      resubmitCount: updated?.resubmitCount,
    });
  } catch (err) {
    if (err instanceof RoomError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[rooms] resubmit failed", err);
    return NextResponse.json({ error: "Could not resubmit." }, { status: 502 });
  }
}
