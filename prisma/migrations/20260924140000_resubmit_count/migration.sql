-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CoachingRoom" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "publicId" TEXT NOT NULL,
    "traineeId" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "videoKey" TEXT NOT NULL,
    "videoCodec" TEXT,
    "priceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "status" TEXT NOT NULL DEFAULT 'awaiting_payment',
    "checkoutSessionId" TEXT,
    "paymentIntentId" TEXT,
    "transferId" TEXT,
    "refundId" TEXT,
    "deliverDueAt" DATETIME,
    "approveDueAt" DATETIME,
    "disputedAt" DATETIME,
    "disputeReason" TEXT,
    "resubmitCount" INTEGER NOT NULL DEFAULT 0,
    "refundProposedById" TEXT,
    "refundProposedAt" DATETIME,
    "refundReason" TEXT,
    "refundAgreedAt" DATETIME,
    "paidAt" DATETIME,
    "deliveredAt" DATETIME,
    "approvedAt" DATETIME,
    "closedAt" DATETIME,
    "annotations" TEXT,
    "focusNote" TEXT,
    "closeReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CoachingRoom_traineeId_fkey" FOREIGN KEY ("traineeId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CoachingRoom_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_CoachingRoom" ("annotations", "approveDueAt", "approvedAt", "checkoutSessionId", "closeReason", "closedAt", "createdAt", "currency", "deliverDueAt", "deliveredAt", "disputeReason", "disputedAt", "focusNote", "id", "paidAt", "paymentIntentId", "priceCents", "publicId", "refundAgreedAt", "refundId", "refundProposedAt", "refundProposedById", "refundReason", "status", "traineeId", "trainerId", "transferId", "updatedAt", "videoCodec", "videoKey") SELECT "annotations", "approveDueAt", "approvedAt", "checkoutSessionId", "closeReason", "closedAt", "createdAt", "currency", "deliverDueAt", "deliveredAt", "disputeReason", "disputedAt", "focusNote", "id", "paidAt", "paymentIntentId", "priceCents", "publicId", "refundAgreedAt", "refundId", "refundProposedAt", "refundProposedById", "refundReason", "status", "traineeId", "trainerId", "transferId", "updatedAt", "videoCodec", "videoKey" FROM "CoachingRoom";
DROP TABLE "CoachingRoom";
ALTER TABLE "new_CoachingRoom" RENAME TO "CoachingRoom";
CREATE UNIQUE INDEX "CoachingRoom_publicId_key" ON "CoachingRoom"("publicId");
CREATE UNIQUE INDEX "CoachingRoom_checkoutSessionId_key" ON "CoachingRoom"("checkoutSessionId");
CREATE UNIQUE INDEX "CoachingRoom_paymentIntentId_key" ON "CoachingRoom"("paymentIntentId");
CREATE INDEX "CoachingRoom_trainerId_status_idx" ON "CoachingRoom"("trainerId", "status");
CREATE INDEX "CoachingRoom_traineeId_idx" ON "CoachingRoom"("traineeId");
CREATE INDEX "CoachingRoom_status_deliverDueAt_idx" ON "CoachingRoom"("status", "deliverDueAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

