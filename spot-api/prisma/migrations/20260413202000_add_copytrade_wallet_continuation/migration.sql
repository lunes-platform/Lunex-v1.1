-- AlterEnum
ALTER TYPE "CopyTradeSignalStatus" ADD VALUE IF NOT EXISTS 'PENDING_WALLET_SIGNATURE';

-- CreateEnum
CREATE TYPE "CopyTradeWalletContinuationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "CopyTradeWalletContinuation" (
    "id" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "leaderId" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "positionEffect" TEXT NOT NULL,
    "executedVia" TEXT NOT NULL DEFAULT 'ASYMMETRIC',
    "requiresWalletSignature" BOOLEAN NOT NULL DEFAULT true,
    "contractAddress" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'swap',
    "side" "OrderSide" NOT NULL,
    "amountIn" DECIMAL(36,18) NOT NULL,
    "minAmountOut" DECIMAL(36,18) NOT NULL,
    "makerAddress" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "agentId" TEXT,
    "status" "CopyTradeWalletContinuationStatus" NOT NULL DEFAULT 'PENDING',
    "txHash" TEXT,
    "message" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CopyTradeWalletContinuation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CopyTradeWalletContinuation_signalId_key" ON "CopyTradeWalletContinuation"("signalId");

-- CreateIndex
CREATE INDEX "CopyTradeWalletContinuation_leaderId_status_requestedAt_idx" ON "CopyTradeWalletContinuation"("leaderId", "status", "requestedAt");

-- CreateIndex
CREATE INDEX "CopyTradeWalletContinuation_vaultId_status_requestedAt_idx" ON "CopyTradeWalletContinuation"("vaultId", "status", "requestedAt");

-- AddForeignKey
ALTER TABLE "CopyTradeWalletContinuation" ADD CONSTRAINT "CopyTradeWalletContinuation_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "CopyTradeSignal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
