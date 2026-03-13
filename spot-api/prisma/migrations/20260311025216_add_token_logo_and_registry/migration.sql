-- AlterTable
ALTER TABLE "TokenListing" ADD COLUMN     "logoURI" TEXT;

-- CreateTable
CREATE TABLE "TokenRegistry" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL DEFAULT 18,
    "logoURI" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "isTrusted" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'LISTING',
    "listingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TokenRegistry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TokenRegistry_address_key" ON "TokenRegistry"("address");

-- CreateIndex
CREATE INDEX "TokenRegistry_symbol_idx" ON "TokenRegistry"("symbol");

-- CreateIndex
CREATE INDEX "TokenRegistry_isVerified_idx" ON "TokenRegistry"("isVerified");
