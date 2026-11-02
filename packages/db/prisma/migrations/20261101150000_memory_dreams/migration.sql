-- Additive: the previous release never reads these tables.
CREATE TABLE "memory_dreams" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "botId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memory_dreams_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "memory_dreams_spaceId_userId_status_idx" ON "memory_dreams"("spaceId", "userId", "status");
CREATE INDEX "memory_dreams_botId_idx" ON "memory_dreams"("botId");

ALTER TABLE "memory_dreams" ADD CONSTRAINT "memory_dreams_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memory_dreams" ADD CONSTRAINT "memory_dreams_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "memory_proposals" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "botId" TEXT,
    "scope" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "baseRevision" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "dreamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memory_proposals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "memory_proposals_spaceId_userId_status_idx" ON "memory_proposals"("spaceId", "userId", "status");
CREATE INDEX "memory_proposals_dreamId_idx" ON "memory_proposals"("dreamId");

ALTER TABLE "memory_proposals" ADD CONSTRAINT "memory_proposals_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memory_proposals" ADD CONSTRAINT "memory_proposals_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memory_proposals" ADD CONSTRAINT "memory_proposals_dreamId_fkey" FOREIGN KEY ("dreamId") REFERENCES "memory_dreams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "memory_dreams" ENABLE ROW LEVEL SECURITY;
CREATE POLICY memory_dreams_tenant ON "memory_dreams"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY memory_dreams_system ON "memory_dreams"
  USING (current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "memory_proposals" ENABLE ROW LEVEL SECURITY;
CREATE POLICY memory_proposals_tenant ON "memory_proposals"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY memory_proposals_system ON "memory_proposals"
  USING (current_setting('app.rls_bypass', true) = 'on');
