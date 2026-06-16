# Cleanup Pass #3 — Shared Type Consolidation

**Date:** 2026-06-16
**Scope:** spot-api/src, sdk/src, mcp, lunes-dex-main/src, lunex-admin/src, subquery-node/src
**Exclusions:** contracts/ (Rust), node_modules, dist, .next, build, test files

---

## Summary

477 unique type/interface names found. 64 appear in 2+ files.
After filtering generic names (Props, Config, State, Options, Result, etc.) and categorising by package boundary:

- Cross-package duplicates: 48 — all left intentionally (see below)
- Same-package duplicates: 14 (inc. generic-named) — assessed individually
- Consolidations applied: 2 (covering 5 duplicate declarations + 3 duplicate functions)

---

## Consolidations Applied

### 1. `SignedReadAuth` + `signedReadHeaders` → `sdk/src/spot-utils.ts`

**Before:** Identical type and function declared locally in 3 sdk module files:
- `sdk/src/modules/agents.ts:13` — `type SignedReadAuth` (local)
- `sdk/src/modules/agents.ts:20` — `function signedReadHeaders` (local)
- `sdk/src/modules/copytrade.ts:25` — `type SignedReadAuth` (local)
- `sdk/src/modules/copytrade.ts:32` — `function signedReadHeaders` (local)
- `sdk/src/modules/orders.ts:44` — `type SignedReadAuth` (local)
- `sdk/src/modules/orders.ts:51` — `function signedReadHeaders` (local)

**After:** Single canonical definition exported from `sdk/src/spot-utils.ts` (appended at EOF). All three modules now import `{ SignedReadAuth, signedReadHeaders }` from `'../spot-utils'`.

**Why this home:** `spot-utils.ts` already owns all SDK signing/auth utilities and is re-exported via `sdk/src/index.ts` (`export * from './spot-utils'`), making `SignedReadAuth` part of the public SDK surface automatically — no extra wiring needed.

**Layer boundary:** All changes within `sdk` package. No cross-package imports introduced.

---

### 2. `PairInfo` → canonical in `lunes-dex-main/src/services/contractService.ts`

**Before:** Identical interface declared in two files within the same package:
- `lunes-dex-main/src/services/contractService.ts:82` — `export interface PairInfo` (canonical owner)
- `lunes-dex-main/src/context/SDKContext.tsx:53` — `interface PairInfo` (local duplicate)

Both had identical shapes: `{ address, token0, token1, reserve0, reserve1, totalSupply }`.

**After:** `SDKContext.tsx` no longer redeclares `PairInfo`. Instead it imports `type { PairInfo } from '../services/contractService'` — which it already imports for the `contractService` singleton. The `interface PairInfo` block was removed from SDKContext.

**Why safe:** SDKContext already `import { contractService }` from contractService; adding a type import from the same module is zero-cost and removes the staleness risk.

**Layer boundary:** Both files within `lunes-dex-main`. No cross-package imports introduced.

---

## Left As-Is — Cross-Package (Intentional)

All 48 cross-package duplicates were left unchanged. Selected examples with rationale:

| Name | Packages | Reason left |
|------|----------|-------------|
| `Token` | `sdk`, `lunes-dex-main` | **Different shapes** — sdk has `logoURI?`, dex hooks have `icon?`, tokenRegistry has `id/acronym/token/tokenPrice/isNative`. Three distinct domain views. |
| `StrategyStatus` (type `'ACTIVE'\|'PAUSED'\|'ARCHIVED'`) | `sdk/modules/strategy`, `lunes-dex-main/src/services/strategyService` | Package independence. dex frontend cannot import from sdk modules directly (published package boundary). |
| `StrategyStatus` (interface with `buyCurve/sellCurve/…`) | `sdk/modules/asymmetric/types`, `lunes-dex-main/src/sdk/AsymmetricClient` | **Different shapes** — sdk version uses `StrategyCurveStatus` and `StrategyHealthState`; dex version inlines `CurveParameters` and a literal union for `status`. Diverged intentionally for frontend portability. |
| `SignedReadAuth` | `sdk/src/modules/*` (now consolidated), `lunes-dex-main/src/sdk/AsymmetricClient`, `lunes-dex-main/src/services/marginService` | dex copies are slightly different (required vs optional fields) and live in the frontend package — importing from sdk would create a cross-package runtime dependency on `@lunex/sdk` that the dex currently avoids for bundle-splitting reasons. |
| `JsonObject` | `mcp/lunex-agent-mcp/src/index.ts`, `mcp/lunex-agent-mcp/src/routerTools.ts`, `mcp/lunex-agent-mcp/src/smokeRouter.ts` | `Record<string, unknown>` one-liner — trivial, local, no shared module in mcp package. Consolidating would require a new shared file with minimal benefit. |

---

## Left As-Is — Same-Package (Non-Candidates)

| Name | Package | Reason left |
|------|---------|-------------|
| `CompatEntity` | `subquery-node` (11 files) | All 11 model files are **auto-generated** (header: `// Auto-generated , DO NOT EDIT`). Editing them risks being overwritten by SubQuery's codegen on next schema regeneration. |
| `IndexedEventKind` | `spot-api` (2 files) | **Diverged shapes** — `socialIndexerService` includes `'ASYMMETRIC_SWAP'`, `socialAnalyticsService` does not. Different domain subsets; consolidating into a union superset would incorrectly widen the analytics service's accepted values. |
| `ContractMethodKind` | `spot-api` (2 files) | Trivial one-liner (`'tx' \| 'query'`). Both usages are purely internal to their service files. No shared types file exists in spot-api/src; creating one for a single one-liner adds more files than it removes. |
| `StyledProps` | `lunes-dex-main` (12 files) | **Different shapes per component** — each file defines its own CSS prop set (e.g. `{ maxWidth, minWidth, … }` vs `{ width, height, sizeInput, … }`). Name collision only; not the same type. |
| `Trade` | `lunes-dex-main` (2 files) | **Different shapes** — OrderBook: `{ id: number, price: number, amount: number, side: 'buy'\|'sell' }`; social/types: `{ date: string, pair: string, side: 'Buy'\|'Sell', entry: number }`. Different domains. |
| `Trader` | `lunes-dex-main` (2 files) | **Different shapes** — CopyModal: `{ id, name, fee, isAI }`; social/types: `{ id, name, username, address, … }`. Different views of a trader entity. |
| `TabType` | `lunes-dex-main` (2 files) | **Different values** — social page: `'all'\|'traders'\|'bots'\|'ideas'\|'leaderboard'`; affiliates page: `'overview'\|'tree'\|'payouts'`. Local UI enum, not a shared concept. |

---

## Layer Boundary Confirmation

- No `spot-api` → `sdk` import introduced.
- No `sdk` → `lunes-dex-main` or reverse import introduced.
- No frontend (`lunes-dex-main`, `lunex-admin`) → backend (`spot-api`) import introduced.
- No `mcp` → any app package import introduced.
- `subquery-node` untouched.
- `contracts/` (Rust) untouched.
