-- Beta feedback & client telemetry (P0-10). Additive only.
-- NOTE: `prisma migrate dev` also proposes DROP INDEX "Trade_ticker24h_cov_idx"
-- (raw-SQL covering index from 20260615000000, not expressible in the Prisma
-- schema). That statement was removed on purpose: keep the index.

-- CreateTable
CREATE TABLE "ClientFeedback" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "walletAddress" TEXT,
    "txHash" TEXT,
    "page" TEXT,
    "userAgent" TEXT,
    "appVersion" TEXT,
    "network" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientError" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "page" TEXT,
    "userAgent" TEXT,
    "network" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientError_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientFeedback_createdAt_idx" ON "ClientFeedback"("createdAt");

-- CreateIndex
CREATE INDEX "ClientFeedback_category_createdAt_idx" ON "ClientFeedback"("category", "createdAt");

-- CreateIndex
CREATE INDEX "ClientError_lastSeenAt_idx" ON "ClientError"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClientError_fingerprint_appVersion_key" ON "ClientError"("fingerprint", "appVersion");
