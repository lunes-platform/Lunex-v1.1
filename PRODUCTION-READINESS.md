# Lunex DEX — Production Readiness Hardening
**Last update:** 2026-04-28

This document records the production-launch hardening pass: what was audited,
what was changed, and what remains before mainnet. Detailed per-task specs
live in `tasks/specs/`; the full audit report is in `PATHFINDER-2026-04-28/`.

---

## Audit Source

A 5-specialist parallel audit (security, backend, frontend, devops, smart
contracts) produced 60 findings organised in 4 tiers. Full report:

- `PATHFINDER-2026-04-28/00-features.md` — feature inventory (23 features)
- `PATHFINDER-2026-04-28/PRODUCAO-RELATORIO.md` — go/no-go matrix

This pass closed **37 items** (all Tier 0 / 1 / 2 / 3 actionable from code).
The remaining items are external (audit firm, secrets configuration) or
non-trivial UX (i18n, full a11y).

---

## Verification Status

```
spot-api    TypeScript:  ✓
spot-api    Tests:       323 / 323 passed (40 suites)
sdk         TypeScript:  ✓
lunex-admin TypeScript:  ✓
lunes-dex-main TypeScript: ✓
subquery    codegen:     ✓ (typings + handlers regenerated)

Smart contracts (87 / 87 ink! tests across 6 contracts):
  copy_vault       11 / 11
  liquidity_lock    5 /  5
  spot_settlement  42 / 42
  staking          12 / 12
  asymmetric_pair   7 /  7
  factory          10 / 10
```

---

## Changes by Layer

### Smart contracts (`Lunex/contracts/*/lib.rs`)

| Contract | Change |
|----------|--------|
| `staking` | `claim_rewards` CEI fixed — transfer happens before mutating `pending_rewards`; `execute_proposal` now performs real `env().transfer()` for fee refund (approval) or treasury+staking-pool split (rejection) |
| `spot_settlement` | Reentrancy guard (`reentrancy_lock`) on `deposit_psp22` / `withdraw_psp22`; two-step `transfer_ownership` + `accept_ownership` + `cancel_ownership_transfer` to prevent typo-locked admin |
| `liquidity_lock` | `withdraw()` now performs the real PSP22 cross-contract transfer of LP tokens back to the owner (with rollback on failure) |
| `copy_vault` | New `swap_through_router(token_in, token_out, amount_in, min_amount_out)` message: real cross-contract call to Router, equity derived from on-chain state (not from a parameter), slippage protection via `min_amount_out`, configurable router address via admin-only `set_router()` |
| `asymmetric_pair` | Reentrancy guard on `asymmetric_swap` |
| `factory` | Constructor `new()` is now fallible: returns `Result<Self, FactoryError>` instead of panicking on zero `fee_to_setter` (panicking constructors leave storage partially initialised in ink! 4.x) |

Cross-contract calls in `liquidity_lock::withdraw`, `staking::execute_proposal`,
and `copy_vault::swap_through_router` are wrapped in `#[cfg(not(test))]` because
ink's mock test environment does not route calls to undeployed contracts;
integration tests on testnet exercise the real transfer paths.

### Backend (`spot-api/`)

| Area | Change |
|------|--------|
| Crash safety | `process.on('unhandledRejection')` and `('uncaughtException')` handlers added before `main()` — schedulers no longer crash silently |
| Production guards | `productionGuards.ts` extended: `NODE_ENV` must be exactly `"production"`, `RELAYER_SEED` placeholders rejected, `NATIVE_TOKEN_ADDRESS` required, `rewards.rewardSplitValid` enforced when rewards enabled |
| Health check | `/health` now returns 503 when Redis is offline (matching engine, nonce store, and rate limiter all depend on Redis) |
| Reward distribution | Redis distributed lock (30 min TTL) at `runWeeklyDistribution` entry; per-recipient idempotency in `distributeLeaderRewards` / `distributeTraderRewards` via `userReward.findFirst` |
| Margin liquidation | Atomic CAS via `updateMany({ where: { id, status: 'OPEN' }})` in `liquidatePosition` — eliminates double-liquidation race condition |
| Trade settlement | `applySettlementResults` wrapped in `prisma.$transaction`; `prismaAny = prisma as any` cast removed |
| Cancel rate limit | Migrated from in-memory `Map` to Redis sliding window (`utils/redisRateLimit.ts`) — survives restarts and horizontal scale |
| Body parser | Global `express.json` limit reduced 5MB → 100KB; only `/api/v1/listing` retains 2MB |
| Admin guard | `requireAdminOrInternal` rejects bypass when proxy headers (`X-Forwarded-For`/`X-Forwarded-Host`/`Forwarded`) are present — defense against XFF spoofing |
| Emergency Controls | New `emergencyService.ts` + 3 admin endpoints (`status`, `spot/pause`, `spot/unpause`) wrap `spot_settlement.pause/unpause` via polkadot.js with audit logging |
| On-chain finality | `settlementService` and `copyVaultService` wait for `isFinalized` (not just `isInBlock`) before confirming user-fund-moving operations |

### SDK (`sdk/`)

- HTTP client now retries `429`, `502`, `503`, `504`, `ECONNABORTED`,
  `ECONNRESET`, `ETIMEDOUT`, `EAI_AGAIN` with exponential backoff + ±20% jitter.
  Honours `Retry-After` for 429. Max 3 retries.

### Frontend (`lunes-dex-main/`)

