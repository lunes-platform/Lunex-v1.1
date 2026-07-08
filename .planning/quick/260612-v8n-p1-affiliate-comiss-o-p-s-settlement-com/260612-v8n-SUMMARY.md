---
phase: quick-260612-v8n
plan: 01
subsystem: affiliate / settlement
tags: [affiliate, settlement, idempotency, advisory-lock, reconciliation, prisma]
requires: []
provides:
  - AffiliateCommission @@unique([sourceTradeId, sourceAddr, beneficiaryAddr, level])
  - affiliateService.distributeSpotTradeCommissions(tradeIds)
  - processPayoutBatch reconciliation + pg_advisory_xact_lock + SETTLED guard
affects:
  - spot-api affiliate commission lifecycle
  - tradeSettlementService settlement hook
  - tradeService executeTrade (no longer credits commissions)
tech-stack:
  added: []
  patterns:
    - pg_advisory_xact_lock for cross-process batch serialization
    - anti-join reconciliation via $queryRaw (no Prisma relation Trade↔AffiliateCommission)
    - P2002 idempotent skip
key-files:
  created:
    - spot-api/prisma/migrations/20260613000000_affiliate_commission_unique/migration.sql
    - spot-api/src/__tests__/affiliateService.test.ts
  modified:
    - spot-api/prisma/schema.prisma
    - lunex-admin/prisma/schema.prisma
    - spot-api/src/services/affiliateService.ts
    - spot-api/src/services/tradeSettlementService.ts
    - spot-api/src/services/tradeService.ts
    - spot-api/src/__tests__/tradeService.test.ts
    - spot-api/src/__tests__/tradeSettlementService.test.ts
decisions:
  - sourceAddr included in the unique key so taker-fee and maker-fee legs both persist
  - reconciliation detects missing commission PER FEE LEG, not per trade
  - reconciliation runs outside the advisory lock (worst case = benign P2002)
metrics:
  duration: ~25min
  completed: 2026-06-13
  tests: 369 passing (47 suites), +new affiliate coverage
---

# Phase quick-260612-v8n Plan 01: Affiliate commission post-settlement + idempotency + batch serialization Summary

Moved SPOT affiliate commission crediting to post-SETTLED confirmation, added a `(sourceTradeId, sourceAddr, beneficiaryAddr, level)` unique constraint with idempotent P2002 skip across both Prisma schemas, and rebuilt `processPayoutBatch` as a single advisory-locked transaction with per-fee-leg reconciliation and a SETTLED eligibility guard — closing audit findings coesao-04 L1, L3, L8.

## What was built

### Task 1 — Unique anti-duplication
- `@@unique([sourceTradeId, sourceAddr, beneficiaryAddr, level], map: "AffiliateCommission_source_dedup_key")` added to **both** `spot-api` and `lunex-admin` schemas (identical `map`, dual-schema rule).
- Manual migration `20260613000000_affiliate_commission_unique/migration.sql`: pre-dedupe `DELETE ... USING` (keep earliest `createdAt`, tiebreak by `id`) then `CREATE UNIQUE INDEX`, following the `20260612000000_userreward_unique_idempotent` precedent. Applied locally via `prisma db execute` (NOT `migrate dev`) and verified the index exists.
- `distributeCommissions` now wraps the `create` in try/catch: P2002 → `log.debug` + `continue` (skip duplicate, keep crediting remaining levels); any other error re-throws.

### Task 2 — Credit only after settlement
- New `affiliateService.distributeSpotTradeCommissions(tradeIds)`: early-returns on empty, loads only `settlementStatus: 'SETTLED'` trades (`include: { pair: true }`), credits taker and maker legs (`Decimal.toString()`, no new float) when fee > 0, per-trade try/catch so one bad trade does not block others.
- `tradeSettlementService.processAttempt` hooks the credit after `applySettlementResults`, only for `status === 'SETTLED'` results, best-effort and outside the settlement transaction (failure logged, settlement not rolled back — reconciliation + unique recover it). Single point covers both new-settlement and retry success.
- `tradeService` executeTrade affiliate loop removed; affiliateService import dropped; comment references coesao-04 L1.

### Task 3 — Reconciliation + advisory lock + claim + guard
- Step 0 reconciliation before the transaction: `$queryRaw` anti-join (`NOT EXISTS` per taker/maker leg, 30-day `RECONCILE_LOOKBACK_DAYS` window) → `distributeSpotTradeCommissions`. Best-effort; failure logged, batch proceeds.
- Whole batch wrapped in `prisma.$transaction(async (tx) => {...}, { timeout: 30_000 })`, first op `tx.$executeRaw(Prisma.sql\`SELECT pg_advisory_xact_lock(hashtext('affiliate_payout_batch'))\`)`.
- SETTLED eligibility guard: SPOT commissions with a non-null `sourceTradeId` only paid if the trade is SETTLED; non-SPOT / null-tradeId pass through; ineligible legacy rows stay unpaid.
- Conditional claim `updateMany({ where: { id: { in }, isPaid: false } })`; `totalPaid` recomputed from rows linked to the batch (`Decimal.plus`); batch created inside the transaction (no orphan PROCESSING on crash).

## Deviations from Plan

### Auto-fixed Issues
**1. [Rule 3 - Test harness] Advisory-lock SQL assertion adapted to Prisma.Sql shape**
- **Found during:** Task 3 GREEN.
- **Issue:** The production code passes a `Prisma.sql` tagged-template object (injection-safe) to `$executeRaw`; the test originally asserted on `String(sql)`, which yields `[object Object]`.
- **Fix:** Test reads the literal fragments from the `Prisma.Sql` object's `.strings` array to assert `pg_advisory_xact_lock` is present. Production code unchanged.
- **Files modified:** spot-api/src/__tests__/affiliateService.test.ts
- **Commit:** 3470fa4

## Gate results
- `npx prisma validate` — spot-api **valid**; lunex-admin **valid**.
- `npx tsc --noEmit` — **0 errors**.
- `npx jest --forceExit` (full) — **47 suites, 369 tests, all passing** (no regressions).
- `grep distributeCommissions src/services/tradeService.ts` — **empty**.
- `grep -c pg_advisory_xact_lock src/services/affiliateService.ts` — **1**.
- `grep -c "NOT EXISTS" src/services/affiliateService.ts` — **2**.
- Migration applied + index confirmed present in local DB.

## Commits
| Commit | Repo | Message |
|--------|------|---------|
| 6b1e14c | monorepo | test: failing tests for affiliate commission idempotency |
| 29a8af0 | monorepo | feat: affiliate commission unique constraint with idempotent skip |
| a751eca | lunex-admin | feat(prisma): mirror AffiliateCommission dedup unique from spot-api |
| 0271933 | monorepo | test: failing tests for post-settlement commission credit |
| 3aa1cdd | monorepo | feat: credit spot affiliate commissions only after settlement confirmation |
| 0b3ed05 | monorepo | test: failing tests for payout batch reconciliation and advisory lock |
| 3470fa4 | monorepo | feat: reconcile missed commissions and serialize affiliate payout batch with advisory lock |

## Known Stubs
None.

## Threat Flags
None — all new surface is within the plan's threat_model (T-q260612-01/02/03/05 mitigated).

## Self-Check: PASSED
- migration.sql, affiliateService.test.ts — FOUND.
- Commits 6b1e14c, 29a8af0, 0271933, 3aa1cdd, 0b3ed05, 3470fa4 (monorepo) and a751eca (lunex-admin) — FOUND.
