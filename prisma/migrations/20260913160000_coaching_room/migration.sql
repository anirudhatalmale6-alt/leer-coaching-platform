-- CreateTable
CREATE TABLE "CoachingRoom" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "publicId" TEXT NOT NULL,
    "traineeId" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "videoKey" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "status" TEXT NOT NULL DEFAULT 'awaiting_payment',
    "paymentIntentId" TEXT,
    "transferId" TEXT,
    "refundId" TEXT,
    "deliverDueAt" DATETIME,
    "paidAt" DATETIME,
    "deliveredAt" DATETIME,
    "approvedAt" DATETIME,
    "closedAt" DATETIME,
    "annotations" TEXT,
    "closeReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CoachingRoom_traineeId_fkey" FOREIGN KEY ("traineeId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CoachingRoom_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CoachingRoom_publicId_key" ON "CoachingRoom"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "CoachingRoom_paymentIntentId_key" ON "CoachingRoom"("paymentIntentId");

-- CreateIndex
CREATE INDEX "CoachingRoom_trainerId_status_idx" ON "CoachingRoom"("trainerId", "status");

-- CreateIndex
CREATE INDEX "CoachingRoom_traineeId_idx" ON "CoachingRoom"("traineeId");

-- CreateIndex
CREATE INDEX "CoachingRoom_status_deliverDueAt_idx" ON "CoachingRoom"("status", "deliverDueAt");

