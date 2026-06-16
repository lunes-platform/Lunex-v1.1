# Cleanup Pass #5 — DRY / DEDUPE

**Date:** 2026-06-16
**Scope:** spot-api/src, sdk/src, mcp, lunes-dex-main/src, lunex-admin/src, subquery-node/src
**Exclusions:** contracts/ (Rust), node_modules, dist, .next, build, test files, auto-generated files

---

## Context

Prior passes (dead code, circular deps, types consolidation) were run 2026-06-14 through 2026-06-16.
Pass #3 (types) already extracted `SignedReadAuth` + `signedReadHeaders` from sdk modules into `sdk/src/spot-utils.ts`.
This pass focused on code-block duplication (not just type duplication), scanning 340 TS/TSX files.

---

## Scan Results

- **Raw duplicated code blocks (8-line windows, same content):** 653 raw hits across 340 files
- **Unique file-pairs with duplication:** 118
- **Same-package file-pairs (candidates):** 105 pairs narrowed to ~25 meaningful non-trivial duplications

---

## Duplications Found

### 1. `formatVolume` + `formatPrice` — lunes-dex-main (EXTRACTED)

**Files with copies:**
- `lunes-dex-main/src/components/spot/PriceHeader/index.tsx:126`
- `lunes-dex-main/src/components/spot/PriceHeader/PairInfoModal.tsx:168`
- `lunes-dex-main/src/components/spot/PriceHeader/AnalyticsModal.tsx:198` (different — NOT merged)
- `lunes-dex-main/src/components/spot/PairSelector/index.tsx:198` (different — NOT merged)

**Assessment:** `index.tsx` and `PairInfoModal.tsx` are byte-identical (same logic, same numeric thresholds, same string concatenation style). Both live in the same `PriceHeader/` directory — same package, same layer, trivially safe to share. `AnalyticsModal` and `PairSelector` have different implementations (`.toFixed(1)+'K'` vs `.toFixed(0)+'K'`; `vol.toString()` vs `vol.toFixed(0)`) — they were NOT touched.

**Action taken:**
1. Created `lunes-dex-main/src/components/spot/PriceHeader/formatters.ts` with `export function formatVolume` and `export function formatPrice`.
2. Removed local definitions from `PriceHeader/index.tsx` and `PairInfoModal.tsx`.
3. Added `import { formatVolume, formatPrice } from './formatters'` to both files.

**tsc --noEmit:** CLEAN (0 errors) in `lunes-dex-main`.

---

## Duplications Left As-Is

### 2. Blockchain service `initialize()` pattern — spot-api (INTENTIONALLY LEFT)

**Files:**
- `spot-api/src/services/emergencyService.ts` (Polkadot ApiPromise + Keyring + ContractPromise setup)
- `spot-api/src/services/rewardPayoutService.ts` (same setup pattern)
- `spot-api/src/services/rebalancerService.ts` (partial similar pattern)
- `spot-api/src/services/socialIndexerService.ts` (similar ApiPromise setup)

**Why left:** These are NOT identical.
- Different config paths: `config.blockchain.spotContractMetadataPath` vs `config.rewards.stakingContractMetadataPath`
- Different contract addresses: `spotContractAddress` vs `stakingContractAddress`
- Different post-init logic: `emergencyService` resolves pause/unpause/is_paused method keys; `rewardPayoutService` resolves `fund_staking_rewards`/`distribute_trading_rewards` keys with distinct fallback/warning logic; `rebalancerService` creates contracts inline per call, not at init.
- These services manage different on-chain contracts with distinct operational lifecycles. Extracting a shared "blockchain factory" would require passing callbacks for all the divergent post-init work, producing an abstraction that's harder to read and audit than the current parallel structures.
- **All are on the fund-moving path (relayer keypair, on-chain txs).** Over-abstraction here is a maintenance risk.
- RECOMMENDATION: If a 5th or 6th service follows this exact pattern with the same config shape, extract a `createBlockchainService(metadataPath, contractAddress, postInit)` factory at that point — not now.

### 3. `TabBtn` + `InputContainer` styled-components — lunes-dex-main pages (INTENTIONALLY LEFT)

**Files:**
- `lunes-dex-main/src/pages/staking/index.tsx:148`
- `lunes-dex-main/src/pages/pool/index.tsx:126`

**Why left:** These are page-level styled components. The blocks are identical (~15 lines of CSS-in-JS each). However:
- They are purely presentational with no logic duplication risk.
- Moving them to a shared file would create a coupling between two pages that currently evolve independently.
- styled-components divergence (e.g. adding a margin/padding specific to staking) would require forking anyway.
- Net benefit: near zero. Net risk: accidental coupling. Left as parallel definitions.

### 4. `signedReadHeaders` helper — sdk modules (ALREADY RESOLVED in Pass #3)

Already extracted to `sdk/src/spot-utils.ts` in the prior pass. No action needed.

---

## Fund-Path Note

The blockchain `initialize()` pattern in `emergencyService` and `rewardPayoutService` touches the relayer keypair and on-chain contract invocation. This was assessed but deliberately NOT abstracted. See item #2 above.

---

## tsc Results

| Package | Result |
|---------|--------|
| lunes-dex-main | CLEAN (0 errors) |
| Other packages | Not modified — no changes to verify |
