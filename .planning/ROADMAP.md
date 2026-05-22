# Roadmap: Lunex Production Readiness

**Milestone:** Mainnet launch readiness
**Core Value:** Custody-grade correctness at every fund-moving step
**Granularity:** standard
**Parallelization:** enabled (disjoint files/services only)
**Created:** 2026-05-21

## Overview

Brownfield production-readiness milestone. The DEX is deployed on testnet; this milestone hardens existing layers to mainnet quality. **No new user-facing features.** Phases are sequenced so cheap-truth-up unblocks all downstream work, team-closable Tier 0 correctness work proceeds in parallel with external dependencies (Lunes pallet upgrade for `CRYPTO-01`, external audit firm engagement), and the final phase is a full dress rehearsal.

### External Dependencies (track separately, do not block team-closable work)

- **EXT-CRYPTO:** Lunes pallet-contracts upgrade exposing `seal_sr25519_verify` — gates the on-chain `verify_order_signature` body. Team-closable side: `CRYPTO-02` decision recorded (off-chain attestation interim) and tests scaffolded so the body swap is mechanical when chain delivers. This is why Tier-0 `CRYPTO-01` lands in Phase 5 (contract test work) rather than earlier — there is no team-side code path until either the pallet ships or the interim attestation path is chosen.
- **EXT-AUDIT:** Security audit firm (Halborn / Trail of Bits / OpenZeppelin / CertiK) engagement + remediation cycle. Audit handoff must follow Phase 1 (no `isInBlock` on fund paths) and Phase 2 (no `//Alice` reachable). Sign-off is `MAINNET-03`, closed in Phase 10.

### Parallelization Map

| Phases | Can run concurrently? | Why |
|--------|------------------------|-----|
| 0 | sequential first | Truth-up cannot be parallelized; it gates every phase's "definition of done" |
| 1, 2, 3 | parallel after 0 | Disjoint services: finality migration (spot-api fund services) vs guards (boot-time config) vs API/SDK contract (route surface + sdk pkg) |
| 4 | parallel with 1/2/3 | Frontend repos (`lunex-admin`, `lunes-dex-main`) touch disjoint code from backend; FE-05 reads API surface from Phase 3 — handle as soft dependency, not block |
| 5 | parallel with 2/3/4, after 1 | Contracts workspace is disjoint from TS code; depends on Phase 1 for finality-test patterns to reuse |
| 6 | sequential after 0, blocks 7 | Submodule decision (Open Q2) must land before infra deploy/runbook work pinned to a single parent SHA |
| 7 | after 2 and 6 | Runbooks reference bridge-admin rotation (Phase 2) and assume single-SHA deploys (Phase 6) |
| 8 | after 7 | Observability completion layers on the metrics/scrape surface fixed in Phase 7 |
| 9 | parallel with 7/8, after 3 | Docs depend on the API canonical from Phase 3 |
| 10 | final, sequential after 0-9 | Dress rehearsal exercises everything |

## Phases

- [ ] **Phase 0: Truth-up & Reconciliation** - Make team's own claims trustworthy before any commitment work (1 day, no code risk)
- [ ] **Phase 1: Finality Discipline on Fund-Moving Paths** - Migrate remaining `isInBlock` short-circuits to `isFinalized` only; lock the regression with tests
- [ ] **Phase 2: Secrets & Production Guards Hardening** - Eliminate every `//Alice`/dev-key fallback; productionGuards becomes the boot-time choke point
- [ ] **Phase 3: API/SDK Contract Reconciliation** - Single OpenAPI sourced from code; SDK regenerated and tested against real endpoints
- [ ] **Phase 4: Frontend Hardening** - Remove fake balances, install test harnesses, strict CSP, session TTL, wallet chooser
- [ ] **Phase 5: Contract Test Honesty** - Un-ignore router math, replace `#[cfg(not(test))]` gates, implement copy_vault fuzz, pin ink version
- [ ] **Phase 6: Submodule & Deploy Trust Model** - Restore single-SHA reproducibility (admin), pin image digests, dedupe Prisma migrate, CI hygiene
- [ ] **Phase 7: Operational Readiness** - Runbooks, tested backup restore, healthchecks, resource limits, emergency-pause coverage for copy_vault + staking
- [ ] **Phase 8: Observability Completion** - Indexer scrape + lag alert, missing alert rules, backup-age metric, dashboards version-controlled
- [ ] **Phase 9: Documentation Truth-up** - SECURITY.md, threat model, onboarding, faucet README, PRODUCTION-READINESS reconciliation
- [ ] **Phase 10: Mainnet Dress Rehearsal** - Full E2E from clean clone → testnet flow; chaos test; restore drill; audit firm sign-off

