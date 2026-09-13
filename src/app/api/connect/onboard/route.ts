import { NextResponse } from "next/server";
import { auth } from "@/auth";
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
  const country = (body.country ?? "").toUpperCase();
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
