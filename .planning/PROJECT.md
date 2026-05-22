# Lunex

## What This Is

Lunex is a decentralized exchange (DEX) built on the **Lunes** Substrate-based blockchain. The system spans **13 ink! smart contracts** (factory, pairs, router, settlement, copy-trading vaults, staking, rewards, liquidity locks, bridge), a **TypeScript orchestration backend** (`spot-api`), a **Next.js admin panel** (`lunex-admin`), an **end-user trading UI** (`lunes-dex-main`), a **client SDK**, an **MCP server** exposing trading tools to AI agents, a **SubQuery indexer**, and a **faucet**. Production deployment uses PM2 + nginx on a VPS, with Docker Compose variants for dev/testnet/sandbox. Secrets are managed via Doppler; observability runs on Prometheus + Grafana + Loki + Alertmanager.

## Core Value

**Custody-grade correctness at every fund-moving step.** A DEX that loses, double-spends, or finalizes-then-reverts user funds is finished — every other concern (performance, UX polish, feature scope) is downstream of this.

## Requirements

### Validated

<!-- Existing capabilities — shipped and relied upon. Confirmed by 2026-05-21 codebase audit. -->

- ✓ ink! contract suite compiles and 282/282 unit tests pass on workspace — existing
- ✓ spot-api Express service running with 194/194 unit tests passing — existing
- ✓ Polkadot signature auth (sr25519 + nonce + Redis strict-prod + timing-safe Bearer + XFF defense) — existing
- ✓ NextAuth Credentials admin auth wired to spot-api — existing
- ✓ MCP server stdio interface with ~52 tools exposing spot/social/copytrade surface — existing
- ✓ SubQuery indexer with 11-entity schema indexing chain events — existing
- ✓ Prometheus metrics + Grafana dashboards + Loki log aggregation deployed — existing
- ✓ Doppler secrets management (`lunex-dex/production` scope) + gitleaks scanning on CI — existing
- ✓ Nightly cargo-fuzz schedule + RC release pipeline + TLS termination at edge — existing
- ✓ docker-compose variants for dev/prod/testnet/sandbox/doppler + PM2 ecosystem — existing
- ✓ settlementService and copyVaultService correctly gate on `isFinalized` (post-April finality migration) — existing

### Active

<!-- Production-readiness gaps from 2026-05-21 audit. Building toward all of these for mainnet launch. -->

**Tier 0 — Mainnet blockers (cannot ship without)**
- [ ] T0-CRYPTO-001: Implement real `verify_order_signature` (sr25519 on-chain) — currently no-op (`spot_settlement/lib.rs:1138`)
- [ ] T0-SECRETS-001: Remove `//Alice` fallback from `assetBridgeService.ts:466` + expand `productionGuards` to refuse boot if `BRIDGE_ADMIN_SEED`/`FACTORY_CONTRACT_ADDRESS`/`TREASURY_ADDRESS`/`STAKING_CONTRACT_ADDRESS`/`LUNES_WS_URL` are unset or non-prod values
- [ ] T0-FINALITY-001: Migrate `rewardPayoutService:447,498` + `rebalancerService:423` + `emergencyService:242` from `isInBlock` to `isFinalized` only on fund-moving paths
- [ ] T0-UI-001: Remove fake hardcoded `balance × 0.045` USD price and fake lUSDT=0 line in `ConnectWallet.tsx:131-149`
- [ ] T0-SDK-001: Fix 27/36 SDK calls hitting non-existent endpoints — reconcile against actual spot-api routes
- [ ] T0-API-001: Reconcile API surface — 149 real endpoints vs 4 specs documenting phantom `/factory/`, `/v2/public/`, `/router/`, `/auth/` namespaces; publish single source of truth (OpenAPI)
- [ ] T0-INFRA-001: Restore `lunex-admin` to parent-repo SHA visibility (either absorb or git submodule with locked commit) — current gitignored nested `.git` means parent rollback does NOT roll admin back
- [ ] T0-OPS-001: Write runbooks (chain halt, bridge desync, indexer lag, DB restore) — Prometheus alerts reference `your-org/...runbooks/` paths that do not exist
- [ ] T0-BACKUP-001: Implement + test Postgres PITR (current backups are untested)
- [ ] T0-FAUCET-001: Add captcha + persistent state + remove `//Alice` initial funding from faucet (or make testnet-only and lock from mainnet)

