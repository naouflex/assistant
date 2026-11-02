-- Additive: the previous release ignores these columns and never reads the new table.
ALTER TABLE "computers" ADD COLUMN "healthRecoveryAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "computers" ADD COLUMN "healthRecoveryAt" TIMESTAMP(3);
ALTER TABLE "computers" ADD COLUMN "healthAlertedAt" TIMESTAMP(3);

ALTER TABLE "notification_preferences" ADD COLUMN "computer" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "computer_health_events" (
    "id" TEXT NOT NULL,
    "computerId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "computer_health_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "computer_health_events_computerId_createdAt_idx" ON "computer_health_events"("computerId", "createdAt");
CREATE INDEX "computers_state_healthRecoveryAt_idx" ON "computers"("state", "healthRecoveryAt");

ALTER TABLE "computer_health_events" ADD CONSTRAINT "computer_health_events_computerId_fkey" FOREIGN KEY ("computerId") REFERENCES "computers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "computer_health_events" ENABLE ROW LEVEL SECURITY;
CREATE POLICY computer_health_events_tenant ON "computer_health_events"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY computer_health_events_system ON "computer_health_events"
  USING (current_setting('app.rls_bypass', true) = 'on');
