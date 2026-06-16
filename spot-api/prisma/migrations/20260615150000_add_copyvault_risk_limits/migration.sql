-- Copy-engine risk limits (RISK-BE)
-- copyMultiplier scales the copied position size; maxPerTradeUsdt caps per-trade
-- size; stopLossPct / maxDrawdownPct gate copy execution (pause on breach).
ALTER TABLE "CopyVault" ADD COLUMN "copyMultiplier" DECIMAL(36,18) NOT NULL DEFAULT 1;
ALTER TABLE "CopyVault" ADD COLUMN "maxPerTradeUsdt" DECIMAL(36,18);
ALTER TABLE "CopyVault" ADD COLUMN "stopLossPct" DECIMAL(10,4);
ALTER TABLE "CopyVault" ADD COLUMN "maxDrawdownPct" DECIMAL(10,4);
