-- CreateEnum
CREATE TYPE "StrategyType" AS ENUM ('COPYTRADE', 'MARKET_MAKER', 'ARBITRAGE', 'MOMENTUM', 'HEDGE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "StrategyRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'AGGRESSIVE');

-- CreateEnum
CREATE TYPE "StrategyStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "reputationScore" DECIMAL(10,4) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Strategy" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "leaderId" TEXT,
    "vaultAddress" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "strategyType" "StrategyType" NOT NULL DEFAULT 'CUSTOM',
    "riskLevel" "StrategyRiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "status" "StrategyStatus" NOT NULL DEFAULT 'ACTIVE',
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "roi30d" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "roi7d" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "roi1d" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "sharpeRatio" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "maxDrawdown" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "winRate" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "totalTrades" INTEGER NOT NULL DEFAULT 0,
    "followersCount" INTEGER NOT NULL DEFAULT 0,
    "totalVolume" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "vaultEquity" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "performanceSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Strategy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyFollow" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "followerAddress" TEXT NOT NULL,
    "allocatedCapital" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "followedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unfollowedAt" TIMESTAMP(3),

    CONSTRAINT "StrategyFollow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyPerformance" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "roi" DECIMAL(20,8) NOT NULL,
    "pnl" DECIMAL(36,18) NOT NULL,
    "volume" DECIMAL(36,18) NOT NULL,
    "trades" INTEGER NOT NULL DEFAULT 0,
    "equity" DECIMAL(36,18) NOT NULL,
    "drawdown" DECIMAL(20,8) NOT NULL,

    CONSTRAINT "StrategyPerformance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GovernanceVote" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "proposalId" INTEGER NOT NULL,
    "voteType" TEXT NOT NULL,
    "txHash" TEXT,
    "votedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GovernanceVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Strategy_agentId_idx" ON "Strategy"("agentId");

-- CreateIndex
CREATE INDEX "Strategy_leaderId_idx" ON "Strategy"("leaderId");

-- CreateIndex
CREATE INDEX "Strategy_strategyType_status_isPublic_idx" ON "Strategy"("strategyType", "status", "isPublic");

-- CreateIndex
CREATE INDEX "Strategy_status_isPublic_roi30d_idx" ON "Strategy"("status", "isPublic", "roi30d");

-- CreateIndex
CREATE INDEX "Strategy_followersCount_idx" ON "Strategy"("followersCount");

-- CreateIndex
CREATE INDEX "StrategyFollow_followerAddress_isActive_idx" ON "StrategyFollow"("followerAddress", "isActive");

-- CreateIndex
CREATE INDEX "StrategyFollow_strategyId_isActive_idx" ON "StrategyFollow"("strategyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "StrategyFollow_strategyId_followerAddress_key" ON "StrategyFollow"("strategyId", "followerAddress");

-- CreateIndex
CREATE INDEX "StrategyPerformance_strategyId_date_idx" ON "StrategyPerformance"("strategyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "StrategyPerformance_strategyId_date_key" ON "StrategyPerformance"("strategyId", "date");

-- CreateIndex
CREATE INDEX "GovernanceVote_walletAddress_proposalId_idx" ON "GovernanceVote"("walletAddress", "proposalId");

-- CreateIndex
CREATE INDEX "GovernanceVote_votedAt_idx" ON "GovernanceVote"("votedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GovernanceVote_walletAddress_proposalId_voteType_key" ON "GovernanceVote"("walletAddress", "proposalId", "voteType");

-- AddForeignKey
ALTER TABLE "Strategy" ADD CONSTRAINT "Strategy_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Strategy" ADD CONSTRAINT "Strategy_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "Leader"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyFollow" ADD CONSTRAINT "StrategyFollow_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyPerformance" ADD CONSTRAINT "StrategyPerformance_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
