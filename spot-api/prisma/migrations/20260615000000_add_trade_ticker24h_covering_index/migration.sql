-- Ticker 24h aggregation performance fix.
--
-- GET /api/v1/pairs/:symbol/ticker computes 24h stats (count/high/low/volume)
-- with an in-DB aggregate over the (pairId, createdAt) window. Under heavy
-- volume (tens of thousands of trades/24h) the existing
-- "Trade_pairId_createdAt_idx" still required heap fetches for the numeric
-- price/amount/quoteAmount columns, keeping the aggregate at ~2.3s.
--
-- This covering index INCLUDEs those columns so the aggregate is satisfied
-- index-only, dropping it to <1s. Additive and non-destructive.
--
-- NOTE: CONCURRENTLY cannot run inside Prisma's implicit migration
-- transaction. If `prisma migrate deploy` errors on the transaction wrapper,
-- run this statement manually (psql) and mark the migration as applied, or
-- remove CONCURRENTLY for a brief lock on fresh/low-traffic databases.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Trade_ticker24h_cov_idx"
  ON "Trade" ("pairId", "createdAt")
  INCLUDE ("price", "amount", "quoteAmount");
