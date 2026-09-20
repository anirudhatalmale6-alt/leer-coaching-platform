import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { saveProfile } from "@/lib/profile-store";
import { MAX_PORTFOLIO_LINKS } from "@/lib/profile";

/**
 * Save the trainer's public profile.
 *
 * Only a trainer may have a profile at all: the public page exists to sell a
 * coaching pass, and someone who has not completed Stripe onboarding has
 * nothing to sell and no account for the money to reach.
 */
const Body = z.object({
  username: z.string().max(40).optional(),
  bio: z.string().max(1000).optional(),
  category: z.string().max(60).optional(),
  instagram: z.string().max(200).optional(),
  youtube: z.string().max(200).optional(),
  avatarKey: z.string().max(400).nullable().optional(),
  price: z.string().max(20).optional(),
  coachingEnabled: z.boolean().optional(),
  // Bounded here as well as in the store so an enormous array cannot be sent
  // just to make the server do the work of rejecting it.
  portfolio: z.array(z.string().max(400)).max(MAX_PORTFOLIO_LINKS * 2).optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isTrainer: true },
  });
  if (!user?.isTrainer) {
    return NextResponse.json(
      { error: "Finish Stripe onboarding before setting up your public page." },
      { status: 403 },
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const result = await saveProfile(session.user.id, parsed.data);
    if (!result.ok) {
      return NextResponse.json({ errors: result.errors }, { status: result.status });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[profile] save failed", err);
    return NextResponse.json({ error: "Could not save your profile." }, { status: 502 });
  }
}
