import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isSupportedCountry, startOnboarding } from "@/lib/connect";
import { stripeConfigured } from "@/lib/env";

/**
 * Begin (or resume) Stripe Connect onboarding for the signed-in user.
 *
 * POST, not GET: it creates a Stripe account on first call, so it must not be
 * triggerable by a prefetch, a crawler, or an <img> tag on another site.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  if (!stripeConfigured) {
    return NextResponse.json(
      { error: "Stripe is not configured on this deployment yet." },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { country?: string };

  /**
   * A trainer resuming onboarding does not pick a country again.
   *
   * Stripe fixes the country at account creation and it cannot comfortably be
   * changed, so for an existing account the stored value is the only correct
   * one. Asking again would be a pointless extra step - and worse, a trainer
   * who picked differently the second time would get a confusing rejection
   * rather than the finish-your-details form they were expecting.
   */
  const existing = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { stripeAccountId: true, stripeCountry: true },
  });

  const country = (
    existing?.stripeAccountId && existing.stripeCountry
      ? existing.stripeCountry
      : (body.country ?? "")
  ).toUpperCase();

  if (!isSupportedCountry(country)) {
    return NextResponse.json(
      { error: "Choose the country your bank account is in." },
      { status: 422 },
    );
  }

  try {
    const url = await startOnboarding(session.user.id, country);
    return NextResponse.json({ url });
  } catch (err) {
    console.error("[connect/onboard]", err);
    return NextResponse.json(
      { error: "Could not start Stripe onboarding. Please try again." },
      { status: 502 },
    );
  }
}
