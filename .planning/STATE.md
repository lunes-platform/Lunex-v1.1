# Project State: Lunex

**Last updated:** 2026-05-21
**Milestone:** Mainnet launch readiness
**Core Value:** Custody-grade correctness at every fund-moving step

## Project Reference

Lunex is a decentralized exchange on the Lunes Substrate-based blockchain. The system spans 13 ink! smart contracts, a TypeScript orchestration backend (`spot-api`), a Next.js admin panel (`lunex-admin`), a Vite+React DEX UI (`lunes-dex-main`), a client SDK, an MCP server, a SubQuery indexer, and a faucet. Production runs on PM2 + nginx VPS with Docker Compose for non-prod; Doppler for secrets; Prometheus + Grafana + Loki + Alertmanager for observability.

**Current focus:** Brownfield production-readiness milestone driven by the 2026-05-21 consolidated audit (`.planning/audit/PRODUCTION_READINESS_AUDIT.md`). 11-phase roadmap starting with cheap truth-up and ending with a full dress rehearsal.

## Current Position

- **Phase:** 0 (Truth-up & Reconciliation) — not started
- **Plan:** none yet
- **Status:** Roadmap drafted, awaiting plan generation
- **Progress:** [░░░░░░░░░░░░░░░░░░░░] 0% (0 of 11 phases complete)

## Performance Metrics

| Metric | Baseline (2026-05-21) | Target | Delta |
|---|---|---|---|
| Contract unit tests passing | 282 / 282 (8 ignored) | 290 / 290 (0 ignored) | Phase 5 unignores 8 router math tests |
| spot-api unit tests passing | 194 / 194 across 23 suites | ≥194 + new finality/guards/SDK tests | Phases 1, 2, 3 add tests |
| Frontend automated tests | 0 / 0 | ≥10 smoke (admin + dex) | Phase 4 |
| `lunex-admin` lint exit code | 0 (with 3 errors + 2 warnings) | non-zero on findings | Phase 0 |
| Tier 0 blockers open | 9 | 0 | Phases 1, 2, 5, 6, 7 close them |
| `isInBlock` references on fund paths | 3 (rewardPayout×2 + rebalancer×1) | 0 | Phase 1 |
| `//Alice` reachable in prod code | ≥5 sites (bridge, faucet, scripts, env.example, standalone) | 0 | Phase 2 |
| Runbooks with real URLs | 0 (`your-org` placeholder) | 13 | Phase 7 |
| Backups successfully restored in test | 0 | nightly CI | Phase 7 |
| Canonical API docs | 4 (none match code) | 1 (OpenAPI from Zod) | Phase 3 |
| SDK calls hitting real endpoints | 9 / 36 | 36 / 36 | Phase 3 |

## Accumulated Context

### Key Decisions (carried from PROJECT.md)

| Decision | Rationale | Status |
|---|---|---|
| Tests-first audit methodology | Avoid confirmation bias; measure code vs intended behavior | Done (surfaced ~30 blockers, 7 not previously in CONCERNS) |
| GSD quality profile (Opus) + all workflow agents enabled | DEX with real funds = correctness over speed | Active |
| 11-phase roadmap starting with Truth-up | Cheap reconciliation unblocks every downstream phase | Written (2026-05-21) |
| Mainnet blocker = correctness + secrets + finality + custody | Per Core Value | Active |
| `lunex-admin` repo strategy (absorb vs locked submodule) | Either restores parent CI visibility | Open — Phase 0 closes Q2 |

### Open Questions (resolved in Phase 0)

1. Faucet at mainnet — public feature or testnet-only? (drives Phase 2 SEC-03 + Phase 9 DOCS-05)
2. `lunex-admin` — absorb or git submodule with locked SHA? (drives Phase 6 INFRA-01)
3. SDK audience — public npm or internal-only? (drives Phase 3 urgency)
4. Bridge at launch — enabled or staged? (softens Phase 2 SEC-01 classification if staged)
5. Polish reclassification — is CSP/i18n/a11y truly non-blocking given admin holds emergency-pause? (Phase 4)
6. Canonical API doc choice — fresh OpenAPI from Zod, or seed from one of the 4? (Phase 3)
7. Relayer key strategy — HSM/KMS only at mainnet, or threshold/multi-relayer required? (Phase 5 CRYPTO-02 + downstream T1-18)

### External Dependencies (track outside the phase critical path)

- **Lunes pallet-contracts** must expose `seal_sr25519_verify` for `CRYPTO-01` body swap. If chain team is blocked at Phase 5 time, fall back to off-chain attestation interim per `CRYPTO-02`.
- **Security audit firm** engagement (Halborn / Trail of Bits / OpenZeppelin / CertiK). Handoff must occur post-Phase 1 (no `isInBlock` on fund paths) and post-Phase 2 (no `//Alice` reachable). Sign-off is `MAINNET-03`, closed in Phase 10.

### Active Todos / Blockers

- None yet (pre-Phase 0).

## Session Continuity

- Last session: 2026-05-21 — roadmap drafted from audit, requirements traceability updated, STATE.md initialized.
- Next session start: run `/gsd:plan-phase 0` to generate Phase 0 plans (PRODUCTION-READINESS reconciliation, admin lint exit-code fix, Open Question resolution write-up, AGENTS.md pointer cleanup).
- Working tree state: `.planning/ROADMAP.md`, `.planning/STATE.md`, `.planning/REQUIREMENTS.md` updated; no code changes.

## Verification Notes

- Coverage validated: 53 / 53 v1 REQ-IDs mapped to exactly one phase. (REQUIREMENTS.md header previously stated "47" — reconciled to actual category-sum count of 53.)
- Goal-backward checks passed for each phase (2-5 observable criteria, no implementation tasks framed as criteria).
- No `isInBlock` on fund paths is an explicit success criterion in Phase 1, Phase 3 (regression), and Phase 10 (final check).
- Tier 0 / Tier 1 phases all include test-coverage criteria; no T0/T1 phase ships untested.

---

*State initialized 2026-05-21 by gsd-roadmapper following audit-driven brownfield phase derivation.*
