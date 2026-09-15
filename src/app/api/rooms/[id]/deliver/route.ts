import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { RoomError, deliverRoom } from "@/lib/rooms";

const Body = z.object({ annotations: z.string().max(500_000) });

/** Trainer submits feedback. Captures the authorised payment. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id: publicId } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const room = await prisma.coachingRoom.findUnique({ where: { publicId } });
  // 404 rather than 403 for someone else's room: confirming it exists is
  // itself a disclosure.
  if (!room || room.trainerId !== session.user.id) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  try {
    const updated = await deliverRoom(room.id, session.user.id, parsed.data.annotations);
    return NextResponse.json({ status: updated?.status });
  } catch (err) {
    if (err instanceof RoomError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[rooms] deliver failed", err);
    return NextResponse.json({ error: "Could not submit the feedback." }, { status: 502 });
  }
}
