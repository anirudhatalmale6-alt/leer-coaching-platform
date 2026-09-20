import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import {
  buildAvatarKey,
  signUpload,
  storageConfigured,
  validateAvatar,
} from "@/lib/storage/r2";

const Body = z.object({
  contentType: z.string().max(100),
  size: z.number().int().positive(),
});

/** Signed URL so the browser PUTs the profile image straight to R2. */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  if (!storageConfigured()) {
    return NextResponse.json(
      { error: "Image storage is not configured on this deployment yet." },
      { status: 503 },
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const check = validateAvatar(parsed.data);
  if (!check.ok) {
    return NextResponse.json({ error: check.reason }, { status: 422 });
  }

  const key = buildAvatarKey(session.user.id, parsed.data.contentType);

  try {
    const url = await signUpload(key, parsed.data.contentType, parsed.data.size);
    return NextResponse.json({
      url,
      key,
      headers: { "Content-Type": parsed.data.contentType },
    });
  } catch (err) {
    console.error("[profile/avatar]", err);
    return NextResponse.json({ error: "Could not prepare the upload." }, { status: 502 });
  }
}
