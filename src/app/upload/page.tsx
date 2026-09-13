import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { storageConfigured } from "@/lib/storage/r2";
import UploadFlow from "./upload-flow";

/**
 * The trainee's side of the spec: drag and drop a clip, which uploads straight
 * to storage via a signed URL and then opens in the analysis canvas.
 */
export default async function UploadPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <p className="text-xs font-semibold tracking-[0.3em] text-[var(--muted)]">
          LEER / MILESTONE 2
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Upload a clip</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--muted)]">
          The file goes straight from your browser to storage - it never passes
          through our server. Length and size are checked before the upload
          starts, so you find out immediately if a clip is too long.
        </p>

        {storageConfigured() ? (
          <div className="mt-8">
            <UploadFlow />
          </div>
        ) : (
          <p className="mt-8 rounded-lg border border-[var(--warn)]/40 bg-[var(--warn)]/10 p-4 text-sm text-[var(--warn)]">
            Storage is not configured on this deployment. Set R2_ENDPOINT,
            R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET.
          </p>
        )}
      </div>
    </main>
  );
}
