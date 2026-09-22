import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  RoomError,
  acceptRefund,
  mayViewRoom,
  proposeRefund,
  withdrawRefundProposal,
} from "@/lib/rooms";
import { normaliseFocusNote } from "@/lib/profile";

const Body = z.object({
  action: z.enum(["propose", "accept", "withdraw"]),
  reason: z.string().max(2000).optional(),
});

/**
 * The mutual-consent refund, in one endpoint.
 *
 * Either party proposes; the OTHER accepts. The rule that the proposer cannot
 * accept their own proposal lives in escrow.ts and is enforced in
 * acceptRefund - without it, "mutual consent" would be a one-sided refund
 * button and a trainee could take the feedback then refund themselves.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { id: publicId } = await ctx.params;
  const room = await prisma.coachingRoom.findUnique({ where: { publicId } });
  if (!room || !mayViewRoom(room, session.user.id)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const reason = normaliseFocusNote(parsed.data.reason ?? "");
  if (!reason.ok) {
    return NextResponse.json({ error: reason.reason }, { status: 422 });
  }

  try {
    const updated =
      parsed.data.action === "propose"
        ? await proposeRefund(room.id, session.user.id, reason.value)
        : parsed.data.action === "withdraw"
          ? await withdrawRefundProposal(room.id, session.user.id)
          : await acceptRefund(room.id, session.user.id);

    return NextResponse.json({
      status: updated?.status,
      refundProposedById: updated?.refundProposedById ?? null,
      refundId: updated?.refundId ?? null,
    });
  } catch (err) {
    if (err instanceof RoomError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[rooms] refund action failed", parsed.data.action, err);
    return NextResponse.json({ error: "Could not complete that." }, { status: 502 });
  }
}
