import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { RoomError, disputeRoom } from "@/lib/rooms";
import { normaliseFocusNote } from "@/lib/profile";

const Body = z.object({ reason: z.string().max(2000) });

/**
 * Trainee disputes the delivered feedback.
 *
 * Stops the auto-approval clock. Does not move any money - see disputeRoom.
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

  // Same length and shape rules as the trainee's focus note: free prose,
  // capped, newlines kept.
  const reason = normaliseFocusNote(parsed.data.reason);
  if (!reason.ok) {
    return NextResponse.json({ error: reason.reason }, { status: 422 });
  }
  if (!reason.value) {
    return NextResponse.json(
      { error: "Please say what was wrong - your coach needs something to work with." },
      { status: 422 },
    );
  }

  const { id: publicId } = await ctx.params;
  const room = await prisma.coachingRoom.findUnique({ where: { publicId } });
  // 404 rather than 403 for a stranger: confirming the room exists is itself a
  // disclosure.
  if (!room || room.traineeId !== session.user.id) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  try {
    const updated = await disputeRoom(room.id, session.user.id, reason.value);
    return NextResponse.json({ status: updated?.status });
  } catch (err) {
    if (err instanceof RoomError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[rooms] dispute failed", err);
    return NextResponse.json({ error: "Could not raise the dispute." }, { status: 502 });
  }
}
