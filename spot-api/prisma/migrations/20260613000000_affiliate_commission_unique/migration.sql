-- Idempotency for affiliate commissions: enforce one AffiliateCommission per
-- (sourceTradeId, sourceAddr, beneficiaryAddr, level). Prevents duplicate
-- commissions when executeTrade / settlement retries re-emit the same fee
-- event. sourceAddr is part of the key so taker-fee and maker-fee
-- distributions for the same trade (distinct sourceAddr) both persist.

-- Dedup any pre-existing duplicates first (keep the earliest-created row),
-- otherwise creating the UNIQUE index would fail. The `sourceTradeId IS NOT NULL`
-- clause documents intent: NULL never joins to NULL in Postgres, so rows with
-- a null sourceTradeId are inherently distinct and are left untouched.
DELETE FROM "AffiliateCommission" a
USING "AffiliateCommission" b
WHERE a."sourceTradeId" IS NOT NULL
  AND a."sourceTradeId" = b."sourceTradeId"
  AND a."sourceAddr" = b."sourceAddr"
  AND a."beneficiaryAddr" = b."beneficiaryAddr"
  AND a."level" = b."level"
  AND (
    a."createdAt" > b."createdAt"
    OR (a."createdAt" = b."createdAt" AND a."id" > b."id")
  );

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateCommission_source_dedup_key" ON "AffiliateCommission"("sourceTradeId", "sourceAddr", "beneficiaryAddr", "level");
