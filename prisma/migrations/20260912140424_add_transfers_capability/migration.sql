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
    "stripeDetailsSubmitted" BOOLEAN NOT NULL DEFAULT false,
    "stripeTransfersActive" BOOLEAN NOT NULL DEFAULT false,
    "stripeChargesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "stripePayoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "stripeSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("createdAt", "email", "emailVerified", "id", "image", "isTrainer", "name", "stripeAccountId", "stripeChargesEnabled", "stripeDetailsSubmitted", "stripePayoutsEnabled", "stripeSyncedAt", "trainerActiveAt", "updatedAt", "username") SELECT "createdAt", "email", "emailVerified", "id", "image", "isTrainer", "name", "stripeAccountId", "stripeChargesEnabled", "stripeDetailsSubmitted", "stripePayoutsEnabled", "stripeSyncedAt", "trainerActiveAt", "updatedAt", "username" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE UNIQUE INDEX "User_stripeAccountId_key" ON "User"("stripeAccountId");
CREATE INDEX "User_isTrainer_idx" ON "User"("isTrainer");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