## Phase Details

### Phase 0: Truth-up & Reconciliation
**Goal**: Make the team's own claims trustworthy before any commitment work — cheap, unblocks every downstream phase
**Depends on**: Nothing
**Requirements**: DOCS-03
**Success Criteria** (what must be TRUE):
  1. `PRODUCTION-READINESS.md` test counts match 2026-05-21 audit reality (282/8 contracts, 194 spot-api unit, frontend status correctly attributed) — diff reviewed and merged
  2. `lunex-admin/package.json` lint script exits non-zero on findings (`--max-warnings=0` and no `|| true`); CI shows red on the current 3 errors + 2 warnings
  3. Answers to the 7 Open Questions (faucet at mainnet, admin repo strategy, SDK audience, bridge at launch, polish reclassification, canonical API doc, relayer key strategy) are recorded in `.planning/decisions.md` (or PROJECT.md Key Decisions table) with owner + date
  4. `AGENTS.md` no longer points at dead canonical docs (`PUBLIC_API_SPECIFICATION.md`, `openapi.json`); pointers are either removed or marked `legacy/`
**Plans**: TBD

### Phase 1: Finality Discipline on Fund-Moving Paths
**Goal**: Every fund-moving service refuses `isInBlock` and lock the discipline with tests so reintroduction fails CI
**Depends on**: Phase 0
**Requirements**: FIN-01, FIN-02, FIN-03, FIN-04, FIN-05
**Success Criteria** (what must be TRUE):
  1. `rewardPayoutService.payNative` (`:447`), `rewardPayoutService.payContract` (`:498`), `rebalancerService` (`:423`), and `emergencyService` (`:242`) early-return when only `isInBlock` is emitted — verified by Jest tests asserting that path
  2. Grep across the spot-api codebase for `isInBlock` on fund paths returns zero results outside test fixtures
  3. `npm test` includes SPEC-REWARD-001, SPEC-REWARD-002, SPEC-REBAL-001, SPEC-EMERG-003 — all four pass and would fail if anyone reverted to `isInBlock`
  4. No `isInBlock` on fund paths: verified by a CI lint/grep step that runs on every PR touching `services/`
**Plans**: TBD

### Phase 2: Secrets & Production Guards Hardening
**Goal**: No production codepath can resolve a key to `//Alice` or any dev-key pattern; `productionGuards.ts` refuses boot on missing/unsafe values
**Depends on**: Phase 0
**Requirements**: SEC-01, SEC-02, SEC-03, SEC-04
**Success Criteria** (what must be TRUE):
  1. `assetBridgeService.ts:466` no longer has `|| '//Alice'`; service refuses to start if `BRIDGE_ADMIN_SEED` is unset, equals any `//Alice..//Ferdie`, or matches `REPLACE_WITH_*` placeholder — verified by Jest in `productionGuards.test.ts`
  2. `productionGuards.collectProductionConfigErrors` covers `BRIDGE_ADMIN_SEED`, `FACTORY_CONTRACT_ADDRESS`, `TREASURY_ADDRESS`, `STAKING_CONTRACT_ADDRESS`, and refuses non-prod `LUNES_WS_URL` (`ws://127.0.0.1:9944`) — each gate has a dedicated test
  3. Faucet either removes `//Alice` initial funding (treasury-funded path) or service is locked off mainnet (per Open Q1 decision from Phase 0)
  4. gitleaks rules match sr25519 mnemonics and dev-seed patterns; CI gates on detection — verified by an intentional-leak fixture branch that fails the gate
  5. `.env.example` mnemonic rotated to a clearly-invalid placeholder; `.env` files no longer ship inside `.next/standalone` build output
