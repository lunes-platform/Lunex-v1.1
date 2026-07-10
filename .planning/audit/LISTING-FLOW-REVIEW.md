# Lunex Token Listing Flow Review

**Date:** 2026-06-04  
**Verdict:** NO-GO for public token listing with real funds  
**Scope:** DEX `/listing`, `spot-api /api/v1/listing`, admin pending-listing flow, listing relayer, `ListingManager`, `LiquidityLock`, Prisma listing models, docs/tests.

## Flow Observed

1. DEX user fills `/listing`, signs `listing.create`, uploads logo, and POSTs `multipart/form-data` to `spot-api`.
2. `spot-api` verifies wallet signature and creates a `TokenListing` + `LiquidityLock` row in `PENDING` / `LOCKED` state.
3. The API response says pending on-chain confirmation, but the DEX success screen tells the user the token is listed and liquidity is locked.
4. Admin pending-listing UI can call `/api/v1/listing/:id/activate` with only admin bearer auth.
5. `activateListing()` sets `status=ACTIVE`, registers token metadata, and does not require on-chain proof fields.
6. `ListingManager.list_token()` exists on-chain, but the current API/frontend path does not execute it.
7. `listing-relayer.ts` is not wired into prod compose and its activation call lacks admin authorization.

## Critical Findings

### LST-01 — ACTIVE listing can be created without on-chain proof

**Severity:** P0  
**Evidence:** `spot-api/src/services/listingService.ts:192-205`, `spot-api/src/routes/listing.ts:314-336`, `lunex-admin/src/app/(admin)/listings/pending/actions.ts:13-19`

`activateListing()` accepts an empty payload and still sets `status: ACTIVE` and `verifiedAt`. The admin UI sends no `onChainListingId`, `pairAddress`, `lpTokenAddress`, `lpAmount`, or `txHash`. This means a token can be activated and registered in `TokenRegistry` without proving fee collection, pool creation, LP minting, or LP lock on-chain.

**Impact:** fake/unsafe listings can become tradable metadata; users may trust a token that did not actually lock liquidity.

**Required fix:** `activateListing()` must fail closed unless it can verify a finalized on-chain `TokenListed`/`LiquidityLocked` event for the token owner/listing and expected tier/liquidity. Manual admin activation must be disabled or require a finalized proof object validated against chain.

### LST-02 — Listing creation records a locked liquidity row before liquidity is locked

**Severity:** P0  
**Evidence:** `spot-api/src/services/listingService.ts:132-164`

`createListing()` writes `LiquidityLock.status = LOCKED` with placeholder `pairAddress`, `lpTokenAddress`, and `lpAmount = 0`. No contract call or finalized event has happened at this point.

**Impact:** backend stats and user/admin views can report locked liquidity that does not exist. This undermines anti-rug claims.

**Required fix:** introduce explicit states such as `PENDING_PAYMENT`, `PENDING_ONCHAIN`, `LOCK_PENDING`, `LOCKED`, `FAILED`, `ACTIVE`. Do not create a `LOCKED` row until a finalized lock event is verified.

### LST-03 — Frontend claims fee deduction, pool creation, lock, and visibility after only an off-chain POST

**Severity:** P0  
**Evidence:** `lunes-dex-main/src/pages/listing/index.tsx:1288-1311`, success screen after `setIsSuccess(true)` at `:864-865`

The review step says “Listing fee deducted”, “Pool created automatically”, “Liquidity deposited”, “LP tokens locked”, and “Token visible on DEX”. The API only returns `Listing created — pending on-chain confirmation`.

**Impact:** user-facing financial/compliance misrepresentation. It can imply custody or lock protection before it exists.

**Required fix:** change UI copy/states to “application submitted”. Show on-chain action requirements separately: approve fee, create/add liquidity, submit/list token, wait finalization, then activation.

### LST-04 — Public DEX flow never executes the on-chain listing contract

**Severity:** P0  
**Evidence:** `lunes-dex-main/src/pages/listing/index.tsx:825-865`, `Lunex/contracts/listing_manager/src/lib.rs:315-438`

The DEX only signs an off-chain auth message and POSTs FormData. It never calls PSP22 approvals, Router/factory pool creation, LP transfer, or `ListingManager.list_token()`.

**Impact:** the “liquidity-locked listing” product is not implemented end-to-end.

**Required fix:** either implement the full on-chain wizard or explicitly classify this as an application/review flow. For public launch, ACTIVE state must be driven by finalized chain events only.

### LST-05 — Listing relayer cannot activate production listings as written

**Severity:** P0  
**Evidence:** `scripts/listing-relayer.ts:68-78`, `spot-api/src/routes/listing.ts:316-319`

The relayer calls `/api/v1/listing/:id/activate` without `Authorization: Bearer <ADMIN_SECRET>`, but the route requires `requireAdmin`. It also does not send pair/LP/tx proof data.

**Impact:** event-driven activation is non-functional, so teams may use manual admin activation, which is unsafe per LST-01.

