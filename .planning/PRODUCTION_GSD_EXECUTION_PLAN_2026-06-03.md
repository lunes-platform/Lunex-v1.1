# Lunex Production GSD Execution Plan

**Date:** 2026-06-03
**Milestone:** Mainnet production readiness
**Verdict:** NO-GO for public mainnet with real funds
**Operating rule:** Certification/reporting can happen after launch, but fund safety, operational controls, disclosure, legal posture, and reproducible release evidence must be ready before public production.

## GSD Focus

Get the system to an audit-ready, production-operable state by closing blockers in dependency order:

1. Stop unsafe fund-moving behavior.
2. Remove dev secrets and production fallbacks.
3. Make contracts testable, verifiable, and ABI-honest.
4. Make frontend signing explicit and non-leaky.
5. Align SDK/API/docs/MCP with the real backend.
6. Make deploy, backups, alerts, and runbooks reliable.
7. Run a full dress rehearsal before mainnet.

## Problem Register

| ID | Severity | Area | Problem | Evidence | Production impact |
|---|---:|---|---|---|---|
| P-001 | P0 | Contracts | `SpotSettlement` does not verify sr25519 signatures on-chain; it only rejects zero signatures. | `Lunex/contracts/spot_settlement/lib.rs:1138` | Settlement trusts relayer; not acceptable for mainnet funds. |
| P-002 | P0 | Contracts | `CopyVault` calls `Router::swap`, but `swap` is not a public ink! message in router ABI. | `copy_vault/lib.rs:840`, `router/lib.rs:118`, `router/lib.rs:837` | Copy-trading swap path can fail in production even if unit tests pass. |
| P-003 | P0 | Contracts | Router hot path has 8 ignored tests; multiple contracts hide production calls behind `#[cfg(not(test))]`. | `router/lib.rs:1710-2145`, `copy_vault`, `liquidity_lock`, `staking` | Tests do not exercise production binary behavior. |
| P-004 | P0 | API/Funds | Fund-moving services resolve success on `isInBlock`. | `rewardPayoutService.ts:447,498`, `rebalancerService.ts:423`, `emergencyService.ts:242` | Reorg can mark a transaction as successful before finality. |
| P-005 | P0 | Secrets | Bridge admin seed falls back to `//Alice`; production guards do not cover it. | `assetBridgeService.ts:466`, `productionGuards.ts` | Production can boot with a public dev key. |
| P-006 | P0 | Frontend/Web3 | Signed reads still run automatically in `useEffect` outside Spot. | `copytrade/Page.tsx`, `MarginTab.tsx`, `BotRegistry/index.tsx` | Tab changes/remounts can prompt signatures without user intent. |
| P-007 | P0 | Frontend/API | Signed reads send `nonce`, `timestamp`, and `signature` in query string. | `spotService.ts`, `marginService.ts`, `agentService.ts` | Signatures leak into logs, history, proxies, and monitoring. |
| P-008 | P0 | Frontend/Deploy | Frontend build can bake empty API URL and fall back to `localhost`. | docker compose frontend build args, `spotService.ts:5` | User browser calls the user's local machine instead of production API. |
| P-009 | P0 | Frontend/Compliance | UI displays fake financial values/fallback prices. | `ConnectWallet.tsx`, `OrderForm/index.tsx`, token mocks | Trading UI can misrepresent balances/prices. |
| P-010 | P0 | SDK/API | SDK and docs call legacy routes that do not match `/api/v1/*`. | `sdk/src/modules/*`, `spot-api/src/index.ts:293` | External integrations cannot rely on published contract. |
| P-011 | P0 | Docs/Compliance | No root `SECURITY.md`, no filled threat model, no disclosure process. | repository tree | Cannot operate a public financial product responsibly. |
| P-012 | P0 | Ops | Runbooks do not exist; alert annotations point to `your-org` placeholders. | `docker/alert-rules.yml` | On-call cannot reliably respond to incidents. |
| P-013 | P0 | Backup | Backup restore/PITR is not proven; backup alert references missing metric. | `docker/backup.sh`, `alert-rules.yml`, `metrics.ts` | Data recovery is unverified. |
| P-014 | P1 | Infra/CI | Trivy reports but does not block; images/tags and migrations are not deterministic. | `.github/workflows/deploy.yml`, `Dockerfile.api`, compose files | Vulnerable/non-reproducible release can ship. |
| P-015 | P1 | Admin | Admin env names and auth model are inconsistent; session TTL not explicit. | `lunex-admin/.env*`, admin actions, `auth.ts` | Emergency/admin operations may fail or remain over-privileged. |
| P-016 | P1 | Integration | MCP local default points to wrong API port. | `mcp/lunex-agent-mcp/src/index.ts:122` | Local agent tooling does not work by default. |
| P-017 | P1 | Integration | Dev SubQuery node/query DB names do not line up. | `docker-compose.dev.yml` | Clean local/bootstrap flow breaks. |
| P-018 | P1 | Observability | Prometheus does not scrape SubQuery/indexer lag; dashboards and alerts are incomplete. | `docker/prometheus.yml`, `docker/alert-rules.yml` | Indexer failure can go undetected. |
| P-019 | P1 | Testing | No browser E2E for DEX/admin critical flows. | package scripts, no Playwright config | Wallet, order, admin, and listing flows are not regression-tested. |
| P-020 | P1 | Release | ink!, Rust, cargo-contract, and docs versioning are inconsistent; no verifiable build pipeline. | contract manifests, docs, root scripts | Contract artifacts are hard to reproduce or verify. |