**Plans**: TBD

### Phase 3: API/SDK Contract Reconciliation
**Goal**: One canonical OpenAPI generated from spot-api code; SDK regenerated against it; consumers can trust the docs
**Depends on**: Phase 0
**Requirements**: API-01, API-02, API-03, API-04
**Success Criteria** (what must be TRUE):
  1. Single canonical OpenAPI 3.x spec generated from spot-api Zod schemas via `zod-to-openapi`, committed at a single path declared canonical in `AGENTS.md`; the 4 legacy specs (`docs/API_SPECIFICATION.md`, `docs/PUBLIC_API_SPECIFICATION.md`, `docs/api/openapi.json`, `docs/API.md`) are moved to `archive/` or aligned
  2. All 36 SDK HTTP calls hit real `/api/v1/...` routes — verified by a `tools/sdk-route-check` script that resolves each SDK call against the spot-api router and exits non-zero on any miss
  3. Every exported SDK public method has at least one happy-path and one error-path test (msw/nock); `prepublishOnly` runs jest with non-zero test count
  4. SDK `README.md` baseURL example matches deployed configuration (no double-prefix); CHANGELOG documents the namespace migration
  5. No `isInBlock` on fund paths regression check: API surface tests reuse Phase 1 finality assertions where applicable
**Plans**: TBD

### Phase 4: Frontend Hardening
**Goal**: Remove fake numbers, install test harnesses on both frontends, enforce strict CSP and security headers, fix admin session TTL, surface wallet chooser
**Depends on**: Phase 0 (soft dependency on Phase 3 for FE-05 env name reconciliation)
**Requirements**: FE-01, FE-02, FE-03, FE-04, FE-05, FE-06, FE-07, FE-08, FE-09, FE-10
**Success Criteria** (what must be TRUE):
  1. `ConnectWallet.tsx:131-149` no longer contains hardcoded `0.045` price or `0.00` lUSDT line — bundle grep asserts neither constant ships; balance is wired to real fetch or removed
  2. Both frontends have a working test harness (Vitest or Jest) with at least the named smoke tests passing: admin login throttle, admin role gate (SUPER_ADMIN emergency), DEX wallet connect happy + multi-extension chooser, DEX swap quote + slippage rejection, DEX signing flow via injector
  3. Strict CSP shipped from `next.config.ts` (admin), `nginx.spa.conf` (dex), and `docker/nginx.prod.conf` — no `unsafe-inline`/`unsafe-eval` on `script-src`; HSTS, X-Frame-Options, Referrer-Policy, X-Content-Type-Options present on every deploy path
  4. NextAuth admin `session.maxAge ≤ 8h` (per Open Q5 decision in Phase 0) with rolling refresh; emergency-pause panel requires reauth — verified by integration test
  5. `lunex-admin/.env.example` matches code (`AUTH_SECRET`, `SPOT_API_URL`, `ADMIN_SECRET`); wallet chooser exposes installed extensions and persists choice; swap UI shows `paymentInfo`/`partialFee` before broadcast; `pages/docs/index.tsx` is route-split; login rate-limiter no longer trusts `x-forwarded-for[0]` unconditionally; i18n library adopted
**Plans**: TBD
**UI hint**: yes

