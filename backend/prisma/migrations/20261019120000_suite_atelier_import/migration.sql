-- AlterTable
ALTER TABLE "WorkItem" ADD COLUMN "externalRef" TEXT;

-- CreateTable
CREATE TABLE "ImportIdempotency" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "requestHash" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "response" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkItem_externalRef_key" ON "WorkItem"("externalRef");

-- CreateIndex
CREATE INDEX "ImportIdempotency_createdAt_idx" ON "ImportIdempotency"("createdAt");
