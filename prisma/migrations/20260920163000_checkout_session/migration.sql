-- AlterTable
ALTER TABLE "CoachingRoom" ADD COLUMN "checkoutSessionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CoachingRoom_checkoutSessionId_key" ON "CoachingRoom"("checkoutSessionId");