**Required fix:** make relayer a production service with explicit admin/relayer auth, finalized block tracking, event decoding via ABI, idempotent activation, and proof payload validation.

### LST-06 — Withdraw marks DB lock withdrawn without proving on-chain LP transfer

**Severity:** P0  
**Evidence:** `spot-api/src/routes/listing.ts:358-390`, `spot-api/src/services/listingService.ts:331-351`

The withdraw endpoint verifies a wallet signature and time/owner state, then marks DB row `WITHDRAWN`. It does not call `LiquidityLock.withdraw()` or verify a finalized `LiquidityUnlocked` event. It accepts optional `txHash`.

**Impact:** DB can diverge from custody. UI/API may mark LP tokens withdrawn when chain transfer failed or never happened.

**Required fix:** make withdraw DB update event-driven from finalized `LiquidityUnlocked`, or require a verified finalized tx/event before changing DB status.

## High Findings

### LST-07 — Admin pending listing UI hides critical fields

**Severity:** P1  
**Evidence:** `lunex-admin/src/app/(admin)/listings/pending/page.tsx:77-107`

The API returns `ownerAddress`, `lunesLiquidity`, and `tokenLiquidity`, but admin UI reads `requesterAddress` and `lockedAmount`. Reviewers see `—` for requester/locked amount.

**Impact:** admins cannot make an informed approval/rejection decision.

**Required fix:** display owner, token address, lunes/token liquidity, logo, tier, website, tx/on-chain status, and validation result.

### LST-08 — Frontend allows SVG logo while backend rejects it

**Severity:** P1  
**Evidence:** frontend accepts `image/svg+xml` at `lunes-dex-main/src/pages/listing/index.tsx:789-806`; backend allows only PNG/WebP at `spot-api/src/routes/listing.ts:31-67`

**Impact:** user gets a late failure after progressing through the flow. SVG is correctly rejected server-side for safety, but UI copy is wrong.

**Required fix:** remove SVG from frontend accepted types/copy.

### LST-09 — Token metadata and numeric validation are weak

**Severity:** P1  
**Evidence:** `spot-api/src/routes/listing.ts:108-119`, `spot-api/src/services/listingService.ts:115-121`

`tokenAddress` only has length bounds, `tokenDecimals` is optional without min/max, and liquidity uses `parseFloat`. There is no PSP22 metadata verification, decimal precision handling, token symbol/name match, duplicate symbol policy, honeypot/checklist evidence, or Decimal/BN parsing.

**Impact:** malformed or misleading listings can enter review; numeric precision can drift for large amounts.

**Required fix:** validate SS58/account format, decimals range, PSP22 metadata, symbol/name consistency, Decimal/BN arithmetic, and token risk flags.

### LST-10 — Public docs describe a different listing model

**Severity:** P1  
**Evidence:** `docs/LISTING_POLICY.md` describes Staking admin/governance listing; `docs/API.md` still documents `lpTokenAddress/lpAmount` create body, while current route ignores those fields.

**Impact:** integrators and users cannot know the real launch flow.

**Required fix:** choose one canonical listing model and align docs, UI, API, SDK/admin/scripts.

## Test Gaps

- No `listingService` unit tests for state transitions, duplicate token, liquidity minimums with Decimal safety, activation proof requirements, lock withdrawal proof.
- No `listing` route e2e tests for signed create, owner signed read headers, upload magic bytes, SVG rejection, unauthorized activation/rejection, activation proof validation.
- No contract e2e proving `ListingManager.list_token()` fee transfer/distribution and `LiquidityLock.withdraw()` PSP22 transfer.
- No admin tests proving pending listing UI displays actual owner/liquidity and cannot approve without proof.
- No relayer tests for event decoding, auth, finality, idempotency, and reorg/dedup behavior.

## GSD Task Map

### P0

1. Replace current ACTIVE transition with finalized-event activation only.
2. Split DB states: application submitted, on-chain pending, lock verified, active, rejected, failed.
3. Correct DEX success/review copy to pending/application semantics until chain proof exists.
4. Wire or remove `listing-relayer`; if kept, add auth, finality, ABI decoding, idempotency, and production service config.
5. Make lock withdraw event-driven from finalized `LiquidityUnlocked`.

### P1

1. Fix admin pending-listing table fields and require proof details before approval.
2. Remove SVG from frontend listing logo accept list and copy.
3. Add strict token/account/decimal/metadata validation.
4. Consolidate docs around the canonical listing model.
5. Add unit/e2e/contract tests listed above.

## Implementation Update — 2026-06-04

### Closed or Mitigated