## Task Map

### Track A — Fund Safety First

| Task | Priority | Owner area | Depends on | Implementation |
|---|---:|---|---|---|
| A1 | P0 | spot-api | none | Replace all fund-moving `isInBlock || isFinalized` branches with `isFinalized` only. Add tests that emit only `isInBlock` and assert unresolved/failure behavior. |
| A2 | P0 | spot-api | A1 | Add CI grep/lint gate forbidding `isInBlock` in fund-moving services outside test fixtures. |
| A3 | P0 | contracts/API | none | **Done 2026-06-03:** recorded CRYPTO-02 in `.planning/decisions.md`: public mainnet requires on-chain sr25519 verification with a shared canonical payload, or an on-chain order-commitment fallback. Relayer-only/off-chain verification is limited to testnet/closed beta. |
| A4 | P0 | contracts | A3 | Implement the selected CRYPTO-02 path: either replace `verify_order_signature()` with real on-chain verification after payload migration, or add on-chain order commitments and reject unknown hashes/nonces. Add positive/tampered/replay tests. |
| A5 | P0 | contracts | none | Fix `CopyVault` -> `Router` cross-contract ABI mismatch; expose proper ink! message or adjust integration contract. |

### Track B — Secrets And Production Guards

| Task | Priority | Owner area | Depends on | Implementation |
|---|---:|---|---|---|
| B1 | P0 | spot-api | none | Remove `BRIDGE_ADMIN_SEED || '//Alice'`; require explicit seed/config and fail boot if missing. |
| B2 | P0 | spot-api | B1 | Expand `productionGuards` to validate `BRIDGE_ADMIN_SEED`, `FACTORY_CONTRACT_ADDRESS`, `TREASURY_ADDRESS`, `STAKING_CONTRACT_ADDRESS`, `LUNES_WS_URL`, faucet mode, and all dev seed patterns. |
| B3 | P0 | faucet/infra | B2 | Decide faucet launch posture: testnet-only or mainnet with treasury funding, captcha, persisted state, and abuse limits. |
| B4 | P1 | CI/security | B2 | Add gitleaks patterns for dev seeds/mnemonics and fail CI on findings. |

### Track C — Contract Honesty And Verifiable Release

| Task | Priority | Owner area | Depends on | Implementation |
|---|---:|---|---|---|
| C1 | P0 | contracts | none | Unignore 8 router tests and make swap/liquidity math pass in CI. |
| C2 | P0 | contracts | none | Replace `#[cfg(not(test))]` coverage gaps with mockable clients or ink! E2E tests. |
| C3 | P0 | contracts | A5 | Add `ink_e2e` flows for router, copy_vault, staking, liquidity_lock, spot_settlement. |
| C4 | P1 | contracts | C1 | Implement real `copy_vault` fuzz target and run nightly for at least 600 seconds. |
| C5 | P0 | release | C1-C3 | Pin one ink! v4 version, Rust toolchain, and cargo-contract version. Add `cargo contract build --verifiable` release gate and archive metadata/wasm/hash. |
| C6 | P0 | scripts | C5 | Fix `scripts/verify-deployment.ts` so it loads real artifacts and checks real ABI methods only. |

### Track D — Frontend/Web3 Trust

| Task | Priority | Owner area | Depends on | Implementation |
|---|---:|---|---|---|
| D1 | P0 | DEX UI | none | Remove all automatic wallet signing in `useEffect`, route change, tab change, connect, and remount paths. Signed reads must require explicit click or prior session token. |
| D2 | P0 | DEX UI/API | D1 | Move signed reads out of query string into `POST` body or signed headers; scrub server/access logs. |
| D3 | P0 | DEX UI | none | Fail production build if API/WS envs are empty, `localhost`, `127.0.0.1`, or wrong origin. |
| D4 | P0 | DEX UI | none | Remove fake financial values and render unavailable state when real balance/price is unavailable. |
| D5 | P1 | DEX UI | D1-D4 | Add Playwright wallet-mock tests: navigate `/spot`, margin tab, copytrade, social bots; assert zero `signRaw` until explicit action. |
| D6 | P1 | DEX UI/infra | D3 | Align CSP `connect-src`, fonts, and scripts with actual production assets; remove `unsafe-eval` and reduce `unsafe-inline`. |

### Track E — API, SDK, MCP, Docs Contract

| Task | Priority | Owner area | Depends on | Implementation |
|---|---:|---|---|---|
| E1 | P0 | spot-api/docs | none | Declare one canonical OpenAPI generated from real `/api/v1/*` routes. Archive or rewrite stale specs. |
| E2 | P0 | SDK | E1 | Update SDK modules to call real endpoints; add route checker that fails on unknown route. |
| E3 | P0 | SDK | E2 | Add SDK happy/error tests for every public method and wire into `prepublishOnly`. |
| E4 | P1 | MCP | E1 | Align MCP default API URL with local canonical port `4000` or require explicit env with clear failure. |
| E5 | P1 | docs | E1-E4 | Reconcile `README`, `AGENTS.md`, `llms.txt`, SDK README, MCP README, API docs, and production readiness claims. |

