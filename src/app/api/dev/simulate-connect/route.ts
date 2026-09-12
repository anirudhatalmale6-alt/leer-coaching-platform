import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { applyConnectStatus } from "@/lib/connect";
import { devShortcutsEnabled } from "@/lib/env";

/**
 * DEVELOPMENT ONLY: feed a fake Stripe account status through the REAL role
 * elevation code path, so the Trainee -> Trainer logic can be exercised before
 * Stripe keys exist.
 *
 * Note what this does and does not prove. It runs the genuine
 * applyConnectStatus() - the same function the webhook calls - so the role
 * rules, the username allocation and the database writes are really tested.
 * It does NOT prove anything about Stripe's API itself; that needs test keys.
 *
 * DELETE THIS FILE before the platform accepts real money.
 */
export async function POST(req: Request) {
  if (!devShortcutsEnabled) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    detailsSubmitted?: boolean;
    transfersActive?: boolean;
    payoutsEnabled?: boolean;
  };

  // Give the user a placeholder account id if they have none, so the rest of
  // the flow behaves as it would after a real accounts.create().
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (user && !user.stripeAccountId) {
    await prisma.user.update({
      where: { id: user.id },
      data: { stripeAccountId: `acct_dev_${user.id.slice(0, 12)}` },
    });
  }

  const updated = await applyConnectStatus(session.user.id, {
    detailsSubmitted: body.detailsSubmitted ?? true,
    transfersActive: body.transfersActive ?? true,
    payoutsEnabled: body.payoutsEnabled ?? true,
    chargesEnabled: false, // separate charges and transfers: never needed
  });

  return NextResponse.json({
    ok: true,
    isTrainer: updated?.isTrainer ?? false,
    username: updated?.username ?? null,
  });
}
