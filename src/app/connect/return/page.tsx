import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { syncConnectStatus } from "@/lib/connect";

/**
 * Where Stripe sends the trainer after onboarding.
 *
 * Stripe explicitly does not guarantee the account is complete when it returns
 * here, so this re-reads the account rather than assuming success. The
 * account.updated webhook is the other half of the same job - whichever arrives
 * first wins, and both are idempotent.
 */
export default async function ConnectReturn() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  try {
    await syncConnectStatus(session.user.id);
  } catch (err) {
    console.error("[connect/return] sync failed", err);
    // Not fatal: the webhook will still elevate the account.
  }

  redirect("/dashboard?onboarding=returned");
}
