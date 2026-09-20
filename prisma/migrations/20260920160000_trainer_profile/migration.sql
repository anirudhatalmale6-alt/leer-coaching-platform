-- AlterTable
ALTER TABLE "CoachingRoom" ADD COLUMN "focusNote" TEXT;

-- CreateTable
CREATE TABLE "PortfolioLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    CONSTRAINT "PortfolioLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" DATETIME,
    "image" TEXT,
    "username" TEXT,
    "isTrainer" BOOLEAN NOT NULL DEFAULT false,
    "trainerActiveAt" DATETIME,
    "stripeAccountId" TEXT,
    "stripeCountry" TEXT,
    "stripeTransfersStatus" TEXT,
    "stripeRequirementsOutstanding" BOOLEAN NOT NULL DEFAULT false,
    "stripeSyncedAt" DATETIME,
    "bio" TEXT,
    "category" TEXT,
    "instagram" TEXT,
    "youtube" TEXT,
    "avatarKey" TEXT,
    "coachingPriceCents" INTEGER NOT NULL DEFAULT 5000,
    "coachingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("createdAt", "email", "emailVerified", "id", "image", "isTrainer", "name", "stripeAccountId", "stripeCountry", "stripeRequirementsOutstanding", "stripeSyncedAt", "stripeTransfersStatus", "trainerActiveAt", "updatedAt", "username") SELECT "createdAt", "email", "emailVerified", "id", "image", "isTrainer", "name", "stripeAccountId", "stripeCountry", "stripeRequirementsOutstanding", "stripeSyncedAt", "stripeTransfersStatus", "trainerActiveAt", "updatedAt", "username" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE UNIQUE INDEX "User_stripeAccountId_key" ON "User"("stripeAccountId");
CREATE INDEX "User_isTrainer_idx" ON "User"("isTrainer");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "PortfolioLink_userId_idx" ON "PortfolioLink"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioLink_userId_position_key" ON "PortfolioLink"("userId", "position");