### Phase 5: Contract Test Honesty
**Goal**: Remove every test-coverage void in ink! contracts — unignore router math, replace gated cross-contract calls with mockable clients, real fuzz target, single ink version, close `verify_order_signature` no-op
**Depends on**: Phase 0, Phase 1 (finality-test patterns)
**Requirements**: CRYPTO-01, CRYPTO-02, CONTRACT-01, CONTRACT-02, CONTRACT-03, CONTRACT-04
**Success Criteria** (what must be TRUE):
  1. 8 `#[ignore]`'d router math tests at `router/lib.rs:1710-2145` are unignored, passing in CI, and exercise single-hop / multi-hop / decimals edge cases via pure helpers
  2. Four `#[cfg(not(test))]` gates (`copy_vault::swap_through_router`, `liquidity_lock::withdraw`, `staking::execute_proposal` transfer, staking test-constant alignment) replaced with mockable contract clients; `tests/integration/` harness via `ink-e2e` or local Substrate testnet runs nightly
  3. `copy_vault` fuzz target binds to actual `CopyVault` (no empty `fuzz_target!{}`); `VaultModel` invariants are ported; nightly run is ≥600s duration
  4. ink! workspace pinned to exactly one version (4.2.1 or 4.3.x — decision recorded); `cargo deny` or workspace check enforces it
  5. CRYPTO-02 decision recorded and implemented: either `verify_order_signature` body swapped to call `seal_sr25519_verify` (if pallet ready) with SPEC-SPOT-001-CRYPTO happy + tampered tests passing, OR off-chain attestation + on-chain commitment is shipped and documented; `verify_order_signature` is no longer a no-op
**Plans**: TBD

### Phase 6: Submodule & Deploy Trust Model
**Goal**: Restore single-SHA reproducibility — parent SHA rollback rolls admin back; container images are immutable; Prisma migrate runs in exactly one place
**Depends on**: Phase 0 (Open Q2 decision)
**Requirements**: INFRA-01, INFRA-04, INFRA-05, INFRA-06, CI-01, CI-02, CI-03
**Success Criteria** (what must be TRUE):
  1. `lunex-admin/` is restored to parent-repo SHA visibility (absorbed OR git submodule with locked commit per Open Q2 decision); parent CI runs typecheck + lint + build for admin on the same SHA as the rest of the pipeline
  2. `docker-compose.prod.yml` pins all Lunex images by immutable git-SHA tag (no `:latest` fallback) and all third-party images by `@sha256:` digest; Trivy gate set to `exit-code: '1'` for Critical+High with an explicit allowlist file
  3. `prisma migrate deploy` runs in exactly one place (kept in `deploy.yml` one-shot, removed from `Dockerfile.api` CMD); no race between Dockerfile CMD and deploy workflow
  4. All workflows use `npm ci` (not `npm install`); `deploy.yml` upgraded from Node 18 to Node 20; duplicate `pr-check.yml`/`pr-checks.yaml` consolidated into one
  5. `lunex-admin npm run lint` exits non-zero on errors (Phase 0 set the flag; this phase closes any remaining lint findings)
**Plans**: TBD

### Phase 7: Operational Readiness
**Goal**: Production is operable by humans paged at 3 a.m. — runbooks exist, backups have been restored, healthchecks gate `depends_on`, resource limits set, emergency pause covers all fund-holding contracts
**Depends on**: Phase 0, Phase 2 (for bridge-admin rotation runbook), Phase 6 (single-SHA deploy)
**Requirements**: INFRA-02, INFRA-03
**Success Criteria** (what must be TRUE):
  1. All runbooks referenced by alert annotations exist under `docs/runbooks/`: chain halt, bridge desync, indexer fall-behind, DB restore, relayer balance low, plus the remaining 8 from INFRA.md — `your-org` placeholder eliminated everywhere; at least one cold-run incident drill executed against a runbook
  2. Postgres backup restore is tested: nightly CI job pulls latest S3 dump, restores into scratch Postgres, asserts row counts > 0 on key tables; WAL archiving to S3 (PITR) configured; restore integrity check (`pg_restore --list` / `gzip -t`) in `backup.sh`; documented RTO
  3. All 12 missing docker-compose healthchecks added (`frontend`, `subquery-query`, `nginx`, `prometheus`, `grafana`, `alertmanager`, `promtail`, `db-backup`, `certbot`, `postgres-exporter`, `redis-exporter`, `nginx-exporter`); deploy verifies all `healthy` before promotion
  4. Resource limits set on every compose service (`mem_limit`, `cpus`); `DATABASE_URL` has `?connection_limit=10&pool_timeout=20`
  5. `emergencyService` exposes pause/unpause + status for `copy_vault` and `staking` (no longer hardcoded `available: false`); admin panel UI wires them; e2e drill verified; audit firm handoff is ready (post-Phase 1/2/5 code state confirmed) — closure event tracked in Phase 10 as `MAINNET-03`
