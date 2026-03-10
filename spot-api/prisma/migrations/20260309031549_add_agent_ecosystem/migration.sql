-- CreateEnum
CREATE TYPE "AgentType" AS ENUM ('HUMAN', 'AI_AGENT', 'OPENCLAW_BOT', 'ALGO_BOT');

-- CreateEnum
CREATE TYPE "AgentStakeStatus" AS ENUM ('STAKED', 'UNSTAKING', 'UNSTAKED', 'SLASHED');

-- CreateEnum
CREATE TYPE "AgentApiKeyPermission" AS ENUM ('TRADE_SPOT', 'TRADE_MARGIN', 'SOCIAL_POST', 'COPYTRADE_SIGNAL', 'READ_ONLY');

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "leaderId" TEXT,
    "walletAddress" TEXT NOT NULL,
    "agentType" "AgentType" NOT NULL DEFAULT 'HUMAN',
    "framework" TEXT,
    "strategyDescription" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isBanned" BOOLEAN NOT NULL DEFAULT false,
    "banReason" TEXT,
    "dailyTradeLimit" INTEGER NOT NULL DEFAULT 10,
    "maxPositionSize" DECIMAL(36,18) NOT NULL DEFAULT 100,
    "maxOpenOrders" INTEGER NOT NULL DEFAULT 5,
    "stakedAmount" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "stakingTier" INTEGER NOT NULL DEFAULT 0,
    "totalTrades" INTEGER NOT NULL DEFAULT 0,
    "totalVolume" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "lastActiveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentApiKey" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'default',
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "permissions" "AgentApiKeyPermission"[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "lastUsedIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentStake" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "amount" DECIMAL(36,18) NOT NULL,
    "token" TEXT NOT NULL DEFAULT 'LUNES',
    "status" "AgentStakeStatus" NOT NULL DEFAULT 'STAKED',
    "txHash" TEXT,
    "stakedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unstakeRequestedAt" TIMESTAMP(3),
    "unstakeCompletedAt" TIMESTAMP(3),
    "slashedAt" TIMESTAMP(3),
    "slashReason" TEXT,

    CONSTRAINT "AgentStake_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Agent_leaderId_key" ON "Agent"("leaderId");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_walletAddress_key" ON "Agent"("walletAddress");

-- CreateIndex
CREATE INDEX "Agent_agentType_isActive_idx" ON "Agent"("agentType", "isActive");

-- CreateIndex
CREATE INDEX "Agent_stakingTier_isActive_idx" ON "Agent"("stakingTier", "isActive");

-- CreateIndex
CREATE INDEX "Agent_lastActiveAt_idx" ON "Agent"("lastActiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentApiKey_keyHash_key" ON "AgentApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "AgentApiKey_agentId_revokedAt_idx" ON "AgentApiKey"("agentId", "revokedAt");

-- CreateIndex
CREATE INDEX "AgentApiKey_keyHash_idx" ON "AgentApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "AgentStake_agentId_status_idx" ON "AgentStake"("agentId", "status");

-- CreateIndex
CREATE INDEX "AgentStake_status_idx" ON "AgentStake"("status");

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "Leader"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentApiKey" ADD CONSTRAINT "AgentApiKey_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentStake" ADD CONSTRAINT "AgentStake_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
