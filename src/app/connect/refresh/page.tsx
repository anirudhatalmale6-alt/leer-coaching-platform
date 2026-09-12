import { redirect } from "next/navigation";
import { auth } from "@/auth";

/**
 * Stripe sends the user here when an account link has expired or was abandoned.
 * Account links are single-use, so the only correct response is to send them
 * back to the dashboard and let them start a fresh one.
 */
export default async function ConnectRefresh() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  redirect("/dashboard?onboarding=expired");
}