### Track F — Ops, Infra, Observability

| Task | Priority | Owner area | Depends on | Implementation |
|---|---:|---|---|---|
| F1 | P0 | ops/docs | none | Create `docs/runbooks/` for API down, chain down, DB restore, Redis failure, indexer lag, deploy rollback, settlement backlog, bridge/admin key rotation, emergency pause. |
| F2 | P0 | ops/security | none | Add root `SECURITY.md` with disclosure email, scope, SLA, safe harbor, severity policy, and supported versions. |
| F3 | P0 | security/docs | F2 | Fill `docs/THREAT_MODEL.md` across frontend, API, relayer, contracts, admin, faucet, MCP, SubQuery. |
| F4 | P0 | ops/data | none | Implement restore drill: restore latest backup into scratch Postgres, verify integrity and row counts, document RTO/RPO. |
| F5 | P0 | observability | F4 | Implement `lunex_last_backup_age_seconds` metric and make backup alert fire in staging. |
| F6 | P1 | observability | none | Add SubQuery/indexer lag scrape, alert, dashboard, and runbook link. |
| F7 | P1 | infra | none | Add missing healthchecks/resource limits and make deploy wait for healthy services. |
| F8 | P1 | CI/release | none | Replace `npm install` with `npm ci`, upgrade deploy Node to 20, set Trivy `exit-code: '1'`, remove duplicate Prisma migrate. |
| F9 | P1 | admin | none | Reconcile admin env names, set session/JWT TTL, require reauth for emergency actions, and add admin E2E smoke. |

### Track G — Compliance And Launch Control

| Task | Priority | Owner area | Depends on | Implementation |
|---|---:|---|---|---|
| G1 | P0 | product/legal | none | Define launch classification: testnet, beta closed, public mainnet, or public mainnet with restricted features. |
| G2 | P0 | legal/compliance | G1 | Record KYC/AML/sanctions posture, terms, privacy/LGPD posture, jurisdictional restrictions, and user-facing risk disclosures. |
| G3 | P0 | product/security | A-F P0 | Produce audit handoff pack: architecture, threat model, runbooks, OpenAPI, contract artifacts, release hashes, known risks. |
| G4 | P0 | release | A-F P0 | Run mainnet dress rehearsal on testnet-equivalent environment: swap, settlement, copy-vault, listing, reward payout, bridge, emergency pause, backup restore, chaos drill. |
| G5 | P1 | certification | post-launch or pre-mainnet per business choice | External certification/report cycle, remediation tracking, and public disclosure package. |

## Implementation Order

### Sprint 0 — Freeze And Guardrails

Goal: stop adding risk while fixes land.

- Freeze public launch claims until NO-GO items close.
- Add CI grep gates for `isInBlock` fund paths, `//Alice` production paths, and frontend production `localhost` fallbacks.
- Create `SECURITY.md` and initial runbook skeletons so alerts no longer point to missing files.

### Sprint 1 — Fund Safety

Goal: no unsafe fund-moving behavior remains.

- A1, A2, B1, B2.
- Start A3 decision immediately because it may depend on Lunes chain capability.
- Acceptance: fund paths wait for finality, production boot fails on unsafe secrets, tests fail on regression.

### Sprint 2 — Frontend Signing And API Contract

Goal: user signatures become intentional and the public API becomes truthful.

- D1, D2, D3, D4.
- E1, E2.
- Acceptance: browser E2E proves no signature prompt on navigation; SDK route checker passes against real backend.

### Sprint 3 — Contract E2E And Release Artifacts

Goal: contracts can be built, tested, verified, and audited.

- A4, A5, C1, C2, C3, C5, C6.
- Acceptance: no ignored router hot-path tests, ink! E2E suite exists, verifiable build artifacts are archived.

### Sprint 4 — Operations

Goal: production can be operated under incident conditions.

- F1-F8, F9.
- Acceptance: restore drill passes, alerts link to real runbooks, SubQuery lag is monitored, deploy is deterministic.

### Sprint 5 — Dress Rehearsal And Audit Pack

Goal: prove readiness before public mainnet.

- G1-G4.
- Acceptance: clean clone/bootstrap works, testnet rehearsal passes, chaos/restore drills pass, audit handoff pack is complete.

## Definition Of Done

Mainnet can be reconsidered only when all are true:

- Zero P0 tasks open.
- No fund-moving code resolves on `isInBlock`.
- No production boot path can use `//Alice`, placeholders, localhost, or empty critical envs.
- `SpotSettlement` signature strategy is implemented and documented with explicit risk status.
- Contract hot paths have unit + ink! E2E coverage.
- Frontend has zero automatic signing on navigation/remount and no signatures in query string.
- SDK/OpenAPI/docs all match the real `/api/v1/*` backend.
- Runbooks, disclosure, threat model, backup restore, and alerting are real and tested.
- Production release artifacts are reproducible/verifiable.
- Dress rehearsal passes on the exact launch candidate SHA.

## Immediate Next Tasks

Start with these concrete implementation PRs:

