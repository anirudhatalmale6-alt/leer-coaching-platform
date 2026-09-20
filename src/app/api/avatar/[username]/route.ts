import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { signPlayback, storageConfigured } from "@/lib/storage/r2";

/**
 * Serve a trainer's profile image on their public page.
 *
 * The bucket stays private. Rather than making it public - which would also
 * expose every coaching clip's prefix to anyone who learned the hostname -
 * this redirects to a short-lived signed URL.
 *
 * Keyed by username rather than by object key so the public page never has to
 * know, or leak, where anything lives in storage.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;

  const user = await prisma.user.findUnique({
    where: { username: username.toLowerCase() },
    select: { avatarKey: true, isTrainer: true },
  });

  if (!user?.isTrainer || !user.avatarKey || !storageConfigured()) {
    // 404 rather than a placeholder image: the page already renders initials
    // when there is no avatar, and a 404 lets the browser stop asking.
    return new NextResponse(null, { status: 404 });
  }

  try {
    const url = await signPlayback(user.avatarKey, 3600);
    return NextResponse.redirect(url, {
      status: 302,
      headers: {
        // Short, deliberately. The signed URL behind it expires in an hour, so
        // caching the REDIRECT for longer than that would hand visitors a link
        // that 403s. A minute is enough to stop a reload re-signing.
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch (err) {
    console.error("[avatar]", err);
    return new NextResponse(null, { status: 404 });
  }
}
