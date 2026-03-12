-- CreateTable
CREATE TABLE "AccessRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "application" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "decisionBy" TEXT,
    "decisionAt" DATETIME,
    "decisionNote" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "payloadFingerprint" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "idx_employee_app_status" ON "AccessRequest"("employeeId", "application", "status");

-- CreateIndex
CREATE INDEX "idx_employee" ON "AccessRequest"("employeeId");

-- CreateIndex
CREATE INDEX "idx_status" ON "AccessRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AccessRequest_employeeId_idempotencyKey_key" ON "AccessRequest"("employeeId", "idempotencyKey");

