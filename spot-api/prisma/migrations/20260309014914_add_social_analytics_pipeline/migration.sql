-- CreateEnum
CREATE TYPE "OrderSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('LIMIT', 'MARKET', 'STOP', 'STOP_LIMIT');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_TRIGGER', 'OPEN', 'PARTIAL', 'FILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TimeInForce" AS ENUM ('GTC', 'IOC', 'FOK');

-- CreateEnum
CREATE TYPE "MarginPositionStatus" AS ENUM ('OPEN', 'CLOSED', 'LIQUIDATED');

-- CreateEnum
CREATE TYPE "MarginTransferDirection" AS ENUM ('DEPOSIT', 'WITHDRAW');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TradeSettlementStatus" AS ENUM ('PENDING', 'SETTLING', 'SETTLED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "CopyVaultStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CopyTradeSource" AS ENUM ('API', 'WEB3');

-- CreateEnum
CREATE TYPE "CopyTradeSignalStatus" AS ENUM ('EXECUTED', 'TWAP_EXECUTED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CopyTradeExecutionStatus" AS ENUM ('EXECUTED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LeaderTradeStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "SocialIdeaDirection" AS ENUM ('Bullish', 'Bearish');

-- CreateEnum
CREATE TYPE "AnalyticsPipelineStatus" AS ENUM ('IDLE', 'RUNNING', 'ERROR', 'DISABLED');

-- CreateEnum
CREATE TYPE "IndexedEventKind" AS ENUM ('SWAP', 'LIQUIDITY_ADD', 'LIQUIDITY_REMOVE', 'TRADE_OPEN', 'TRADE_CLOSE', 'VAULT_DEPOSIT', 'VAULT_WITHDRAW', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AffiliateSourceType" AS ENUM ('SPOT', 'MARGIN', 'COPYTRADE');

-- CreateEnum
CREATE TYPE "AffiliatePayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "Pair" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "baseToken" TEXT NOT NULL,
    "quoteToken" TEXT NOT NULL,
    "baseName" TEXT NOT NULL,
    "quoteName" TEXT NOT NULL,
    "baseDecimals" INTEGER NOT NULL DEFAULT 8,
    "quoteDecimals" INTEGER NOT NULL DEFAULT 8,
    "isNativeBase" BOOLEAN NOT NULL DEFAULT false,
    "isNativeQuote" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "makerFeeBps" INTEGER NOT NULL DEFAULT 10,
    "takerFeeBps" INTEGER NOT NULL DEFAULT 25,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pair_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "pairId" TEXT NOT NULL,
    "makerAddress" TEXT NOT NULL,
    "side" "OrderSide" NOT NULL,
    "type" "OrderType" NOT NULL,
    "price" DECIMAL(36,18) NOT NULL,
    "stopPrice" DECIMAL(36,18),
    "amount" DECIMAL(36,18) NOT NULL,
    "filledAmount" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "remainingAmount" DECIMAL(36,18) NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'OPEN',
    "signature" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "orderHash" TEXT NOT NULL,
    "timeInForce" "TimeInForce" NOT NULL DEFAULT 'GTC',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "pairId" TEXT NOT NULL,
    "makerOrderId" TEXT NOT NULL,
    "takerOrderId" TEXT NOT NULL,
    "makerAddress" TEXT NOT NULL,
    "takerAddress" TEXT NOT NULL,
    "side" "OrderSide" NOT NULL,
    "price" DECIMAL(36,18) NOT NULL,
    "amount" DECIMAL(36,18) NOT NULL,
    "quoteAmount" DECIMAL(36,18) NOT NULL,
    "makerFee" DECIMAL(36,18) NOT NULL,
    "takerFee" DECIMAL(36,18) NOT NULL,
    "settlementStatus" "TradeSettlementStatus" NOT NULL DEFAULT 'PENDING',
    "settlementAttempts" INTEGER NOT NULL DEFAULT 0,
    "settlementPayload" JSONB,
    "settlementError" TEXT,
    "lastSettlementAttemptAt" TIMESTAMP(3),
    "nextSettlementRetryAt" TIMESTAMP(3),
    "txHash" TEXT,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candle" (
    "id" TEXT NOT NULL,
    "pairId" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "openTime" TIMESTAMP(3) NOT NULL,
    "open" DECIMAL(36,18) NOT NULL,
    "high" DECIMAL(36,18) NOT NULL,
    "low" DECIMAL(36,18) NOT NULL,
    "close" DECIMAL(36,18) NOT NULL,
    "volume" DECIMAL(36,18) NOT NULL,
    "quoteVolume" DECIMAL(36,18) NOT NULL,
    "tradeCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Candle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBalance" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "available" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "locked" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarginAccount" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "collateralToken" TEXT NOT NULL DEFAULT 'USDT',
    "collateralAvailable" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "collateralLocked" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "totalRealizedPnl" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarginAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarginPosition" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "pairId" TEXT NOT NULL,
    "pairSymbol" TEXT NOT NULL,
    "side" "OrderSide" NOT NULL,
    "status" "MarginPositionStatus" NOT NULL DEFAULT 'OPEN',
    "collateralAmount" DECIMAL(36,18) NOT NULL,
    "leverage" DECIMAL(20,8) NOT NULL,
    "notional" DECIMAL(36,18) NOT NULL,
    "quantity" DECIMAL(36,18) NOT NULL,
    "entryPrice" DECIMAL(36,18) NOT NULL,
    "markPrice" DECIMAL(36,18) NOT NULL,
    "borrowedAmount" DECIMAL(36,18) NOT NULL,
    "maintenanceMargin" DECIMAL(36,18) NOT NULL,
    "liquidationPrice" DECIMAL(36,18) NOT NULL,
    "unrealizedPnl" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "realizedPnl" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarginPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarginCollateralTransfer" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "direction" "MarginTransferDirection" NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'CONFIRMED',
    "token" TEXT NOT NULL,
    "amount" DECIMAL(36,18) NOT NULL,
    "signature" TEXT NOT NULL,
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarginCollateralTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarginLiquidation" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "liquidatorAddress" TEXT NOT NULL,
    "markPrice" DECIMAL(36,18) NOT NULL,
    "equityBefore" DECIMAL(36,18) NOT NULL,
    "penaltyAmount" DECIMAL(36,18) NOT NULL,
    "releasedCollateral" DECIMAL(36,18) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarginLiquidation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Leader" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "avatar" TEXT NOT NULL DEFAULT '',
    "twitterUrl" TEXT,
    "telegramUrl" TEXT,
    "discordUrl" TEXT,
    "isAi" BOOLEAN NOT NULL DEFAULT false,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "bio" TEXT NOT NULL,
    "memberSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "performanceFeeBps" INTEGER NOT NULL DEFAULT 1500,
    "roi30d" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "roi90d" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "totalAum" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "drawdown" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "followersCount" INTEGER NOT NULL DEFAULT 0,
    "winRate" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "avgProfit" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "sharpe" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "totalPerformanceFeesEarned" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "allowApiTrading" BOOLEAN NOT NULL DEFAULT false,
    "apiKeyHash" TEXT,
    "pnlHistory" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Leader_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopyVault" (
    "id" TEXT NOT NULL,
    "leaderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "collateralToken" TEXT NOT NULL DEFAULT 'USDT',
    "status" "CopyVaultStatus" NOT NULL DEFAULT 'ACTIVE',
    "totalEquity" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "totalShares" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "totalDeposits" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "totalWithdrawals" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "minDeposit" DECIMAL(36,18) NOT NULL DEFAULT 10,
    "twapThreshold" DECIMAL(36,18) NOT NULL DEFAULT 50000,
    "maxSlippageBps" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CopyVault_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopyVaultPosition" (
    "id" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "followerAddress" TEXT NOT NULL,
    "shareBalance" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "netDeposited" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "totalWithdrawn" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "highWaterMarkValue" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "feePaid" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "realizedPnl" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CopyVaultPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopyVaultDeposit" (
    "id" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "followerAddress" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "amount" DECIMAL(36,18) NOT NULL,
    "sharesMinted" DECIMAL(36,18) NOT NULL,
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CopyVaultDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopyVaultWithdrawal" (
    "id" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "followerAddress" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "sharesBurned" DECIMAL(36,18) NOT NULL,
    "grossAmount" DECIMAL(36,18) NOT NULL,
    "feeAmount" DECIMAL(36,18) NOT NULL,
    "netAmount" DECIMAL(36,18) NOT NULL,
    "profitAmount" DECIMAL(36,18) NOT NULL,
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CopyVaultWithdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopyTradeSignal" (
    "id" TEXT NOT NULL,
    "leaderId" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "pairId" TEXT,
    "pairSymbol" TEXT NOT NULL,
    "side" "OrderSide" NOT NULL,
    "source" "CopyTradeSource" NOT NULL DEFAULT 'API',
    "strategyTag" TEXT,
    "amountIn" DECIMAL(36,18) NOT NULL,
    "amountOutMin" DECIMAL(36,18) NOT NULL,
    "executionPrice" DECIMAL(36,18),
    "realizedPnlPct" DECIMAL(20,8),
    "route" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxSlippageBps" INTEGER NOT NULL DEFAULT 100,
    "status" "CopyTradeSignalStatus" NOT NULL DEFAULT 'EXECUTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CopyTradeSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopyTradeExecution" (
    "id" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "pairId" TEXT,
    "pairSymbol" TEXT NOT NULL,
    "side" "OrderSide" NOT NULL,
    "sliceIndex" INTEGER NOT NULL,
    "totalSlices" INTEGER NOT NULL,
    "amountIn" DECIMAL(36,18) NOT NULL,
    "amountOut" DECIMAL(36,18),
    "executionPrice" DECIMAL(36,18),
    "slippageBps" INTEGER,
    "realizedPnl" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "status" "CopyTradeExecutionStatus" NOT NULL DEFAULT 'EXECUTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CopyTradeExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaderTrade" (
    "id" TEXT NOT NULL,
    "leaderId" TEXT NOT NULL,
    "pairId" TEXT,
    "pairSymbol" TEXT NOT NULL,
    "side" "OrderSide" NOT NULL,
    "entryPrice" DECIMAL(36,18) NOT NULL,
    "exitPrice" DECIMAL(36,18),
    "pnlPct" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "status" "LeaderTradeStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "LeaderTrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialIdea" (
    "id" TEXT NOT NULL,
    "leaderId" TEXT NOT NULL,
    "pairId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "pairSymbol" TEXT NOT NULL,
    "direction" "SocialIdeaDirection" NOT NULL,
    "likesCount" INTEGER NOT NULL DEFAULT 0,
    "commentsCount" INTEGER NOT NULL DEFAULT 0,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialIdea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialIdeaLike" (
    "id" TEXT NOT NULL,
    "ideaId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialIdeaLike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialIdeaComment" (
    "id" TEXT NOT NULL,
    "ideaId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialIdeaComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaderFollow" (
    "id" TEXT NOT NULL,
    "leaderId" TEXT NOT NULL,
    "followerAddress" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaderFollow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialAnalyticsCursor" (
    "id" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "lastProcessedBlock" INTEGER NOT NULL DEFAULT 0,
    "lastProcessedHash" TEXT,
    "status" "AnalyticsPipelineStatus" NOT NULL DEFAULT 'IDLE',
    "lastProcessedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialAnalyticsCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialIndexedEvent" (
    "id" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "blockHash" TEXT NOT NULL,
    "eventIndex" INTEGER NOT NULL,
    "extrinsicIndex" INTEGER,
    "extrinsicHash" TEXT,
    "pallet" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "kind" "IndexedEventKind" NOT NULL DEFAULT 'UNKNOWN',
    "accountAddress" TEXT,
    "counterpartyAddress" TEXT,
    "pairSymbol" TEXT,
    "amountIn" DECIMAL(36,18),
    "amountOut" DECIMAL(36,18),
    "price" DECIMAL(36,18),
    "realizedPnl" DECIMAL(36,18),
    "timestamp" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialIndexedEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaderAnalyticsSnapshot" (
    "id" TEXT NOT NULL,
    "leaderId" TEXT NOT NULL,
    "sourceChain" TEXT NOT NULL,
    "sourceMode" TEXT NOT NULL DEFAULT 'INDEXER',
    "asOfBlock" INTEGER NOT NULL DEFAULT 0,
    "asOfTime" TIMESTAMP(3) NOT NULL,
    "initialEquity" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "currentEquity" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "realizedPnl" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "unrealizedPnl" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "tradedVolume" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "grossProfit" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "grossLoss" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "roi30d" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "roi90d" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "maxDrawdown" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "winRate" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "avgProfit" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "sharpe" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "totalTrades" INTEGER NOT NULL DEFAULT 0,
    "winningTrades" INTEGER NOT NULL DEFAULT 0,
    "losingTrades" INTEGER NOT NULL DEFAULT 0,
    "pnlHistory" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "lastEventAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaderAnalyticsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "referrerAddress" TEXT NOT NULL,
    "refereeAddress" TEXT NOT NULL,
    "referralCode" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateCommission" (
    "id" TEXT NOT NULL,
    "beneficiaryAddr" TEXT NOT NULL,
    "sourceAddr" TEXT NOT NULL,
    "sourceTradeId" TEXT,
    "sourceType" "AffiliateSourceType" NOT NULL,
    "level" INTEGER NOT NULL,
    "feeToken" TEXT NOT NULL,
    "feeAmount" DECIMAL(36,18) NOT NULL,
    "commissionRate" INTEGER NOT NULL,
    "commissionAmount" DECIMAL(36,18) NOT NULL,
    "batchId" TEXT,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateCommission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliatePayoutBatch" (
    "id" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "totalPaid" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "status" "AffiliatePayoutStatus" NOT NULL DEFAULT 'PENDING',
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliatePayoutBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Pair_symbol_key" ON "Pair"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderHash_key" ON "Order"("orderHash");

-- CreateIndex
CREATE INDEX "Order_pairId_side_status_price_idx" ON "Order"("pairId", "side", "status", "price");

-- CreateIndex
CREATE INDEX "Order_makerAddress_status_idx" ON "Order"("makerAddress", "status");

-- CreateIndex
CREATE INDEX "Order_orderHash_idx" ON "Order"("orderHash");

-- CreateIndex
CREATE UNIQUE INDEX "Order_makerAddress_nonce_key" ON "Order"("makerAddress", "nonce");

-- CreateIndex
CREATE UNIQUE INDEX "Trade_txHash_key" ON "Trade"("txHash");

-- CreateIndex
CREATE INDEX "Trade_pairId_createdAt_idx" ON "Trade"("pairId", "createdAt");

-- CreateIndex
CREATE INDEX "Trade_makerAddress_idx" ON "Trade"("makerAddress");

-- CreateIndex
CREATE INDEX "Trade_takerAddress_idx" ON "Trade"("takerAddress");

-- CreateIndex
CREATE INDEX "Trade_settlementStatus_nextSettlementRetryAt_idx" ON "Trade"("settlementStatus", "nextSettlementRetryAt");

-- CreateIndex
CREATE INDEX "Candle_pairId_timeframe_openTime_idx" ON "Candle"("pairId", "timeframe", "openTime");

-- CreateIndex
CREATE UNIQUE INDEX "Candle_pairId_timeframe_openTime_key" ON "Candle"("pairId", "timeframe", "openTime");

-- CreateIndex
CREATE INDEX "UserBalance_address_idx" ON "UserBalance"("address");

-- CreateIndex
CREATE UNIQUE INDEX "UserBalance_address_token_key" ON "UserBalance"("address", "token");

-- CreateIndex
CREATE UNIQUE INDEX "MarginAccount_address_key" ON "MarginAccount"("address");

-- CreateIndex
CREATE INDEX "MarginAccount_address_idx" ON "MarginAccount"("address");

-- CreateIndex
CREATE INDEX "MarginPosition_accountId_status_idx" ON "MarginPosition"("accountId", "status");

-- CreateIndex
CREATE INDEX "MarginPosition_accountId_pairId_status_idx" ON "MarginPosition"("accountId", "pairId", "status");

-- CreateIndex
CREATE INDEX "MarginPosition_pairSymbol_status_idx" ON "MarginPosition"("pairSymbol", "status");

-- CreateIndex
CREATE INDEX "MarginCollateralTransfer_accountId_createdAt_idx" ON "MarginCollateralTransfer"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "MarginCollateralTransfer_accountId_status_createdAt_idx" ON "MarginCollateralTransfer"("accountId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MarginLiquidation_positionId_createdAt_idx" ON "MarginLiquidation"("positionId", "createdAt");

-- CreateIndex
CREATE INDEX "MarginLiquidation_liquidatorAddress_createdAt_idx" ON "MarginLiquidation"("liquidatorAddress", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Leader_username_key" ON "Leader"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Leader_address_key" ON "Leader"("address");

-- CreateIndex
CREATE UNIQUE INDEX "Leader_apiKeyHash_key" ON "Leader"("apiKeyHash");

-- CreateIndex
CREATE INDEX "Leader_isAi_roi30d_idx" ON "Leader"("isAi", "roi30d");

-- CreateIndex
CREATE INDEX "Leader_followersCount_roi30d_idx" ON "Leader"("followersCount", "roi30d");

-- CreateIndex
CREATE UNIQUE INDEX "CopyVault_leaderId_key" ON "CopyVault"("leaderId");

-- CreateIndex
CREATE INDEX "CopyVault_status_idx" ON "CopyVault"("status");

-- CreateIndex
CREATE INDEX "CopyVaultPosition_followerAddress_idx" ON "CopyVaultPosition"("followerAddress");

-- CreateIndex
CREATE UNIQUE INDEX "CopyVaultPosition_vaultId_followerAddress_key" ON "CopyVaultPosition"("vaultId", "followerAddress");

-- CreateIndex
CREATE INDEX "CopyVaultDeposit_vaultId_createdAt_idx" ON "CopyVaultDeposit"("vaultId", "createdAt");

-- CreateIndex
CREATE INDEX "CopyVaultDeposit_followerAddress_createdAt_idx" ON "CopyVaultDeposit"("followerAddress", "createdAt");

-- CreateIndex
CREATE INDEX "CopyVaultWithdrawal_vaultId_createdAt_idx" ON "CopyVaultWithdrawal"("vaultId", "createdAt");

-- CreateIndex
CREATE INDEX "CopyVaultWithdrawal_followerAddress_createdAt_idx" ON "CopyVaultWithdrawal"("followerAddress", "createdAt");

-- CreateIndex
CREATE INDEX "CopyTradeSignal_leaderId_createdAt_idx" ON "CopyTradeSignal"("leaderId", "createdAt");

-- CreateIndex
CREATE INDEX "CopyTradeSignal_vaultId_createdAt_idx" ON "CopyTradeSignal"("vaultId", "createdAt");

-- CreateIndex
CREATE INDEX "CopyTradeSignal_pairId_createdAt_idx" ON "CopyTradeSignal"("pairId", "createdAt");

-- CreateIndex
CREATE INDEX "CopyTradeExecution_vaultId_createdAt_idx" ON "CopyTradeExecution"("vaultId", "createdAt");

-- CreateIndex
CREATE INDEX "CopyTradeExecution_signalId_idx" ON "CopyTradeExecution"("signalId");

-- CreateIndex
CREATE INDEX "CopyTradeExecution_pairId_createdAt_idx" ON "CopyTradeExecution"("pairId", "createdAt");

-- CreateIndex
CREATE INDEX "LeaderTrade_leaderId_openedAt_idx" ON "LeaderTrade"("leaderId", "openedAt");

-- CreateIndex
CREATE INDEX "LeaderTrade_pairId_openedAt_idx" ON "LeaderTrade"("pairId", "openedAt");

-- CreateIndex
CREATE INDEX "SocialIdea_leaderId_createdAt_idx" ON "SocialIdea"("leaderId", "createdAt");

-- CreateIndex
CREATE INDEX "SocialIdea_pairSymbol_createdAt_idx" ON "SocialIdea"("pairSymbol", "createdAt");

-- CreateIndex
CREATE INDEX "SocialIdea_pairId_createdAt_idx" ON "SocialIdea"("pairId", "createdAt");

-- CreateIndex
CREATE INDEX "SocialIdeaLike_address_idx" ON "SocialIdeaLike"("address");

-- CreateIndex
CREATE UNIQUE INDEX "SocialIdeaLike_ideaId_address_key" ON "SocialIdeaLike"("ideaId", "address");

-- CreateIndex
CREATE INDEX "SocialIdeaComment_ideaId_createdAt_idx" ON "SocialIdeaComment"("ideaId", "createdAt");

-- CreateIndex
CREATE INDEX "SocialIdeaComment_address_idx" ON "SocialIdeaComment"("address");

-- CreateIndex
CREATE INDEX "LeaderFollow_followerAddress_idx" ON "LeaderFollow"("followerAddress");

-- CreateIndex
CREATE UNIQUE INDEX "LeaderFollow_leaderId_followerAddress_key" ON "LeaderFollow"("leaderId", "followerAddress");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAnalyticsCursor_chain_key" ON "SocialAnalyticsCursor"("chain");

-- CreateIndex
CREATE INDEX "SocialIndexedEvent_accountAddress_timestamp_idx" ON "SocialIndexedEvent"("accountAddress", "timestamp");

-- CreateIndex
CREATE INDEX "SocialIndexedEvent_kind_timestamp_idx" ON "SocialIndexedEvent"("kind", "timestamp");

-- CreateIndex
CREATE INDEX "SocialIndexedEvent_pairSymbol_timestamp_idx" ON "SocialIndexedEvent"("pairSymbol", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "SocialIndexedEvent_chain_blockNumber_eventIndex_key" ON "SocialIndexedEvent"("chain", "blockNumber", "eventIndex");

-- CreateIndex
CREATE INDEX "LeaderAnalyticsSnapshot_asOfBlock_idx" ON "LeaderAnalyticsSnapshot"("asOfBlock");

-- CreateIndex
CREATE INDEX "LeaderAnalyticsSnapshot_asOfTime_idx" ON "LeaderAnalyticsSnapshot"("asOfTime");

-- CreateIndex
CREATE UNIQUE INDEX "LeaderAnalyticsSnapshot_leaderId_sourceChain_key" ON "LeaderAnalyticsSnapshot"("leaderId", "sourceChain");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_refereeAddress_key" ON "Referral"("refereeAddress");

-- CreateIndex
CREATE INDEX "Referral_referrerAddress_idx" ON "Referral"("referrerAddress");

-- CreateIndex
CREATE INDEX "Referral_referralCode_idx" ON "Referral"("referralCode");

-- CreateIndex
CREATE INDEX "AffiliateCommission_beneficiaryAddr_isPaid_idx" ON "AffiliateCommission"("beneficiaryAddr", "isPaid");

-- CreateIndex
CREATE INDEX "AffiliateCommission_sourceAddr_createdAt_idx" ON "AffiliateCommission"("sourceAddr", "createdAt");

-- CreateIndex
CREATE INDEX "AffiliateCommission_batchId_idx" ON "AffiliateCommission"("batchId");

-- CreateIndex
CREATE INDEX "AffiliatePayoutBatch_status_idx" ON "AffiliatePayoutBatch"("status");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_pairId_fkey" FOREIGN KEY ("pairId") REFERENCES "Pair"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_pairId_fkey" FOREIGN KEY ("pairId") REFERENCES "Pair"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_makerOrderId_fkey" FOREIGN KEY ("makerOrderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_takerOrderId_fkey" FOREIGN KEY ("takerOrderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candle" ADD CONSTRAINT "Candle_pairId_fkey" FOREIGN KEY ("pairId") REFERENCES "Pair"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarginPosition" ADD CONSTRAINT "MarginPosition_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MarginAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarginPosition" ADD CONSTRAINT "MarginPosition_pairId_fkey" FOREIGN KEY ("pairId") REFERENCES "Pair"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarginCollateralTransfer" ADD CONSTRAINT "MarginCollateralTransfer_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MarginAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarginLiquidation" ADD CONSTRAINT "MarginLiquidation_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "MarginPosition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopyVault" ADD CONSTRAINT "CopyVault_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "Leader"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopyVaultPosition" ADD CONSTRAINT "CopyVaultPosition_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "CopyVault"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopyVaultDeposit" ADD CONSTRAINT "CopyVaultDeposit_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "CopyVault"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopyVaultWithdrawal" ADD CONSTRAINT "CopyVaultWithdrawal_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "CopyVault"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopyTradeSignal" ADD CONSTRAINT "CopyTradeSignal_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "Leader"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopyTradeSignal" ADD CONSTRAINT "CopyTradeSignal_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "CopyVault"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopyTradeSignal" ADD CONSTRAINT "CopyTradeSignal_pairId_fkey" FOREIGN KEY ("pairId") REFERENCES "Pair"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopyTradeExecution" ADD CONSTRAINT "CopyTradeExecution_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "CopyVault"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopyTradeExecution" ADD CONSTRAINT "CopyTradeExecution_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "CopyTradeSignal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopyTradeExecution" ADD CONSTRAINT "CopyTradeExecution_pairId_fkey" FOREIGN KEY ("pairId") REFERENCES "Pair"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderTrade" ADD CONSTRAINT "LeaderTrade_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "Leader"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderTrade" ADD CONSTRAINT "LeaderTrade_pairId_fkey" FOREIGN KEY ("pairId") REFERENCES "Pair"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialIdea" ADD CONSTRAINT "SocialIdea_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "Leader"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialIdea" ADD CONSTRAINT "SocialIdea_pairId_fkey" FOREIGN KEY ("pairId") REFERENCES "Pair"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialIdeaLike" ADD CONSTRAINT "SocialIdeaLike_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "SocialIdea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialIdeaComment" ADD CONSTRAINT "SocialIdeaComment_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "SocialIdea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderFollow" ADD CONSTRAINT "LeaderFollow_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "Leader"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderAnalyticsSnapshot" ADD CONSTRAINT "LeaderAnalyticsSnapshot_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "Leader"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "AffiliatePayoutBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