1. `spot-api`: finality-only transaction helper plus tests for reward payout, rebalancer, and emergency service.
2. `spot-api`: production guard expansion and removal of `BRIDGE_ADMIN_SEED || '//Alice'`.
3. `lunes-dex-main`: remove automatic signing from copytrade, margin, and bot registry.
4. `lunes-dex-main` + `spot-api`: move signed reads from query string to `POST`/headers.
5. `docker` + frontend services: fail production build on missing/localhost API URLs.
6. `contracts`: fix `CopyVault`/`Router` ABI mismatch and unignore router hot-path tests.
7. `docs`: add `SECURITY.md`, threat model, and runbook skeletons.
8. `sdk/docs`: generate canonical OpenAPI and align SDK routes.

## Execution Log

### 2026-06-03 — Sprint 1 Initial Implementation

- Completed first implementation pass for `A1`: reward payout, rebalancer, and emergency spot pause/unpause now resolve only after finalized transaction status.
- Completed first implementation pass for `A2`: added `fundFinalityRegression.test.ts` to prevent `isInBlock` success paths from returning in those services.
- Completed first implementation pass for `B1`: removed `BRIDGE_ADMIN_SEED || '//Alice'`; bridge startup now requires explicit `BRIDGE_ADMIN_SEED`.
- Completed first implementation pass for `B2`: expanded production guards for `LUNES_WS_URL`, `FACTORY_CONTRACT_ADDRESS`, `BRIDGE_ADMIN_SEED`, `TREASURY_ADDRESS`, and `STAKING_CONTRACT_ADDRESS`.
- Added `waitForFinalizedTx` helper with unsubscribe cleanup on success, dispatch error, and timeout.
- Added focused tests for finality helper, production guards, bridge startup guards, and fund finality regression.
- Verification passed:
  - `npm test -- --runTestsByPath src/__tests__/productionGuards.test.ts src/__tests__/finalizedTx.test.ts src/__tests__/fundFinalityRegression.test.ts src/__tests__/assetBridgeService.test.ts`
  - `npm run build`
  - `npm run lint`
- Remaining Sprint 1 work: add CI grep gate wiring, update env examples/deploy manifests for new required bridge/reward fields, and decide the `SpotSettlement` signature strategy (`A3`).

### 2026-06-03 — Sprint 1 Continuation

- Completed `A2` CI wiring: `spot-api` now exposes `npm run prod:guard`, included in `npm run quality` and the main CI validate job via `npm run prod:guard --if-present`.
- Updated production/testnet/Doppler env wiring for required production guard variables: `BRIDGE_ADMIN_SEED`, `FACTORY_CONTRACT_ADDRESS`, `NATIVE_TOKEN_ADDRESS`, rewards config, and bridge/reward examples.
- Completed `A3`: recorded CRYPTO-02 decision in `.planning/decisions.md`.
- Important decision outcome: public mainnet remains blocked by `SpotSettlement` authorization until on-chain sr25519 verification plus canonical payload migration ships, or an on-chain order-commitment fallback ships. Relayer-only/off-chain verification is not accepted for public mainnet.
- Completed first A3 follow-up: cancel-order signing now uses `lunex-auth:orders.cancel` with address, order id, nonce, and timestamp across `spot-api`, `lunes-dex-main`, `sdk`, MCP, and docs. Removed obsolete `lunex-cancel:{orderId}` helper.
- Completed synthetic settlement gate: `tradeApi` and `routerService` now reject generated `agent:` / `manual:` order flows before on-chain settlement can be used.
- Normalized MCP-generated order nonces to numeric strings so prepared signatures do not create non-`u64` nonce payloads.
- Added `prod:guard` checks for finality regressions, bridge seed/RPC fallbacks, production guard coverage, and synthetic settlement gating.
- Verification passed:
  - `spot-api`: `npm run prod:guard`
  - `spot-api`: `npm test -- --runTestsByPath src/__tests__/productionGuards.test.ts src/__tests__/finalizedTx.test.ts src/__tests__/fundFinalityRegression.test.ts src/__tests__/assetBridgeService.test.ts`
  - `spot-api`: `npm run build`
  - `spot-api`: `npm run lint`
  - `sdk`: `npm run build`
  - `mcp/lunex-agent-mcp`: `npx tsc -p tsconfig.json`
  - `lunes-dex-main`: `npm run build`
  - `lunes-dex-main`: `npm run quality`
- Remaining implementation follow-ups from A3:
  - Align create-order canonical payload across contracts, API, frontend, SDK, MCP, and docs.
  - Implement selected contract-side CRYPTO-02 path: on-chain sr25519 verification or order-commitment fallback.
  - Remove signed read payloads from query strings and move them to POST bodies or headers.

### 2026-06-03 — P0 Signed Read Header Migration

- Partially completed `D2`: moved core signed reads from query-string auth to `X-Lunex-Nonce`, `X-Lunex-Timestamp`, and `X-Lunex-Signature` headers.
- Backend compatibility added via `getSignedAuthInput()`: signed reads now prefer headers and temporarily fall back to legacy query/body values.
- Migrated clients:
  - `lunes-dex-main`: Spot user orders, user trades, favorites list; margin overview; agent-by-wallet lookup.
  - `sdk`: Spot `getUserOrders()` and `getUserTrades()`.
  - MCP: Spot `get_user_orders` and `get_user_trade_history`.
