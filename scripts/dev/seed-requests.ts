import { PrismaClient } from "@prisma/client";

/** Local fixtures so the coach's queue can be seen with real rows in it. */
async function main() {
  const p = new PrismaClient();
  const trainer = await p.user.findFirst({ where: { username: "maria_rojas" } });
  const trainee = await p.user.findFirst({ where: { email: "trainee@example.com" } });
  if (!trainer || !trainee) throw new Error("fixtures missing");

  await p.coachingRoom.deleteMany({ where: { focusNote: { startsWith: "seed:" } } });

  const now = Date.now();
  const rows = [
    { hours: 18, status: "awaiting_delivery", note: "seed: plenty of time" },
    { hours: 2, status: "awaiting_delivery", note: "seed: nearly out of time" },
    { hours: -1, status: "delivered", note: "seed: waiting on the trainee" },
  ];
  for (const [i, r] of rows.entries()) {
    await p.coachingRoom.create({
      data: {
        publicId: `seed-000${i}-0000-000000`,
        traineeId: trainee.id,
        trainerId: trainer.id,
        videoKey: `uploads/${trainee.id}/seed-${i}.mp4`,
        priceCents: 6500,
        status: r.status,
        focusNote: r.note,
        paidAt: new Date(now - 3_600_000),
        deliverDueAt: new Date(now + r.hours * 3_600_000),
        ...(r.status === "delivered" ? { deliveredAt: new Date() } : {}),
      },
    });
  }
  console.log("seeded", rows.length, "rooms for", trainer.username);
  await p.$disconnect();
}
main();
