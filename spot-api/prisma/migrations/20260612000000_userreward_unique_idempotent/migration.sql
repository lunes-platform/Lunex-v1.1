-- Idempotency for reward payouts: enforce one UserReward per
-- (rewardWeekId, walletAddress, rewardType). Prevents the double-pay
-- on crash-and-retry between the on-chain transfer and the DB record.

-- Dedup any pre-existing duplicates first (keep the earliest-created row),
-- otherwise creating the UNIQUE index would fail.
DELETE FROM "UserReward" a
USING "UserReward" b
WHERE a."rewardWeekId" = b."rewardWeekId"
  AND a."walletAddress" = b."walletAddress"
  AND a."rewardType" = b."rewardType"
  AND (
    a."createdAt" > b."createdAt"
    OR (a."createdAt" = b."createdAt" AND a."id" > b."id")
  );

-- CreateIndex
CREATE UNIQUE INDEX "UserReward_rewardWeekId_walletAddress_rewardType_key" ON "UserReward"("rewardWeekId", "walletAddress", "rewardType");
