-- Partial unique index: only one PENDING request per employee + application.
-- Prisma does not support partial indexes in schema.prisma, so this is managed via raw SQL.
-- SQLite supports partial indexes natively (WHERE clause on CREATE INDEX).
CREATE UNIQUE INDEX "uq_employee_app_pending"
ON "AccessRequest" ("employeeId", "application")
WHERE "status" = 'PENDING';