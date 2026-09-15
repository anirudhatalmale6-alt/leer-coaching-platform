import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { RoomError, createRoom } from "@/lib/rooms";

const Body = z.object({
  trainerId: z.string().min(1),
  videoKey: z.string().min(1).max(400),
  priceCents: z.number().int(),
});

/** Trainee buys a coaching pass: authorises the card and opens the room. */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // The clip must belong to the buyer. Without this, anyone could open a room
  // against somebody else's private upload just by knowing its key.
  if (!parsed.data.videoKey.startsWith(`uploads/${session.user.id}/`)) {
    return NextResponse.json({ error: "That clip is not yours." }, { status: 403 });
  }

  try {
    const { room, clientSecret } = await createRoom({
      traineeId: session.user.id,
      trainerId: parsed.data.trainerId,
      videoKey: parsed.data.videoKey,
      priceCents: parsed.data.priceCents,
    });
    return NextResponse.json({ publicId: room.publicId, clientSecret });
  } catch (err) {
    if (err instanceof RoomError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[rooms] create failed", err);
    return NextResponse.json({ error: "Could not open the room." }, { status: 502 });
  }
}
