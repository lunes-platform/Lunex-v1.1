-- BE-01 / BE-02: CopyVault deposits/withdrawals are journaled only from a
-- finalized, follower-signed on-chain tx. txHash is unique (replay guard) and
-- the finalized blockHash is stored as part of the proof.
-- (Generated with `prisma migrate diff` against lunex_spot_merge; the
-- unrelated pre-existing drift on "Trade_ticker24h_cov_idx" was intentionally
-- left out — that index is managed by raw SQL in an earlier migration.)

-- AlterTable
ALTER TABLE "CopyVaultDeposit" ADD COLUMN     "blockHash" TEXT;

-- AlterTable
-- BE-04: follower-level stop-loss lives on the follower's own position, never
-- on the shared vault.
ALTER TABLE "CopyVaultPosition" ADD COLUMN     "stopLossPct" DECIMAL(10,4);

-- AlterTable
ALTER TABLE "CopyVaultWithdrawal" ADD COLUMN     "blockHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CopyVaultDeposit_txHash_key" ON "CopyVaultDeposit"("txHash");

-- CreateIndex
CREATE UNIQUE INDEX "CopyVaultWithdrawal_txHash_key" ON "CopyVaultWithdrawal"("txHash");

-- BE-03 data fix: unlink agents that were attached to a leader owned by a
-- DIFFERENT wallet (hijacked links created before the ownership check).
UPDATE "Agent" AS a
SET "leaderId" = NULL
FROM "Leader" AS l
WHERE a."leaderId" = l."id"
  AND l."address" <> a."walletAddress";
