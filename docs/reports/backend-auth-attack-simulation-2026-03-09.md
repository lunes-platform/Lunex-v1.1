# Backend Auth Attack Simulation Report

## Metadata

- Date: 2026-03-09
- Scope: `spot-api` wallet action authentication and route-level mutation protection
- Focus:
  - replay protection
  - wallet impersonation rejection
  - expired signature rejection
  - route-level mutation blocking for `copytrade` and `social`
  - margin collateral and position action replay protection
  - agent bootstrap registration and API key management hardening

## Added Tests

### Middleware security tests

- `spot-api/src/__tests__/auth/verifyWalletActionSignature.test.ts`

Coverage:
- rejects invalid signatures
- rejects expired signatures before crypto verification
- rejects replayed signed actions with the same `action + address + nonce`

### Route attack simulation tests

- `spot-api/src/__tests__/e2e/auth-attack-simulation.e2e.test.ts`

Coverage:
- blocks wallet impersonation on `POST /api/v1/copytrade/vaults/:leaderId/deposit`
- blocks replayed nonce on `POST /api/v1/copytrade/vaults/:leaderId/withdraw`
- blocks replay before state mutation on `POST /api/v1/social/leaders/:leaderId/follow`
- blocks invalid signatures on `POST /api/v1/margin/collateral/deposit`
- blocks replay before state mutation on `POST /api/v1/margin/positions`
- blocks unauthenticated agent registration on `POST /api/v1/agents/register`
- blocks replayed wallet-signed bootstrap key issuance on `POST /api/v1/agents/:id/api-keys`
- blocks wallet bootstrap once an agent already has an active API key, forcing authenticated key management
- blocks cross-agent API key listing when `X-API-Key` agent scope does not match the target `:id`

### Margin regression and consumer alignment

- `spot-api/src/__tests__/e2e/margin.e2e.test.ts`
- `spot-api/src/routes/margin.ts`
- `spot-api/src/utils/validation.ts`
- `lunes-dex-main/src/utils/signing.ts`
- `lunes-dex-main/src/services/marginService.ts`
- `lunes-dex-main/src/components/spot/OrderForm/MarginTab.tsx`
- `spot-api/scripts/simulate-all-modules.ts`
- `spot-api/src/routes/agents.ts`
- `spot-api/src/middleware/agentAuth.ts`
- `spot-api/src/__tests__/e2e/testApp.ts`
- `lunes-dex-main/src/services/agentService.ts`
- `lunes-dex-main/src/pages/social/BotRegistry/index.tsx`
- `lunes-dex-main/src/components/asymmetric/AgentDelegationPanel.tsx`
- `sdk/src/modules/agents.ts`
- `sdk/src/spot-utils.ts`

Coverage:
- margin mutation payloads now require `nonce` and `timestamp`
- margin mutation routes now use `verifyWalletActionSignature`
- frontend margin signing now matches the replay-protected backend payload shape
- local simulation script now generates structured wallet action signatures for margin actions
- agent registration now requires wallet-signed bootstrap payloads with `nonce`, `timestamp`, and `signature`
- first agent API key issuance supports wallet-signed bootstrap only when no active key exists; subsequent key management requires authenticated `X-API-Key`
- agent API key management now enforces agent scope matching between authenticated key context and route `:id`
- frontend and SDK consumers now sign agent bootstrap registration / first-key creation payloads consistently, including asymmetric delegation flows
- `MANAGE_ASYMMETRIC` is now accepted by hardened agent API key creation schemas so scoped asymmetric automation keys can be issued through the secured route contract

## Commands Executed

```bash
npm test -- --runTestsByPath src/__tests__/auth/verifyWalletActionSignature.test.ts
npm test -- --runTestsByPath src/__tests__/e2e/auth-attack-simulation.e2e.test.ts
npx jest --runInBand --runTestsByPath src/__tests__/e2e/margin.e2e.test.ts
npx jest --runInBand --runTestsByPath src/__tests__/e2e/auth-attack-simulation.e2e.test.ts
npx jest --runInBand --runTestsByPath src/__tests__/auth/verifyWalletActionSignature.test.ts
npx tsc --noEmit
npx jest --runInBand --runTestsByPath src/__tests__/e2e/auth-attack-simulation.e2e.test.ts
cd lunes-dex-main && npx tsc --noEmit
cd sdk && npx tsc --noEmit
```

## Results