**Tier 1 — High severity (required for healthy mainnet)**
- [ ] T1-TEST-001: Un-`#[ignore]` 8 router math tests (`router/lib.rs:1710-2145`) and make them pass in CI
- [ ] T1-TEST-002: Replace 4 `#[cfg(not(test))]` gates with mockable contract clients (`copy_vault::swap_through_router`, `liquidity_lock::withdraw`, `staking::execute_proposal` transfer, staking test-constants alignment)
- [ ] T1-TEST-003: Implement `copy_vault` fuzz target (currently empty body)
- [ ] T1-FE-001: Add smoke test suite (Playwright) for both frontends — zero automated tests today
- [ ] T1-SEC-001: Set strict CSP in `next.config.ts` and nginx — remove `unsafe-inline`/`unsafe-eval`; add security headers to admin
- [ ] T1-SEC-002: Set `session.maxAge` on NextAuth admin (currently 30d JWT default for emergency-pause panel)
- [ ] T1-ENV-001: Reconcile `lunex-admin/.env.example` vs code (`NEXTAUTH_SECRET` vs `AUTH_SECRET`, `NEXT_PUBLIC_API_URL` vs `SPOT_API_URL`, `ADMIN_API_SECRET` vs `ADMIN_SECRET`)
- [ ] T1-CI-001: Replace `npm install` with `npm ci` in all workflows; upgrade `deploy.yml` to Node 20 (other workflows already on 20)
- [ ] T1-INFRA-001: Add healthchecks to 12/20 unhealthy docker-compose services + set resource limits
- [ ] T1-OBS-001: Define missing `lunex_last_backup_age_seconds` metric referenced by alert; add indexer-lag scrape + alert
- [ ] T1-DOCS-001: Write `SECURITY.md` + threat model + vulnerability disclosure path

**Tier 2 — Medium severity (fix before mainnet, hotfix-able if missed)**
- [ ] T2-LINT-001: Make `lunex-admin` lint exit non-zero on errors (currently 3 errors + 2 warnings exit 0)
- [ ] T2-PERF-001: Code-split `pages/docs/index.tsx` (3417 LOC statically imported); reduce DEX first-paint from 2.65MB raw / 816kB gzip
- [ ] T2-FE-002: Add wallet provider chooser (`connectWallet(walletSource?)` arg is currently dead)
- [ ] T2-FE-003: Surface tx fee estimate (`paymentInfo`/`partialFee`) in swap UI
- [ ] T2-FE-004: Adopt i18n library (currently mixed pt-BR/English hardcoded strings)
- [ ] T2-VER-001: Resolve `@polkadot/api` 10.x vs 16.5.3 skew, React 18 vs 19, ESLint 7 vs 8, ink! 4.2.1 vs 4.3.0 vs 4.3
- [ ] T2-XFF-001: Fix `x-forwarded-for[0]` unconditional read in login rate-limiter (XFF-spoof)
- [ ] T2-IMG-001: Pin docker image SHAs (no `latest` fallback); remove `prisma migrate deploy` race between Dockerfile CMD and `deploy.yml`
- [ ] T2-CI-002: Make Trivy CI gate (`exit-code: '1'` not `'0'`); deduplicate `pr-check.yml`/`pr-checks.yaml`
- [ ] T2-ENV-002: Remove `.env` files from `.next/standalone` build output

**Tier 3 — Quality & hygiene**
- [ ] T3-DOCS-001: Truth-up `PRODUCTION-READINESS.md` (test counts, lint exit codes, dead SDK retry hardening claims)
- [ ] T3-DOCS-002: Onboarding rewrite — ≤30 min from clone to running locally
- [ ] T3-DOCS-003: Cross-reference API/contract docs against code; remove phantom endpoint specs
- [ ] T3-OBS-002: Version-control Grafana dashboards
- [ ] T3-CI-003: Schedule chaos + restore drills (quarterly)

### Out of Scope

- **Cross-chain bridges beyond Lunes-native assets** — bridging to EVM/Solana is a separate product surface; current bridge is intra-chain asset operations
- **DEX aggregator routing across other DEXes** — Lunex is a primary venue, not an aggregator
- **Custodial wallet feature** — non-custodial by design; private keys stay client-side
- **Off-chain order book / matching** — settlement is on-chain via `spot_settlement` contract
- **Native mobile apps (iOS/Android)** — web-only for v1; PWA acceptable
- **Multi-tenant whitelabel** — single deployment; whitelabel is post-mainnet question
- **Token launch / fundraising features** — IDO/launchpad is out of scope for this milestone

## Context

