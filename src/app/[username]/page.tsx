import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

/**
 * The public trainer URL issued on role elevation: leer.fit/<username>.
 *
 * M1 proves the URL exists and resolves to the right person. The profile
 * itself - banner, bio, gallery, sales cards - is outside the job-post scope
 * and is not built here.
 */
export default async function TrainerPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;

  const trainer = await prisma.user.findUnique({
    where: { username: username.toLowerCase() },
    select: { name: true, image: true, isTrainer: true, trainerActiveAt: true },
  });

  // A username exists only for trainers, but check the flag too: a demoted
  // account keeps its handle and must stop rendering as bookable.
  if (!trainer || !trainer.isTrainer) notFound();

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-3xl px-6 py-20">
        <div className="h-32 rounded-xl bg-gradient-to-r from-[var(--surface-2)] to-[var(--surface)]" />
        <div className="-mt-10 px-6">
          <div className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-[var(--background)] bg-[var(--surface-2)] text-2xl font-semibold">
            {(trainer.name ?? "?").charAt(0).toUpperCase()}
          </div>
          <h1 className="mt-4 text-3xl font-semibold">{trainer.name}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            leer.fit/{username} - coaching since{" "}
            {trainer.trainerActiveAt?.toISOString().slice(0, 10) ?? "today"}
          </p>
        </div>

        <div className="mt-10 rounded-xl border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--muted)]">
          Coaching passes and the booking flow land in milestone 2.
        </div>
      </div>
    </main>
  );
}