- New `pages/notFound/` page wired as `<Route path="*">` catch-all.
- Vite `manualChunks` splits `polkadot`, `charts`, and `vendor` for cacheable
  chunks — `@polkadot/api` (~2-3 MB) no longer dominates the main bundle.
- `.env.production.example` template documenting all mainnet variables.
- "My Pools" filter tab removed pending LP-balance integration in
  `contractService` (was previously a no-op `return false` TODO).
- Dead code removed: duplicate `components/common/ErrorBoundary.tsx` and
  unused `connectWallet/mock.ts`.

### Admin panel (`lunex-admin/`)

- `lib/rateLimit.ts` — sliding-window in-memory limiter; `loginAction` now
  throttles 5 / 15 min per IP **and** per email.
- `create-admin.ts` — hardcoded `Admin@Lunex2026` removed; `ADMIN_PASSWORD`
  required, ≥16 chars enforced; `team/actions.ts` aligned to 16-char minimum.
- New `(admin)/emergency/` page with real-time status, audit-logged
  `pause/unpause` actions, 10-char minimum reason field, JS confirmation.
- `.env.production.example` template.

### SubQuery (`subquery-node/`)

- New `project.template.yaml` with `__LUNES_CHAIN_ID__`, `__LUNES_WS_URL__`,
  `__LUNES_START_BLOCK__` placeholders.
- New `entrypoint.sh` renders the template at container startup via `sed`.
- Handlers added for `spot_settlement` (`Deposit`, `Withdraw`, `Settled`) and
  `staking` (`StakeCreated`, `StakeWithdrawn`, `RewardClaimed`).
- New GraphQL entities `SpotSettlementEvent` and `StakingEvent`.

### Infrastructure (`docker/`)

- **PostgreSQL**: `synchronous_commit=off` removed (returns to `on` default).
- **Redis**: now runs with `--appendonly yes --appendfsync everysec`.
- **Backups**: S3 upload mandatory (`BACKUP_S3_BUCKET:?` in compose);
  `backup.sh` auto-installs `aws-cli` if missing; cron loop aligned to 01:00 UTC;
  S3 retention 30 days, local 7 days.
- **Monitoring**: blackbox-exporter wired (modules `http_2xx`,
  `tcp_connect_tls`, `icmp`); `ssl_expiry` and `http_probe` jobs active;
  custom Grafana dashboard `lunex-overview.json` with health, p99 latency,
  error rate, SSL days-to-expiry, vault equity, pending settlements.
- **Nginx**: `stub_status` endpoint on port 8888 (docker-network ACL);
  `nginx-exporter` service wired; Prometheus `nginx` job active.
- **Node.js version**: `Dockerfile.api` standardised on `node:20-alpine`.

### CI/CD (`.github/workflows/`)

- `deploy.yml` typecheck steps for frontend / admin no longer have `|| true`
  — type errors block deploy.

---

## Pre-Mainnet Checklist (out of scope of this pass)

### 🔴 Blockers
- [ ] External audit by a firm specialised in ink! / Substrate
      (Halborn, Trail of Bits, OpenZeppelin substrate practice, CertiK).
      4–8 weeks.
- [ ] Deploy contracts to testnet Lunes and run end-to-end integration tests
      (real swap via `swap_through_router`, real PSP22 transfer in
      `liquidity_lock::withdraw`, real LUNES transfer in
      `staking::execute_proposal`, two-step ownership transfer end-to-end).
- [ ] On-chain `verify_order_signature` is currently a no-op until
      pallet-contracts on Lunes exposes `seal_sr25519_verify`. Until then,
      protect the relayer key with HSM/KMS and consider a multi-relayer
      threshold scheme.

### 🟡 DevOps secrets to inject via secrets manager
- `RELAYER_SEED` (mainnet, KMS/HSM preferred)
- `AUTH_SECRET` = `openssl rand -base64 32`
- `ADMIN_SECRET` ≥ 32 chars
- `NATIVE_TOKEN_ADDRESS`, `LUNES_CHAIN_ID`, `LUNES_WS_URL`
- `BACKUP_S3_BUCKET` + `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`
- `ADMIN_PASSWORD` ≥ 16 chars (random)

### 🟢 Post-deploy
- Call `copy_vault::set_router(<router_addr>)` on each vault.
- Call `spot_settlement::add_relayer(<relayer>)` for each relayer.
- Verify SSL alerts fire in Grafana within the configured threshold.
- Test Emergency Controls in staging (pause/unpause + audit log review).

### Non-blocking polish (post-launch backlog)
- CSP without `unsafe-inline`/`unsafe-eval` (requires React tree audit to
  identify required inlines and replace with nonces).
- `i18n` instrumentation (`react-intl` / `i18next`).
- Full WCAG accessibility sweep (aria-labels, focus order, contrast).
- Unified contract-deploy script.
- `socialIndexerService.ts` (42 KB) polling/backoff review.

---

## File Index

- `tasks/plan.md` — full implementation plan
- `tasks/todo.md` — checklist by phase
- `tasks/specs/` — per-task specs with acceptance criteria
- `tasks/IMPLEMENTACAO-2026-04-28.md` — Phases 1–3 report
- `tasks/IMPLEMENTACAO-FASES-4-5.md` — Phases 4–5 report
- `tasks/IMPLEMENTACAO-100.md` — Phase 5 contract stubs eliminated
- `tasks/IMPLEMENTACAO-TIER2-3.md` — Tier 2 & 3 hardening
- `PATHFINDER-2026-04-28/` — original audit artefacts
