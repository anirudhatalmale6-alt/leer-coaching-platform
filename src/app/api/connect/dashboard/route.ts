import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createDashboardLink } from "@/lib/connect";
import { stripeConfigured } from "@/lib/env";

/**
 * Send the trainer to their own Stripe Express dashboard.
 *
 * POST, not GET: it mints a single-use login link, so it must not be
 * triggerable by a prefetch or a crawler.
 *
 * Links are short-lived and single-use, which is why this is a round trip
 * rather than a URL rendered into the page - a link put in the HTML would be
 * stale by the time anyone clicked it twice.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!stripeConfigured) {
    return NextResponse.json({ error: "Stripe is not configured." }, { status: 503 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { stripeAccountId: true },
  });
  if (!user?.stripeAccountId) {
    return NextResponse.json(
      { error: "Connect a Stripe account first." },
      { status: 409 },
    );
  }

  try {
    const url = await createDashboardLink(user.stripeAccountId);
    return NextResponse.json({ url });
  } catch (err) {
    /**
     * "Cannot create a login link for an account that has not completed
     * onboarding" is a state, not a fault - the trainer started Stripe and
     * stopped partway. Telling them to finish is useful; "something went
     * wrong" would leave them stuck with no idea what to do.
     */
    const message = (err as { message?: string }).message ?? "";
    if (message.includes("has not completed onboarding")) {
      return NextResponse.json(
        {
          error:
            "Finish your Stripe onboarding first - the dashboard opens once Stripe has what it needs.",
          needsOnboarding: true,
        },
        { status: 409 },
      );
    }
    console.error("[connect/dashboard]", err);
    return NextResponse.json({ error: "Could not open Stripe." }, { status: 502 });
  }
}
