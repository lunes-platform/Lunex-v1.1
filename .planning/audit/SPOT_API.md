# spot-api Production Readiness Audit

**Date:** 2026-05-21
**Scope:** `/Users/lucas/Documents/Projetos_DEV/Lunex/spot-api`
**Methodology:** Tests-before-code. Specs derived from docs (`README.md`, `PRODUCTION-READINESS.md`, `CHANGELOG.md`, `.planning/codebase/CONCERNS.md`, `INTEGRATIONS.md`, `spot-api/README.md`, `spot-api/.env.example`, `spot-api/package.json`) BEFORE any source code was read. Existing tests + tsc + quality script were executed before code inspection. The audit then compares specs to source line-by-line.

NextAuth is **out of scope** — it lives in `lunex-admin`, not `spot-api`. The four spot-api auth flows audited are: (1) sr25519 signature + nonce (browser wallet), (2) Bearer `ADMIN_SECRET`, (3) `X-API-Key` agent key, (4) `X-Leader-Key` leader key (documented in README but not exercised in this scan beyond presence in route list).

---

## Methodology

**Phase 1** — Read docs only. Identified 24 routes, 35+ services, 4 auth surfaces, and explicit production guard requirements.

**Phase 2** — Wrote SPEC list per service / route family from documented behavior (see *Per-Service Findings*). 53 specs across 7 families.

