---
status: complete
quick_id: 260616-juv
commit: 216b455
date: 2026-06-16
---

# Quick Task 260616-juv — Confirm Swap: real quote values + gated confirm

## Outcome

The Confirm Swap modal previously hardcoded **"Unavailable"** for Minimum received,
Price impact and Liquidity Provider Fee — consent-before-signing fields. The values
were already computed by `SDKContext.getQuote` and held in `home/index.tsx` state;
they were simply never passed into the modal. Now wired and gated.

## Changes (commit `216b455`, code only)

- **`confirmSwap/index.tsx`** — extended `ConfirmSwapProps` (`minimumReceived`,
  `priceImpact`, `inputValue1`, `inputAcronym`, `outputAcronym`); replaced the three
  "Unavailable" literals with real values; LP Fee shown as 0.3% of input
  (`computeLpFee`); Confirm button now `disabled={!isChecked || !quoteReady}`;
  caveat copy at 63-66 updated to reflect the wired minimum.
- **`quoteUtils.ts` (+ `quoteUtils.test.ts`)** — pure `computeLpFee()` and
  `isQuoteReady()` with the LP rate anchored to `pair/lib.rs` `LP_FEE_SHARE=600`
  (0.3% of trade). `isQuoteReady` gates on `minimumReceived` only — `priceImpact='0'`
  is a valid live result and must not block. 10 unit tests.
- **`home/index.tsx`** — passes the new props to `<M.ConfirmSwap>`; **corrected the
  wrong on-page fee breakdown** to match the contract: tooltip (line 318) and the
  `0.4% LP + 0.05% + 0.05%` row (line 336) → `0.3% LP + 0.1% Protocolo + 0.1% Stakers`
  (contract: total 0.5%, LP 0.3%, protocol 0.1%, stakers 0.1%).

## Verification

- `npx tsc --noEmit` → clean (exit 0)
- `npx vitest run quoteUtils` → **10/10 passed** (exit 0)
- **DEFERRED:** browser/E2E verification of the modal — the full stack
  (spot-api/postgres) is down per STATE.md. Re-verify in-browser when the stack is up.

## Notes / follow-ups

- The contract's canonical fee is **0.5% total / 0.3% LP / 0.1% protocol / 0.1% stakers**
  (`pair/lib.rs:312-322`). `usePools.ts:231` still reports an ambiguous `'0.3%'` — worth
  reconciling separately so every surface cites the same source.
- LP fee in the modal is a **display estimate** (float math) — acceptable since the
  authoritative fee is applied on-chain; not fund-moving.

## Process note

The `gsd-executor` subagent completed all edits and staged them but died on a transient
API 500 before committing/writing this summary. The orchestrator verified the staged
work independently (tsc + vitest), committed it (`216b455`), and authored this summary.
