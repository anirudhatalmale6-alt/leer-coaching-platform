import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import {
  buildObjectKey,
  signUpload,
  storageConfigured,
  validateUpload,
} from "@/lib/storage/r2";
import { devShortcutsEnabled } from "@/lib/env";

const Body = z.object({
  contentType: z.string().max(100),
  size: z.number().int().positive(),
  durationSeconds: z.number().positive().optional(),
});

/**
 * Issue a signed URL so the browser uploads straight to R2.
 *
 * The file never touches this server: a 100MB clip through a serverless
 * function would be slow, expensive, and on Vercel would hit the request body
 * limit long before it finished.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  if (!storageConfigured()) {
    return NextResponse.json(
      { error: "Storage is not configured on this deployment yet." },
      { status: 503 },
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const check = validateUpload(parsed.data);
  if (!check.ok) {
    return NextResponse.json({ error: check.reason }, { status: 422 });
  }

  const key = buildObjectKey(session.user.id, parsed.data.contentType);

  try {
    const url = await signUpload(key, parsed.data.contentType, parsed.data.size);
    return NextResponse.json({
      url,
      key,
      // The browser must send exactly these, or the signature will not match.
      headers: {
        "Content-Type": parsed.data.contentType,
      },
      // Only in development, and only to make a misconfigured bucket obvious.
      ...(devShortcutsEnabled ? { bucket: process.env.R2_BUCKET } : {}),
    });
  } catch (err) {
    console.error("[uploads/sign]", err);
    return NextResponse.json({ error: "Could not prepare the upload." }, { status: 502 });
  }
}
