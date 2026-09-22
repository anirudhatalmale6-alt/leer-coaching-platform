-- AlterTable
ALTER TABLE "CoachingRoom" ADD COLUMN "approveDueAt" DATETIME;
ALTER TABLE "CoachingRoom" ADD COLUMN "disputeReason" TEXT;
ALTER TABLE "CoachingRoom" ADD COLUMN "disputedAt" DATETIME;
ALTER TABLE "CoachingRoom" ADD COLUMN "refundAgreedAt" DATETIME;
ALTER TABLE "CoachingRoom" ADD COLUMN "refundProposedAt" DATETIME;
ALTER TABLE "CoachingRoom" ADD COLUMN "refundProposedById" TEXT;
ALTER TABLE "CoachingRoom" ADD COLUMN "refundReason" TEXT;

