import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { signPlayback, storageConfigured } from "@/lib/storage/r2";

const Body = z.object({ key: z.string().min(1).max(400) });

/**
 * Hand back a short-lived playback URL for an object.
 *
 * Coaching footage is never public, so the bucket stays private and every view
 * costs a fresh signature. The key is checked against the caller's own prefix:
 * without that, anyone signed in could ask for anyone else's clip just by
 * knowing its key, which is exactly the leak signed URLs are meant to prevent.
 *
 * M3 widens this to "the trainer assigned to this coaching room may also
 * fetch it", driven by the room record rather than by the path.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!storageConfigured()) {
    return NextResponse.json({ error: "Storage is not configured." }, { status: 503 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const prefix = `uploads/${session.user.id}/`;
  if (!parsed.data.key.startsWith(prefix)) {
    // Deliberately 404, not 403: confirming that a key exists but belongs to
    // someone else is itself a disclosure.
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  try {
    const url = await signPlayback(parsed.data.key);
    return NextResponse.json({ url });
  } catch (err) {
    console.error("[uploads/playback]", err);
    return NextResponse.json({ error: "Could not prepare playback." }, { status: 502 });
  }
}