- Added backend unit coverage for header extraction and header-over-query precedence.
- Verification passed:
  - `spot-api`: `npm test -- --runTestsByPath src/__tests__/auth/verifyWalletActionSignature.test.ts`
  - `spot-api`: `npm run build`
  - `spot-api`: `npm run quality`
  - `lunes-dex-main`: `npm run quality`
  - `lunes-dex-main`: `npm run build`
  - `sdk`: `npm run build`
  - `mcp/lunex-agent-mcp`: `npx tsc -p tsconfig.json`
- Remaining `D2` scope:
  - Migrate signed reads still present in social, copytrade, rewards, strategies, governance, affiliate, listing, and secondary MCP tools.
  - Add a CI regression check that rejects `nonce/timestamp/signature` in GET query construction once all legacy clients are migrated.

### 2026-06-03 — Frontend Production API URL Guard

- Completed first pass for frontend production API URL fail-closed checks.
- Added `lunes-dex-main/scripts/check-production-env.cjs` and `npm run build:prod`.
- `build:prod` requires `REACT_APP_SPOT_API_URL` and rejects localhost, loopback, link-local, and RFC1918 private network hosts.
- `docker/Dockerfile.frontend` now runs `build:prod` by default; sandbox can opt out via `LUNEX_FRONTEND_STRICT_BUILD=false`.
- Updated production/testnet/Doppler compose args so frontend API URL is supplied explicitly instead of baked as an empty string.
- Updated env templates:
  - `docker/.env.prod.example`: added `REACT_APP_SPOT_API_URL`.
  - `docker/.env.testnet.example`: added `TESTNET_SPOT_API_URL`.
  - `lunes-dex-main/.env.production.example`: documented `build:prod` guard behavior.
- Verification passed:
  - Valid URL: `REACT_APP_SPOT_API_URL=https://api.lunex.lunes.io node scripts/check-production-env.cjs`
  - Negative URL: `REACT_APP_SPOT_API_URL=http://localhost:4000 node scripts/check-production-env.cjs` failed as expected.
  - `REACT_APP_SPOT_API_URL=https://api.lunex.lunes.io npm run build:prod`
- Compose config check note: the first run failed before frontend interpolation because `LUNES_CHAIN_ID` was required by SubQuery but missing from `docker/.env.prod.example`; this was closed in the follow-up below.

### 2026-06-03 — Compose Template Coverage

