-- CreateTable
CREATE TABLE "WorkItemDependency" (
    "predecessorId" INTEGER NOT NULL,
    "successorId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("predecessorId", "successorId"),
    CONSTRAINT "WorkItemDependency_predecessorId_fkey" FOREIGN KEY ("predecessorId") REFERENCES "WorkItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkItemDependency_successorId_fkey" FOREIGN KEY ("successorId") REFERENCES "WorkItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RunningTimer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "workItemId" INTEGER NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "RunningTimer_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "WorkItemDependency_successorId_idx" ON "WorkItemDependency"("successorId");

-- CreateIndex
CREATE UNIQUE INDEX "RunningTimer_workItemId_key" ON "RunningTimer"("workItemId");