**Plans**: TBD

### Phase 8: Observability Completion
**Goal**: Every alert rule fires when it should; every metric referenced by an alert exists; dashboards are version-controlled
**Depends on**: Phase 7
**Requirements**: OBS-01, OBS-02, OBS-03, OBS-04, OBS-05, OBS-06
**Success Criteria** (what must be TRUE):
  1. All runbooks (`OBS-01`) link from alert annotations to real files (closes the loop with Phase 7 deliverables; verified by an alert-rule linter)
  2. `lunex_last_backup_age_seconds` metric is defined in `spot-api/src/utils/metrics.ts` and emitted by `backup.sh` — `DatabaseBackupFailed` alert is verified to fire in a stage rehearsal
  3. SubQuery indexer exposes `lastProcessedHeight` and is scraped by Prometheus; `IndexerLag > 100 blocks for >5m` alert + runbook entry shipped
  4. Relayer/bridge balance gauges and alert rules shipped (threshold per Open Q6 decision from Phase 0); Loki/Promtail/Alertmanager self-monitor alerts shipped
  5. Grafana dashboards (including `lunex-overview.json` and any added for finality lag, indexer lag, reward distribution, copy-vault drilldown) exported as JSON and committed under version control
**Plans**: TBD

### Phase 9: Documentation Truth-up
**Goal**: Public-launch documentation — security disclosure, threat model, onboarding, faucet posture, PRODUCTION-READINESS fully reconciled
**Depends on**: Phase 0, Phase 3 (API canonical)
**Requirements**: DOCS-01, DOCS-02, DOCS-04, DOCS-05
**Success Criteria** (what must be TRUE):
  1. `SECURITY.md` at repo root with disclosure email, PGP key, scope, response SLA, safe-harbor language
  2. `docs/THREAT_MODEL.md` filled (STRIDE per layer: frontend → spot-api → relayer → contracts → faucet → MCP → indexer) — no longer a blank template
  3. Onboarding rewrite verified by an uninvolved developer completing clone → running locally in ≤30 minutes; time-to-green is documented
  4. Faucet `README.md` written and reflects launch-policy decision from Open Q1 (mainnet-public with captcha+treasury funding+persisted state OR testnet-locked)
  5. `PRODUCTION-READINESS.md` fully reconciled against this audit (16 divergence rows from the consolidated audit closed); CHANGELOG `[Unreleased]` captures 2026-04-28 hardening + 2026-05-21 audit findings
**Plans**: TBD

