-- BE-07: settle_trade submission marker + RECONCILE_REQUIRED state.
-- BE-05: index for the SETTLED-only reward queries (settledAt window).
-- Hand-written and scoped to the Trade model only, so it cannot absorb
-- concurrent, not-yet-migrated schema changes from other work streams.

-- AlterEnum
ALTER TYPE "TradeSettlementStatus" ADD VALUE 'RECONCILE_REQUIRED';

-- AlterTable
ALTER TABLE "Trade" ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "submittedBirthBlock" INTEGER,
ADD COLUMN     "submittedMortality" INTEGER,
ADD COLUMN     "submittedRelayerNonce" INTEGER,
ADD COLUMN     "submittedTxHash" TEXT;

-- CreateIndex
CREATE INDEX "Trade_settlementStatus_settledAt_idx" ON "Trade"("settlementStatus", "settledAt");
