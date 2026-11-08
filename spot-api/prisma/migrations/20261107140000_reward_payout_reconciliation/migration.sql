-- Reward payouts: persist the mortal era of each submitted transfer so an
-- ambiguous (UNKNOWN) payout can be reconciled by hash from finalized blocks
-- instead of being auto-re-paid. payoutStatus is a String column, so the new
-- UNKNOWN value needs no enum change.

-- AlterTable
ALTER TABLE "UserReward" ADD COLUMN     "payoutBirthBlock" INTEGER,
ADD COLUMN     "payoutMortality" INTEGER,
ADD COLUMN     "payoutSubmittedAt" TIMESTAMP(3);
