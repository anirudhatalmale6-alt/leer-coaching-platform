import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { RoomError, approveRoom } from "@/lib/rooms";

/** Trainee accepts the feedback. Transfers the trainer's 80%. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id: publicId } = await ctx.params;
  const room = await prisma.coachingRoom.findUnique({ where: { publicId } });
  if (!room || room.traineeId !== session.user.id) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  try {
    const updated = await approveRoom(room.id, session.user.id);
    return NextResponse.json({ status: updated?.status, transferId: updated?.transferId });
  } catch (err) {
    if (err instanceof RoomError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[rooms] approve failed", err);
    return NextResponse.json({ error: "Could not complete the payout." }, { status: 502 });
  }
}
