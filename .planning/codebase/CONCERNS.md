# Codebase Concerns

**Analysis Date:** 2026-05-21

This audit complements `PRODUCTION-READINESS.md` (2026-04-28) and `PATHFINDER-2026-04-28/PRODUCAO-RELATORIO.md`. Those documents tracked the 37 hardening items closed in the April pass. This file enumerates **what is still open** plus **new findings** introduced since.

Priorities (highest first): **Security → Correctness → Performance → Maintainability**.

---

## Security — Critical (Tier 0 still open)

### On-chain signature verification is a no-op

- File: `Lunex/contracts/spot_settlement/lib.rs:1138` — `verify_order_signature()`
- Problem: The function only rejects all-zero signatures. No cryptographic check happens on-chain. The relayer is fully trusted to verify sr25519 signatures off-chain (`spot-api/src/services/settlementService.ts`). A compromised relayer can forge any signed order without the contract noticing.
- Root cause: `pallet-contracts` on the Lunes runtime does not yet expose `seal_sr25519_verify` (ink! 4.x host-function gap).
- Impact: Catastrophic — single compromise of `RELAYER_SEED` → full settlement drain.
- Fix path: Wait for Lunes pallet-contracts upgrade with `seal_sr25519_verify`; replace function body with the commented snippet referenced in the source. Until then, harden the relayer key with HSM/KMS and/or multi-relayer threshold scheme as called out in `PRODUCTION-READINESS.md`.

### Silent fallback to dev seed `//Alice` in asset bridge

- File: `spot-api/src/services/assetBridgeService.ts:466`
- Code path: `const adminSeed = process.env.BRIDGE_ADMIN_SEED || '//Alice';`
- Problem: `productionGuards.ts` blocks dev seeds for `RELAYER_SEED`, but the bridge admin seed has no such guard. If `BRIDGE_ADMIN_SEED` is missing or misspelled in production env, the service starts up signing as Alice (a publicly-known dev key).
- Impact: Cross-chain wrap/unwrap operations could be controlled by anyone who knows the dev keypair. Tier 0 equivalent.
- Fix: Add `BRIDGE_ADMIN_SEED` to `productionGuards.ts` dev-seed denylist and require it explicitly when `NODE_ENV=production` and bridge enabled. Remove the `|| '//Alice'` default.

### Cached weak dev secret in standalone build artifact

- File: `lunex-admin/.next/standalone/lunex-admin/.env`
- Problem: The standalone Next build output retains a hardcoded dev `AUTH_SECRET` string (a well-known short string suggesting a dev placeholder). The directory is `.gitignore`'d, so it does not leak via git, but it ships inside any Docker image built from the standalone tree.
- Impact: If the image were ever pushed to a registry with that build cached, admin JWTs become forgeable. Operationally, also a footgun for developers running the standalone image locally and forgetting to override.
- Fix: Add a CI guard that fails if `AUTH_SECRET` in the standalone bundle is anything other than the literal placeholder that `productionGuards` recognises. Make the Dockerfile copy the `.env` template, not a built version.

### Root `.env.example` ships the well-known test mnemonic