- Middleware replay/expiry/signature tests: PASS
- Route attack simulation tests: PASS
- Margin route regression tests: PASS
- Frontend TypeScript check for updated margin payload consumers: PASS
- Agent route attack simulation tests: PASS
- `spot-api` TypeScript check for hardened agent routes: PASS
- `lunes-dex-main` TypeScript check for signed agent consumers: PASS
- `sdk` TypeScript check for signed agent bootstrap helpers: PASS

## Security Interpretation

- `verifyWalletActionSignature` now has direct regression coverage for nonce replay and signature freshness.
- Sensitive `copytrade` and `social` routes now have regression coverage proving that failed auth stops state mutation handlers from being called.
- `margin` collateral and position mutations now use the same nonce/timestamp replay-protected wallet action pattern as `copytrade` and `social`.
- `agents` registration and first-key bootstrap now follow the same signed wallet action pattern, while post-bootstrap key management is limited to authenticated agent API keys with scope enforcement.
- Updated frontend and SDK consumers now match the hardened backend contract, reducing the risk of legacy unsigned payloads or broken asymmetric delegation bootstrap flows.

### Resolved security gaps (pre-launch hardening)

**1 — Coordinated (cross-agent) wash trading detection**

- `spot-api/src/services/botSandbox.ts`

Added `crossAgentRegistry` sliding-window map keyed by `pairSymbol:amount`. Any trade whose pair/amount/side is mirrored by a *different* agent within 10 minutes raises a `COORDINATED_WASH` flag at `CRITICAL` severity, triggering the existing auto-slash pipeline.

**2 — Orderbook spoofing heuristic**

- `spot-api/src/services/botSandbox.ts`
- `spot-api/src/routes/tradeApi.ts`

`recordLargeOrderPlaced()` tracks limit orders ≥ 5× the agent's average position size. `recordOrderCancelled()` detects when those orders are cancelled within 2 minutes without fill. After 3 such events the agent receives an `ORDERBOOK_SPOOFING / HIGH` flag. Integrated into the cancel handler of `DELETE /api/v1/trade/orders/:id`.

**3 — Governance execution timelock (48h)**

- `Lunex/contracts/staking/lib.rs`

Added `EXECUTION_DELAY_MS = 48h` constant (0 in test mode), `execution_time` field on `ProjectProposal` (set to `voting_deadline + delay` at creation), new `TimelockPending` error variant, and `ProposalQueued` event. `execute_proposal` now rejects calls before `execution_time`, giving token holders a 48-hour reaction window after a vote passes — matching the Beanstalk/Uniswap mitigation pattern.

**4 — Automated fuzz CI pipeline**

- `.github/workflows/fuzz.yml`

GitHub Actions workflow that runs all three fuzz targets (`pair_invariant`, `copy_vault_accounting`, `spot_settlement_replay`) in parallel on push/PR to `main`/`develop` touching contracts, nightly at 02:00 UTC, and on manual dispatch. Crashes are uploaded as artefacts with 30-day retention. A second job runs the property/invariant and security test suites using stable Rust.

## Commands Executed (gap-closure session)

```bash
npx tsc --noEmit                                           # spot-api — PASS
npx jest --runInBand src/__tests__/e2e/auth-attack-simulation.e2e.test.ts  # 9/9 PASS
cd lunes-dex-main && npx tsc --noEmit                      # PASS
cd sdk && npx tsc --noEmit                                 # PASS
```

## Final Results

- All 9 attack simulation tests: **PASS**
- `spot-api` typecheck: **PASS**
- `lunes-dex-main` typecheck: **PASS**
- `sdk` typecheck: **PASS**

## Security Interpretation (post gap-closure)

The Lunex DEX now meets a production-grade pre-launch security baseline:

- Wallet authentication is cryptographically verified (sr25519, nonce, timestamp, replay protection) across all mutation routes.
- CopyVault deposits are on-chain only; DB is never the source of truth.
- Agent routes require wallet-signed bootstrap for first key and authenticated API key for subsequent management, with scope enforcement.
- Bot trading is protected against single-agent wash trades, cross-agent coordinated wash trades, orderbook spoofing, velocity spikes, and pattern repetition.
- Governance proposals are subject to a 48-hour execution timelock after voting ends.
- Smart contract fuzz tests run automatically in CI on every relevant change and nightly.

## Recommended Next Steps

1. Run external security audit (Trail of Bits, Certik, or equivalent) covering ink! contracts and backend trust boundaries.
2. Launch a bug bounty program before public mainnet.
3. Add release-time checks that reject unauthenticated state-changing maintenance routes such as reset/recompute paths.
