# FINDING — Listing-fee decimals mismatch across contract ↔ token ↔ backend

**Date:** 2026-06-17
**Status:** ✅ RESOLVED (contract) — fix implemented (option C, decimals-agnostic),
TDD green (12/12), and **proven on-chain** (`spot-api/scripts/prove-listing-fee-decimals.ts`:
tier-1 fee on an 8-dec token = exactly 1_000 tokens, not 10M).
**Surfaced by:** on-chain system verification after deploying the full contract set
(`spot-api/scripts/verify-onchain-system.ts` + `verify-advanced-onchain.ts`).
**Severity:** HIGH (fund-moving path; listing feature was effectively unusable as wired).
**NOT a B1 regression** — B1 (`create_lock`) works. This was in `list_token` Steps 1–3
(fee collection), orthogonal to the LP-lock fix.

## Resolution

- **Contract (fixed):** `listing_manager` no longer hardcodes `DECIMALS = 1e12`. The
  constructor now takes `lunes_decimals: u8`; tier fees/min-liq are whole-unit constants
  scaled by `10^lunes_decimals` at runtime (checked math). Works for any fee-token decimals.
- **Deploy (fixed):** `deploy-remaining-contracts.ts` queries the fee token's
  `token_decimals()` and passes it; `deploy-listing-contracts.ts` takes `LUNES_DECIMALS`
  (default 8). Both updated to the 6-arg constructor.
- **Backend (re-characterized — no functional fix needed):** `listingService.ts`
  `cfg.listingFee.toFixed(18)` stores the fee in **human units** as an 18-dp string (display/DB
  precision), NOT a 1e18 raw-unit scaling — so it does not cause an on-chain mismatch. The
  `tokenDecimals ?? 18` default applies to the *listed* token, not the fee token. (My initial
  "backend uses 18-dec for the fee" framing below was imprecise; the only true scaling bug was
  in the contract.) Recommend a saner default than 18 for `tokenDecimals` separately.
- **Verification:** `prove-listing-fee-decimals.ts` PASS on a live node; `prove-b1-lp-lock.ts`
  re-run PASS with the new constructor.

## The mismatch

The same "LUNES" amount on the listing-fee path is represented with **three different
decimal scales** across layers:

| Layer | Decimals | Evidence |
|---|---|---|
| `listing_manager` contract | **12** | `const DECIMALS = 1_000_000_000_000` (`lib.rs:43`), `TIER1_FEE = 1_000 * DECIMALS` |
| WLUNES PSP22 (deployed as `lunes_token`) | **8** | `wnative.token_decimals()` on-chain = 8; `deploy-contracts.ts` passes `8` to `wnative.new` |
| `wnative` contract's own unit test | **18** | `wnative/lib.rs:460` `assert_eq!(token_decimals(), 18)` |
| `spot-api` `listingService` | **18** | `listingService.ts:143` `cfg.listingFee.toFixed(18)`; `tokenDecimals ?? 18` |

The project's dominant canonical convention is **12 dec** ("plancks"):
`lunes-dex-main/src/utils/plancks.ts` (`PLANCKS_PER_UNIT = 1e12`),
`spot-api` `socialIndexerService`/`rebalancerService` (`PLANCKS_PER_UNIT = 1e12`).
So `listing_manager`'s 12-dec is consistent with that convention — but the **deployed
WLUNES token is 8-dec**, and the **backend formats the fee as 18-dec**.

## Concrete impact (with `lunes_token = WLUNES`, 8-dec)

`list_token` Step 1 collects `TIER1_FEE = 1_000 * 1e12 = 1e15` raw units via
`PSP22::transfer_from` on an **8-dec** token:

- `1e15 / 1e8 = 10,000,000 WLUNES` charged for a tier-1 listing meant to cost **1,000 LUNES** → **10,000× overcharge**.
- `TIER1_MIN_LIQ = 10_000 * 1e12 = 1e16` raw = **100,000,000 WLUNES** required as min liquidity (intended 10,000) → **unreachable**.
- Net effect: `list_token` is effectively **uncallable** with WLUNES as the fee token (no one holds 10M WLUNES), so the listing feature is broken as currently wired.
- The backend further reports the fee at 18-dec, so even the off-chain display/accounting disagrees with the on-chain charge.

## Root cause

The fee token's decimals are an **implicit, hardcoded assumption** in three places that
were never reconciled:
1. `listing_manager` hardcodes 12-dec and cannot read the token's actual decimals.
2. The deploy wires an 8-dec WLUNES as the fee token.
3. The backend assumes 18-dec.

There is no single canonical "LUNES fee-token decimals" constant shared across layers.

## Recommendation (needs a product decision — do NOT silently patch constants)

Decide the canonical fee-token + its decimals, then align all layers. Options:

- **A. Make WLUNES the canonical fee token at a fixed decimals (e.g. 8 or 12) and align
  everything.** Requires: deploy WLUNES with the chosen decimals consistently; set
  `listing_manager` `DECIMALS` to match; set backend to the same scale. Cleanest if WLUNES
  is the intended fee token.
- **B. Use a dedicated 12-dec LUNES PSP22 as the fee token** (separate from the 8-dec
  trading WLUNES). Keeps `listing_manager` as-is (12-dec) but the deploy must pass that
  token, not the 8-dec WLUNES.
- **C. Make `listing_manager` decimals-agnostic** — read `PSP22Metadata::token_decimals`
  of `lunes_token` at construction (or accept fee amounts in raw units via constructor),
  removing the hardcoded `DECIMALS`. Most robust; survives any token choice.

Whichever is chosen, also fix the **18-dec** assumption in `spot-api/listingService.ts`
(`toFixed(18)`, `tokenDecimals ?? 18`) and confirm the `wnative` unit test's 18-dec
expectation matches the deployed value.

## Verification once fixed

Re-run a real `list_token` on-chain (fund a wallet with the correct fee amount, approve,
call, assert fee transferred == intended and `create_lock` fires) — the existing
`spot-api/scripts/prove-b1-lp-lock.ts` already exercises the full path and can be extended
to assert the fee magnitude.
