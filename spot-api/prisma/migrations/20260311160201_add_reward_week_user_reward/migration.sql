-- CreateTable
CREATE TABLE "Favorite" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "pairSymbol" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardWeek" (
    "id" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "weekEnd" TIMESTAMP(3) NOT NULL,
    "totalFeesCollected" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "rewardPoolAmount" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "leaderPoolAmount" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "stakerPoolAmount" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACCUMULATING',
    "distributedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardWeek_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserReward" (
    "id" TEXT NOT NULL,
    "rewardWeekId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "amount" DECIMAL(36,18) NOT NULL,
    "rewardType" TEXT NOT NULL,
    "rank" INTEGER,
    "weight" DECIMAL(36,18),
    "claimed" BOOLEAN NOT NULL DEFAULT false,
    "claimedAt" TIMESTAMP(3),
    "txHash" TEXT,
    "payoutStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "payoutError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserReward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Favorite_walletAddress_idx" ON "Favorite"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_walletAddress_pairSymbol_key" ON "Favorite"("walletAddress", "pairSymbol");

-- CreateIndex
CREATE INDEX "RewardWeek_status_idx" ON "RewardWeek"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RewardWeek_weekStart_key" ON "RewardWeek"("weekStart");

-- CreateIndex
CREATE INDEX "UserReward_walletAddress_claimed_idx" ON "UserReward"("walletAddress", "claimed");

-- CreateIndex
CREATE INDEX "UserReward_rewardWeekId_idx" ON "UserReward"("rewardWeekId");

-- CreateIndex
CREATE INDEX "UserReward_payoutStatus_idx" ON "UserReward"("payoutStatus");

-- AddForeignKey
ALTER TABLE "UserReward" ADD CONSTRAINT "UserReward_rewardWeekId_fkey" FOREIGN KEY ("rewardWeekId") REFERENCES "RewardWeek"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