- File: `.env.example`
- Problem: Contains the famous "horn horn horn ..." 12-word test mnemonic under `PRIVATE_KEY=`. This is a Substrate test wallet that holds zero value but is recognised by tooling.
- Impact: Low (it's a template), but it is a footgun — developers copy `.env.example` to `.env` and unknowingly keep a known weak key. Gitleaks rules (`.gitleaks.toml`) allowlist `.env.example`, so leak-detection won't catch it.
- Fix: Replace with `PRIVATE_KEY=REPLACE_WITH_PRODUCTION_SEED_FROM_SECRETS_MANAGER` and add a `productionGuards` check.

### Tier 1 / Tier 2 security items still open from the April audit

The following items from `PATHFINDER-2026-04-28/PRODUCAO-RELATORIO.md` are **not** marked closed by `PRODUCTION-READINESS.md`:

- Relayer is a single point of failure (#24). Centralized signer; KMS/multisig not implemented. `spot-api/src/services/settlementService.ts`.
- Admin timelock on `copy_vault` pause is absent (#39). Owner can pause immediately without delay window.
- CSP relies on `unsafe-inline`/`unsafe-eval` in Nginx (#35, #38). Still open per PRODUCTION-READINESS Pre-Mainnet checklist.
- `reset_reentrancy_guard` may be exposed on the rewards contract ABI (#40). Not verified closed.
- `buildSpotCancelMessage` lacks an embedded timestamp (#60) — cancel signatures replayable across long windows.

---

## Correctness — High Priority

### Reward payouts confirm on `isInBlock` instead of `isFinalized`

- Files:
  - `spot-api/src/services/rewardPayoutService.ts:447` (native LUNES transfer)
  - `spot-api/src/services/rewardPayoutService.ts:498` (contract calls)
  - `spot-api/src/services/rebalancerService.ts:423`
- Problem: PRODUCTION-READINESS claims `settlementService` and `copyVaultService` were migrated to await `isFinalized`. The reward payout path and the rebalancer were missed. Both move user funds.
- Impact: A reorg between `isInBlock` and finality lets the off-chain DB mark a payout/rebalance complete while the on-chain transfer is rolled back. Money can be double-credited or lost.
- Fix: Mirror the pattern in `settlementService.ts:528` and `copyVaultService.ts:162` — branch on `txResult.status.isFinalized` only; do not accept `isInBlock` for fund-moving operations.

### Smart contract stubs already closed but flagged as `#[cfg(not(test))]`

- Files: `Lunex/contracts/copy_vault/lib.rs:847`, `Lunex/contracts/liquidity_lock/src/lib.rs:224`, `Lunex/contracts/staking/lib.rs:502,509,1137`
- Status: Per `PRODUCTION-READINESS.md`, the production code paths were filled in. The real cross-contract transfers are gated behind `#[cfg(not(test))]` because ink's mock test env cannot route undeployed contracts.
- Concern: There is **no testnet integration test** in the repo that exercises the live paths. Coverage only proves the test-only stubs work.
- Impact: Regressions in the real transfer logic ship undetected until a testnet deploy.
- Fix: Add a `tests/integration/` harness wired to a local Substrate testnet (or use ink-e2e). Run as part of CI nightly.

### Router unit tests for swap math are `#[ignore]`d

- File: `Lunex/contracts/router/lib.rs:1710,1738,1872,1921,1950,2000,2081,2145`
- Problem: 8 router tests carry `#[ignore]` comments stating "Requer cross-contract call ao Factory/Pair". They never run in CI.
- Impact: Router swap math (`get_amounts_out`, `get_amounts_in`, multi-hop paths) is the hottest hot path in the DEX and has zero unit-test coverage; only fuzz model in `fuzz/fuzz_targets/pair_invariant.rs` covers the constant-product invariant, and that's a parallel model not the actual contract.
- Fix: Refactor the math primitives out of the cross-contract entry points into pure functions; unit-test those directly. Keep `#[ignore]` only on tests that actually need a deployed Factory/Pair.

### Fuzz coverage for `copy_vault` is a comment-only stub

- File: `Lunex/contracts/copy_vault/fuzz/fuzz_targets/fuzz_vault.rs`
- Problem: The body of `fuzz_target!` is empty — only a comment block describes what should be tested. PRODUCTION-READINESS Tier 1 #25 flagged this and it is still open.
- Note: There is a separate `fuzz/fuzz_targets/copy_vault_accounting.rs` at the repo root which IS implemented, but it is a parallel `VaultModel` (HashMap-based) — not the actual `CopyVault` contract. Property holds on the model do not transfer to the production contract.
- Asymmetric pair fuzz (`Lunex/contracts/asymmetric_pair/fuzz/fuzz_targets/invariant_math.rs`) does exist and panics on violation — that one is real.
- Fix: Port the model invariants into ink-e2e fuzz drivers against the actual `CopyVault` and `AsymmetricPair` contracts.

### Admin emergency controls are partial

- File: `spot-api/src/services/emergencyService.ts:132` — explicit `TODO`
- Problem: Only `spot_settlement` pause/unpause is wired. `copy_vault` and `staking` emergency endpoints report `available: false` and instruct operators to "pause directly via polkadot.js or the contract owner key".
- Impact: In an incident, ops cannot pause the largest user-fund-holding contract (`copy_vault`) from the admin panel. The runbook then depends on operator access to a raw signer.
- Fix: Wire `copy_vault` and `staking` pause status queries and pause/unpause tx routes; load their ABIs the same way `spot_settlement` is loaded.

### Inconsistent finality wait helper

- File: `spot-api/src/services/emergencyService.ts:242` — `if (status.isFinalized || status.isInBlock)`
- Less critical than payouts (no fund movement), but inconsistent with the finality discipline applied elsewhere. Pause/unpause acknowledgement before finality could give a false sense of safety in a fast incident.

---

## Correctness — Medium

### `socialIndexerService` saturated with `as any`

- File: `spot-api/src/services/socialIndexerService.ts` (1446 lines, 20+ `as any` casts)
- Listed as Tier 3 #54 in the April audit ("not analyzed — risk of polling without backoff"). Still not analysed.
- Concrete risks visible from a skim:
  - `const db = prisma as any` (line 92) — bypasses Prisma's type-safety on a service that writes to ~5 tables.
  - Pair/router/wnative/copyVault/asymmetricPair ABIs all `as any` cast before being passed to `ContractPromise` constructor — type guarantees on decoded contract output are lost.
  - 42 KB file size; polling backoff strategy never reviewed.

### Type-safety bypasses scattered through backend

- ~190 `: any` or `as any` occurrences in `spot-api/src/`. Hotspots: `socialIndexerService.ts`, `rebalancerService.ts`, `rewardPayoutService.ts` (`txMethod: any`, `options: Record<string, any>`).
- SDK has ~21 `any`-typed return types in public modules (`sdk/src/modules/tokens.ts:42`, `sdk/src/modules/agents.ts:285,291`). These are SDK consumer-facing — TypeScript users get no IntelliSense and no compile-time guards.

### Deprecated field still accepted by validation

- `spot-api/src/utils/validation.ts:176` and `sdk/src/spot-types.ts:489` — `realizedPnlPct` is marked deprecated but still accepted in the schema. Clients sending it get no warning.
- Fix: Reject the field with a Zod `.refine` or strip it explicitly; emit a warning header.

---

## Performance / Scalability

### Large service modules

| File | Lines |
|------|-------|
| `spot-api/src/services/copytradeService.ts` | 1921 |
| `spot-api/src/services/socialIndexerService.ts` | 1446 |
| `spot-api/src/services/rewardDistributionService.ts` | 1318 |
| `spot-api/src/services/marginService.ts` | 1144 |
| `lunes-dex-main/src/services/contractService.ts` | 1376 |
| `lunes-dex-main/src/pages/docs/index.tsx` | 3417 |

These are above a reasonable maintainability ceiling. `copytradeService.ts` houses the entire copy-trade lifecycle and the largest single Prisma surface; any change risks the whole feature.

### No container resource limits

- Files: `docker/docker-compose.prod.yml`, `docker-compose.dev.yml`
- Problem: No `mem_limit`, `cpus:`, or `deploy.resources` directives. Per Tier 3 #57.
- Impact: A leaking node process can OOM-kill its neighbour (Postgres, Redis) on the same host. In production this is a single-host failure mode.
- Fix: Add per-service `deploy.resources.limits` blocks.

### No Postgres `connection_limit`

- The `DATABASE_URL` strings reviewed do not set `connection_limit`. With 3 Node.js services (spot-api, indexer worker, admin) and several scheduler intervals each holding their own connections, `too many connections` is a foreseeable production incident.
- Fix: Append `?connection_limit=10&pool_timeout=20` (or appropriate value) to the production `DATABASE_URL`.

---

## Maintainability / Coupling

### `lunex-admin/` is gitignored and uses its own git repo

- File: `.gitignore` last line — `lunex-admin/`
- Reality: `lunex-admin/.git/` exists. The admin panel is NOT tracked by the parent `Lunex-v1.1` repo. The parent CI sees an empty directory.
- Impact:
  - `PRODUCTION-READINESS.md` claims "lunex-admin TypeScript: ✓" — but the parent CI cannot have verified that, because the source is invisible to it.
  - Deployment artifacts (e.g. `lunex-admin/.next/standalone/`) are likewise untracked.
  - A rollback of the main repo to a prior commit does not roll back admin code; the two histories drift independently.
- Fix: Either pull `lunex-admin` in as a proper git submodule (with pinned SHA) or move it into the main tree. Right now the relationship is "convention only".

### Dependency version skew across submodules

- `@polkadot/api`: root `^10.9.1`, `spot-api` `16.5.3`, `lunes-dex-main` `^16.5.3`, `sdk` (check separately). Root's `typechain-compiler` pipeline runs against the old 10.x API.
- `react`: `lunes-dex-main` `18.2.0`, `lunex-admin` `19.2.3`. The two front-ends will never share a component library cleanly.
- `next`: `lunex-admin` on `16.1.6` (very new — verify ecosystem stability of plugins).
- `eslint`: root `^7.26.0`, `spot-api` `^8.39.0`. Two lint configurations, two rule sets, two upgrade paths.
- TypeScript ESLint: root `^4.8.2` (very old), `spot-api` `^8.39.0` (current). Root cannot run modern lint rules.
- Per audit Tier 2 #49: Node version mismatch (API 18, frontend/admin 20). PRODUCTION-READINESS says `Dockerfile.api` standardised on `node:20-alpine`, but local dev environments may still drift unless `.nvmrc` is enforced.

### Patched vendor dependencies

- Files: `patches/@727-ventures+typechain-compiler+0.5.10.patch`, `patches/@727-ventures+typechain-types+0.0.21.patch`
- Problem: Two upstream packages from `@727-ventures` are patched at install time via `patch-package`. The patches fix:
  1. A wrong filename in `typechain-compiler` (reading `metadata.json` instead of `<name>.json`).
  2. A type drift in `typechain-types` (old `Weight` → `WeightV2`) and a tx-status check that previously accepted `isInBlock`.
- Concern: The upstream packages appear unmaintained (`0.5.10`, `0.0.21`). Any `npm install` on a fresh checkout that fails to apply the patches silently breaks contract codegen. Long-term these need a fork or a replacement.

### `spot-api` reports missing dependencies

- `depcheck` audit on 2026-04-13 flagged 3 missing dependencies in `spot-api` (per local memory; `sdk` and `mcp` are clean).
- Fix: Run `npm run deadcode:deps` in `spot-api/` and reconcile.

### Test seed accounts hardcoded in scripts

- Files: every script under `spot-api/scripts/*.ts` (`simulate-volume`, `qa-security`, `qa-api`, `deploy-tokens`, `setup-local-tokens`, `qa-blockchain`, ...) uses `keyring.addFromUri('//Alice')`, `//Bob`, `//Charlie`, ...
- Acceptable in dev tooling. Concern: nothing prevents these scripts from being run against mainnet by accident — no `chainId` guard at the top of each script.
- Fix: Each script should refuse to run unless the connected chain is a recognised testnet/devnet ID.

---

## Test Coverage Gaps

### What is tested

- 87 / 87 ink! tests across 6 contracts (per April pass).
- 323 / 323 spot-api Jest tests across 40 suites.
- Three fuzz targets in the root `fuzz/` dir (model-based, not contract-bound).
- Asymmetric pair has a real contract-binding fuzz target.

### What is not tested

- `verify_order_signature` real cryptographic path (no host fn yet).
- Real PSP22 cross-contract transfers in `liquidity_lock::withdraw`, `staking::execute_proposal`, `copy_vault::swap_through_router` — all gated behind `#[cfg(not(test))]`; coverage proves only the stub path.
- Router swap math under realistic Factory/Pair conditions (8 ignored tests).
- Copy vault contract-binding fuzz (stub).
- Reward payout finality migration (no integration test for `isFinalized`).
- Bridge admin seed fallback (no guard test).
- Long-lived admin emergency endpoints for `copy_vault` and `staking` (not wired, so trivially uncovered).
- End-to-end mainnet-config dry run on a Lunes testnet deploy.

---

## Out-of-Scope (defer to mainnet checklist owner)

The following are listed in `PRODUCTION-READINESS.md` Pre-Mainnet Checklist and are blockers but require external action — not code changes:

- External audit by an ink!/Substrate firm (Halborn, Trail of Bits, OpenZeppelin substrate, CertiK).
- Mainnet deploy + end-to-end testnet integration.
- Secrets injection for `RELAYER_SEED`, `AUTH_SECRET`, `ADMIN_SECRET`, `NATIVE_TOKEN_ADDRESS`, `LUNES_CHAIN_ID`, `LUNES_WS_URL`, `BACKUP_S3_BUCKET`, `ADMIN_PASSWORD`.
- Post-deploy: `copy_vault::set_router(...)` per vault; `spot_settlement::add_relayer(...)` per relayer.

---

## Recommended Priority Order

1. **Patch the new Tier 0**: `BRIDGE_ADMIN_SEED` fallback (1h) and reward payout `isInBlock` → `isFinalized` migration (4h). These are pure code fixes, low blast radius.
2. **Wire emergency controls for `copy_vault` and `staking`** (1–2 days). Without these the runbook for the largest pool depends on raw signer access.
3. **Resolve `lunex-admin` git relationship** — submodule with pinned SHA, OR fold into main tree (½–1 day). Until this is done, the production-readiness sign-off on admin is unverifiable from the parent repo.
4. **Add testnet integration suite** that exercises real (`#[cfg(not(test))]`) contract paths.
5. **Port `copy_vault` fuzz target to a real contract-binding driver**; un-ignore the router math tests after factoring out pure helpers.
6. **Standardise dependency versions** across submodules (polkadot, eslint, typescript-eslint, react where possible).
7. **Replace patched `@727-ventures` deps** or fork.

---

*Concerns audit: 2026-05-21 — supplements `PRODUCTION-READINESS.md` (2026-04-28).*
