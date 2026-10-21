-- Nœud Atelier (docs/SUITE.md §7) : idempotence générale des écritures et journal d'événements.

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "response" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("scope", "key")
);

-- Les clés des imports Atelier Tab déjà traités restent valables (portée « imports.atelier_tab »).
INSERT INTO "IdempotencyRecord" ("scope", "key", "requestHash", "statusCode", "response", "createdAt")
SELECT 'imports.atelier_tab', "key", "requestHash", "statusCode", "response", "createdAt" FROM "ImportIdempotency";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "ImportIdempotency";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "AtelierEvent" (
    "seq" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subjectKind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "subjectLabel" TEXT NOT NULL DEFAULT '',
    "data" TEXT NOT NULL DEFAULT '{}'
);

-- CreateIndex
CREATE INDEX "IdempotencyRecord_createdAt_idx" ON "IdempotencyRecord"("createdAt");

-- CreateIndex
CREATE INDEX "AtelierEvent_at_idx" ON "AtelierEvent"("at");

-- CreateIndex
CREATE INDEX "AtelierEvent_type_seq_idx" ON "AtelierEvent"("type", "seq");
