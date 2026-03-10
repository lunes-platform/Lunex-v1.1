-- CreateEnum
CREATE TYPE "ListingTier" AS ENUM ('BASIC', 'VERIFIED', 'FEATURED');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED');

-- CreateEnum
CREATE TYPE "LockStatus" AS ENUM ('LOCKED', 'UNLOCKED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "CopyVault" ADD COLUMN     "contractAddress" TEXT;

-- CreateTable
CREATE TABLE "TokenListing" (
    "id" TEXT NOT NULL,
    "ownerAddress" TEXT NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "tokenName" TEXT NOT NULL,
    "tokenSymbol" TEXT NOT NULL,
    "tokenDecimals" INTEGER NOT NULL DEFAULT 18,
    "pairAddress" TEXT,
    "tier" "ListingTier" NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'PENDING',
    "listingFee" DECIMAL(36,18) NOT NULL,
    "lunesLiquidity" DECIMAL(36,18) NOT NULL,
    "tokenLiquidity" DECIMAL(36,18) NOT NULL,
    "lpAmount" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "onChainListingId" INTEGER,
    "txHash" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TokenListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiquidityLock" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "ownerAddress" TEXT NOT NULL,
    "pairAddress" TEXT NOT NULL,
    "lpTokenAddress" TEXT NOT NULL,
    "lpAmount" DECIMAL(36,18) NOT NULL,
    "lunesLocked" DECIMAL(36,18) NOT NULL,
    "tokenLocked" DECIMAL(36,18) NOT NULL,
    "tier" "ListingTier" NOT NULL,
    "status" "LockStatus" NOT NULL DEFAULT 'LOCKED',
    "unlockAt" TIMESTAMP(3) NOT NULL,
    "onChainLockId" INTEGER,
    "txHashLock" TEXT,
    "txHashUnlock" TEXT,
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiquidityLock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TokenListing_tokenAddress_key" ON "TokenListing"("tokenAddress");

-- CreateIndex
CREATE INDEX "TokenListing_ownerAddress_idx" ON "TokenListing"("ownerAddress");

-- CreateIndex
CREATE INDEX "TokenListing_status_tier_idx" ON "TokenListing"("status", "tier");

-- CreateIndex
CREATE INDEX "TokenListing_createdAt_idx" ON "TokenListing"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LiquidityLock_listingId_key" ON "LiquidityLock"("listingId");

-- CreateIndex
CREATE INDEX "LiquidityLock_ownerAddress_status_idx" ON "LiquidityLock"("ownerAddress", "status");

-- CreateIndex
CREATE INDEX "LiquidityLock_unlockAt_status_idx" ON "LiquidityLock"("unlockAt", "status");

-- AddForeignKey
ALTER TABLE "LiquidityLock" ADD CONSTRAINT "LiquidityLock_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "TokenListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
