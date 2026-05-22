# Lunex Production Readiness — Consolidated Audit
*Date: 2026-05-21 | Method: tests-first parallel audit across 5 domains*

Synthesises the five domain audits (`CONTRACTS.md`, `SPOT_API.md`, `FRONTEND.md`, `INFRA.md`, `DOCS_SDK_MCP.md`) and reconciles them against `PRODUCTION-READINESS.md` (2026-04-28) and `.planning/codebase/CONCERNS.md` (2026-05-21).

---

## Executive Summary

- **Specs derived:** ~140 across the 5 audits (13 contracts × ~5 SPECs + 53 spot-api SPECs + 37 frontend SPECs + ~25 infra SPECs + ~22 docs/SDK/MCP/indexer SPECs).
- **Test runs (today, 2026-05-21):**
  - Smart contracts: **282 passed / 0 failed / 8 ignored** (router math is the 8).
  - spot-api unit: **194 passed / 0 failed** across 23 suites (`tsc` clean, `quality` clean).
  - lunex-admin: tsc clean, build OK, lint emits **3 errors + 2 warnings AND exits 0**.
  - lunes-dex-main: tsc + vite build OK; lint clean; **zero tests**.
  - SDK / MCP / faucet / subquery-node: **zero or near-zero unit tests** per package.
- **Production blockers by severity:** Tier 0 = **9**, Tier 1 = **18**, Tier 2 = **17**, Tier 3 = **12**.
- **Doc-vs-code drift items:** ≥10 explicit (4 API specs disagree with each other and with code; SDK 75% broken vs server; PRODUCTION-READINESS test counts off; lunex-admin invisible to parent CI; alert-rule runbook URLs are placeholders; CHANGELOG ~50 days behind).
- **Top 3 immediate risks to mainnet:**
  1. **Relayer key compromise = full settlement drain.** `verify_order_signature` is a no-op on-chain (`spot_settlement/lib.rs:1138`) pending Lunes pallet-contracts upgrade — the entire spot vault rests on one off-chain seed.
  2. **Silent fund loss via reorg between `isInBlock` and `isFinalized`.** Reward payouts and rebalancer still mark DB rows complete on `isInBlock` (`rewardPayoutService.ts:447,498`, `rebalancerService.ts:423`) — a reorg double-credits or loses real LUNES.
  3. **No production runbooks exist.** Alert annotations point at `https://github.com/your-org/lunex/blob/main/docs/runbooks/...` (literal placeholder) — operators paged at 3 a.m. have no documented response, no backup restore has ever been tested, indexer lag has no alert.

---

## Verification Snapshot

| Domain | Specs (count) | Covered | Partial | Missing | Drifted |
|--------|-------|---------|---------|---------|---------|
| Smart Contracts | 50 | 38 | 8 | 2 | 2 |
| spot-api | 53 | 44 | 2 | 5 | 2 |
| Frontends (admin + dex) | 37 | 16 | 6 | 9 | 6 |
| Infrastructure | 27 | 11 | 9 | 3 | 4 |
| Docs / SDK / MCP / Indexer | 22 | 5 | 7 | 6 | 4 |
| **TOTAL** | **189** | **114** | **32** | **25** | **18** |