### Phase 10: Mainnet Dress Rehearsal
**Goal**: Prove the entire system from clean clone to production-equivalent run; close audit firm cycle; sign off launch
**Depends on**: Phases 0–9
**Requirements**: MAINNET-01, MAINNET-02, MAINNET-03, CI-04
**Success Criteria** (what must be TRUE):
  1. Full E2E from clean clone → local stack → testnet flow exercised before mainnet code freeze: swap, settlement, copy-vault deposit, listing, governance proposal+execution, reward distribution, bridge wrap/unwrap, emergency pause — all signed off by ops lead
  2. Chaos test: kill each named service in turn (Redis, Postgres, SubQuery, RPC stall, relayer process) — recovery verified, expected alerts fire, runbooks (Phase 7) drive resolution
  3. Restore-from-S3 drill executed against the dress-rehearsal Postgres — row counts and key invariants reconcile; RTO measured matches the documented target
  4. Long-form gitleaks + fuzz runs complete without findings; ink! contracts fuzz nightly is green for 7 consecutive runs at the new 600s+ duration
  5. Audit firm (`MAINNET-03`) sign-off received against current commit SHA; high/critical findings remediated and re-tested; quarterly chaos + restore drill cadence (`CI-04`) is scheduled in CI/calendar; no `isInBlock` on fund paths in the shipped commit (final regression check)
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 0. Truth-up & Reconciliation | 0/0 | Not started | - |
| 1. Finality Discipline | 0/0 | Not started | - |
| 2. Secrets & Production Guards | 0/0 | Not started | - |
| 3. API/SDK Contract | 0/0 | Not started | - |
| 4. Frontend Hardening | 0/0 | Not started | - |
| 5. Contract Test Honesty | 0/0 | Not started | - |
| 6. Submodule & Deploy Trust | 0/0 | Not started | - |
| 7. Operational Readiness | 0/0 | Not started | - |
| 8. Observability Completion | 0/0 | Not started | - |
| 9. Documentation Truth-up | 0/0 | Not started | - |
| 10. Mainnet Dress Rehearsal | 0/0 | Not started | - |

## Coverage Validation

**Total v1 requirements:** 53 (category sum is authoritative — REQUIREMENTS.md header previously cited "47" which was stale)
**Mapped:** 53 / 53 ✓
**Orphaned:** 0
**Duplicates:** 0 (every REQ-ID appears in exactly one phase)

### Requirement → Phase Map

| Phase | Requirements | Count |
|-------|--------------|-------|
| 0 | DOCS-03 | 1 |
| 1 | FIN-01, FIN-02, FIN-03, FIN-04, FIN-05 | 5 |
| 2 | SEC-01, SEC-02, SEC-03, SEC-04 | 4 |
| 3 | API-01, API-02, API-03, API-04 | 4 |
| 4 | FE-01, FE-02, FE-03, FE-04, FE-05, FE-06, FE-07, FE-08, FE-09, FE-10 | 10 |
| 5 | CRYPTO-01, CRYPTO-02, CONTRACT-01, CONTRACT-02, CONTRACT-03, CONTRACT-04 | 6 |
| 6 | INFRA-01, INFRA-04, INFRA-05, INFRA-06, CI-01, CI-02, CI-03 | 7 |
| 7 | INFRA-02, INFRA-03 | 2 |
| 8 | OBS-01, OBS-02, OBS-03, OBS-04, OBS-05, OBS-06 | 6 |
| 9 | DOCS-01, DOCS-02, DOCS-04, DOCS-05 | 4 |
| 10 | MAINNET-01, MAINNET-02, MAINNET-03, CI-04 | 4 |
| **Total** | | **53** |

### Coverage by Category

| Category | Total | Mapped | Phase(s) |
|---|---|---|---|
| CRYPTO | 2 | 2 | Phase 5 |
| FIN | 5 | 5 | Phase 1 |
| SEC | 4 | 4 | Phase 2 |
| API | 4 | 4 | Phase 3 |
| FE | 10 | 10 | Phase 4 |
| CONTRACT | 4 | 4 | Phase 5 |
| INFRA | 6 | 6 | Phase 6 (×4), Phase 7 (×2) |
| OBS | 6 | 6 | Phase 8 |
| CI | 4 | 4 | Phase 6 (×3), Phase 10 (×1) |
| DOCS | 5 | 5 | Phase 0 (×1), Phase 9 (×4) |
| MAINNET | 3 | 3 | Phase 10 |
| **Total** | **53** | **53** | |

---

*Roadmap created 2026-05-21 from audit-driven brownfield initialization.*
