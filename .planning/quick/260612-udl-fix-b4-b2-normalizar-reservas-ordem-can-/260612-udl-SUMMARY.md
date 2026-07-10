---
phase: quick-260612-udl
plan: 01
subsystem: lunes-dex-main
tags: [bug-fix, display, price-impact, reserves, decimals]
dependency_graph:
  requires: []
  provides:
    - reserveUtils.ts (normalizeReservesForPath, humanPrice)
  affects:
    - Pool page "Price" display (B4)
    - getQuote price impact calculation (B2)
tech_stack:
  added:
    - lunes-dex-main/src/utils/reserveUtils.ts
  patterns:
    - bigint arithmetic with 1e9 scale guard for decimal-adjusted price
    - canonical token_0 lookup before reserve orientation
key_files:
  created:
    - lunes-dex-main/src/utils/reserveUtils.ts
  modified:
    - lunes-dex-main/src/hooks/useLiquidity.tsx
    - lunes-dex-main/src/context/SDKContext.tsx
decisions:
  - "humanPrice uses 1e9 bigint scale instead of raw Number division to avoid precision loss on u128 reserves"
  - "getPairToken0 fallback to path[0] when RPC fails preserves existing behavior (T-udl-02 accepted)"
  - "getPairToken0 exposed in SDKContext as needed by useLiquidity; file added to Task 2 scope per plan instruction"
metrics:
  duration: ~20min
  completed: 2026-06-12
  tasks_completed: 3
  tasks_total: 3
  files_changed: 3
---

# Phase quick-260612-udl Plan 01: Fix B4+B2 Normalizar Reservas / Ordem Canônica Summary

**One-liner:** Decimal-adjusted price display and canonical reserve orientation for Uniswap V2 price impact using bigint arithmetic helpers.

## What Was Built

Two pure helper functions in `reserveUtils.ts` fix both bugs without changing any types or interfaces:

**B4 fix (useLiquidity.tsx):** Pool page "Price" was computing `reserve1/reserve0` as raw integers, yielding ~10.63 for a WLUNES(8dec)/LUSDT(6dec) pair instead of the correct ~1063.39. `humanPrice()` applies the decimal scale before the ratio, using a bigint 1e9 intermediate scale to avoid Number precision loss on large u128 values.

**B2 fix (SDKContext.tsx getQuote):** `reserveIn`/`reserveOut` were always assigned as `reserve0`/`reserve1` respectively, ignoring which token is `token_0` in the canonical pair ordering. When the user swaps in the reverse direction, the wrong reserve becomes `reserveIn`, causing the price impact formula to compute near-zero impact (since the ratio ends up inverted). `normalizeReservesForPath()` corrects the orientation by consulting `getPairToken0()` on the pair contract before the calculation.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Criar reserveUtils.ts | 37ee90c | lunes-dex-main/src/utils/reserveUtils.ts |
| 2 | Corrigir B4 useLiquidity.tsx | a54fc46 | lunes-dex-main/src/hooks/useLiquidity.tsx, lunes-dex-main/src/context/SDKContext.tsx |
| 3 | Corrigir B2 getQuote SDKContext.tsx | 83de77a | lunes-dex-main/src/context/SDKContext.tsx |

## Deviations from Plan

### Auto-added functionality (expected by plan)

**1. [Plan-directed] Added getPairToken0 to SDKContext**
- **Found during:** Task 2
- **Issue:** `sdk.getPairToken0` was not exposed in `SDKContext` interface or value object; calling it from `useLiquidity.tsx` would fail TypeScript
- **Fix:** Added `getPairToken0` to: SDKContextState interface, wrapper function, and `useMemo` value — pattern identical to `getPairInfo`
- **Files modified:** lunes-dex-main/src/context/SDKContext.tsx
- **Commit:** a54fc46
- **Note:** The plan explicitly said "Verificar se `sdk.getPairToken0` está exposto em `SDKContext.tsx`. Se não estiver, adicionar o wrapper lá também" — this is not a deviation but an expected conditional action

## Known Stubs

None. All data flows are wired to live on-chain calls. The fallback `?? tokenA.address` / `?? path[0]` is a defensive null-check for RPC failure, not a stub.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: T-udl-02 (accepted) | SDKContext.tsx | getPairToken0 fallback to path[0] when RPC fails — price impact may be underestimated; protected by on-chain PriceImpactTooHigh validation |

## Verification

- `npx tsc --noEmit` (lunes-dex-main): 0 errors after each task
- Browser verification (manual, by orchestrator): Pool page WLUNES/LUSDT should show ~1063.39 LUSDT/WLUNES; swap of 5 WLUNES should show price impact > 0%

## Self-Check: PASSED

- lunes-dex-main/src/utils/reserveUtils.ts: FOUND (37ee90c)
- lunes-dex-main/src/hooks/useLiquidity.tsx: FOUND (a54fc46)
- lunes-dex-main/src/context/SDKContext.tsx: FOUND (a54fc46, 83de77a)
- Commits 37ee90c, a54fc46, 83de77a: verified in git log

## Adendo do orquestrador (verificação browser + fix de conclusão)

Verificação browser pós-merge encontrou o B2 ainda manifestando impact 0,00%. Causa: bug **pré-existente** adicional na fórmula — `midPriceNum = aOut * reserveIn * BPS` pré-multiplicava por 10.000 antes da comparação `midPriceDen > midPriceNum`, que portanto nunca era verdadeira. O fix de orientação das reservas estava correto, mas mascarado por essa segunda camada.

Fix de conclusão (commit `53babbc`):
- Removido `* BPS` prematuro do `midPriceNum`.
- `getQuote` ganhou `decimalsIn?/decimalsOut?` e `executionPrice` passou a escala humana (era ratio raw ÷100 no par 8↔6 dec — mesmo bug-família do B4 na página Swap).
- Callers `pages/home/index.tsx` e `hooks/useSwap.tsx` passam os decimais.

Verificação browser final (par WLUNES/LUSDT real, reservas 76,79 ↔ 81.660):
- Pool "Price": **1063.391882** LUSDT/WLUNES ✓ (antes 10.633919)
- Swap 5 WLUNES: price impact **6,55%** ✓ (antes 0,00%; cálculo manual: 6,56%)
- Swap "Price": **993.698082** LUSDT ✓ (antes 9.936981)
- `npx tsc --noEmit`: 0 erros ✓