(Counts approximate — sourced from the per-domain matrices; status is the auditor's classification, not a binary pass/fail.)

---

## Critical Path to Production

### TIER 0 — Mainnet Blockers (CANNOT ship without)

#### T0-1. `verify_order_signature` is a no-op on-chain  *(external blocker)*
- **Domain:** contracts
- **Evidence:** `Lunex/contracts/spot_settlement/lib.rs:1138-1148` (only rejects all-zero signature; source comment documents the gap)
- **Risk:** Catastrophic / certain on relayer compromise. Single private key (`RELAYER_SEED`) controls the entire spot vault. Compromise → full drain.
- **Acceptance:** Either (a) Lunes pallet-contracts exposes `seal_sr25519_verify` and the function body is replaced + a happy-path + tampered-payload test pass; or (b) interim threshold/multisig scheme on the relayer ships with HSM/KMS and is signed off by an external auditor.

#### T0-2. External audit by ink!/Substrate firm not done  *(external blocker)*
- **Domain:** contracts
- **Evidence:** `PRODUCTION-READINESS.md` Pre-Mainnet Blockers section, item 1.
- **Risk:** Unknown unknowns in 13 ink! contracts handling user funds. 4–8 week external engagement.
- **Acceptance:** Sign-off report from Halborn / Trail of Bits / OpenZeppelin / CertiK against current commit SHA; high/critical findings remediated and re-tested.

#### T0-3. `BRIDGE_ADMIN_SEED` silent fallback to `//Alice`  *(team-closable, ~1h)*
- **Domain:** spot-api / secrets
- **Evidence:** `spot-api/src/services/assetBridgeService.ts:466` — `const adminSeed = process.env.BRIDGE_ADMIN_SEED || '//Alice'`. `productionGuards.ts` does not block this (only `RELAYER_SEED` is guarded). The service has its own `require.main === module` entrypoint at line 490, so the central guard never runs.
- **Risk:** Misconfigured/missing env var in production Doppler → service signs as `//Alice` (publicly-known dev key) → cross-chain wrap/unwrap controllable by anyone.
- **Acceptance:** (i) `|| '//Alice'` removed; (ii) `BRIDGE_ADMIN_SEED` added to `productionGuards.ts` denylist (`//Alice..//Ferdie` + `REPLACE_WITH_*` placeholder); (iii) Jest test in `productionGuards.test.ts` proves the guard fires.

#### T0-4. Reward payout + rebalancer settle on `isInBlock`  *(team-closable, ~4h)*
- **Domain:** spot-api / correctness
- **Evidence:** `rewardPayoutService.ts:447` (native LUNES) + `rewardPayoutService.ts:498` (contract call) + `rebalancerService.ts:423` all `if (txResult.status.isInBlock || txResult.status.isFinalized)`. Pattern in `settlementService.ts:528` and `copyVaultService.ts:162` is the correct one (finalized only).
- **Risk:** Reorg between in-block and finality → DB marks payout complete while chain rolls it back → real LUNES double-credited or lost.
- **Acceptance:** Three `isInBlock` short-circuits removed; finality-only branches in place; new Jest tests assert the code path early-returns when only `isInBlock` is emitted.

#### T0-5. No runbooks exist for paged alerts  *(team-closable, ~3-5 days)*
- **Domain:** infrastructure
- **Evidence:** Alert annotations in `docker/alert-rules.yml` reference `https://github.com/your-org/lunex/blob/main/docs/runbooks/...` — `your-org` is the literal placeholder; `docs/runbooks/` directory does not exist.
- **Risk:** Operator paged for `APIDown`, `BlockchainNodeUnreachable`, `OrderSettlementBacklog`, `DatabaseBackupFailed`, etc. has zero documented response. Mean time to recovery is unbounded.
- **Acceptance:** All 13 runbooks listed in INFRA.md exist under `docs/runbooks/`; alert annotations link to real files; one cold-run incident-drill executed against a runbook before mainnet.

#### T0-6. Backup restore has never been tested  *(team-closable, ~1 day)*
- **Domain:** infrastructure
- **Evidence:** `docker/backup.sh` uploads pg_dump gzip to S3; **no `restore.sh`, no CI restore job, no documented RTO**. Alert `DatabaseBackupFailed` expects `lunex_last_backup_age_seconds` metric which appears **not defined** in `spot-api/src/utils/metrics.ts` (so the alert will never fire).
- **Risk:** A backup that has never been restored is a hope, not a backup. False sense of safety from the never-firing alert.
- **Acceptance:** Nightly CI job pulls latest S3 dump, restores into scratch Postgres, asserts row counts > 0 on key tables. `lunex_last_backup_age_seconds` defined and verified to fire the existing alert in a stage rehearsal.

#### T0-7. lunex-admin invisible to parent CI  *(team-closable, ~½-1 day)*
- **Domain:** frontend / CI / deploy
- **Evidence:** `lunex-admin/.git/` is a nested git repo; parent `.gitignore` excludes `lunex-admin/`. PRODUCTION-READINESS.md's "lunex-admin TypeScript ✓" line was produced from inside the nested repo, not by parent CI. Parent rollback to prior SHA does not roll admin back.
- **Risk:** Two histories drift independently; admin claims are unverifiable from a parent git SHA; deploy reproducibility broken; a regression in admin ships unnoticed by parent CI.
- **Acceptance:** Decision recorded (submodule with pinned SHA OR fold into main tree). Parent CI typecheck+lint+build job for admin exists and is green on the same SHA the rest of the pipeline references.

#### T0-8. Wallet modal shows fake balances and USD price  *(team-closable, ~½ day)*
- **Domain:** frontend (lunes-dex-main)
- **Evidence:** `lunes-dex-main/src/components/wallet/ConnectWallet.tsx:131-133` hardcodes `$0.045` LUNES price; `:140-149` hardcodes lUSDT balance to `0.00` regardless of real on-chain holdings.
- **Risk:** First user to connect a wallet on mainnet sees a fake USD number and a fake zero lUSDT balance. Trust loss is immediate and viral.
- **Acceptance:** Hardcoded values removed; either real balance fetch wired or the line is removed and the spec downgraded. Visual regression test or smoke test asserts no hardcoded `0.045` / `0.00` constants in shipped bundle.

#### T0-9. Mutable image tags + advisory Trivy + double Prisma migrate  *(team-closable, ~1-2 days)*
- **Domain:** infrastructure / supply chain
- **Evidence:** `docker-compose.prod.yml` uses `${IMAGE_TAG:-latest}`; third-party images tag-pinned (`postgres:15-alpine`, `redis:7-alpine`, `grafana:10.4.0`, ...) — **no `@sha256:` digests anywhere**. `deploy.yml` scan-images job sets `exit-code: '0'` → Critical CVEs deploy. `Dockerfile.api:35` runs `prisma migrate deploy` on every container start AND `deploy.yml` runs it in a one-shot — concurrent boots can race on a fresh schema.
- **Risk:** Tag re-publish (or `latest` fallback if SSH export is dropped) → attacker image runs in prod. Critical CVE images deploy with no human gate. Migration race on any scaled rolling restart.
- **Acceptance:** Lunex images pinned to immutable git-SHA tags (no `:latest` fallback); third-party images pinned to `@sha256:` digests; Trivy gate set to `exit-code: '1'` for Critical+High with an explicit allowlist file; `prisma migrate deploy` removed from `Dockerfile.api` CMD (kept only in deploy.yml one-shot).

---

### TIER 1 — High-Severity (Required for healthy mainnet)

#### T1-1. `#[cfg(not(test))]`-gated cross-contract calls have zero CI coverage
- **Domain:** contracts
- **Evidence:** `copy_vault/lib.rs:847` (swap via Router), `liquidity_lock/src/lib.rs:224` (PSP22 transfer), `staking/lib.rs:1137` (env().transfer for refund/treasury split). Plus test-only thresholds `MIN_VOTES_FOR_APPROVAL=1`, `EXECUTION_DELAY_MS=0` (vs prod `10_000` and `48h`).
- **Risk:** Selector encoding / arg packing / return decoding / gas estimates all unverified. A regression ships undetected until testnet deploy.
- **Acceptance:** `tests/integration/` harness wired to `ink-e2e` or local Substrate testnet; covers all three gated paths + a prod-thresholds governance run; nightly CI.

#### T1-2. Router swap math is `#[ignore]`d
- **Domain:** contracts
- **Evidence:** `router/lib.rs:1710,1738,1872,1921,1950,2000,2081,2145` — 8 tests covering `get_amounts_out`, `get_amounts_in`, multi-hop, all `#[ignore]`d.
- **Risk:** The DEX's primary pricing function has zero unit-test CI coverage.
- **Acceptance:** Pure math factored into helpers; ≥8 unit tests on those helpers (single-hop, multi-hop, decimals edge cases) un-ignored and passing.

#### T1-3. `copy_vault` fuzz target is a comment-only stub
- **Domain:** contracts
- **Evidence:** `Lunex/contracts/copy_vault/fuzz/fuzz_targets/fuzz_vault.rs:1-29` — empty `fuzz_target!` body. Root `fuzz/fuzz_targets/copy_vault_accounting.rs` is a parallel `VaultModel` (HashMap), not the contract.
- **Risk:** Largest single pool of user funds has no contract-bound fuzz coverage.
- **Acceptance:** Fuzz target binds to actual `CopyVault` (or runs via ink-e2e); 600s nightly fuzz duration; the existing `VaultModel` invariants are ported over.

#### T1-4. ink! version inconsistency across contracts
- **Domain:** contracts
- **Evidence:** `spot_settlement/Cargo.toml:8` (`ink = "4.3.0"`) and `asymmetric_pair/Cargo.toml:8` (`ink = "4.3"`) vs workspace baseline `4.2.1`.
- **Risk:** Substrate `WeightV2` host-function call shape changed between 4.2 and 4.3; cross-contract metadata may diverge.
- **Acceptance:** All 13 contracts pin to exactly one ink version (either 4.2.1 or 4.3.x); a `cargo deny`-style workspace check enforces this.

#### T1-5. `emergencyService` cannot pause `copy_vault` or `staking`
- **Domain:** spot-api / runbook
- **Evidence:** `emergencyService.ts:132-148` hardcodes `available: false` for `copy_vault` and `staking` with explicit TODO. Runbook depends on raw signer access.
- **Risk:** In an incident, ops cannot pause the largest user-fund-holding contract from the admin panel.
- **Acceptance:** `copy_vault` + `staking` ABIs loaded; pause/unpause + status endpoints wired; admin panel UI exposes them; e2e drill verified.

#### T1-6. SDK 75% broken against current spot-api
- **Domain:** docs / SDK
- **Evidence:** 27 of 36 SDK HTTP calls hit non-existent legacy paths (`/factory/...`, `/router/...`, `/staking/...`, `/wnative/...`, `/auth/nonce`). Only 9 calls match real `/api/v1/...` routes. `sdk/README.md` baseURL example (`https://api.lunex.io/v1`) produces double-prefix bugs.
- **Risk:** Anyone reading the README to integrate the DEX is blocked on day 1; npm publish ships a broken SDK because `prepublishOnly: npm run build && npm test` runs jest with zero test files.
- **Acceptance:** All SDK module calls migrated to `/api/v1/...` and align with real routes (or modules deleted if unsupported); README baseURL corrected; at least one happy-path + one error-path test per module; SDK CHANGELOG documents the migration.

#### T1-7. Four parallel API specs disagree with each other and with code
- **Domain:** docs
- **Evidence:** `docs/API_SPECIFICATION.md` (38 ep, dead `/factory/...` namespace), `docs/PUBLIC_API_SPECIFICATION.md` (32 ep, phantom `/v2/*`), `docs/api/openapi.json` (5 ep, wrong base URL), `docs/API.md` (65 ep, no prefix shown). Code reality: 149 routes under `/api/v1/...` across 22 mounted prefixes.
- **Risk:** No canonical API contract. Integrators (and internal teams) cannot trust any document.
- **Acceptance:** Single canonical OpenAPI 3.x generated from spot-api Zod schemas via `zod-to-openapi`; declared canonical in `AGENTS.md`; stale specs moved to `archive/`; `llms.txt` updated.

#### T1-8. No `SECURITY.md`, no filled threat model
- **Domain:** docs
- **Evidence:** No `/SECURITY.md` at repo root; no vuln-disclosure path in README or CONTRIBUTING; `docs/PRELAUNCH_SECURITY_REVIEW_TEMPLATE.md` is a template, not an instance.
- **Risk:** Public launch with no responsible-disclosure channel. White-hat reports go to /dev/null.
- **Acceptance:** `SECURITY.md` with disclosure email, PGP key, scope, response SLA, safe-harbor; `docs/THREAT_MODEL.md` filled (STRIDE per layer: frontend → spot-api → relayer → contracts → faucet → MCP → indexer).

#### T1-9. SubQuery indexer has no Prometheus scrape, no lag alert
- **Domain:** infra / observability
- **Evidence:** No scrape job for `subquery-node`; no `indexer_last_block` gauge; `socialAnalyticsService` depends on indexer freshness but no SLO.
- **Risk:** Indexer falls silently behind; social/historical/analytics features rot; operators learn from users.
- **Acceptance:** SubQuery exposes `lastProcessedHeight` via metrics endpoint; Prometheus scrape + `IndexerLag > 100 blocks for >5m` alert + runbook entry.

#### T1-10. Healthchecks missing on 12 of 20 compose services
- **Domain:** infra
- **Evidence:** Healthchecks absent on `frontend`, `subquery-query`, `nginx`, `prometheus`, `grafana`, `alertmanager`, `promtail`, `db-backup`, `certbot`, `postgres-exporter`, `redis-exporter`, `nginx-exporter`.
- **Risk:** `depends_on: service_healthy` cannot enforce ordering; Grafana / Alertmanager failure invisible until human checks dashboard.
- **Acceptance:** Healthcheck blocks on every service; deploy verifies all `healthy` before promotion.

#### T1-11. CSP retains `unsafe-inline` + `unsafe-eval`
- **Domain:** infra + frontend
- **Evidence:** `docker/nginx.prod.conf:128,336` allows both for `script-src`. Inner `lunex-admin/next.config.ts` and `lunes-dex-main/nginx.spa.conf` set **no** security headers at all — Vercel/direct-Node deploys ship unprotected.
- **Risk:** XSS containment essentially absent. Particularly bad for admin (emergency-pause authority) and DEX (signs financial txs).
- **Acceptance:** Nonce/hash CSP strategy with no `unsafe-inline`/`unsafe-eval`; `next.config.ts` `headers()` block; `nginx.spa.conf` adds CSP/HSTS/X-Frame/Referrer-Policy; verified across all deploy paths.

#### T1-12. Zero automated tests on either frontend
- **Domain:** frontend
- **Evidence:** `find lunex-admin/src lunes-dex-main/src -name '*.test.*' -o -name '*.spec.*'` → 0 files. README says frontend "test" is `tsc --noEmit`.
- **Risk:** Credentials / rate limiter / role gate / wallet connect / swap / slippage / signing / retry — uncovered.
- **Acceptance:** Vitest or Jest installed on both; minimum 1 happy-path + 1 error-path test for: admin login throttle, admin role gate, dex wallet connect, dex swap quote, dex slippage rejection.

#### T1-13. No session TTL on admin JWT
- **Domain:** frontend (admin)
- **Evidence:** `lunex-admin/src/auth.ts` declares no `session.maxAge` or `jwt.maxAge`; NextAuth default is 30 days.
- **Risk:** Stolen JWT for emergency-pause-capable admin lives 30 days.
- **Acceptance:** `session.maxAge ≤ 8h` with rolling refresh; reauth required for emergency actions.

#### T1-14. Wallet provider chooser missing in DEX UI
- **Domain:** frontend (lunes-dex-main)
- **Evidence:** `SDKContext.tsx:271-307` accepts any extension via `web3Enable`; `ConnectWallet.tsx` has no UI to pick SubWallet / Talisman / Nova / Polkadot.js — the `walletSource` parameter is dead.
- **Risk:** README and INTEGRATIONS promise multi-wallet; UI defaults to first account of first source. Users with multiple extensions get unpredictable behavior.
- **Acceptance:** UI chooser exposes installed extensions and persists choice; manual smoke test across the four named wallets.

#### T1-15. Doppler is single point of failure for secrets
- **Domain:** infra
- **Evidence:** `.doppler.yaml` binds the only production secret source for `ecosystem.config.js`; `docker-compose.doppler.yml` exists but requires Doppler live during deploy. No documented fallback.
- **Risk:** Doppler outage + container restart = production stays down.
- **Acceptance:** Documented SOPS-encrypted emergency-only fallback bundle; rotation/access policy; tested fail-over runbook.

#### T1-16. Backup gaps beyond restore-untested (PITR, Redis AOF off-host, etc.)
- **Domain:** infra
- **Evidence:** No WAL archiving (logical pg_dump only) → no PITR; Redis AOF only on local volume (nonce store + rate limit state lost on host loss); Prometheus TSDB + Loki chunks + Grafana DB on local volumes only; no backup integrity test (`gzip -t`/`pg_restore --list`); no cross-region S3.
- **Risk:** Transactions between 01:00 UTC dumps unrecoverable; nonce replay window after host loss; observability history lost on host loss.
- **Acceptance:** WAL archiving to S3; nightly TSDB snapshot; documented Redis AOF backup; restore integrity check step in `backup.sh`.

#### T1-17. Doc/code drift: PRODUCTION-READINESS test counts, lint exit code, CHANGELOG
- **Domain:** docs
- **Evidence:** see "PRODUCTION-READINESS.md Reconciliation" below.
- **Risk:** Team cannot trust its own claims; every "✓" needs re-verification.
- **Acceptance:** PRODUCTION-READINESS.md re-numbered against today's test runs; CHANGELOG `[Unreleased]` captures 2026-04-28 hardening + 2026-05-21 audit findings; `lunex-admin npm run lint` script gets `--max-warnings=0`.

#### T1-18. Single relayer key (CONCERNS #24)
- **Domain:** spot-api / contracts
- **Evidence:** `settlementService.ts:187` — single `RELAYER_SEED`. With T0-1 unresolved, this key IS the trust assumption.
- **Risk:** Same blast radius as T0-1; relayer compromise = settlement drain.
- **Acceptance:** HSM/KMS guidance documented + executed; multi-relayer threshold scheme or hardware-rooted signer; key-rotation runbook.

---

### TIER 2 — Medium-Severity (Should be fixed before mainnet, can be hotfixed if missed)

#### T2-1. `productionGuards` misses FACTORY/TREASURY/STAKING addresses + `LUNES_WS_URL`
- **Evidence:** `productionGuards.ts` does not check `FACTORY_CONTRACT_ADDRESS`, `TREASURY_ADDRESS` (when rewards on), `STAKING_CONTRACT_ADDRESS` (when rewards on), or refuse `ws://127.0.0.1:9944` for `LUNES_WS_URL`.
- **Risk:** Service boots in production with cryptic downstream errors instead of refusing to start.
- **Acceptance:** Extend `collectProductionConfigErrors`; cover each in `productionGuards.test.ts`.

#### T2-2. Two-step ownership transfer only on `spot_settlement`
- **Evidence:** Pattern exists at `spot_settlement/lib.rs:1019` (`accept_ownership` + cancel). Not verified on the other 12 contracts.
- **Risk:** Typo-locked admin key on `copy_vault`, `staking`, `factory`, `listing_manager`, `rewards`.
- **Acceptance:** Two-step pattern + tests propagated to all admin-holding contracts.

#### T2-3. `emergencyService.runSpotPauseTx` accepts `isInBlock`
- **Evidence:** `emergencyService.ts:242` — same `isInBlock || isFinalized` pattern (pause not fund-moving but inconsistent).
- **Acceptance:** Drop `isInBlock`; one Jest test asserts behavior.

#### T2-4. Cancel signature lacks embedded timestamp (CONCERNS #60)
- **Evidence:** `spot_settlement::cancel_order` cancel-by-relayer signature has no timestamp; replayable indefinitely. The orphan helper `buildSpotCancelMessage` (auth.ts:104) is dead code (cancel route uses `verifyWalletActionSignature` which IS safe); risk is regression.
- **Acceptance:** Delete dead helper; add timestamp to canonical `build_cancel_message` for relayer-side cancels; reject older than N seconds.

#### T2-5. Reentrancy regression test gap for `spot_settlement`
- **Evidence:** Lock pattern exists (`lib.rs:313-321`) but no test asserts `Err(SpotError::Reentrancy)` via a malicious PSP22 mock that calls back into `deposit_psp22` during `transfer_from`.
- **Acceptance:** Mock test added.

#### T2-6. Test thresholds in `staking` diverge sharply from production
- **Evidence:** `MIN_VOTES_FOR_APPROVAL=1` (test) vs `10_000` (prod); `EXECUTION_DELAY_MS=0` (test) vs `48h` (prod).
- **Acceptance:** Feature-flagged or `--cfg prod_thresholds` suite runs governance under prod constants.

#### T2-7. Login rate limit reads spoofable `x-forwarded-for[0]`
- **Evidence:** `lunex-admin/src/app/login/actions.ts:14-20` — no TRUST_PROXY allowlist; spot-api `requireAdminOrInternal` is hardened against XFF spoofing but the admin login surface is not.
- **Acceptance:** Trusted-proxy allowlist; matching defense to spot-api.

#### T2-8. NextAuth pinned to v5 beta.30
- **Evidence:** `next-auth ^5.0.0-beta.30` in admin `package.json`.
- **Acceptance:** Pin exact version or migrate to GA.

#### T2-9. DEX main bundle 882 kB raw / 203 kB gzip
- **Evidence:** First-paint payload ≈ 2.65 MB raw / 816 kB gzip. `pages/docs/index.tsx` is 3417 LOC and statically imported.
- **Acceptance:** Route-split docs page; main bundle under threshold.

#### T2-10. Tx signing UI omits fee estimate
- **Evidence:** No `paymentInfo`/`partialFee` callers in `lunes-dex-main/src/`.
- **Acceptance:** Pre-broadcast surface shows estimated fee.

#### T2-11. Missing alert rules
- **Evidence:** Per INFRA.md §"Missing Alert Rules" — finality lag, indexer lag, bridge admin balance, relayer balance, copy-vault TVL anomaly, margin liquidation spike, reward distribution lock, Loki/Promtail/Alertmanager self-monitor, blackbox probe failure, reconnect-storm.
- **Acceptance:** Rules added + runbook entries.

#### T2-12. `lunex_last_backup_age_seconds` metric referenced by alert but undefined
- **Evidence:** `DatabaseBackupFailed` alert expects the metric; not defined in `spot-api/src/utils/metrics.ts`.
- **Acceptance:** Metric defined + emitted by `backup.sh` (or removed alert).

#### T2-13. SubQuery handler tests missing
- **Evidence:** Zero `.test.ts` files in `subquery-node/`. Aggregation invariants on `WalletSummary`, `VaultDailyStat`, `DailyProtocolStats` unverified.
- **Acceptance:** Per-handler unit tests on aggregation correctness.

#### T2-14. Faucet hardening (if mainnet feature; see Open Q1)
- **Evidence:** No README, no captcha, in-memory cooldown state (lost on restart), `//Alice` initial funding pattern, no audit log.
- **Acceptance:** README + Turnstile/hCaptcha + persisted state (Redis/Postgres) + treasury-funded path + append-only audit log.

#### T2-15. MCP coverage thin + monolithic file
- **Evidence:** `mcp/lunex-agent-mcp/src/index.ts` is 3,657 lines; only 2 of ~52 tools have dedicated tests.
- **Acceptance:** Per-domain tool registration files; smoke test (schema validation + round-trip) for every tool.

#### T2-16. CI hygiene: duplicate PR workflows, `npm install` not `npm ci`, Node 18 in deploy.yml
- **Evidence:** `.github/workflows/pr-check.yml` and `pr-checks.yaml` coexist; all workflows use `npm install`; `deploy.yml env.NODE_VERSION: '18'` while rest use `'20'`.
- **Acceptance:** Older PR workflow deleted; `npm ci` everywhere; Node 20 across all workflows.

#### T2-17. Resource limits + DB connection pool missing
- **Evidence:** No `deploy.resources` / `mem_limit` / `cpus:` in any compose file; `DATABASE_URL` has no `?connection_limit=`.
- **Acceptance:** Per-service resource limits; `?connection_limit=10&pool_timeout=20` on production DATABASE_URL.

---

### TIER 3 — Quality & Hygiene (Post-launch acceptable but plan for)

- T3-1. React 18 (dex) vs React 19 (admin) skew; ESLint 7/8/9 skew across packages.
- T3-2. Patched `@727-ventures` typechain deps (apparently unmaintained). Long-term replace or fork.
- T3-3. `socialIndexerService.ts` (1446 LOC, 20+ `as any` casts) flagged for review; polling/backoff never analyzed.
- T3-4. `assetBridgeService` uses `console.log/error` instead of pino; logs unstructured.
- T3-5. `lunes-dex-main/test-*.js` scratch files at repo root — delete.
- T3-6. Duplicated `@polkadot/x-global` copies inflate DEX bundle — `npm dedupe`.
- T3-7. `DISABLE_ESLINT_PLUGIN=true` in DEX env (CRA-era dead var).
- T3-8. Hardcoded mixed pt-BR / English strings; no i18n library.
- T3-9. Full WCAG accessibility sweep deferred per PRODUCTION-READINESS.
- T3-10. Modal in `ConnectWallet.tsx` has no `role="dialog"`/`aria-modal`/focus trap.
- T3-11. Service-level monoliths: `copytradeService.ts` 1921 LOC, `rewardDistributionService.ts` 1318, `marginService.ts` 1144, `contractService.ts` 1376, `docs/index.tsx` 3417.
- T3-12. Nightly fuzz duration 60s (too low). Increase to 600s+ per target.

---

## Cross-Cutting Themes

### CC-1. `//Alice` everywhere — dev-key fallback pattern
The same anti-pattern appears in five places. Treat as one campaign:
- `spot-api/src/services/assetBridgeService.ts:466` — `BRIDGE_ADMIN_SEED || '//Alice'` (Tier 0).
- `faucet/index.js` — `fundFaucetFromAlice` initial funding (Tier 2; depends on Open Q1).
- `/.env.example` — `PRIVATE_KEY=horn horn horn ... ` well-known test mnemonic; gitleaks allowlists `.env.example` so leak detection can never flag it (CONCERNS).
- `spot-api/scripts/*.ts` — every dev script uses `//Alice`/`//Bob`/`//Charlie` with no chainId guard against running on mainnet by accident.
- `lunex-admin/.next/standalone/lunex-admin/.env` — `AUTH_SECRET=REPLACE_WITH_OUTPUT_OF_openssl_rand_base64_32` placeholder ships in the Docker image (bundling behavior is the risk; future build could bake a real value).
**Campaign acceptance:** dev-seed denylist enforced wherever a private key is read; chainId guard at top of every script; gitleaks allowlist tightened; Dockerfile copies `.env` template at runtime, not built version.

### CC-2. Finality discipline is partial
`settlementService.ts:528` and `copyVaultService.ts:162` correctly require `isFinalized`. Three fund-moving paths missed: `rewardPayoutService.ts:447`, `:498`, and `rebalancerService.ts:423` — all still accept `isInBlock`. `emergencyService.ts:242` is also `isInBlock || isFinalized` (lower risk — no fund movement). PRODUCTION-READINESS.md narrative implies the migration was complete; **it was not**.

### CC-3. Test gates obscure unverified code
Three patterns combine to make CI green misleading:
- `#[cfg(not(test))]` gates real cross-contract calls in `copy_vault`, `liquidity_lock`, `staking` (CONTRACTS T1-1).
- `#[ignore]` on the 8 hottest router tests (T1-2).
- Stub fuzz target for `copy_vault` (T1-3).
- Parallel `VaultModel` / `pair_invariant` fuzz at repo root binds to HashMap models, not to deployed contracts.

### CC-4. Documentation cannot be trusted
- PRODUCTION-READINESS test counts diverge from today's runs (CC reconcile table below).
- API surface declared in 4 different documents, **0%** match with code.
- SDK 75% broken vs server.
- Alert annotations point at `your-org` placeholder.
- CHANGELOG `[Unreleased]` lags PRODUCTION-READINESS by ~50 days.
- `AGENTS.md` declares dead docs (`PUBLIC_API_SPECIFICATION.md`, `openapi.json`) as canonical.

### CC-5. Submodule isolation breaks the deployment trust model
`lunex-admin/.git/` + parent `.gitignore: lunex-admin/`. Parent CI sees an empty directory. Single-SHA reproducibility broken. Every "✓ admin" claim is unverifiable from the parent repo.

### CC-6. Observability gaps belie the alert-rule surface
22 alert rules look comprehensive. But: (a) `lunex_last_backup_age_seconds` referenced by `DatabaseBackupFailed` doesn't exist in source → alert never fires; (b) no indexer scrape job → no indexer lag rule; (c) no finality-lag metric (despite the entire settlement story being finality-based); (d) no bridge/relayer balance gauges → silent stops when fees run out; (e) Loki/Promtail/Alertmanager self-monitor missing; (f) Grafana ships one dashboard committed (`lunex-overview.json`) — others would be unversioned if added.

### CC-7. Frontend hygiene (zero tests, fake numbers, headers only at outer nginx)
Zero unit/integration/E2E tests on either frontend. Hardcoded fake balances + USD price in wallet modal. Security headers live only at `docker/nginx.prod.conf`; inner `nginx.spa.conf` and `next.config.ts` set none — any deploy that bypasses the outer prod nginx (Vercel, direct Node) ships unprotected.

### CC-8. `productionGuards` is the right idea, under-applied
`productionGuards.ts` covers `NODE_ENV`, `ADMIN_SECRET`, `CORS`/`WS_ORIGINS`, `RELAYER_SEED` (+ dev-seed denylist), and a few others. Misses `BRIDGE_ADMIN_SEED`, `FACTORY_CONTRACT_ADDRESS`, `TREASURY_ADDRESS`, `STAKING_CONTRACT_ADDRESS`, and `LUNES_WS_URL` non-localhost. Two of these are Tier 0/2 in their own right.

---

## PRODUCTION-READINESS.md Reconciliation

| Claim in PRODUCTION-READINESS.md (2026-04-28) | Audit finding (2026-05-21) | Action |
|---|---|---|
| `spot-api Tests: 323 / 323 passed (40 suites)` | Today: **194 / 194 across 23 suites** (unit only, e2e excluded) | Either ~17 suites are e2e-gated and excluded by the filter, or test surface regressed. Reconcile in CHANGELOG; if regressed, restore. |
| `Smart contracts: 87 / 87 ink! tests across 6 contracts` | Today: **282 passed / 8 ignored across 13 contracts** | Test count grew (good); doc undercounts and lists the wrong 6. Update PRODUCTION-READINESS.md per-contract table. |
| `lunex-admin TypeScript: ✓` | Parent CI cannot see lunex-admin at all (`.gitignore` + nested `.git`). Verification was done from inside the nested repo. | T0-7 above. |
| `lunex-admin lint`: implied ✓ via "TypeScript ✓" | `npm run lint` emits **3 errors + 2 warnings AND exits 0** | T1-17 — add `--max-warnings=0`; fix findings. |
| `settlementService and copyVaultService wait for isFinalized` | True (verified at `settlementService.ts:528`, `copyVaultService.ts:162`). | Statement is true but **implies migration was complete**. Reward + rebalancer still on `isInBlock` — T0-4. Add a Doc errata. |
| `lib/rateLimit.ts ... throttles per IP and per email` (admin) | True, in-memory sliding window — single-node only; XFF spoofable. | T2-7. Doc should call out the limitations. |
| `Cancel rate limit migrated to Redis sliding window` | True at `routes/orders.ts:82-95,109-113`. | OK. |
| `Postgres: synchronous_commit=off removed (returns to on default)` | OK per compose. | OK. |
| `Redis: --appendonly yes --appendfsync everysec` | True; but no off-host AOF snapshot — host loss = full Redis state loss. | T1-16. |
| `Custom Grafana dashboard lunex-overview.json` | Single dashboard committed; promised metrics (finality lag, indexer lag, reward distribution, copy-vault drilldown) not present. | T2-11 + T1-9. |
| `deploy.yml typecheck no longer has \|\| true` | True. But `scan-images` still has `exit-code: '0'` (Trivy report-only), and `npm install` (not `npm ci`) everywhere, and deploy.yml runs Node 18 while rest are 20. | T0-9 + T2-16. |
| `Body parser global limit reduced 5MB → 100KB` | True at `index.ts:209`. | OK. |
| `Production guards extended: NATIVE_TOKEN_ADDRESS required, RELAYER_SEED placeholders rejected, rewardSplitValid` | True. Still misses `BRIDGE_ADMIN_SEED`, `FACTORY_CONTRACT_ADDRESS`, `TREASURY_ADDRESS`, `STAKING_CONTRACT_ADDRESS`, `LUNES_WS_URL` non-localhost. | T0-3 + T2-1. |
| `Pre-Mainnet Non-blocking polish: CSP without unsafe-inline/eval` | Still open at `nginx.prod.conf:128,336`. Classifying it as non-blocking for an admin holding emergency-pause authority is questionable. | Re-classify as T1-11. |
| `SDK: retry hardening with exponential backoff + jitter` | True (`http-client.ts`). But the SDK's HTTP module is calling 27 dead routes — retry hardening on a broken target. | T1-6 — doc should not imply SDK is production-ready. |
| `New entrypoint.sh renders subquery template at container startup` | True. No indexer-lag metric/alert/runbook. | T1-9. |

---

## Verified Production-Ready (positives)

These are solid and should not be regressed:

- **spot-api auth surface** — sr25519 signature + nonce (Redis-strict in prod), 5-min TTL, sorted-field canonical message, timing-safe `ADMIN_SECRET` comparison, XFF spoof defense on `/metrics`, walletRisk allowlist hook before nonce consumption. (`middleware/auth.ts`, `middleware/adminGuard.ts`, `middleware/agentAuth.ts`)
- **Contract tests** — 282/282 passing (8 ignored on router math). All 13 contracts compile and unit-test green.
- **spot-api unit tests** — 194/194 passing today; `tsc --noEmit` clean; `npm run quality` clean (1 dead-export finding).
- **TLS / rate limit / SSL-expiry monitoring at the edge** — nginx terminates TLS, certbot renew loop, `api_global` 60r/m / `api_orders` 10r/s / `api_auth` 5r/m zones, blackbox SSL probes + alert rules.
- **CSP + HSTS preload at outer nginx** (though see T1-11 for `unsafe-inline` weakness).
- **gitleaks** — push + PR + nightly cron with custom rules for substrate seed phrases. (Allowlist gap noted in CC-1.)
- **Nightly fuzz pipeline** — `pair_invariant`, `copy_vault_accounting`, `spot_settlement_replay` runs 02:00 UTC (duration short — T3-12).
- **RC release pipeline** — `release.yml` with bot tags, GH release, GHCR push, SBOM + provenance.
- **MCP server** — tool list matches docs 1:1 across ~52 tools; auth pattern (external wallet sig + API key) is correct.
- **SubQuery schema is current** — `SpotSettlementEvent` + `StakingEvent` mappings present per the April pass.
- **Two-step ownership transfer on `spot_settlement`** — pattern is sound (just not propagated, T2-2).
- **Reentrancy locks across 7 contracts** (T2-5 only flags the missing regression test).
- **Emergency `spot_settlement` pause** — wired end-to-end with audit logging.

---

## Recommended Phase Structure

Designed to unblock truth-up before commitments, address Tier 0 before Tier 1, and minimize phase-to-phase dependencies. Each phase produces a verifiable artifact.

### Phase 0 — Truth-up & Reconciliation (~1 day, no code risk)
- **Goal:** Make the team's own claims trustworthy. Cheap; unblocks every phase after.
- **Scope:** Update `PRODUCTION-READINESS.md` test counts; rewrite CHANGELOG `[Unreleased]` to capture 2026-04-28 hardening + 2026-05-21 audit; correct `AGENTS.md` canonical-doc pointers (don't migrate API specs yet, just stop pointing at dead ones); add `--max-warnings=0` to `lunex-admin lint` script; document the answers to the 6 Open Questions below.
- **Tier:** T1-17 only.
- **Depends on:** nothing.

### Phase 1 — Crypto Correctness Foundation
- **Goal:** Close the two Tier 0 correctness items the team CAN close unilaterally.
- **Scope:** T0-4 (`isFinalized` migration for reward + rebalancer + emergency pause). New Jest tests for finality discipline. T1-18 / T0-1 mitigation: document HSM/KMS rollout plan for `RELAYER_SEED` until pallet upgrade.
- **Tier:** T0-4 + groundwork for T0-1/T1-18.
- **Depends on:** Phase 0.

### Phase 2 — Secrets & Production Guards Hardening
- **Goal:** Close every dev-key/dev-seed fallback. Make `productionGuards.ts` the choke point.
- **Scope:** T0-3 (`BRIDGE_ADMIN_SEED`), T2-1 (FACTORY/TREASURY/STAKING/WS_URL), CC-1 campaign (`.env.example` rotation, gitleaks allowlist tightening, chainId guard in scripts, Dockerfile `.env` template handling).
- **Tier:** T0-3 + T2-1 + CC-1.
- **Depends on:** Phase 0.

### Phase 3 — API/SDK Contract Reconciliation
- **Goal:** One canonical OpenAPI; SDK matches it; consumers can trust the docs.
- **Scope:** T1-7 (generate OpenAPI from Zod schemas, archive dead specs, update `AGENTS.md` and `llms.txt`), T1-6 (SDK namespace migration, README correction, per-module tests, CHANGELOG, error types).
- **Tier:** T1-6 + T1-7.
- **Depends on:** Phase 0.

### Phase 4 — Frontend Hardening
- **Goal:** Kill fake numbers, restore headers, surface wallet provider chooser, install test harnesses.
- **Scope:** T0-8 (wallet modal), T1-11 (CSP + `next.config.ts` headers + `nginx.spa.conf` headers), T1-12 (test harnesses + minimum tests), T1-13 (admin session TTL), T1-14 (wallet provider chooser), T2-7 (admin XFF), T2-9 (route-split docs page), T2-10 (fee estimate).
- **Tier:** Mixed T0 / T1 / T2.
- **Depends on:** Phase 0.

### Phase 5 — Contract Test Coverage Gaps
- **Goal:** Remove the `#[cfg(not(test))]` + `#[ignore]` + stub-fuzz coverage void.
- **Scope:** T1-1 (testnet/ink-e2e integration suite covering all gated paths + prod-thresholds governance), T1-2 (router math pure helpers + un-ignore), T1-3 (copy_vault contract-bound fuzz), T1-4 (ink version pin), T2-2 (two-step ownership across 5 contracts), T2-4 (cancel timestamp), T2-5 (reentrancy mock test), T2-6 (prod-thresholds governance suite).
- **Tier:** Heavy T1 + some T2.
- **Depends on:** Phase 0, Phase 1.

### Phase 6 — Submodule & Deploy Trust Model
- **Goal:** Restore single-SHA reproducibility and make CI honest about the admin.
- **Scope:** T0-7 (lunex-admin submodule or absorb), T0-9 (image SHA pinning + Trivy gate + Prisma migrate dedup), T2-16 (CI hygiene: dedupe PR workflows, `npm ci`, Node 20 everywhere).
- **Tier:** Mixed T0 / T2.
- **Depends on:** Phase 0, decision on Open Q2.

### Phase 7 — Operational Readiness (Runbooks + Recovery)
- **Goal:** Make production operable by humans paged at 3 a.m.
- **Scope:** T0-5 (write 13 runbooks, replace placeholder URLs, drill at least one), T0-6 (backup restore CI job + `lunex_last_backup_age_seconds` metric + RTO doc), T1-5 (`emergencyService` wires `copy_vault` + `staking`), T1-10 (healthchecks on the missing 12 services), T1-15 (Doppler fallback doc), T1-16 (PITR + AOF + observability backups + integrity test), T2-17 (resource limits + DB connection pool).
- **Tier:** T0-5 + T0-6 + several T1/T2.
- **Depends on:** Phase 0, Phase 2 (for bridge-admin rotation runbook).

### Phase 8 — Observability Completion
- **Goal:** Fix the alert rules that exist; add the rules that don't; version-control dashboards.
- **Scope:** T1-9 (SubQuery scrape + lag alert + runbook), T2-11 (missing alert rules: finality lag, bridge/relayer balance, TVL anomaly, margin liquidation spike, reward lock, observability self-monitor), T2-12 (`lunex_last_backup_age_seconds` defined), T2-13 (SubQuery handler tests), T2-15 (MCP modularization + smoke tests), Grafana dashboard PRs.
- **Tier:** T1-9 + T2-11..T2-15.
- **Depends on:** Phase 7.

### Phase 9 — Documentation Truth-up
- **Goal:** Public-launch documentation: SECURITY, threat model, onboarding, faucet README.
- **Scope:** T1-8 (`SECURITY.md` + filled threat model), T2-14 (faucet hardening + README — conditional on Open Q1), MCP tool-catalog export, onboarding 30-min target measurement.
- **Tier:** T1-8 + T2-14.
- **Depends on:** Phase 0, Phase 3 (API contract).

### Phase 10 — Mainnet Dress Rehearsal
- **Goal:** Prove the entire system from clone to production-equivalent run.
- **Scope:** Cold clone → setup → testnet end-to-end (swap, settlement, copy-vault deposit, listing, governance, reward distribution, bridge wrap/unwrap, emergency pause); chaos test (Redis kill, Postgres failover, SubQuery lag injection, RPC stall); restore-from-S3 drill; gitleaks + fuzz long-form runs; sign-off by ops lead.
- **Tier:** Captures T0-1 mitigation (HSM/KMS), T0-2 (audit firm sign-off integration).
- **Depends on:** Phases 0–9.

---

## New Test Specs (consolidated)

Grouped by domain. Each cites the source audit.

### Contracts (CONTRACTS.md §"New Test Specs")
- **SPEC-SPOT-005-NEG** — `spot_settlement` reentrancy regression via malicious PSP22 mock.
- **SPEC-SPOT-001-CRYPTO** — `verify_order_signature` real-signature happy path + tampered negative (post-pallet upgrade).
- **SPEC-CV-002-LIVE** — `copy_vault::swap_through_router` end-to-end via ink-e2e / testnet.
- **SPEC-LL-003-LIVE** — `liquidity_lock::withdraw` end-to-end PSP22 transfer.
- **SPEC-STK-002-LIVE** — `staking::execute_proposal` approval refund + rejection split paths on testnet.
- **SPEC-STK-002-PROD-THRESHOLDS** — governance suite under `MIN_VOTES_FOR_APPROVAL=10_000` + `EXECUTION_DELAY_MS=48h`.
- **SPEC-RTR-001-PURE** — refactor router math into pure helpers; unit tests single-hop + multi-hop + decimals.
- **SPEC-CV-FUZZ-REAL** — port `VaultModel` invariants to ink-e2e/fuzz bound to `CopyVault`.
- **SPEC-OWN-TWO-STEP** — two-step ownership tests on copy_vault, staking, factory, listing_manager, rewards.
- **SPEC-FINALITY-PAYOUT** — Jest tests for reward + rebalancer code paths early-returning on `isInBlock`.
- **SPEC-CANCEL-TIMESTAMP** — `build_cancel_message` embedded timestamp + N-second reject window.
- **SPEC-INK-VERSION-PIN** — workspace check that all 13 contracts pin one ink version.

### spot-api (SPOT_API.md §"New Tests to Write")
- `assetBridgeService env guard test` — SPEC-BRIDGE-001/002.
- `rewardPayoutService.transferNative finality test` — SPEC-REWARD-001.
- `rewardPayoutService.signAndSendContract finality test` — SPEC-REWARD-002.
- `rebalancerService.updateCurveParameters finality test` — SPEC-REBAL-001.
- `emergencyService.runSpotPauseTx finality test` — SPEC-EMERG-003.
- `productionGuards BRIDGE_ADMIN_SEED + factory/treasury/staking/wsUrl coverage`.
- `requireAdminOrInternal XFF spoof test` — SPEC-AUTH-007.
- `/health 503 on Redis down` — SPEC-HEALTH-001.
- `/metrics admin gating test` — SPEC-METRICS-001.
- `listing logo magic-byte test` — SPEC-LISTING-003.
- `securityShield path-traversal blocks` — SPEC-SHIELD-001.
- `cancel-rate-limit Redis sliding window test` — SPEC-ORDERS-005.

### Frontend (FRONTEND.md §"Per-frontend blockers")
- `lunex-admin credentials login + bcrypt match` (SPEC-ADMIN-001).
- `lunex-admin login throttle: per-IP + per-email` (SPEC-ADMIN-004).
- `lunex-admin emergency page SUPER_ADMIN gate` (SPEC-ADMIN-006).
- `lunes-dex-main wallet connect happy + multi-extension chooser` (SPEC-DEX-001).
- `lunes-dex-main swap quote + slippage rejection` (SPEC-DEX-002).
- `lunes-dex-main signing flow uses injector` (SPEC-DEX-004).
- `lunes-dex-main 404 catch-all` (SPEC-DEX-006).
- `lunes-dex-main ErrorBoundary catches render error` (SPEC-DEX-007).

### Infrastructure (INFRA.md §"Recommendations")
- Backup restore in CI nightly (S3 cp + pg_restore + row-count assertion).
- `lunex_last_backup_age_seconds` metric emission test.
- SubQuery indexer-lag scrape and alert rule integration test.
- Healthcheck smoke for the 12 missing services.
- Image-tag immutability assertion (compose lint).

### Docs / SDK / MCP / Indexer (DOCS_SDK_MCP.md §"Tier 0/1/2/3")
- SDK module-per-module: happy path + error path (msw/nock).
- MCP per-tool smoke: input-schema validation + round-trip.
- SubQuery handler unit tests on `WalletSummary`, `VaultDailyStat`, `DailyProtocolStats`, `PairStats` aggregation invariants.
- Faucet rate limit + persisted-state + audit-log test.

---

## Open Questions for Product Owner

These ambiguities the audit could not decide; answers drive phase scope.

- **Q1.** Is **Faucet** a public mainnet feature or testnet-only? Drives the entire faucet hardening scope (captcha, persisted state, treasury funding, audit log, README). If testnet-only, T2-14 drops to T3.
- **Q2.** Is **lunex-admin** to remain a separate repo (justifiable) or be absorbed into the parent? Drives T0-7 implementation choice (submodule with pinned SHA vs. fold-in).
- **Q3.** Is the **SDK** shipping to public npm at mainnet, or kept internal-only? If public, T1-6 (SDK namespace migration) is effectively Tier 0 because consumers are paged. If internal-only, stays T1.
- **Q4.** Is the **cross-chain bridge** enabled at mainnet launch or staged later? Drives urgency of T0-3 (`BRIDGE_ADMIN_SEED`). If staged, the fix is still cheap and should ship, but the blocker classification softens.
- **Q5.** Are PRODUCTION-READINESS.md's **"non-blocking polish"** items (CSP `unsafe-inline`/`unsafe-eval`, full i18n, full a11y sweep) still non-blocking given the admin holds emergency-pause authority and the DEX signs financial transactions? T1-11 audit recommendation: re-classify CSP as required.
- **Q6.** Which document is **canonical going forward** — fresh OpenAPI generated from Zod, or one of the four existing specs (none of which match code)? Drives T1-7 implementation choice. Auditor recommendation: fresh-generate.
- **Q7.** Should the **single-relayer** model ship at mainnet (with HSM/KMS only) or does a **threshold/multi-relayer** scheme block launch? PRODUCTION-READINESS lists HSM as pre-mainnet; auditor flags T1-18 because while pallet-contracts lacks `seal_sr25519_verify`, the relayer key IS the trust assumption.

---

*Consolidated audit produced 2026-05-21. Synthesises CONTRACTS.md, SPOT_API.md, FRONTEND.md, INFRA.md, DOCS_SDK_MCP.md against PRODUCTION-READINESS.md (2026-04-28) and `.planning/codebase/CONCERNS.md` (2026-05-21).*
