# Requirements: Lunex Production Readiness

**Defined:** 2026-05-21
**Core Value:** Custody-grade correctness at every fund-moving step
**Milestone scope:** Mainnet launch readiness — all Tier 0 + Tier 1 + Tier 2 + Tier 3 from `.planning/audit/PRODUCTION_READINESS_AUDIT.md`

## v1 Requirements

Requirements for mainnet launch. Each maps to a roadmap phase. Tier reflects launch-blocker priority, not order-of-completion (cheap unblocking work may run first).

### Crypto Correctness

- [ ] **CRYPTO-01**: `spot_settlement.verify_order_signature` validates sr25519 signature on-chain (no longer a no-op at `spot_settlement/lib.rs:1138`). *(Tier 0)*
- [ ] **CRYPTO-02**: Decision recorded for sr25519 verification path — either Lunes pallet-contracts exposes `seal_sr25519_verify`, or off-chain attestation + on-chain commitment is documented and implemented. *(Tier 0)*

### Finality Discipline

- [ ] **FIN-01**: `rewardPayoutService.payNative` (`:447`) refuses `isInBlock` status — accepts `isFinalized` only on fund-moving paths. *(Tier 0)*
- [ ] **FIN-02**: `rewardPayoutService.payContract` (`:498`) refuses `isInBlock` — accepts `isFinalized` only. *(Tier 0)*
- [ ] **FIN-03**: `rebalancerService` (`:423`) refuses `isInBlock` — accepts `isFinalized` only. *(Tier 0)*
- [ ] **FIN-04**: `emergencyService` (`:242`) refuses `isInBlock` — accepts `isFinalized` only. *(Tier 1)*
- [ ] **FIN-05**: Unit + integration tests assert `isFinalized` gating across all 4 services and would fail if anyone reintroduces `isInBlock`. *(Tier 0)*

### Secrets & Production Guards

- [ ] **SEC-01**: `assetBridgeService` refuses to start if `BRIDGE_ADMIN_SEED` is unset, equals `//Alice`, or matches any dev-key pattern (`assetBridgeService.ts:466`). *(Tier 0)*
- [ ] **SEC-02**: `productionGuards.ts` refuses boot in production if `BRIDGE_ADMIN_SEED`, `FACTORY_CONTRACT_ADDRESS`, `TREASURY_ADDRESS`, `STAKING_CONTRACT_ADDRESS`, or `LUNES_WS_URL` are unset, dev-default, or non-prod values. *(Tier 0)*
- [ ] **SEC-03**: Faucet removes `//Alice` initial funding path (or service is locked off mainnet entirely). *(Tier 0)*
- [ ] **SEC-04**: gitleaks scans match patterns for sr25519 mnemonics, seed phrases, and dev keys; CI gates on detection. *(Tier 2)*

### API & SDK Contract

- [ ] **API-01**: Single OpenAPI spec generated from spot-api code is the source of truth for 149 endpoints; 4 conflicting legacy spec docs are archived or aligned. *(Tier 0)*
- [ ] **API-02**: SDK regenerated from OpenAPI — all 36 HTTP calls hit existing endpoints (currently 27/36 broken). *(Tier 0)*
- [ ] **API-03**: SDK has tests covering happy path + error paths for every exported public method. *(Tier 1)*
- [ ] **API-04**: SDK README baseURL example matches deployed configuration. *(Tier 2)*

### Frontend Hardening

- [ ] **FE-01**: `ConnectWallet.tsx` removes hardcoded `balance × 0.045` USD price and fake lUSDT=0 line — wired to real price oracle or hidden until oracle exists (`ConnectWallet.tsx:131-149`). *(Tier 0)*
- [ ] **FE-02**: NextAuth admin sessions have explicit `session.maxAge` (≤24h for emergency-pause panel; revisit per security review). *(Tier 1)*
- [ ] **FE-03**: `next.config.ts` and inner nginx config emit strict CSP (no `unsafe-inline`, no `unsafe-eval`) plus baseline security headers (X-Frame-Options, Referrer-Policy, X-Content-Type-Options, Strict-Transport-Security). *(Tier 1)*
- [ ] **FE-04**: Smoke test suite (Playwright) covers happy-path flows for both frontends — login admin, list orders admin, connect wallet DEX, submit order DEX. *(Tier 1)*
- [ ] **FE-05**: `lunex-admin/.env.example` reconciled with code (`AUTH_SECRET`, `SPOT_API_URL`, `ADMIN_SECRET` — three renames). *(Tier 1)*
- [ ] **FE-06**: Wallet provider chooser surfaced — `connectWallet(walletSource?)` argument used, not dead. *(Tier 2)*
- [ ] **FE-07**: Swap UI displays tx fee estimate via `api.tx.*.paymentInfo()` before broadcast. *(Tier 2)*
- [ ] **FE-08**: i18n library adopted; mixed pt-BR/English strings consolidated. *(Tier 2)*
- [ ] **FE-09**: DEX UI code-splits `pages/docs/index.tsx` (currently 3417 LOC statically imported); first-paint payload reduced. *(Tier 2)*
- [ ] **FE-10**: Login rate-limiter no longer trusts `x-forwarded-for[0]` unconditionally. *(Tier 2)*

