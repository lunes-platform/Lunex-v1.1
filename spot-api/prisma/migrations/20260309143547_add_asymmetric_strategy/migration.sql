-- CreateEnum
CREATE TYPE "AsymmetricStrategyStatus" AS ENUM ('ACTIVE', 'COOLING_DOWN', 'SUSPENDED_ERROR', 'PAUSED');

-- CreateEnum
CREATE TYPE "AsymmetricCurveSide" AS ENUM ('BUY', 'SELL');

-- AlterEnum
ALTER TYPE "AgentApiKeyPermission" ADD VALUE 'MANAGE_ASYMMETRIC';

-- AlterEnum
ALTER TYPE "IndexedEventKind" ADD VALUE 'ASYMMETRIC_SWAP';

-- CreateTable
CREATE TABLE "AsymmetricStrategy" (
    "id" TEXT NOT NULL,
    "userAddress" TEXT NOT NULL,
    "pairAddress" TEXT NOT NULL,
    "agentId" TEXT,
    "isAutoRebalance" BOOLEAN NOT NULL DEFAULT true,
    "status" "AsymmetricStrategyStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastRebalancedAt" TIMESTAMP(3),
    "pendingAmount" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "buyK" DECIMAL(36,18) NOT NULL,
    "buyGamma" INTEGER NOT NULL,
    "buyMaxCapacity" DECIMAL(36,18) NOT NULL,
    "buyFeeTargetBps" INTEGER NOT NULL DEFAULT 30,
    "sellGamma" INTEGER NOT NULL,
    "sellMaxCapacity" DECIMAL(36,18) NOT NULL,
    "sellFeeTargetBps" INTEGER NOT NULL DEFAULT 30,
    "sellProfitTargetBps" INTEGER NOT NULL DEFAULT 500,
    "leverageL" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "allocationC" DECIMAL(10,4) NOT NULL DEFAULT 0.5,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AsymmetricStrategy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AsymmetricRebalanceLog" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "side" "AsymmetricCurveSide" NOT NULL,
    "trigger" TEXT NOT NULL,
    "acquiredAmount" DECIMAL(36,18) NOT NULL,
    "newCapacity" DECIMAL(36,18) NOT NULL,
    "txHash" TEXT,
    "gasConsumed" DECIMAL(36,18),
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AsymmetricRebalanceLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AsymmetricStrategy_userAddress_status_idx" ON "AsymmetricStrategy"("userAddress", "status");

-- CreateIndex
CREATE INDEX "AsymmetricStrategy_pairAddress_idx" ON "AsymmetricStrategy"("pairAddress");

-- CreateIndex
CREATE INDEX "AsymmetricStrategy_agentId_idx" ON "AsymmetricStrategy"("agentId");

-- CreateIndex
CREATE INDEX "AsymmetricStrategy_status_lastRebalancedAt_idx" ON "AsymmetricStrategy"("status", "lastRebalancedAt");

-- CreateIndex
CREATE INDEX "AsymmetricRebalanceLog_strategyId_createdAt_idx" ON "AsymmetricRebalanceLog"("strategyId", "createdAt");

-- CreateIndex
CREATE INDEX "AsymmetricRebalanceLog_status_createdAt_idx" ON "AsymmetricRebalanceLog"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "AsymmetricStrategy" ADD CONSTRAINT "AsymmetricStrategy_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AsymmetricRebalanceLog" ADD CONSTRAINT "AsymmetricRebalanceLog_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "AsymmetricStrategy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
