import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isUsernameAvailable } from "@/lib/profile-store";
import { normaliseUsername } from "@/lib/profile";

/**
 * Live availability check for the handle field.
 *
 * Advisory only. The answer can be stale by the time the trainer presses save,
 * so the unique index is what actually decides - see saveProfile's P2002
 * handling. This exists so somebody typing a taken name finds out while they
 * are still typing.
 *
 * Signed in only: an open endpoint here is a free username enumerator.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const candidate = new URL(req.url).searchParams.get("u") ?? "";
  const check = normaliseUsername(candidate);
  if (!check.ok) {
    return NextResponse.json({ available: false, reason: check.reason });
  }

  const available = await isUsernameAvailable(check.value, session.user.id);
  return NextResponse.json({
    available,
    value: check.value,
    reason: available ? null : "That name is already taken.",
  });
}