**Phase 3** — Ran:
- `npm test -- --testPathIgnorePatterns=e2e` → **23 suites, 194 tests passed** (exit 0, 105.8 s).
- `npx tsc --noEmit` → **clean, exit 0**.
- `npm run quality` (lint + ts-prune + depcheck + prettier) → exit 0, but ts-prune reports 1 unused export: `src/middleware/auth.ts:104 buildSpotCancelMessage` (CONCERNS.md #60 still flagged it as cancel-replay surface; unused export confirms cancel signature does not embed timestamp).

Note: README.md claims **323 / 323 tests across 40 suites** (2026-04-28). Today's runs show **194 / 194 across 23 suites** for unit (e2e excluded). Discrepancy unexplained — either ~17 suites are e2e-tagged and excluded by our filter, or test surface shrank. Recommend reconciling.

**Phase 4** — Read source, compared to specs, marked COVERED / PARTIAL / MISSING / DRIFTED.

**Phase 5** — Wrote this document.

---

## Service Inventory

### Routes (mounted in `src/index.ts:293-314`)

| Mount | File | Auth surfaces |
|-------|------|--------------|
| `/api/v1/pairs` | `routes/pairs.ts` | `requireAdmin` on 5 write paths |
| `/api/v1/orders` | `routes/orders.ts` | sr25519 + nonce |
| `/api/v1/trades` | `routes/trades.ts` | `verifyWalletReadSignature` on user reads |
| `/api/v1/candles` | `routes/candles.ts` | public |
| `/api/v1/orderbook` | `routes/orderbook.ts` | public |
| `/api/v1/social` | `routes/social.ts` | mix: 3 admin POSTs, 6 wallet-signed |
| `/api/v1/copytrade` | `routes/copytrade.ts` | wallet-signed |
| `/api/v1/margin` | `routes/margin.ts` | wallet-signed + 1 admin |
| `/api/v1/affiliate` | `routes/affiliate.ts` | wallet-signed + 3 admin |
| `/api/v1/agents` | `routes/agents.ts` | wallet-signed for register; agent X-API-Key for trade |
| `/api/v1/strategies` | `routes/strategies.ts` | — |
| `/api/v1/execution` | `routes/execution.ts` | `agentAuth(['TRADE_SPOT'])` for entire router |
| `/api/v1/trade` | `routes/tradeApi.ts` | `agentAuth(['TRADE_SPOT'])` for entire router |
| `/api/v1/asymmetric` | `routes/asymmetric.ts` | wallet-signed + `agentAuth(['MANAGE_ASYMMETRIC'])` |
| `/api/v1/route` | `routes/router.ts` | `agentAuth(['TRADE_SPOT'])` for entire router |
| `/api/v1/listing` | `routes/listing.ts` | wallet-signed + `requireAdmin` on activate/reject/process-expired |
| `/api/v1/governance` | `routes/governance.ts` | wallet-signed |
| `/api/v1/tokens` | `routes/tokenRegistry.ts` | `requireAdmin` on mutation |
| `/api/v1/user` | `routes/favorites.ts` | wallet-signed |
| `/api/v1/markets` | `routes/marketInfo.ts` | public |
| `/api/v1/rewards` | `routes/rewards.ts` | wallet-signed + 1 admin trigger |
| `/api/v1/admin` | `routes/admin.ts` | `requireAdmin` on all 5 endpoints |
| `GET /health` | `index.ts:317` | public — returns 503 if Redis or DB unhealthy |
| `GET /metrics` | `index.ts:349` | `requireAdminOrInternal` (Bearer OR private/loopback IP without XFF) |

### Services touched in this audit
`assetBridgeService`, `rewardPayoutService`, `rebalancerService`, `settlementService`, `copyVaultService`, `emergencyService`, `agentService`, `tradeSettlementService`, `walletRiskService`, `marginService`, `socialIndexerService` (not deep-read; flagged by CONCERNS).

---

## Test Coverage Summary

| Command | Result |
|--------|--------|
| `npm test -- --testPathIgnorePatterns=e2e` | **23 suites, 194 tests passed, exit 0** (105.8 s) |
| `npx tsc --noEmit` | **clean, exit 0** |
| `npm run quality` | **exit 0** — ts-prune flags 1 unused export (`buildSpotCancelMessage`) |
| `npm run test:e2e` | Not executed (Postgres / WS deps); 5 e2e files exist: `affiliate`, `agent`, `botSandbox`, `governance`, `tradeApi` |

### Existing test suites (`src/__tests__/`)
`tradeService`, `routerService`, `tradeSettlementService`, `productionGuards`, `copytrade`, `helpers`, `asymmetricService`, `auth/verifyWalletActionSignature`, `orderbookBootstrapService`, `matchingLockService`, `txWithTimeout`, `responseSanitizer`, `settlementSignatureMessage`, `walletRiskService`, `rebalancerService` + 8 more.

### Coverage gaps (no test asserts the spec)
- `assetBridgeService` — no test at all; the `//Alice` fallback has zero coverage.
- `rewardPayoutService` `isFinalized` discipline — no test for native or contract paths.
- `rebalancerService.updateCurveParameters` `isFinalized` — `rebalancerService.test.ts` exists but does not assert finality status branch (line 423).
- `emergencyService` `runSpotPauseTx` finality discipline — no test.
- `copyVaultService` finality (already correct) — only asserts happy path, no fork-revert simulation.
- `listing` logo upload magic-byte check — no test.
- `securityShield` path traversal patterns — no test (visible in tree).
- WebSocket allowed-origins enforcement — no test.
- `requireAdminOrInternal` XFF spoofing rejection — no test.
- `/health` 503 on Redis-down — no test asserting status code.
- `/metrics` admin gating — no test.
- Per-route rate limiters (orders 10/s, trade 10/s, agents 5/s) — no test.

---

## Per-Service Findings (verification matrix)

### assetBridgeService

| Spec | Status | Evidence | Notes |
|------|--------|----------|-------|
| SPEC-BRIDGE-001: MUST refuse to start if `BRIDGE_ADMIN_SEED` env unset in production | **MISSING** | `spot-api/src/services/assetBridgeService.ts:466` | `const adminSeed = process.env.BRIDGE_ADMIN_SEED \|\| '//Alice'` — silent fallback. **No** `productionGuards.ts` check covers it (see `utils/productionGuards.ts:1-156`). |
| SPEC-BRIDGE-002: MUST sign tx with the configured seed only — never `//Alice` fallback in prod | **MISSING** | `assetBridgeService.ts:466` → constructor `:67` `keyring.addFromUri(config.adminSeed)` | Same root cause. Module is standalone (`require.main === module` at `:490`); not imported by `index.ts`, so guard would have to live inside the service or in a launch wrapper. |
| SPEC-BRIDGE-003: deposit/withdraw replay protection via persistent state | COVERED | `assetBridgeService.ts:75-102, 104-111` | `loadState`/`saveState` + `makeDepositKey`. |
| SPEC-BRIDGE-004: wait for finalized blocks before mint/transfer | COVERED (claimed) | header `:9` says "Uses FINALIZED blocks only" | Not verified in this pass — needs separate read of monitor loop. Flag for follow-up. |
| SPEC-BRIDGE-005: sequential nonce management | COVERED (claimed) | `:63` `currentNonce: number = -1` + header B-03 | Not verified end-to-end. |

### rewardPayoutService

| Spec | Status | Evidence | Notes |
|------|--------|----------|-------|
| SPEC-REWARD-001: MUST wait for `isFinalized` (not `isInBlock`) before marking native LUNES payout complete | **DRIFTED** | `rewardPayoutService.ts:447` | `if (txResult.status.isInBlock \|\| txResult.status.isFinalized)` accepts isInBlock. PRODUCTION-READINESS.md claims this was migrated for `settlementService` + `copyVaultService` only; this path was missed. Exact-line confirmed at offset 447 today. |
| SPEC-REWARD-002: MUST wait for `isFinalized` for contract-call payouts (signAndSendContract) | **DRIFTED** | `rewardPayoutService.ts:498` | Same pattern. Money-moving — reward distribution moves real LUNES. |
| SPEC-REWARD-003: per-recipient idempotency via `userReward.findFirst` | COVERED (claimed by PRODUCTION-READINESS) | not re-verified in this audit | Verified in 2026-04-28 pass per docs. |
| SPEC-REWARD-004: distributed lock at `runWeeklyDistribution` entry | COVERED (claimed) | not re-verified | Same. |

### rebalancerService

| Spec | Status | Evidence | Notes |
|------|--------|----------|-------|
| SPEC-REBAL-001: `updateCurveParameters` MUST wait for `isFinalized` | **DRIFTED** | `rebalancerService.ts:423` | `if (txResult.status.isInBlock \|\| txResult.status.isFinalized)` — same pattern. Adjusts AMM curve, indirectly moves value. |
| SPEC-REBAL-002: dry-run gas estimate before submit | COVERED | `rebalancerService.ts:400-404` | `result.isErr` aborts before signAndSend. |
| SPEC-REBAL-003: `ensureReady()` blocked when `relayerSeed` missing | COVERED | `rebalancerService.ts:43` | `Boolean(config.blockchain.wsUrl && config.blockchain.relayerSeed)`. |

### settlementService

| Spec | Status | Evidence | Notes |
|------|--------|----------|-------|
| SPEC-SETTLE-001: settlement tx MUST wait for `isFinalized` | **COVERED** | `settlementService.ts:528` | `if (txResult.status.isFinalized)` (no `isInBlock` short-circuit). Pattern is the correct one to mirror. |
| SPEC-SETTLE-002: reject all-zero relayer seed at boot | COVERED | `productionGuards.ts:84-101` | RELAYER_SEED required, dev-seed `//Alice..//Ferdie` denylist, placeholder `REPLACE_WITH_...` rejected. |
| SPEC-SETTLE-003: dispatchError aborts | COVERED | `settlementService.ts:518-522` | Explicit `dispatchError` branch rejects. |

### copyVaultService

| Spec | Status | Evidence | Notes |
|------|--------|----------|-------|
| SPEC-VAULT-001: deposit MUST wait for `isFinalized` | COVERED | `copyVaultService.ts:162` | `if (txResult.status.isFinalized)` only — correct. |
| SPEC-VAULT-002: dry-run gas estimate before submit | COVERED | `copyVaultService.ts:131-140` | `result.isErr` aborts. |

### emergencyService

| Spec | Status | Evidence | Notes |
|------|--------|----------|-------|
| SPEC-EMERG-001: pause/unpause MUST require admin auth | COVERED | `routes/admin.ts:81,106` | `requireAdmin` on both. |
| SPEC-EMERG-002: audit log on state change | COVERED | `emergencyService.ts:250-253`, `routes/admin.ts:91,116` | `log.warn` includes `performedBy` + `reason`. |
| SPEC-EMERG-003: tx acknowledged only after `isFinalized` (for pause to be safely visible) | **DRIFTED** | `emergencyService.ts:242` | `if (status.isFinalized \|\| status.isInBlock)` — accepts isInBlock. Lower risk than payouts (no fund move), but reports "paused" before the chain confirms. |
| SPEC-EMERG-004: copy_vault and staking emergency endpoints wired | **MISSING** | `emergencyService.ts:132-148` | Hardcoded `available: false` for `copy_vault` and `staking`. Explicit TODO. |

### Auth (sr25519 wallet / ADMIN_SECRET / X-API-Key / X-Leader-Key)

| Spec | Status | Evidence | Notes |
|------|--------|----------|-------|
| SPEC-AUTH-001: signed action MUST include timestamp within 5 min | COVERED | `middleware/auth.ts:186-197` | `SIGNED_ACTION_TTL_MS = 5 * 60 * 1000`. |
| SPEC-AUTH-002: signed action MUST consume a unique nonce (no replay) | COVERED | `middleware/auth.ts:266-282` | `consumeNonce` uses Redis `SET NX EX`. In-memory fallback for non-prod. |
| SPEC-AUTH-003: in production, signature MUST be rejected if Redis nonce store unavailable | COVERED | `middleware/auth.ts:64-71, 200-211` | `consumeNonce` returns `{ ok:false, error:'unavailable' }` in prod (no in-memory fallback). |
| SPEC-AUTH-004: sr25519 verification via `@polkadot/util-crypto` | COVERED | `middleware/auth.ts:147-159` | `signatureVerify(message, signature, address).isValid`. |
| SPEC-AUTH-005: cancel signatures MUST embed timestamp (CONCERNS #60) | **MISSING** | `middleware/auth.ts:104-106` | `buildSpotCancelMessage(orderId) → lunex-cancel:${orderId}` — no timestamp embedded. Function is also flagged as unused export by ts-prune; cancel route uses `verifyWalletActionSignature` with `fields: { orderId }` (orders.ts:115-124) which builds a fresh action message that DOES include nonce+timestamp. So the `lunex-cancel:` constant is dead code BUT the cancel path itself is safe. **Spec status: COVERED in practice via action signature; dead export should be removed.** |
| SPEC-AUTH-006: ADMIN_SECRET comparison MUST be timing-safe | COVERED | `middleware/adminGuard.ts:57-63` | `crypto.timingSafeEqual` with length check. |
| SPEC-AUTH-007: `/metrics` MUST be unreachable from external proxies even with private IP (XFF spoofing defense) | COVERED | `middleware/adminGuard.ts:85-100` | Refuses bypass when any of `X-Forwarded-For`, `X-Forwarded-Host`, `Forwarded` is present. |
| SPEC-AUTH-008: API key auth via `X-API-Key`, attached `req.agent` with permissions | COVERED | `middleware/agentAuth.ts:30-71` | Verifies via `agentService.verifyApiKey`, checks required permissions, attaches `req.agent`. |
| SPEC-AUTH-009: signed message canonical format `lunex-order:{pair}:{side}:{type}:{price}:{stopPrice}:{amount}:{nonce}[:{timestamp}]` | COVERED | `middleware/auth.ts:95-100` | `buildSpotOrderMessage`. README declares the format. |
| SPEC-AUTH-010: wallet-action message includes lexicographically-sorted fields | COVERED | `middleware/auth.ts:122-145` | `buildWalletActionMessage` sorts entries. |
| SPEC-AUTH-011: wallets banned via `walletRiskService` MUST be rejected during action verification | COVERED | `middleware/auth.ts:250-264` | `assertWalletCanAct` called between sig verify and nonce consume. |
| SPEC-AUTH-012: read-signature TTL also enforced | COVERED | `middleware/auth.ts:310-322` | Same 5 min TTL. |

### Public + write endpoints

| Spec | Status | Evidence | Notes |
|------|--------|----------|-------|
| SPEC-ORDERS-001: POST /orders rejects expired timestamp >5min | COVERED | `routes/orders.ts:38-41` | Same TTL constant. |
| SPEC-ORDERS-002: POST /orders rejects on used nonce | COVERED | `routes/orders.ts:44-47, 65-73` | Pre-check + consume. |
| SPEC-ORDERS-003: POST /orders Zod-validated body | COVERED | `routes/orders.ts:31-36` | `CreateOrderSchema`. |
| SPEC-ORDERS-004: order route rate-limited (10/s) | COVERED | `index.ts:261-268` | `orderLimiter` mounted on `/api/v1/orders`. |
| SPEC-ORDERS-005: cancel rate-limited via Redis sliding window (20/min/address) | COVERED | `routes/orders.ts:82-95, 109-113` | `checkRedisRateLimit`. |
| SPEC-LISTING-001: admin endpoints `/activate`, `/reject`, `/admin/process-expired-locks` require `requireAdmin` | COVERED | `routes/listing.ts:316, 345, 407` | All three. |
| SPEC-LISTING-002: logo upload size capped (200 KB) and MIME-restricted to PNG/WebP | COVERED | `routes/listing.ts:38, 55-64` | `MAX_LOGO_SIZE = 200 * 1024`; `ALLOWED_MIMES`. |
| SPEC-LISTING-003: logo upload validated by magic bytes (defense against extension spoofing) | COVERED | `routes/listing.ts:66-86, 246-249` | PNG and WebP magic-byte check; uploaded file removed on mismatch. |
| SPEC-LISTING-004: POST / requires wallet signature | COVERED | `routes/listing.ts:251-269` | `verifyWalletActionSignature` for `listing.create`. |
| SPEC-LISTING-005: 2 MB body parser only on `/api/v1/listing`; global is 100 KB | COVERED | `index.ts:208-209` | Order matters — `/api/v1/listing` middleware mounted first. |
| SPEC-SOCIAL-001: analytics-recompute and other admin POSTs guarded | COVERED | `routes/social.ts:80,93,106` | `requireAdmin` on 3 endpoints. |
| SPEC-ROUTER-001: smart router routes locked behind agent API key | COVERED | `routes/router.ts:61` | `router.use(agentAuth(['TRADE_SPOT']))` for whole router. |
| SPEC-TRADEAPI-001: agent trade API locked behind agent API key | COVERED | `routes/tradeApi.ts:20` | `router.use(agentAuth(['TRADE_SPOT']))` for whole router. |
| SPEC-EXEC-001: execution router locked behind agent API key | COVERED | `routes/execution.ts:51` | Same pattern. |
| SPEC-ASYM-001: write paths require either wallet sig OR agent permission `MANAGE_ASYMMETRIC` | COVERED | `routes/asymmetric.ts:376,468,503,570,594,632,680,718` | Mixed; both gates present. |
| SPEC-PAIRS-001: pair registration / mutation requires admin | COVERED | `routes/pairs.ts:88,110,195,231,258` | 5 admin guards. |
| SPEC-TOKENREG-001: token registry mutation requires admin | COVERED | `routes/tokenRegistry.ts:78` | `requireAdmin`. |
| SPEC-CANDLES-001: candles handler limits result to 200 | COVERED (per CHANGELOG) | not re-read | trusted from CHANGELOG. |
| SPEC-CORS-001: production rejects wildcard CORS origin | COVERED | `index.ts:147-150`, `productionGuards.ts:65-71` | Both startup guard and runtime origin callback. |
| SPEC-CORS-002: strict CORS routes refuse no-origin unless authenticated server-to-server | COVERED | `index.ts:177-201` | Allows when `x-api-key`, signed query auth, or `x-lunex-client: mcp` header is present. |
| SPEC-BODY-001: global JSON body limited to 100 KB | COVERED | `index.ts:209` | `express.json({ limit: '100kb' })`. |
| SPEC-HTTPS-001: production enforces HTTPS via 301 redirect on missing `x-forwarded-proto: https` | COVERED | `index.ts:231-238` | 301 redirect. |
| SPEC-SHIELD-001: path traversal / .env / .git URLs rejected with 400 | COVERED | `middleware/securityShield.ts:5-49` | Pattern list + decoded URL check. |

### Observability (metrics, health, logs)

| Spec | Status | Evidence | Notes |
|------|--------|----------|-------|
| SPEC-HEALTH-001: `/health` returns 503 when Redis unhealthy | COVERED | `index.ts:317-347` | `overallOk = dbOk && redisOk`; status 503 when either is down. |
| SPEC-HEALTH-002: `/health` returns DB + Redis booleans + margin price health | COVERED | `index.ts:340-346` | Returned in JSON. |
| SPEC-METRICS-001: `/metrics` requires admin or internal/loopback | COVERED | `index.ts:349`, `middleware/adminGuard.ts:85-100` | `requireAdminOrInternal`. |
| SPEC-METRICS-002: Prometheus exposes histogram, gauges, and counters per `utils/metrics.ts` | COVERED | `index.ts:18-26, 240-248` | http duration histogram + gauges + counters wired. |
| SPEC-LOG-001: structured JSON via pino with redactions on secrets | COVERED | `utils/logger.ts` (referenced at `logger.ts:24` redacts `*.relayerSeed`) | redactions documented; spot-check pass. |
| SPEC-CRASH-001: `unhandledRejection` / `uncaughtException` log + exit 1 | COVERED | `index.ts:69-77` | log.fatal + process.exit(1). |
| SPEC-GRACEFUL-001: SIGTERM / SIGINT close HTTP server, stop schedulers, disconnect Prisma/Redis | COVERED | `index.ts:452-477` | Full shutdown sequence. |

### Production guards (`utils/productionGuards.ts`)

| Env var / setting | Guarded? | Evidence |
|------|----------|----------|
| `NODE_ENV` must equal `"production"` exactly | YES | `:52-57` |
| `ADMIN_SECRET` set + ≥32 chars | YES | `:59-63` |
| `CORS_ALLOWED_ORIGINS` non-empty, no wildcard | YES | `:65-72` |
| `ALLOWED_WS_ORIGINS` non-empty, no wildcard | YES | `:74-82` |
| `RELAYER_SEED` set, not dev seed, not placeholder | YES | `:84-101` |
| `SPOT_CONTRACT_ADDRESS` set | YES | `:103-105` |
| `SPOT_CONTRACT_METADATA_PATH` set | YES | `:107-109` |
| `NATIVE_TOKEN_ADDRESS` set | YES | `:115-120` |
| `REDIS_URL` set, not localhost | YES | `:122-129` |
| `MATCHING_LOCK_*` positive | YES | `:131-141` |
| Reward split sums to 100 (when rewards enabled) | YES | `:145-152` |
| **`BRIDGE_ADMIN_SEED` set + not dev seed** | **NO** | **gap** |
| `FACTORY_CONTRACT_ADDRESS` set | NO | not checked despite being required at runtime |
| `TREASURY_ADDRESS` set (when rewards enabled) | NO | not checked |
| `STAKING_CONTRACT_ADDRESS` set (when rewards enabled) | NO | not checked |
| `SUBQUERY_ENDPOINT` set when `SUBQUERY_ENABLED=true` | NO | not checked |
| Mainnet WS URL (refuse `127.0.0.1` `LUNES_WS_URL` in production) | NO | not checked — `LUNES_WS_URL` falls through to `ws://127.0.0.1:9944` if env is missing |

---

## Production Blockers (CRITICAL → MEDIUM)

### CRITICAL

1. **CRITICAL — `BRIDGE_ADMIN_SEED` `//Alice` fallback** — `spot-api/src/services/assetBridgeService.ts:466`. If the bridge runner is started without `BRIDGE_ADMIN_SEED`, it boots signing as `//Alice` (publicly-known dev key). `productionGuards.ts` doesn't cover it. Reproduction: `BRIDGE_ADMIN_SEED= ts-node src/services/assetBridgeService.ts` (the file has a `require.main === module` entrypoint at line 490). **Fix**: remove the `|| '//Alice'` default; add `BRIDGE_ADMIN_SEED` to `productionGuards.ts` (with dev-seed denylist) and to `assertProductionSecrets` in `index.ts`. If the bridge is launched via a separate process, that launcher must call the same guard.

2. **CRITICAL — Reward payouts settle on `isInBlock`** — `spot-api/src/services/rewardPayoutService.ts:447` (native LUNES) and `:498` (contract calls). Both money-moving paths accept `isInBlock`. A reorg between in-block and finality could let the off-chain DB mark a payout settled while the on-chain transfer is reverted. **Fix**: mirror the `settlementService.ts:528` pattern — drop the `|| isInBlock` short-circuit.

3. **CRITICAL — Rebalancer `updateCurveParameters` settles on `isInBlock`** — `spot-api/src/services/rebalancerService.ts:423`. Same pattern, same risk class (changes AMM curve parameters that govern pricing — indirectly value-moving). **Fix**: same as #2.

### HIGH

4. **HIGH — Cancel signature `buildSpotCancelMessage` is dead but documented format remains** — `src/middleware/auth.ts:104-106`. The cancel route actually uses `verifyWalletActionSignature` with action `orders.cancel` (which DOES embed timestamp + nonce), so the live cancel path is safe (SPEC-AUTH-005 marked COVERED). But the orphan helper `buildSpotCancelMessage` returns `lunex-cancel:${orderId}` with no timestamp; ts-prune flags it as unused. Risk: future code re-introduces use. **Fix**: delete the function and the export.

5. **HIGH — `emergencyService` copy_vault + staking unwired** — `src/services/emergencyService.ts:132-148`. The largest user-fund-holding contract (`copy_vault`) cannot be paused from the admin panel; runbook depends on raw signer access. **Fix**: load `copy_vault` and `staking` ABIs the same way `spot_settlement` is loaded (`:79-115`); wire pause/unpause + paused-status queries.

6. **HIGH — `emergencyService.runSpotPauseTx` accepts `isInBlock`** — `src/services/emergencyService.ts:242`. Lower blast-radius than #2 (pause is not fund-moving) but inconsistent with the finality discipline; in a fast incident the admin UI could report "paused" before the chain finalizes. **Fix**: drop `isInBlock` from the OR.

### MEDIUM

7. **MEDIUM — Production guards missing `FACTORY_CONTRACT_ADDRESS`, `TREASURY_ADDRESS`, `STAKING_CONTRACT_ADDRESS` (rewards), `LUNES_WS_URL` non-localhost check** — `productionGuards.ts`. The service will boot in production with `LUNES_WS_URL` pointing at `ws://127.0.0.1:9944` (config.ts:54 default) and `FACTORY_CONTRACT_ADDRESS` empty. The blockchain code will then fail downstream with cryptic errors instead of refusing to start. **Fix**: extend `collectProductionConfigErrors` with the missing checks.

8. **MEDIUM — Single relayer key (CONCERNS #24)** — `src/services/settlementService.ts:187`. Centralised signer is the entire trust assumption for off-chain settlement until pallet-contracts gains `seal_sr25519_verify`. **Fix**: KMS / HSM / multisig integration is out of code scope but should be tracked. README says HSM is part of pre-mainnet checklist.

9. **MEDIUM — Test count drift** — README claims 323/323 tests across 40 suites (2026-04-28); today shows 194/194 across 23 suites for unit only. Either ~17 suites are e2e-only (likely) or test surface regressed. Need reconciliation; this audit ran unit-only because e2e requires Postgres + Redis up.

10. **MEDIUM — `assetBridgeService` has zero test coverage** — file is 14.7 KB and handles cross-chain wrap/unwrap. No test exists. **Fix**: at minimum, contract-test the env validation and `loadState`/`saveState` round-trip.

### LOW

11. **LOW — `assetBridgeService` uses `console.log/error`** — `:84, 100, 116, 477, 494, 499`. The rest of the service-layer code uses pino (`utils/logger.ts`). Inconsistent log shipping; structured fields lost. **Fix**: swap to `log.info/error`.

12. **LOW — `socialIndexerService` not deep-read in this audit** — CONCERNS #54 flagged 20+ `as any` casts and unreviewed polling backoff. Out of scope for this run; flag for next audit.

13. **LOW — ts-prune flags `buildSpotCancelMessage` as unused** — `src/middleware/auth.ts:104`. Already discussed in #4.

---

## New Tests to Write

| Missing test | Verifies spec | Suggested file |
|------|------|------|
| `assetBridgeService env guard test` | SPEC-BRIDGE-001/002 | `__tests__/assetBridgeService.envGuard.test.ts` (new) |
| `rewardPayoutService.transferNative finality test` | SPEC-REWARD-001 | extend `__tests__/rewardPayoutService.test.ts` (or create) — mock `signAndSend` to emit `isInBlock` then `isFinalized` and assert the txHash resolves only on `isFinalized` |
| `rewardPayoutService.signAndSendContract finality test` | SPEC-REWARD-002 | same file |
| `rebalancerService.updateCurveParameters finality test` | SPEC-REBAL-001 | extend `__tests__/rebalancerService.test.ts` |
| `emergencyService.runSpotPauseTx finality test` | SPEC-EMERG-003 | new |
| `productionGuards.BRIDGE_ADMIN_SEED test` | SPEC-BRIDGE-001 | extend `__tests__/productionGuards.test.ts` once guard is added |
| `productionGuards.factory/treasury/staking/wsUrl coverage` | gap 7 | extend same file |
| `requireAdminOrInternal XFF spoof test` | SPEC-AUTH-007 | new |
| `/health 503 on Redis down` | SPEC-HEALTH-001 | new — mock redis throw, assert 503 |
| `/metrics admin gating test` | SPEC-METRICS-001 | new |
| `listing logo magic-byte test` | SPEC-LISTING-003 | new — write garbage with `.png` ext, expect 400 |
| `securityShield path-traversal blocks` | SPEC-SHIELD-001 | new |
| `cancel-rate-limit Redis sliding window test` | SPEC-ORDERS-005 | new |

---

## Summary

- **Documented blockers (CRITICAL #1–#3) all confirmed at the exact line numbers** in CONCERNS.md (no drift). `assetBridgeService.ts:466`, `rewardPayoutService.ts:447`, `rewardPayoutService.ts:498`, `rebalancerService.ts:423` — all present today, all unfixed.
- **PRODUCTION-READINESS.md claim "settlement + copyVault migrated to isFinalized" is accurate** — verified at `settlementService.ts:528` and `copyVaultService.ts:162`. Migration was partial.
- **Auth surface is broadly correct.** 4 auth flows (sr25519, admin Bearer, agent API key, leader key) wired with timing-safe comparisons, Redis-backed nonce store with prod-strict failure, sorted-field canonical message format, XFF-spoof defense on `/metrics`. SPEC-AUTH-005 (cancel timestamp) is a dead-code finding, not an active vuln.
- **Production guards cover RELAYER_SEED but not BRIDGE_ADMIN_SEED, FACTORY_CONTRACT_ADDRESS, TREASURY_ADDRESS (when rewards on), STAKING_CONTRACT_ADDRESS (when rewards on), or `LUNES_WS_URL` non-localhost.** Recommend extending `collectProductionConfigErrors` before mainnet.
- **194/194 unit tests + tsc clean + lint clean.** Solid green. Tests cover the auth/signature/nonce/locking primitives. Gaps are concentrated in finality discipline tests, env-guard tests, and `assetBridgeService` (zero coverage).

---

*Audit produced 2026-05-21 against commit-state of `/Users/lucas/Documents/Projetos_DEV/Lunex` on this date.*