**Codebase intelligence (2026-05-21):**
- Monorepo with Rust `Cargo.toml` workspace + Yarn at root + per-package npm
- Rust 1.85.0 stable pinned; rustfmt requires nightly (config quirk)
- 7 TypeScript subprojects: `spot-api` (Express), `lunex-admin` (Next.js 16), `lunes-dex-main` (Vite + React 18), `sdk`, `mcp/lunex-agent-mcp`, `subquery-node`, `faucet`
- PostgreSQL 15 + Redis backing services; Prisma ORM shared between spot-api and admin
- Authentication is fragmented across 4 surfaces: NextAuth Credentials (admin), Polkadot signature (spot-api public), API key (machine clients), admin secret (privileged ops)
- 5 audits completed 2026-05-21 covering contracts, spot-api, frontends, infra, docs/SDK/MCP — findings in `.planning/audit/`
- Consolidated audit at `.planning/audit/PRODUCTION_READINESS_AUDIT.md` lists 9 Tier 0 blockers, ~30 total

**Operational state:**
- VPS-hosted prod (PM2 + nginx) with Docker Compose for non-prod environments
- Doppler scope `lunex-dex/production` holds secrets
- Nightly cargo-fuzz CI; release-candidate pipeline tagged
- Outstanding items in `PRODUCTION-READINESS.md` (9.5KB) — many already covered, several misreported as done (see Reconciliation in consolidated audit)

**Why now:**
- Project is approaching mainnet launch
- April 2026 finality migration left 3 fund-moving paths still on `isInBlock` (silent regression risk)
- SDK and API documentation drift means external integrators cannot rely on docs
- Audit-firm engagement requires code in audit-ready state (cannot present `verify_order_signature` no-op)

## Constraints

- **Tech stack — frozen for this milestone:** ink! contracts on Lunes Substrate, TypeScript backend, Next.js 16 admin, Vite/React 18 DEX UI. No framework migrations during stabilization push.
- **Security — non-negotiable:** No code touching fund movement ships without `isFinalized` gating + reproducible tests covering the signed paths. No `//Alice` keys reachable in any production codepath.
- **Backwards compatibility — API contract:** External SDK consumers may already be in the wild; endpoint renames require deprecation window even if existing docs are wrong (verify ownership first).
- **Timeline — sequenced, not parallel-only:** Tier 0 must precede mainnet announcement. Tier 1 should land within 30 days of Tier 0. Tier 2/3 can extend post-launch hotfix cycle.
- **External dependency — `verify_order_signature`:** Requires Lunes pallet-contracts to expose `seal_sr25519_verify`. If chain team is blocked, plan alternative (off-chain attestation + on-chain check) before assuming this lands.
- **External dependency — security audit firm:** Engagement and remediation cycle is on the critical path; Tier 0 code-side fixes must precede audit handoff.
- **Resources — small team:** Plan parallel phases only where they touch disjoint files/services.
- **Compliance — Brazilian regulatory landscape:** DEX legal posture varies; user-facing claims and KYC posture must be reviewed before launch announcement.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Tests-first audit methodology (derive specs from docs before reading code) | Avoid confirmation bias — measure code against intended behavior, not vice versa | ✓ Good — surfaced ~30 blockers including 7 not in CONCERNS.md |
| GSD config: Quality profile (Opus) + all workflow agents enabled | DEX with real funds = correctness over speed; cost is justified | — Pending |
| Phase structure: 11 phases starting with "Truth-up" (cheap, unblocks all) | Phase 0 reconciles PRODUCTION-READINESS.md claims so downstream phases plan against reality | — Pending (roadmap not yet written) |
| Mainnet blocker = correctness + secrets + finality + custody | Per Core Value: a DEX that loses funds is finished | — Pending |
| `lunex-admin` repo unification: TBD (absorb vs locked-submodule) | Either approach restores CI coverage; absorb is simpler, submodule preserves history | — Pending (Open Question for product owner) |

## Open Questions (from audit synthesis)

These need product-owner resolution before/during planning:

1. **Faucet at mainnet:** Is faucet a public mainnet feature, or testnet-only? Drives scope of Tier 0 faucet hardening.
2. **`lunex-admin` repo:** Absorb back into parent monorepo, or convert to proper git submodule with locked SHA?
3. **SDK audience:** Is the published SDK for external integrators (public contract) or internal-only (free to rename endpoints)?
4. **Bridge at launch:** Is the asset bridge a launch feature, or post-launch?
5. **Canonical API doc choice:** Of the 4 conflicting API spec docs, which (if any) should be the seed for the OpenAPI of record?
6. **Relayer balance threshold:** What's the minimum SOL/lUSDT balance that should page on-call?
7. **Polish reclassification:** Are i18n / wallet picker / fee estimate launch-blocking or post-launch polish?

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-21 after initialization (brownfield with tests-first audit)*