### Smart Contract Test Honesty

- [ ] **CONTRACT-01**: 8 `#[ignore]`'d router math tests (`router/lib.rs:1710-2145`) unignored and passing in CI. *(Tier 1)*
- [ ] **CONTRACT-02**: 4 `#[cfg(not(test))]` gates replaced with mockable contract clients — `copy_vault::swap_through_router`, `liquidity_lock::withdraw`, `staking::execute_proposal` transfer, staking test-constant alignment. *(Tier 1)*
- [ ] **CONTRACT-03**: `copy_vault` fuzz target body implemented (currently empty `fuzz_target!{}`). *(Tier 1)*
- [ ] **CONTRACT-04**: ink! workspace pinned to single version (resolve 4.2.1 vs 4.3.0 vs 4.3 drift). *(Tier 2)*

### Infrastructure & Deployment

- [ ] **INFRA-01**: `lunex-admin/` restored to parent-repo SHA visibility — parent SHA rollback reverts admin code (either absorb into monorepo, or convert to git submodule with locked commit). *(Tier 0)*
- [ ] **INFRA-02**: Postgres backup tested via documented restore drill; PITR (point-in-time recovery) configured. *(Tier 0)*
- [ ] **INFRA-03**: 12/20 docker-compose services without healthchecks gain healthchecks; resource limits set on all services. *(Tier 1)*
- [ ] **INFRA-04**: Docker images pinned by SHA digest in prod compose; no `latest` fallback. *(Tier 2)*
- [ ] **INFRA-05**: `prisma migrate deploy` runs in exactly one place (remove duplicate between Dockerfile CMD and `deploy.yml`). *(Tier 2)*
- [ ] **INFRA-06**: `.env` files removed from `.next/standalone` build output. *(Tier 2)*

### Observability

- [ ] **OBS-01**: Runbooks written and linked from alert annotations for: chain halt, bridge desync, indexer fall-behind, DB restore, relayer balance low. *(Tier 0)*
- [ ] **OBS-02**: `lunex_last_backup_age_seconds` metric (referenced by alert) is actually exposed by a service. *(Tier 1)*
- [ ] **OBS-03**: SubQuery indexer scraped by Prometheus with lag alert configured. *(Tier 1)*
- [ ] **OBS-04**: Relayer/bridge balance metric + alert rule (threshold per Open Question Q6). *(Tier 1)*
- [ ] **OBS-05**: Loki/Promtail self-monitor configured (alerts fire if log shipping stops). *(Tier 1)*
- [ ] **OBS-06**: Grafana dashboards exported and version-controlled. *(Tier 3)*

### CI/CD

