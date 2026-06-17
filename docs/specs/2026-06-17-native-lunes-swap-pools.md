# Spec — Native LUNES (auto-wrap) in Swap + Pools

**Status:** Approved (design) — ready for implementation planning
**Date:** 2026-06-17
**Area:** `lunes-dex-main` (React/Vite frontend)
**Decision record:** follows the market-standard native/wrapped pattern (ETH/WETH on
Uniswap; replicated by SOL/wSOL, BNB/WBNB, MATIC/WPOL).

## Goal

Present **LUNES** (the network's native coin) as the primary, default tradeable and
LP asset in **Swap** and **Liquidity Pools**, with transparent auto-wrap/unwrap to
**WLUNES** (the PSP22 wrapper the AMM actually trades). This removes the "two LUNES"
confusion (native balance vs WLUNES balance) so a user's real LUNES balance is
usable directly, matching how every major DEX handles its native coin.

## Market standard being followed (researched)

1. Native coin is the **default/primary** selectable asset; the wrapped token is
   secondary but **still reachable** (Uniswap keeps WETH selectable).
2. Wrapping is **transparent during a swap** — pick LUNES → Router wraps internally.
3. **LUNES↔WLUNES direct = a "Wrap"/"Unwrap" action, not a swap**: the action button
   changes to Wrap/Unwrap, quote/route/slippage are hidden, conversion is **1:1, no
   fee, no slippage** (calls WNative `deposit`/`withdraw`).
4. **Remove liquidity** lets the user choose to receive **LUNES or WLUNES** (default
   LUNES; note WLUNES output is slightly cheaper in gas).
5. **Max** on a native amount **reserves a gas buffer**.
6. Off-chain/intent systems (Uniswap's UniswapX ↔ our **Spot orderbook**) operate on
   the **wrapped** token — so Spot stays on WLUNES, and users must be able to wrap.

Sources: Uniswap support — "Why do ETH swaps involve converting to WETH?",
"Difference between removing liquidity as WETH and ETH"; Uniswap interface #2864
(Wrap-button pattern).

## Core model — display token vs routing token

- **Display token:** `LUNES` (`isNative: true`). What the user sees and selects.
- **Routing token:** `WLUNES` PSP22 (`CONTRACTS.WNATIVE` / `TOKENS.WLUNES`). The
  on-chain pair asset (pools remain WLUNES/X). Both are **8 decimals, 1:1**.
- Single source of truth: new module **`src/utils/nativeToken.ts`** owns:
  - `LUNES_TOKEN` definition (symbol `LUNES`, name `Lunes`, logo, isNative).
  - `isLunes(symbolOrAddress)` and `isWlunes(symbolOrAddress)`.
  - `toRoutingAddress(token)` → WLUNES address when token is LUNES, else token addr.
  - `toDisplayToken(addr)` → maps WLUNES addr → LUNES display token.
  - `classifyTrade(from, to)` → `'swap' | 'wrap' | 'unwrap'` and, for swaps, the
    Router method to use (see below). Pure, unit-tested.

## Behavior

### Token selector (`chooseToken/tokenRegistry.ts`)
- Default list shows **LUNES** (native) instead of WLUNES.
- WLUNES is **not in the default list** but **resolvable via search** (typing
  "WLUNES"/"Wrapped") so Wrap/Unwrap and Spot funding remain possible.
- `getTokenLogo`: LUNES uses the lunes logo.

### Balances
- For LUNES, show **native balance** (`getNativeBalance`, ÷1e8).
- **Max** on native LUNES leaves a gas buffer (constant, e.g. `GAS_RESERVE_LUNES`,
  default ~0.1 LUNES) so the tx can pay fees.

### Swap — method selection
| From | To | Action | Router/contract call | Approve? |
|---|---|---|---|---|
| LUNES | Token | swap | `swap_exact_native_for_tokens` (attach value) | no |
| Token | LUNES | swap | `swap_exact_tokens_for_native` | yes (token) |
| Token | Token | swap | `swap_exact_tokens_for_tokens` (existing) | yes |
| LUNES | WLUNES | **wrap** | WNative `deposit` (attach value) | no |
| WLUNES | LUNES | **unwrap** | WNative `withdraw` | no |

- **Quote** (`getAmountsOut`): build the path with the **WLUNES address** internally
  even when LUNES is selected (pool is WLUNES/X). Wrap/unwrap mode shows **1:1**, no
  quote call, no slippage, button label "Wrap"/"Unwrap".
- **Robustness fix (bug found in browser test):** guard the quote path so a missing
  pair (address not a valid base58 string) yields a clean "Insufficient liquidity"
  state instead of throwing `createType(AccountId): Invalid base58 ...`.

### Liquidity Pools
| Action | Call |
|---|---|
| Add liquidity LUNES + Token | `add_liquidity_native` (attach value) |
| Remove liquidity → LUNES + Token | `remove_liquidity_native` |
| Remove liquidity → WLUNES + Token | existing `remove_liquidity` (toggle) |
- Remove-liquidity offers a **receive-as toggle: LUNES (default) | WLUNES**.
- LP positions for WLUNES/X pools **display as LUNES/X**.

## Out of scope (this iteration)
- **Spot orderbook** and **Staking** keep WLUNES semantics (off-chain matching /
  separate mechanism, not Router-native). Documented inconsistency; follow-up later.
  Users fund Spot by wrapping LUNES→WLUNES via the Wrap action.

## Edge cases
- Gas reserve on native Max (above).
- Wrap/unwrap is 1:1, zero fee, zero slippage — no price-impact UI.
- Selecting LUNES on both sides is disallowed (same as selecting identical tokens).
- Decimals: LUNES and WLUNES both 8 — no scaling differences.
- Missing pair / no liquidity → graceful "Insufficient liquidity", never a thrown
  AccountId decode error.

## Architecture / isolation
- All native↔wrapped logic centralized in `src/utils/nativeToken.ts` (pure, tested).
  UI/services consume its helpers; no scattered `if symbol === 'WLUNES'` conditionals.
- Integration points: `tokenRegistry.ts`, `getTokenLogo.ts`, swap
  (`context/SDKContext.tsx`, `pages/home/index.tsx`, `services/contractService.ts`),
  pools (`pages/pool/index.tsx`, `hooks/usePools.ts`).

## Testing (Vitest — repo's frontend test runner)
- Unit: `nativeToken.ts` — mapping (display↔routing), `isLunes/isWlunes`,
  `classifyTrade` returns correct mode + Router method for every From/To combo.
- Characterization: quote-path guard returns graceful state (no throw) when the pair
  address is absent/non-string.
- Method-selection: given (from,to), the swap layer picks the documented call.

## Acceptance criteria
1. LUNES is the default from-token; selecting LUNES shows the user's **native** balance.
2. LUNES→Token swap uses `swap_exact_native_for_tokens` with no token approval.
3. Token→LUNES swap uses `swap_exact_tokens_for_native`.
4. LUNES↔WLUNES shows **Wrap/Unwrap** (1:1, no slippage) and calls deposit/withdraw.
5. Add/remove liquidity works with native LUNES; remove offers LUNES|WLUNES output.
6. WLUNES is hidden from the default list but findable via search.
7. Max on native LUNES leaves a gas buffer.
8. No `createType(AccountId)` crash on pairs without liquidity.
9. New Vitest unit tests for `nativeToken.ts` pass.
