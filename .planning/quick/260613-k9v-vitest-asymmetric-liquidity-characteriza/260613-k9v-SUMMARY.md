---
quick_id: 260613-k9v
slug: vitest-asymmetric-liquidity-characteriza
date: 2026-06-13
status: complete
runner: vitest
---

# Summary — Vitest + Asymmetric Liquidity characterization tests

## Outcome

`lunes-dex-main` now has a working test runner and **25 passing characterization
tests** that lock the Asymmetric Liquidity behaviour (and the recent B4/B2
reserve-decimal fix) against silent regression. Zero product behaviour changed.

## What shipped (3 atomic commits)

| Commit | Type | Content |
|--------|------|---------|
| d5ada14 | chore | Vitest 3 + jsdom infra: `test`/`test:run` scripts, `vitest.config.ts` (jsdom env, src alias mirror) |
| 6f9313b | refactor | Extracted `toPlancks` + `PLANCKS_PER_UNIT` verbatim → pure `src/utils/plancks.ts`; hook imports it (no logic change) |
| b2f8c48 | test | 3 characterization specs (25 tests) |

(Plan committed pre-dispatch as a491e78.)

## Tests added (25 total, all green)

- `src/utils/__tests__/reserveUtils.test.ts` (6) — `normalizeReservesForPath`
  path orientation + case-insensitive matching; `humanPrice` 8↔6 decimal
  adjustment (**1063.39**, 100× the naive 10.63), reciprocal, zero-reserve guard.
- `src/utils/__tests__/plancks.test.ts` (9) — `toPlancks` whole/fractional/
  smallest-unit/zero/empty/truncation/bad-input, plus two documented quirks
  (decimals-coupling; multi-dot input silently truncated to int + first frac).
- `src/components/asymmetric/__tests__/asymmetricCurve.test.ts` (10) —
  `simulateLiquidity` reproduces UI preview **Buy@30%=334.00 / Sell@30%=237.80**,
  base-at-zero, x≥x0 guard, x0≤0 guard, negative→0 clamp; `buildChartData` shape;
  `STRATEGY_TEMPLATES` integrity (3 templates, γ∈[1,5], k/x0 > 0).

## Verification

- `npm run test:run` → **25/25 pass**
- `tsc --noEmit` → exit 0 (no new errors)
- `prettier --check` + `eslint --max-warnings=0` on all changed files → clean
- Runner: Vitest 3.2.6 (pinned `^3` — Vitest 4 requires `@types/node` ≥20; repo pins 18)

## Notes / surprises (documented, not fixed — scope discipline)

- `toPlancks` hardcodes `decimals=12` (= PLANCKS_PER_UNIT 10^12) even though pair
  tokens can be 8/6 decimals. No caller passes a different `decimals`, so current
  behaviour is correct in practice; the coupling is locked + documented for a
  future conscious change.
- `toPlancks('1.2.3')` does **not** throw — `split('.')` keeps int + first
  fraction segment, dropping the rest (`→ '1200000000000'`). Surfaced by a test
  that initially assumed it would error; now characterized.

## Deferred (needs the local stack, which is down)

- Browser E2E of `/pool/asymmetric` — the local Lunes node (Colima/Docker,
  `ws://localhost:9944`) and `spot-api` :4000 went down when the machine shut
  off. The curve-preview values are now locked in code, so the regression
  guarantee no longer depends on the node. Bringing the stack back up for a live
  walkthrough is the next step.