- Closed the compose/env coverage gap surfaced by `docker compose config`.
- `docker/.env.prod.example` now includes:
  - `LUNES_CHAIN_ID` and `LUNES_START_BLOCK` for SubQuery.
  - Required off-host backup placeholders: `BACKUP_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `BACKUP_S3_RETENTION_DAYS`.
  - `ALLOWED_WS_ORIGINS`.
  - Non-empty placeholders for required mainnet contract/token variables.
- `docker/.env.testnet.example` now includes non-empty placeholders for required testnet contracts/tokens.
- Verification passed:
  - `docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod.example config`
  - `docker compose -f docker/docker-compose.testnet.yml --env-file docker/.env.testnet.example config`

### 2026-06-04 — Signed Read Completion + Explicit Signing

- Completed the mapped `D2` signed-read query migration:
  - Backend signed-read routes now accept `X-Lunex-Nonce`, `X-Lunex-Timestamp`, and `X-Lunex-Signature` headers in rewards, copytrade, strategies, governance, social, affiliate, asymmetric, listing, orders, trades, favorites, margin, and agents.
  - `lunes-dex-main` now sends signed-read auth in headers for rewards pending, social leader profile reads, copytrade positions/activity, followed strategies, governance vote history, affiliate dashboard/tree/payouts, and prior Spot/margin/agent flows.
  - SDK signed reads now use headers for orders, copytrade, agents, and asymmetric read methods.
  - MCP signed read tools now use headers for Spot, social leader profile, copytrade positions/activity, and followed strategies.
- Added `prod:guard` regression coverage to reject signed auth in client GET query strings for mapped frontend, SDK, and MCP files.
- Advanced `D1` explicit-signing cleanup:
  - Removed automatic signed copytrade follower dashboard load on wallet connection; user must click Refresh.
  - Removed automatic signed margin overview load on tab mount; user must click Load Margin Overview.
  - Removed automatic signed bot-registry wallet lookup; user must click Load My Agent.
  - Removed automatic signed affiliate API reads on page load; user must click Load Dashboard.
- Verification passed:
  - `spot-api`: `npm run prod:guard`
  - `spot-api`: `npm run quality`
  - `spot-api`: `npm run build`
  - `lunes-dex-main`: `npm run quality`
  - `lunes-dex-main`: `npm run build`
  - `sdk`: `npm run build`
  - `mcp/lunex-agent-mcp`: `npx tsc -p tsconfig.json`
- Remaining frontend trust work:
  - Add Playwright wallet-mock tests proving tab changes/remounts do not call `signRaw`.
  - Add a dedicated hardcoded contract/token fallback audit for non-financial config defaults.

### 2026-06-04 — Critical Fake Financial Display Cleanup

- Completed mapped `D4` cleanup for critical fake financial values:
  - Wallet balance modal no longer derives a hardcoded USD estimate from `LUNES * 0.045`.
  - lUSDT wallet row no longer displays `0.00` or `≈ $0.00` when no token balance source is connected.
  - Spot order form no longer uses hardcoded market price, maker fee, or taker fee defaults for order estimates.
  - Spot order form disables market/stop orders when live ticker price or taker fee data is unavailable, and disables limit/stop-limit submission when maker fee data is unavailable.
  - Spot chart trade-line defaults no longer prefill fake entry, take-profit, or stop-loss prices.
  - Token picker mock prices now render as unavailable instead of `$ 0.00` / `$ 1.00`.
  - Swap confirmation no longer renders fixed BTC minimum, network fee, LP fee, or price impact figures without a live quote.
- Verification passed:
  - `lunes-dex-main`: `npm run quality`
  - `lunes-dex-main`: `npm run build`
- Remaining frontend trust work:
  - Add Playwright wallet-mock tests proving route changes, tab changes, remounts, and dashboard refresh controls do not call `signRaw` until explicit user action.
  - Run a separate audit for marketing/demo values before production build freeze.

### 2026-06-04 — Frontend No-Auto-Signing Guard + Runtime Address Fallback Cleanup

- Added `lunes-dex-main/scripts/check-frontend-regressions.cjs` and wired it into `npm run quality` as `npm run frontend:guard`.
- The guard fails on:
  - wallet signing calls inside `useEffect`;
  - signed-read dependencies inside `useEffect`;
  - hardcoded SS58 contract/token fallbacks of the form `process.env.REACT_APP_* || '5...'` in runtime source.
- Removed additional automatic signed reads:
  - Strategies marketplace no longer auto-loads followed strategies on wallet connect; the user clicks `Sync Followed`.
  - Strategy detail no longer auto-loads follow state on mount; the user clicks `Sync Follow State`.
  - Social profile auto-refresh now uses public profile data only; signed follow-state sync is explicit.
  - Social settings no longer loads the saved leader profile on mount; the user clicks `Load Saved Profile`.
- Removed runtime SS58 address fallbacks from:
  - `src/config/contracts.ts`;
  - pool token list;
  - `usePools` token metadata and factory/router/wnative setup;
  - Spot `PriceHeader`;
  - `contractService.allPairsLength()` / `allPairs()`.
- Verification passed:
  - `lunes-dex-main`: `node ./scripts/check-frontend-regressions.cjs`
  - `lunes-dex-main`: `npm run quality`
  - `lunes-dex-main`: `npm run build`
  - `lunes-dex-main`: `rg` found no remaining runtime `process.env.REACT_APP_(TOKEN|*CONTRACT) || '5...'` fallback pattern.
- Remaining frontend trust work:
  - Add browser-level Playwright wallet-mock coverage when test dependencies are available.
  - Reconcile documentation/marketing examples that still mention local URLs or dev keys so public docs do not normalize unsafe launch behavior.

### 2026-06-04 — Security Disclosure + Ops Runbook Baseline

- Added root `SECURITY.md` with supported scope, vulnerability reporting channel, response targets, safe harbor, production launch gates, and incident evidence requirements.
- Added `docs/THREAT_MODEL.md` with assets, trust boundaries, STRIDE summary, and explicit P0 known risks.
- Added operational runbooks under `docs/runbooks/`:
  - API down/degraded;
  - blockchain RPC down;
  - settlement backlog;
  - database and backup;
  - Redis;
  - WebSocket stream drop;
  - host resources;
  - security alerts;
  - SSL certificate;
  - indexer lag;
  - relayer/admin key rotation;
  - emergency pause;
  - deploy rollback.
- Updated all existing `docker/alert-rules.yml` runbook annotations to local `docs/runbooks/*` paths and removed the `your-org` placeholder.
- Added `scripts/check-ops-docs.cjs`, `npm run ops:docs`, and a CI `ops-docs` job that validates:
  - required security docs exist;
  - alert rules contain no `your-org`;
  - runbook annotations use local paths;
  - referenced runbook files exist;
  - runbooks include `Impact`, `Triage`, and `Mitigation` sections.
- Verification passed:
  - `node scripts/check-ops-docs.cjs`
  - `git diff --check`
- Remaining ops/compliance work:
  - Execute and archive a real backup restore drill with RTO/RPO.
  - Implement/prove `lunex_last_backup_age_seconds` metric emission if not already present in runtime metrics.
  - Run chaos/drill exercises for API, Redis, Postgres, RPC, settlement backlog, emergency pause, and deploy rollback.
  - Finalize legal/compliance posture: terms, privacy/LGPD, sanctions/KYC posture, jurisdiction restrictions, and risk disclosures.

### 2026-06-04 — Token Listing Fail-Closed Remediation

- Added `.planning/audit/LISTING-FLOW-REVIEW.md` covering DEX `/listing`, `spot-api` listing routes/services, admin pending-listing actions, relayer, contracts, docs, and tests.
- Implemented fail-closed listing activation in `spot-api`:
  - `activateListing()` now requires on-chain proof fields: `onChainListingId`, `pairAddress`, `lpTokenAddress`, `lpAmount`, and `txHash`.
  - Activation is restricted to `PENDING` listings and rejects missing/invalid proof.
  - New listing applications no longer create fake `LiquidityLock` rows with placeholder pair/LP data and `LOCKED` status.
  - Proof-backed activation creates or updates the lock row with real pair/LP/tx proof data.
  - Lock withdraw now requires an on-chain withdraw `txHash` before DB state changes.
- Updated DEX listing UI:
  - Success/review copy now says application submitted and pending finalized proof.
  - Removed claims that fee deduction, pool creation, liquidity lock, or token visibility happen immediately after off-chain submission.
  - Logo upload now accepts PNG/WebP only, matching backend validation.
- Updated admin listing flow:
  - Pending-listing table reads the actual API fields (`ownerAddress`, `lunesLiquidity`, `tokenLiquidity`).
  - Direct manual approve is disabled and replaced by `Proof required`.
  - Admin action API now requires activation proof if used programmatically.
- Added `listingService` unit tests for pending creation without fake locks, proof-required activation, and proof-backed lock creation.
- Verification passed:
  - `spot-api`: `npm test -- --runTestsByPath src/__tests__/listingService.test.ts`
  - `spot-api`: `npm run build`
  - `spot-api`: `npm run quality`
  - `lunes-dex-main`: `npm run build`
  - `lunes-dex-main`: `npm run quality`
  - `lunex-admin`: `npm run lint`
  - `lunex-admin`: `npm run build` with network access for `next/font` Google font download
  - Root: `git diff --check`
- Remaining listing blockers:
  - Real finalized event verifier for `TokenListed`, `LiquidityLocked`, and `LiquidityUnlocked`.
  - Production `listing-relayer` wiring with auth, finalized cursor, ABI decoding, idempotency, and replay/reorg handling.
  - Canonical DEX on-chain listing wizard or explicit application-only public launch posture.
  - Contract e2e and route/admin/browser e2e coverage for listing lifecycle.

### 2026-06-04 — Token Listing Finalized Proof Verifier

- Added `spot-api/src/services/listingProofService.ts`.
- `spot-api` activation now verifies finalized/indexed SubQuery `ListingEvent` evidence before changing state to `ACTIVE`:
  - `TOKEN_LISTED` must match owner, token address, pair address, tier, `listingId`, and `txHash`.
  - `LIQUIDITY_LOCKED` must match owner, pair address, tier, `lockId`, LP amount, and the same `txHash`.
  - Production fails closed when `SUBQUERY_ENDPOINT` / `SUBQUERY_ENABLED=true` are not configured.
- `spot-api` withdraw finalization now verifies `LIQUIDITY_UNLOCKED` before changing a lock to `WITHDRAWN`.
- Added admin relayer endpoint:
  - `POST /api/v1/listing/lock/onchain/:onChainLockId/withdraw-finalized`
  - Protected by `ADMIN_SECRET`.
- Added `onChainLockId` to activation proof and stopped reusing `onChainListingId` as the liquidity-lock id.
- Updated SubQuery listing schema/mapping:
  - `ListingEvent.listingId`
  - `ListingEvent.lockId`
- Updated `scripts/listing-relayer.ts`:
  - Requires `ADMIN_SECRET`.
  - Processes finalized heads via `subscribeFinalizedHeads`.
  - Correlates `TokenListed` + `LiquidityLocked` by finalized extrinsic hash.
  - Sends complete activation proof to `spot-api`.
  - Finalizes withdraw through the new admin route with the finalized tx hash.
- Verification passed:
  - `spot-api`: `npm run build`
  - `spot-api`: `npm test -- --runTestsByPath src/__tests__/listingService.test.ts`
  - `spot-api`: `npm run quality`
  - `scripts/listing-relayer.ts`: `npx tsc --noEmit --skipLibCheck --module commonjs --target ES2020 --esModuleInterop scripts/listing-relayer.ts`
  - `lunex-admin`: `npm run lint`
  - `subquery-node`: `npm run codegen`
  - `subquery-node`: `npm run build`
  - Root: `git diff --check`
- Remaining listing blockers:
  - Execute the updated SubQuery deployment/backfill procedure in production and archive evidence.
  - Add lifecycle e2e for contract → SubQuery → relayer → API → admin/DEX visibility.
  - Implement the DEX on-chain listing wizard or keep public listing as application-only until verified events exist.
  - Consider a contract event change to emit `lpTokenAddress`; current `LiquidityLocked` event does not expose it.

### 2026-06-05 — SubQuery Listing Deploy/Backfill Gate

- Added `docs/runbooks/subquery-backfill.md` with triage, mitigation, rollback, and evidence requirements.
- Added `scripts/check-subquery-listing-deploy.cjs`.
- Added root script `npm run subquery:listing:deploy-check`.
- The gate validates the updated listing proof schema/mapping/deploy prerequisites:
  - indexed `ListingEvent.listingId` and `ListingEvent.lockId`;
  - mapping persistence of `listing_id` and `lock_id`;
  - generated SubQuery model helpers for listing/lock ids;
  - handler registration in `project.template.yaml`;
  - production compose finalized-only indexing with `--unfinalized-blocks=false`;
  - API `SUBQUERY_ENDPOINT` / `SUBQUERY_ENABLED`;
  - production `listing-relayer` service;
  - backfill/replay env controls;
  - runbook rollback instructions.
- Verification passed:
  - `npm run subquery:listing:deploy-check`
  - `subquery-node`: `npm run codegen`
  - `subquery-node`: `npm run build`
  - Root: `git diff --check`
- Remaining listing blockers:
  - Execute the deployment/backfill procedure in production and archive evidence.
  - Add lifecycle e2e for contract → SubQuery → relayer → API → admin/DEX visibility.
  - Implement the DEX on-chain listing wizard or keep public listing as application-only until verified events exist.
  - Consider a contract event change to emit `lpTokenAddress`; current `LiquidityLocked` event does not expose it.

### 2026-06-04 — Listing Relayer Durable Cursor + Production Compose

- Added durable relayer state:
  - `LISTING_RELAYER_STATE_FILE`
  - `LISTING_RELAYER_START_BLOCK`
  - `LISTING_RELAYER_REPLAY_BLOCKS`
- The relayer now:
  - loads/saves a JSON finalized-block cursor atomically;
  - replays a bounded finalized window on startup;
  - fills live gaps from `lastFinalizedBlock + 1` to the current finalized head;
  - waits for block API tasks to settle before saving the cursor.
- Added `listing-relayer` to `docker/docker-compose.prod.yml` with:
  - `ADMIN_SECRET`;
  - listing/lock contract addresses;
  - internal `SPOT_API_URL`;
  - persistent `listingrelayerdata` volume.
- Updated `docker/Dockerfile.api` to pre-create `/app/.state` with the non-root runtime owner.
- Production SubQuery compose now uses `--unfinalized-blocks=false` for finalized proof semantics.
- Verification passed:
  - `scripts/listing-relayer.ts`: `npx tsc --noEmit --skipLibCheck --module commonjs --target ES2020 --esModuleInterop scripts/listing-relayer.ts`
  - `docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod.example config`
  - `spot-api`: `npm run build`
  - Root: `git diff --check`
- Remaining listing blockers:
  - Deploy/backfill the updated SubQuery schema/mapping in production.
  - Add lifecycle e2e for contract → SubQuery → relayer → API → admin/DEX visibility.
  - Implement the DEX on-chain listing wizard or keep public listing as application-only until verified events exist.
  - Consider a contract event change to emit `lpTokenAddress`; current `LiquidityLocked` event does not expose it.

### 2026-06-05 — Listing Relayer / Indexer Grafana Dashboard

- Added `docker/grafana/provisioning/dashboards/listing-relayer-indexer.json`.
- Dashboard panels cover:
  - relayer scrape health;
  - finalized cursor age;
  - last finalized block;
  - SubQuery node/query probes;
  - finalized block processing rate/failures;
  - activation and withdraw proof API success/failure rates.
- Updated `scripts/check-ops-docs.cjs` to accept YAML `runbook:` annotations with single quotes, double quotes, or no quotes.
- Verification passed:
  - dashboard JSON parse check;
  - `docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod.example config`;
  - `npm run ops:docs`;
  - Root: `git diff --check`.
- Remaining listing blockers:
  - Deploy/backfill the updated SubQuery schema/mapping in production.
  - Add lifecycle e2e for contract → SubQuery → relayer → API → admin/DEX visibility.
  - Implement the DEX on-chain listing wizard or keep public listing as application-only until verified events exist.
  - Consider a contract event change to emit `lpTokenAddress`; current `LiquidityLocked` event does not expose it.

### 2026-06-05 — Listing Relayer / SubQuery Observability

- `scripts/listing-relayer.ts` now exposes Prometheus text metrics on `LISTING_RELAYER_METRICS_PORT`:
  - `lunex_listing_relayer_up`
  - `lunex_listing_relayer_uptime_seconds`
  - `lunex_listing_relayer_last_finalized_block`
  - `lunex_listing_relayer_cursor_age_seconds`
  - `lunex_listing_relayer_processed_blocks_total`
  - `lunex_listing_relayer_failed_blocks_total`
  - activation/withdraw success and failure counters.
- `docker/prometheus.yml` now scrapes:
  - `listing-relayer:9471`;
  - internal blackbox probes for `subquery-node`, `subquery-query`, and relayer metrics.
- `docker/alert-rules.yml` now alerts on relayer down/stale/failure states and SubQuery node/query probe failures.
- Added `docs/runbooks/listing-relayer.md` and updated `docs/runbooks/indexer-lag.md`.
- Verification passed:
  - `scripts/listing-relayer.ts`: `npx tsc --noEmit --skipLibCheck --module commonjs --target ES2020 --esModuleInterop scripts/listing-relayer.ts`
  - `docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod.example config`
  - `npm run ops:docs`
  - `spot-api`: `npm run build`
  - Root: `git diff --check`
- Remaining listing blockers:
  - Deploy/backfill the updated SubQuery schema/mapping in production.
  - Add lifecycle e2e for contract → SubQuery → relayer → API → admin/DEX visibility.
  - Add Grafana dashboard panels for relayer cursor age/failures and SubQuery availability/lag.
  - Implement the DEX on-chain listing wizard or keep public listing as application-only until verified events exist.
  - Consider a contract event change to emit `lpTokenAddress`; current `LiquidityLocked` event does not expose it.
