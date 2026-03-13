-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('PENDING', 'EXECUTED', 'REJECTED', 'FAILED');

-- CreateTable
CREATE TABLE "ExecutionLog" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "strategyId" TEXT,
    "orderId" TEXT,
    "pairSymbol" TEXT NOT NULL,
    "side" "OrderSide" NOT NULL,
    "orderType" TEXT NOT NULL,
    "requestedAmount" DECIMAL(36,18) NOT NULL,
    "executedAmount" DECIMAL(36,18),
    "price" DECIMAL(36,18),
    "slippageBps" INTEGER,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "validationChecks" JSONB,
    "source" TEXT NOT NULL DEFAULT 'API',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExecutionLog_agentId_createdAt_idx" ON "ExecutionLog"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "ExecutionLog_strategyId_createdAt_idx" ON "ExecutionLog"("strategyId", "createdAt");

-- CreateIndex
CREATE INDEX "ExecutionLog_status_createdAt_idx" ON "ExecutionLog"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ExecutionLog_pairSymbol_createdAt_idx" ON "ExecutionLog"("pairSymbol", "createdAt");

-- AddForeignKey
ALTER TABLE "ExecutionLog" ADD CONSTRAINT "ExecutionLog_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionLog" ADD CONSTRAINT "ExecutionLog_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
