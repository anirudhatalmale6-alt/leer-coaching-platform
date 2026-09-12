import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { googleConfigured, devShortcutsEnabled } from "@/lib/env";
import DevSignIn from "./dev-signin";

export default async function SignIn() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-20">
      <div className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8">
        <p className="text-xs font-semibold tracking-[0.3em] text-[var(--muted)]">
          LEER
        </p>
        <h1 className="mt-3 text-2xl font-semibold">Sign in</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          One account for trainees and trainers. You can start coaching later
          without signing up again.
        </p>

        {googleConfigured ? (
          <form
            className="mt-8"
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/dashboard" });
            }}
          >
            <button
              type="submit"
              className="w-full rounded-lg bg-white px-4 py-3 font-semibold text-[#1f2937] transition hover:brightness-95"
            >
              Continue with Google
            </button>
          </form>
        ) : (
          <div className="mt-8 rounded-lg border border-[var(--warn)]/40 bg-[var(--warn)]/10 p-4 text-sm text-[var(--warn)]">
            Google sign-in is not configured on this deployment. Add
            AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET to enable it.
          </div>
        )}

        {devShortcutsEnabled && <DevSignIn />}
      </div>
    </main>
  );
}