- [ ] **CI-01**: All workflows use `npm ci` (not `npm install`); `deploy.yml` upgraded from Node 18 to Node 20. *(Tier 1)*
- [ ] **CI-02**: Trivy gates CI on findings (`exit-code: '1'`); duplicate `pr-check.yml`/`pr-checks.yaml` consolidated. *(Tier 2)*
- [ ] **CI-03**: `lunex-admin` lint exits non-zero on errors (currently 3 errors + 2 warnings exit 0 — CI can't catch). *(Tier 2)*
- [ ] **CI-04**: Quarterly chaos + restore drills scheduled in CI/calendar. *(Tier 3)*

### Documentation

- [ ] **DOCS-01**: `SECURITY.md` written with vulnerability disclosure path. *(Tier 1)*
- [ ] **DOCS-02**: Threat model documented (STRIDE or attacker-goal-driven). *(Tier 1)*
- [ ] **DOCS-03**: `PRODUCTION-READINESS.md` reconciled against `.planning/audit/PRODUCTION_READINESS_AUDIT.md` (16 divergence rows). *(Tier 3)*
- [ ] **DOCS-04**: Onboarding rewrite — `≤30 min from clone to running locally` verified by uninvolved developer. *(Tier 3)*
- [ ] **DOCS-05**: Faucet README written (with launch-policy decision baked in per Open Question Q1). *(Tier 3)*

### Mainnet Dress Rehearsal

- [ ] **MAINNET-01**: Full E2E from clean clone → local stack → testnet flow exercised before mainnet code freeze. *(Tier 1)*
- [ ] **MAINNET-02**: Chaos test — kill each service in turn, verify recovery + alerts fire. *(Tier 1)*
- [ ] **MAINNET-03**: Audit firm engaged with code in post-CRYPTO-01 / post-SEC-01 state; remediation cycle closed. *(Tier 0 dependency)*

## v2 Requirements

Deferred to post-mainnet milestone.

### Multi-tenant / Whitelabel
- **WL-01**: Whitelabel deployment surface
- **WL-02**: Per-tenant config isolation

### Mobile
- **MOBILE-01**: Native iOS app
- **MOBILE-02**: Native Android app

### Advanced Trading
- **ADV-01**: Stop-loss / take-profit
- **ADV-02**: Limit order book UI improvements
- **ADV-03**: TWAP / DCA features

## Out of Scope

| Feature | Reason |
|---------|--------|
| Cross-chain bridges beyond Lunes-native assets | Separate product surface; current bridge is intra-chain only |
| DEX aggregator routing across other DEXes | Lunex is a primary venue, not an aggregator |
| Custodial wallet | Non-custodial by design; keys stay client-side |
| Off-chain order book / matching | Settlement is on-chain via `spot_settlement` |
| Native mobile (iOS/Android) | Web-only for v1; PWA acceptable |
| Multi-tenant whitelabel | Post-mainnet question |
| Token launch / fundraising features | IDO/launchpad out of scope for this milestone |
| Migration of TS code to another language | Stack frozen for this milestone |

## Traceability

Populated by `gsd-roadmapper` on 2026-05-21. Each REQ-ID maps to exactly one phase.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CRYPTO-01 | Phase 5 | Pending |
| CRYPTO-02 | Phase 5 | Pending |
| FIN-01 | Phase 1 | Pending |
| FIN-02 | Phase 1 | Pending |
| FIN-03 | Phase 1 | Pending |
| FIN-04 | Phase 1 | Pending |
| FIN-05 | Phase 1 | Pending |
| SEC-01 | Phase 2 | Pending |
| SEC-02 | Phase 2 | Pending |
| SEC-03 | Phase 2 | Pending |
| SEC-04 | Phase 2 | Pending |
| API-01 | Phase 3 | Pending |
| API-02 | Phase 3 | Pending |
| API-03 | Phase 3 | Pending |
| API-04 | Phase 3 | Pending |
| FE-01 | Phase 4 | Pending |
| FE-02 | Phase 4 | Pending |
| FE-03 | Phase 4 | Pending |
| FE-04 | Phase 4 | Pending |
| FE-05 | Phase 4 | Pending |
| FE-06 | Phase 4 | Pending |
| FE-07 | Phase 4 | Pending |
| FE-08 | Phase 4 | Pending |
| FE-09 | Phase 4 | Pending |
| FE-10 | Phase 4 | Pending |
| CONTRACT-01 | Phase 5 | Pending |
| CONTRACT-02 | Phase 5 | Pending |
| CONTRACT-03 | Phase 5 | Pending |
| CONTRACT-04 | Phase 5 | Pending |
| INFRA-01 | Phase 6 | Pending |
| INFRA-02 | Phase 7 | Pending |
| INFRA-03 | Phase 7 | Pending |
| INFRA-04 | Phase 6 | Pending |
| INFRA-05 | Phase 6 | Pending |
| INFRA-06 | Phase 6 | Pending |
| OBS-01 | Phase 8 | Pending |
| OBS-02 | Phase 8 | Pending |
| OBS-03 | Phase 8 | Pending |
| OBS-04 | Phase 8 | Pending |
| OBS-05 | Phase 8 | Pending |
| OBS-06 | Phase 8 | Pending |
| CI-01 | Phase 6 | Pending |
| CI-02 | Phase 6 | Pending |
| CI-03 | Phase 6 | Pending |
| CI-04 | Phase 10 | Pending |
| DOCS-01 | Phase 9 | Pending |
| DOCS-02 | Phase 9 | Pending |
| DOCS-03 | Phase 0 | Pending |
| DOCS-04 | Phase 9 | Pending |
| DOCS-05 | Phase 9 | Pending |
| MAINNET-01 | Phase 10 | Pending |
| MAINNET-02 | Phase 10 | Pending |
| MAINNET-03 | Phase 10 | Pending |

**Coverage:**
- v1 requirements: **53 total** by category sum (CRYPTO×2, FIN×5, SEC×4, API×4, FE×10, CONTRACT×4, INFRA×6, OBS×6, CI×4, DOCS×5, MAINNET×3). Prior header stated "47" — header was stale; category sum is authoritative.
- Mapped to phases: **53** ✓
- Unmapped: **0** ✓

---

*Requirements defined: 2026-05-21*
*Last updated: 2026-05-21 — traceability populated by gsd-roadmapper*