1. **LST-01 mitigated in API/relayer:** `spot-api` activation now fails closed unless the caller supplies `onChainListingId`, `onChainLockId`, `pairAddress`, `lpTokenAddress`, `lpAmount`, and `txHash`, and the API verifies finalized `TOKEN_LISTED` + `LIQUIDITY_LOCKED` events through SubQuery before setting `ACTIVE`. The admin pending-listing screen no longer exposes a direct manual approve button; it displays `Proof required` instead. Remaining gap: production must deploy the updated SubQuery schema/mapping and run lifecycle e2e before launch.
2. **LST-02 fixed for new applications:** `createListing()` no longer creates a fake `LiquidityLock` row with placeholder pair/LP values and `LOCKED` status. A lock row is created or updated only during proof-backed activation.
3. **LST-03 mitigated:** DEX listing copy now presents the flow as an application submitted for proof/review. It no longer claims that the listing fee was deducted, a pool was created, LP tokens were locked, or the token is visible immediately after the off-chain POST.
4. **LST-06 mitigated in API/relayer:** withdraw now requires a finalized on-chain withdraw `txHash`, and the API verifies a finalized `LIQUIDITY_UNLOCKED` event through SubQuery before changing DB status. A relayer/admin route finalizes withdraw by `onChainLockId`.
5. **LST-07 fixed for the current API response:** admin pending listing now reads `ownerAddress`, `lunesLiquidity`, and `tokenLiquidity`, and blocks direct approval without proof.
6. **LST-08 fixed:** DEX logo upload now accepts PNG/WebP only, matching backend validation.
7. **Test baseline added:** `spot-api/src/__tests__/listingService.test.ts` covers pending application creation without fake locks, proof-required activation, and proof-backed lock creation.

### Still Blocking Production

1. Execute the updated SubQuery deployment/backfill procedure in production and archive evidence.
2. Implement the canonical on-chain listing wizard in DEX or explicitly keep public DEX listing as an application-only flow until an external/on-chain process emits verified events.
3. Add contract e2e tests proving `ListingManager.list_token()` fee distribution, pool/liquidity assumptions, LP custody, and withdraw behavior.
4. Add route/admin/browser e2e coverage for signed create, logo validation, unauthorized activation, SubQuery proof validation, relayer activation, and no direct admin approval.
5. Decide whether `LiquidityLocked` should emit `lpTokenAddress`; the current verifier can only prove pair address, lock id, owner, tier, and LP amount because the contract event does not expose a separate LP token address.

### Relayer Ops Update — 2026-06-04

- `listing-relayer` now persists a finalized-block cursor to `LISTING_RELAYER_STATE_FILE`.
- Startup replays `LISTING_RELAYER_START_BLOCK` when set, otherwise a bounded `LISTING_RELAYER_REPLAY_BLOCKS` finalized window.
- Live processing fills gaps from `lastFinalizedBlock + 1` to the current finalized head.
- Cursor is saved only after per-block API activation/withdraw tasks settle successfully.
- Production compose now includes a `listing-relayer` service and `listingrelayerdata` volume.
- Production SubQuery compose now uses `--unfinalized-blocks=false` so API proof checks are backed by finalized indexed events.

### Relayer / Indexer Observability Update — 2026-06-05

- `listing-relayer` now exposes Prometheus metrics on `LISTING_RELAYER_METRICS_PORT`.
- Prometheus scrapes the relayer directly through `job="listing_relayer"`.
- Prometheus blackbox probes internal SubQuery node/query and relayer metrics endpoints through `job="internal_http_probe"`.
- Added alerts:
  - `ListingRelayerDown`
  - `ListingRelayerCursorStale`
  - `ListingRelayerBlockFailures`
  - `ListingRelayerActivationFailures`
  - `ListingRelayerWithdrawFailures`
  - `SubQueryNodeDown`
  - `SubQueryQueryDown`
- Added `docs/runbooks/listing-relayer.md` and updated `docs/runbooks/indexer-lag.md`.

### Grafana Dashboard Update — 2026-06-05

- Added `docker/grafana/provisioning/dashboards/listing-relayer-indexer.json`.
- Dashboard covers:
  - relayer up/down;
  - finalized cursor age;
  - last finalized block processed;
  - SubQuery node/query availability;
  - relayer processed/failed block rates;
  - activation/withdraw proof API success/failure rates.
- `scripts/check-ops-docs.cjs` now accepts YAML runbook annotations with single quotes, double quotes, or no quotes.

### SubQuery Backfill Gate Update — 2026-06-05

- Added `docs/runbooks/subquery-backfill.md`.
- Added `scripts/check-subquery-listing-deploy.cjs`.
- Added `npm run subquery:listing:deploy-check`.
- The gate verifies:
  - `ListingEvent.listingId` and `ListingEvent.lockId` are indexed;
  - listing mappings persist `listing_id` and `lock_id`;
  - generated SubQuery types include lookup helpers;
  - listing handlers are present in `project.template.yaml`;
  - production compose uses finalized-only SubQuery indexing;
  - API SubQuery config and listing-relayer service are present;
  - env examples expose `LUNES_START_BLOCK` and `LISTING_RELAYER_START_BLOCK`;
  - the backfill runbook includes rollback instructions.
