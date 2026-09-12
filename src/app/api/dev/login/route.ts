import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { devShortcutsEnabled } from "@/lib/env";

/**
 * DEVELOPMENT ONLY passwordless sign-in.
 *
 * Exists so the app can be demonstrated and tested before Google OAuth
 * credentials are issued. It is gated on NODE_ENV !== "production" AND an
 * explicit LEER_DEV_LOGIN=1, and assertProductionConfig() refuses to boot
 * production if that flag is ever set there.
 *
 * DELETE THIS FILE before the platform accepts real money.
 */
export async function POST(req: Request) {
  if (!devShortcutsEnabled) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { email, name } = (await req.json().catch(() => ({}))) as {
    email?: string;
    name?: string;
  };
  if (!email) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: name ?? email.split("@")[0] },
  });

  const sessionToken = randomUUID();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { sessionToken, userId: user.id, expires } });

  const res = NextResponse.json({ ok: true, userId: user.id });
  res.cookies.set("authjs.session-token", sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires,
  });
  return res;
}
