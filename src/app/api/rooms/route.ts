import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { RoomError, createRoom } from "@/lib/rooms";
import { normaliseFocusNote } from "@/lib/profile";

/**
 * Trainee books a coaching pass: opens the room and returns a hosted Checkout
 * URL to pay on.
 *
 * NOTE what is NOT in this body: the price. The trainer's profile decides what
 * their coaching costs, and it is read server-side in createRoom. A price
 * accepted from here would let a buyer name their own.
 */
const Body = z.object({
  trainerUsername: z.string().min(1).max(40),
  videoKey: z.string().min(1).max(400),
  focusNote: z.string().max(2000).optional(),
  // Advisory, from the browser's own inspection of the file. Only ever used to
  // explain a playback problem to the coach, never to gate anything, so an
  // unrecognised value is harmless - but keep it to a short known set anyway.
  codec: z.enum(["h264", "hevc", "av1", "vp9", "vp8", "mpeg4", "prores"]).optional(),
});

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

  const note = normaliseFocusNote(parsed.data.focusNote ?? "");
  if (!note.ok) {
    return NextResponse.json({ error: note.reason }, { status: 422 });
  }

  const trainer = await prisma.user.findUnique({
    where: { username: parsed.data.trainerUsername.toLowerCase() },
    select: { id: true },
  });
  if (!trainer) {
    return NextResponse.json({ error: "That coach was not found." }, { status: 404 });
  }

  try {
    const { room, checkoutUrl } = await createRoom({
      traineeId: session.user.id,
      trainerId: trainer.id,
      videoKey: parsed.data.videoKey,
      videoCodec: parsed.data.codec,
      focusNote: note.value,
    });
    return NextResponse.json({ publicId: room.publicId, checkoutUrl });
  } catch (err) {
    if (err instanceof RoomError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[rooms] create failed", err);
    return NextResponse.json({ error: "Could not open the room." }, { status: 502 });
  }
}
