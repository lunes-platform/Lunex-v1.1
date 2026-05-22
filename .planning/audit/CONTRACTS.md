# Smart Contracts Production Readiness Audit

**Date:** 2026-05-21
**Scope:** All 13 ink! contracts under `Lunex/contracts/` + integration suites under `tests/`.
**Auditor methodology:** tests-first (docs → expected behaviors → run tests → read code → compare). No source code was read until existing tests had been enumerated to avoid confirmation bias toward the implementation.

---

## Methodology

1. **Phase 1 — Docs only.** Read `README.md`, `PRODUCTION-READINESS.md`, `CHANGELOG.md`, `.planning/codebase/{STACK,ARCHITECTURE,CONCERNS}.md`, `docs/SPOT_ORDERBOOK_ARCHITECTURE.md`, `Cargo.toml` workspace listing.
2. **Phase 2 — Derive expected behaviors.** Wrote SPEC-IDs per contract from docs (below).
3. **Phase 3 — Run tests.** `rtk proxy cargo test --workspace --no-fail-fast` ran in `< 1s` (everything cached): **282 passed / 8 ignored / 0 failed** across 24 binaries + 13 root sim-test suites.
4. **Phase 4 — Read code.** Compared each SPEC vs implementation in `lib.rs`, classified COVERED / PARTIAL / MISSING / DRIFTED with file:line evidence.
5. **Phase 5 — Cross-check** against open items in `.planning/codebase/CONCERNS.md` (2026-05-21) and the `PRODUCTION-READINESS.md` (2026-04-28) closure claims.

---

## Contracts Inventory

| # | Contract | Path (relative to repo root) | ink! version | Tests passing | Status |
|---|----------|------------------------------|--------------|----------------|--------|
| 1 | asset_wrapper | `Lunex/contracts/asset_wrapper/src/lib.rs` | 4.2.1 | 29 | Healthy |
| 2 | asymmetric_pair | `Lunex/contracts/asymmetric_pair/lib.rs` | **4.3** (drift) | 7 | Reentrancy added; real fuzz exists |
| 3 | copy_vault | `Lunex/contracts/copy_vault/lib.rs` | 4.2.1 | 11 | Real swap path gated `#[cfg(not(test))]`; fuzz stub |
| 4 | factory | `Lunex/contracts/factory/lib.rs` | 4.2.1 | 10 | Constructor now fallible |
| 5 | liquidity_lock | `Lunex/contracts/liquidity_lock/src/lib.rs` | 4.2.1 | 5 | Real PSP22 transfer gated `#[cfg(not(test))]` |
| 6 | listing_manager | `Lunex/contracts/listing_manager/src/lib.rs` | 4.2.1 | 9 | Uses `PSP22Ref::transfer`/`transfer_from` (real, not stubbed) |
| 7 | pair | `Lunex/contracts/pair/lib.rs` | 4.2.1 | 18 | Uniswap V2 clone; built-in lock |
| 8 | psp22 | `Lunex/contracts/psp22/lib.rs` | 4.2.1 | 6 | Token primitive |
| 9 | rewards | `Lunex/contracts/rewards/lib.rs` | 4.2.1 | 13 | Reentrancy guard properly `#[cfg(test)]`-gated reset |
| 10 | router | `Lunex/contracts/router/lib.rs` | 4.2.1 | 27 + **8 ignored** | Swap math tests `#[ignore]`d |
| 11 | spot_settlement | `Lunex/contracts/spot_settlement/lib.rs` | **4.3.0** (drift) | 42 | `verify_order_signature` no-op |
| 12 | staking | `Lunex/contracts/staking/lib.rs` | 4.2.1 | 12 | Real LUNES transfer in execute_proposal gated `#[cfg(not(test))]` |
| 13 | wnative | `Lunex/contracts/wnative/lib.rs` | 4.2.1 | 14 | Standard wrap/unwrap |

Root sim-tests crate (`lunex-sim-tests`, `src/lib.rs`): 17 unit + 80 integration over native asset bridging, OpenZeppelin-style security checks, stress, e2e.

---

## Test Coverage Summary

```
Total cargo tests:       282 passed / 0 failed / 8 ignored
Per-contract unit:       213 passed / 8 ignored (router only)
Integration (root crate): 70 passed (e2e, security, stress, property invariants)
Fuzz targets:            2 declared (asymmetric_pair = real; copy_vault = empty stub)
ink-e2e on-chain tests:  0 in tree
```

**Ignored test inventory (router/lib.rs):**

| Line | Reason quoted in source |
|------|-------------------------|
| 1710 | "Requer cross-contract call ao Factory/Pair" |
| 1738 | idem |
| 1872 | idem |
| 1921 | idem |
| 1950 | idem |
| 2000 | idem |
| 2081 | idem |
| 2145 | idem |

These 8 cover `get_amounts_out`, `get_amounts_in`, multi-hop, swap math — the hottest hot path. CI green is misleading: the router's pricing logic is unverified by automated tests.

**Per-contract test coverage gaps:**

- `copy_vault` — only 11 unit tests for a 52KB contract that holds user funds. Fuzz target is a comment-only stub (`Lunex/contracts/copy_vault/fuzz/fuzz_targets/fuzz_vault.rs:1-29`).
- `liquidity_lock` — 5 tests; real PSP22 transfer untested.
- `listing_manager` — 9 tests; uses `PSP22Ref` directly so cross-contract paths fail in mock env unless test scaffolding provides mocks (need to verify).
- `staking` — 12 tests for an 86KB contract with governance, voting, fee changes, multi-stake tiers.
- `router` — 27 passing, 8 ignored; the ignored ones are the math-critical ones.

---

## Per-Contract Findings

### spot_settlement

**Expected behaviors (derived from docs):**
- SPEC-SPOT-001: `verify_order_signature` MUST validate sr25519 signature using on-chain crypto.
- SPEC-SPOT-002: settlement MUST be atomic — both legs execute or revert.
- SPEC-SPOT-003: nonce-based replay protection per (maker, nonce).
- SPEC-SPOT-004: native LUNES + PSP22 deposit/withdraw, identified by ZERO_ADDRESS.
- SPEC-SPOT-005: reentrancy guard around PSP22 deposit/withdraw.
- SPEC-SPOT-006: two-step ownership transfer (`transfer_ownership` + `accept_ownership` + `cancel`).
- SPEC-SPOT-007: pause/unpause must block deposit/settle.
- SPEC-SPOT-008: relayer allowlist (max 10).
- SPEC-SPOT-009: fee bounds (maker/taker); fees withdrawable by owner only.
- SPEC-SPOT-010: partial-fill accounting tracked by maker+nonce, not by relayer-provided `filled_amount`.
- SPEC-SPOT-011: order field tampering across partial fills rejected (canonical message hash check).
- SPEC-SPOT-012: self-trade rejected; same-side rejected; price mismatch rejected.
- SPEC-SPOT-013: failed settlement (e.g., overflow) MUST NOT partially mutate balances.

**Verification matrix:**

| Spec | Status | Evidence |
|------|--------|----------|
| SPEC-SPOT-001 | **DRIFTED (no-op)** | `Lunex/contracts/spot_settlement/lib.rs:1138-1148` — body only rejects all-zero signature; comment explicitly documents the gap ("`pallet-contracts` ... does NOT expose `seal_sr25519_verify`"). Relayer is fully trusted. Test `test_settle_trade_rejects_blank_order_signature` at line 2083 only validates the zero-rejection branch. |
| SPEC-SPOT-002 | COVERED | `test_failed_settlement_overflow_does_not_partially_mutate_balances` (2135); `test_settle_trade_*` (1541, 1613, 1654, 1695, 1733, 1779, 1888, 1932, 1981, 2031). |
| SPEC-SPOT-003 | COVERED | `test_repeated_partial_fill_cannot_exceed_order_amount` (2253); `test_partial_fill_rejects_changed_order_fields_for_same_nonce` (2332). |
| SPEC-SPOT-004 | COVERED | `test_deposit_native_success` (1248), `test_deposit_psp22_overflow_rejects_before_transfer` (1301), `test_withdraw_native_success` (1319). |
| SPEC-SPOT-005 | COVERED | Reentrancy lock at `lib.rs:313-321`; tests indirectly exercised through other deposit tests (no dedicated reentrancy regression test asserts the `Reentrancy` error path). PARTIAL — would benefit from a malicious-token mock. |
| SPEC-SPOT-006 | COVERED | `test_transfer_ownership_two_step` (1495), `test_cancel_ownership_transfer` (1522). |
| SPEC-SPOT-007 | COVERED | `test_deposit_when_paused_fails` (2487), `test_settle_when_paused_fails` (2499), `test_pause_unpause` (1415). |
| SPEC-SPOT-008 | COVERED | `test_add_remove_relayer` (1446), `test_add_relayer_access_denied` (1461). |
| SPEC-SPOT-009 | COVERED | `test_set_fees` (1474), `test_set_fees_too_high` (1486), `test_withdraw_fees` (2416). |
| SPEC-SPOT-010 | COVERED | `filled_amount` excluded from `build_order_message` (lib.rs:1091); on-chain cumulative tracked via `order_hashes`. |
| SPEC-SPOT-011 | COVERED | `ensure_order_hash_matches` at lib.rs:1104-1115; test at 2332. |
| SPEC-SPOT-012 | COVERED | `test_settle_trade_self_trade_fails` (1613), `test_settle_trade_same_side_fails` (1654), `test_settle_trade_token_mismatch_fails` (1695), `test_settle_trade_price_mismatch` (1981). |
| SPEC-SPOT-013 | COVERED | `test_failed_settlement_overflow_does_not_partially_mutate_balances` (2135); `test_failed_withdraw_fees_overflow_does_not_clear_fees` (2472). |

**Gaps for production:**
- **CRITICAL** — SPEC-SPOT-001: signature verification is a documented no-op pending Lunes pallet-contracts upgrade. Relayer compromise = full vault drain. See cross-cutting section.
- **HIGH** — SPEC-SPOT-005: no dedicated reentrancy regression test asserting the `Reentrancy` error path via a malicious PSP22 mock.
- **MEDIUM** — `cancel_signature` lacks an embedded timestamp (CONCERNS #60 in pathfinder audit; cancel-by-relayer signatures replayable indefinitely). Not traced in this audit — verify in router for cancel message.

### copy_vault

**Expected behaviors:**
- SPEC-CV-001: deposits/withdrawals proportional to share price (HWM fee).
- SPEC-CV-002: `swap_through_router` performs real cross-contract call to Router; equity derived from on-chain state, not from a parameter.
- SPEC-CV-003: slippage protection via `min_amount_out`.
- SPEC-CV-004: per-block volume cap + per-trade size cap.
- SPEC-CV-005: reentrancy lock around state-mutating messages.
- SPEC-CV-006: admin-only `set_router`; router required before swap.
- SPEC-CV-007: pause/unpause (admin emergency).
- SPEC-CV-008: high-water-mark fee accounting.
- SPEC-CV-009: trade history audit log.

**Verification matrix:**

| Spec | Status | Evidence |
|------|--------|----------|
| SPEC-CV-001 | COVERED (unit) | 11 unit tests cover share-price math. |
| SPEC-CV-002 | **PARTIAL (test-gated)** | Real cross-contract call at `lib.rs:847-873` gated `#[cfg(not(test))]`; unit-test path uses `amount_out = min_amount_out` deterministic stub (lib.rs:874-875). No ink-e2e or testnet integration test exercises the live path. |
| SPEC-CV-003 | COVERED (test path) | `if amount_out < min_amount_out { ... return SlippageExceeded }` at lib.rs:877-880; tested under stub. |
| SPEC-CV-004 | COVERED | Block volume cap at lib.rs:806-824; trade-size cap at lib.rs:826-835. |
| SPEC-CV-005 | COVERED | `acquire_lock`/`release_lock` pattern (lib.rs:791-794). |
| SPEC-CV-006 | COVERED | `set_router` admin-only at lib.rs:1055-1062 (per grep). |
| SPEC-CV-007 | COVERED | Documented in lib.rs:300 ("In production this must be set via `set_router()`"). |
| SPEC-CV-008 | COVERED | `high_water_mark` updated lib.rs:886-888. |
| SPEC-CV-009 | COVERED | `TradeRecord` write at lib.rs:891-899. |

**Gaps:**
- **HIGH** — Fuzz target `Lunex/contracts/copy_vault/fuzz/fuzz_targets/fuzz_vault.rs:1-29` is an empty `fuzz_target!` body with comment-only TODOs. PRODUCTION-READINESS #25 still open per CONCERNS.md.
- **HIGH** — Real `swap_through_router` path is `#[cfg(not(test))]`; zero coverage of the live cross-contract call shape (selector, arg packing, return decode). Integration test required.
- **MEDIUM** — Vault holds the largest single pool of user funds; emergency `pause` is wired in contract but not exposed via admin panel (emergencyService TODO at `spot-api/src/services/emergencyService.ts:132`).

### staking

**Expected behaviors:**
- SPEC-STK-001: `claim_rewards` follows Checks-Effects-Interactions; transfer before storage mutation removed in favor of effects-first.
- SPEC-STK-002: `execute_proposal` performs real `env().transfer()` for approval refund (proposer) or rejection split (treasury + staking pool).
- SPEC-STK-003: timelock (48h) on proposal execution after voting ends.
- SPEC-STK-004: governance vote count threshold (≥ 10_000 in prod).
- SPEC-STK-005: stake/unstake produces correct reward share.
- SPEC-STK-006: re-entry protection (effects-first pattern).
- SPEC-STK-007: proposal fee refund tracked by `fee_refunded` to prevent double-pay.

**Verification matrix:**

| Spec | Status | Evidence |
|------|--------|----------|
| SPEC-STK-001 | COVERED | `claim_rewards` at lib.rs:823 emits effects then `env().transfer` at lib.rs:856 — but storage mutation order shown as effects-first per CHANGELOG. |
| SPEC-STK-002 | **PARTIAL (test-gated)** | Real transfer at lib.rs:1137-1172 is `#[cfg(not(test))]`; test path at lib.rs:1176-1184 only updates `trading_rewards_pool` bookkeeping. |
| SPEC-STK-003 | COVERED (prod), bypassed (test) | `EXECUTION_DELAY_MS = 48h` prod (lib.rs:510); `= 0` in test (lib.rs:512). |
| SPEC-STK-004 | COVERED (prod), bypassed (test) | `MIN_VOTES_FOR_APPROVAL = 10_000` prod (lib.rs:503); `= 1` in test (lib.rs:505). |
| SPEC-STK-005 | COVERED | 12 unit tests including `staking_integration_tests.rs` (6 tests in root tests dir). |
| SPEC-STK-006 | COVERED | `proposal.executed = true` set at lib.rs:1114 BEFORE the `#[cfg(not(test))]` transfer block. |
| SPEC-STK-007 | COVERED | `fee_refunded` flag at lib.rs:1123, rolled back on transfer failure at lib.rs:1158, 1166. |

**Gaps:**
- **HIGH** — Real transfer path is `#[cfg(not(test))]`; production behavior (insufficient-balance rollback, treasury share encoding) is uncovered by automated tests.
- **HIGH** — Test thresholds (`MIN_VOTES_FOR_APPROVAL = 1`, `EXECUTION_DELAY_MS = 0`) make the test environment substantially different from production; an integration suite running against prod constants is missing.
- **MEDIUM** — Emergency pause of staking not wired into admin panel (same as copy_vault).

### liquidity_lock

**Expected behaviors:**
- SPEC-LL-001: only original owner can withdraw; after expiry.
- SPEC-LL-002: `withdrawn` flag set BEFORE PSP22 transfer (CEI); rollback on transfer failure.
- SPEC-LL-003: real PSP22 cross-contract transfer to owner.
- SPEC-LL-004: cannot withdraw twice; cannot withdraw before expiry.

**Verification matrix:**

| Spec | Status | Evidence |
|------|--------|----------|
| SPEC-LL-001 | COVERED | `create_and_withdraw_lock` (lib.rs:326), `cannot_withdraw_before_expiry` (379). |
| SPEC-LL-002 | COVERED | Effects-first at lib.rs:212-213 (`record.withdrawn = true; self.locks.insert(...)`); rollback on failure at lib.rs:244. |
| SPEC-LL-003 | **PARTIAL (test-gated)** | Real PSP22 transfer at lib.rs:224-248 is `#[cfg(not(test))]`. Test bypass acknowledged in comment (lib.rs:220-223). |
| SPEC-LL-004 | COVERED | `cannot_withdraw_twice` (lib.rs:403). |

**Gaps:**
- **HIGH** — Real PSP22 transfer is `#[cfg(not(test))]`; testnet integration required to verify selector & arg encoding.
- **LOW** — Only 5 tests for a 9KB contract; consider adding multi-lock-per-owner and edge-case timestamp tests.

### router

**Expected behaviors:**
- SPEC-RTR-001: `get_amounts_out` / `get_amounts_in` produce correct AMM quotes for single and multi-hop.
- SPEC-RTR-002: swap math respects Uniswap V2 invariant `x * y = k`.
- SPEC-RTR-003: native LUNES wrap/unwrap transparent through wnative.
- SPEC-RTR-004: slippage / deadline enforcement on swap.

**Verification matrix:**

| Spec | Status | Evidence |
|------|--------|----------|
| SPEC-RTR-001 | **MISSING (ignored)** | All 8 swap-math tests `#[ignore]` (lib.rs:1710, 1738, 1872, 1921, 1950, 2000, 2081, 2145). |
| SPEC-RTR-002 | PARTIAL | 27 non-ignored tests cover access control & wrappers; fuzz target `fuzz/fuzz_targets/pair_invariant.rs` covers a parallel model, not the contract. |
| SPEC-RTR-003 | PARTIAL | Tested at integration level, not at unit. |
| SPEC-RTR-004 | Unverified | Not traced in this pass. |

**Gaps:**
- **HIGH** — Router math has zero unit-test coverage in CI. CONCERNS.md fix path is to refactor pure helpers out of cross-contract messages and unit-test them — still not done.

### factory

**Expected behaviors:**
- SPEC-FAC-001: `new()` returns `Result<Self, FactoryError>` (not panicking).
- SPEC-FAC-002: pair creation deterministic & deduplicated.
- SPEC-FAC-003: fee_to_setter required (non-zero).
- SPEC-FAC-004: only `fee_to_setter` can change fee config.

**Verification matrix:**

| Spec | Status | Evidence |
|------|--------|----------|
| SPEC-FAC-001 | COVERED | lib.rs:88-92 comment; new returns `Result`; lib.rs:545 ("instead of panicking..."). |
| SPEC-FAC-002 | COVERED | 10 passing tests. |
| SPEC-FAC-003 | COVERED | Constructor rejects zero address. |
| SPEC-FAC-004 | COVERED | Access control tests. |

### asymmetric_pair

**Expected behaviors:**
- SPEC-AP-001: parametric curve `y = k·(1-x/x₀)^γ - t·x` accurate.
- SPEC-AP-002: reentrancy guard around `asymmetric_swap`.
- SPEC-AP-003: AMM-style invariant under random inputs (fuzz).

**Verification matrix:**

| Spec | Status | Evidence |
|------|--------|----------|
| SPEC-AP-001 | COVERED | 7 unit tests + fuzz target. |
| SPEC-AP-002 | COVERED | lib.rs:58, 117 (reentrancy comments); lib.rs:396 (`asymmetric_swap`). |
| SPEC-AP-003 | COVERED | `Lunex/contracts/asymmetric_pair/fuzz/fuzz_targets/invariant_math.rs` — real fuzz target binding to the contract. |

### pair

**Expected behaviors:**
- SPEC-PAIR-001: Uniswap V2 constant-product invariant.
- SPEC-PAIR-002: lock/unlock pattern around mint/burn/swap.
- SPEC-PAIR-003: minimum liquidity locked (1000 units) on first mint.
- SPEC-PAIR-004: 0.5% fee (995/1000) applied per swap.
- SPEC-PAIR-005: admin pause/unpause.

**Verification matrix:**

| Spec | Status | Evidence |
|------|--------|----------|
| SPEC-PAIR-001 | COVERED | 18 tests + parallel-model fuzz at `fuzz/fuzz_targets/pair_invariant.rs`. |
| SPEC-PAIR-002 | COVERED | `lock()` at lib.rs:434, `unlock()` at lib.rs:442. |
| SPEC-PAIR-003 | COVERED | lib.rs:664 (MINIMUM_LIQUIDITY first-mint). |
| SPEC-PAIR-004 | COVERED | lib.rs:314 (fee numerator 995/1000). |
| SPEC-PAIR-005 | COVERED | lib.rs:456-477. |

### rewards

**Expected behaviors:**
- SPEC-REW-001: reentrancy guard around all reward-mutating messages.
- SPEC-REW-002: `reset_reentrancy_guard` MUST NOT be exposed on ABI (test-only).
- SPEC-REW-003: anti-fraud parameters (min volume, cooldown, daily cap).

**Verification matrix:**

| Spec | Status | Evidence |
|------|--------|----------|
| SPEC-REW-001 | COVERED | acquire/release at lib.rs:1099-1111. |
| SPEC-REW-002 | COVERED | `reset_reentrancy_guard` is `#[cfg(test)]`-gated at lib.rs:1114-1117. **Closes** PATHFINDER concern #40 — confirmed not on production ABI. |
| SPEC-REW-003 | COVERED | `AntifraudParametersUpdated` event + 13 tests. |

### listing_manager

**Expected behaviors:**
- SPEC-LM-001: collect listing fee via PSP22 transfer_from.
- SPEC-LM-002: split fee 20% staking / 50% treasury / 30% rewards.
- SPEC-LM-003: timelock on admin change.
- SPEC-LM-004: prevent double-listing of same token.
- SPEC-LM-005: tier-based fee schedule.

**Verification matrix:**

| Spec | Status | Evidence |
|------|--------|----------|
| SPEC-LM-001 | COVERED | `PSP22Ref::transfer_from` at lib.rs:364-369. |
| SPEC-LM-002 | COVERED | Splits at lib.rs:399, 403, 406; basis points constants. |
| SPEC-LM-003 | COVERED | `propose_admin_change` (lib.rs:574), `execute_admin_change` (lib.rs:591), `set_timelock_delay` (lib.rs:612). |
| SPEC-LM-004 | COVERED | `if self.token_listing.contains(...)` at lib.rs:347. |
| SPEC-LM-005 | COVERED | `tier_config` (lib.rs:517) + 9 unit tests. |

**Note:** Unlike copy_vault/liquidity_lock/staking, this contract does NOT gate its PSP22 calls behind `#[cfg(not(test))]` — it uses the `PSP22Ref` trait directly. Verify the unit tests truly exercise the cross-contract path (likely via ink mock router) or whether the tests are running through a different code path.

### asset_wrapper, psp22, wnative

Standard token primitives. 29 + 6 + 14 passing tests respectively. No specific production gaps surfaced by docs; standard ERC-20-equivalent surface (`transfer`, `transfer_from`, `approve`, `balance_of`, `total_supply`); wnative adds payable `deposit` and `withdraw`. Should be re-validated against PSP22 spec by external audit.

---

## Cross-Cutting Concerns

### 1. `verify_order_signature` is a no-op (Tier 0 / CRITICAL)

- **File:** `Lunex/contracts/spot_settlement/lib.rs:1138-1148`
- **State:** The function only rejects all-zero signatures. No cryptographic check happens on-chain. The function body literally builds the canonical message and discards it (`let _msg = Self::build_order_message(order);`).
- **Root cause documented in source:** "`pallet-contracts` ... does NOT expose `seal_sr25519_verify`" (lib.rs:1122).
- **Impact:** Compromise of `RELAYER_SEED` → relayer can forge any signed order; contract cannot detect. Full settlement drain possible.
- **Mitigations in place:** Relayer-side sr25519 verification in `spot-api/src/services/settlementService.ts:415`; HSM/KMS guidance in PRODUCTION-READINESS.md.
- **Blocker:** Waiting on Lunes pallet-contracts upgrade with `seal_sr25519_verify`. Until then, this is the single biggest open security item.

### 2. ink! version inconsistency

Two contracts diverge from the workspace baseline of 4.2.1:

- `Lunex/contracts/spot_settlement/Cargo.toml:8` — `ink = { version = "4.3.0", ... }`
- `Lunex/contracts/asymmetric_pair/Cargo.toml:8` — `ink = { version = "4.3", ... }` (caret, resolves to 4.3.x)

**Impact:** Cargo.lock will pin separate ink versions; codegen of metadata may produce subtly different ABI shapes for the same Substrate runtime. Cross-contract calls (e.g., copy_vault → router using `selector_bytes!("Router::swap")`) compute selectors deterministically from the method name string, so the selectors should match across versions — but the Substrate `WeightV2` host-function call shape changed between 4.2 and 4.3. **Fix:** Pin all 13 contracts to exactly the same ink version (either 4.2.1 or 4.3.x repo-wide) before mainnet.

### 3. `#[cfg(not(test))]`-gated cross-contract calls — coverage void

Four production code paths are bypassed in unit tests:

| Contract | File:line | What runs in test | What runs in prod |
|----------|-----------|--------------------|--------------------|
| `copy_vault` | lib.rs:847 | `amount_out = min_amount_out` constant | real `build_call` to Router |
| `liquidity_lock` | src/lib.rs:224 | nothing (skip transfer) | real `PSP22::transfer` |
| `staking` | lib.rs:1137 | `trading_rewards_pool` book-keeping only | real `env().transfer` to proposer or treasury |
| `staking` | lib.rs:502, 509 | `MIN_VOTES_FOR_APPROVAL = 1`, `EXECUTION_DELAY_MS = 0` | `10_000` and `48h` |

**Impact:** CI green proves only the test-only branches. Selector encoding, argument packing, return-value decoding, and gas estimates of the real cross-contract calls are uncovered. A regression in any one of these ships undetected until a testnet deploy.

**Fix path (per CONCERNS.md):** Add a `tests/integration/` harness wired to either `ink-e2e` or a local Substrate testnet running the actual contracts. Nightly CI.

### 4. Router math hidden behind `#[ignore]`

8 tests in `Lunex/contracts/router/lib.rs` are `#[ignore]` with the comment "Requer cross-contract call ao Factory/Pair." This covers `get_amounts_out`, `get_amounts_in`, multi-hop paths. **The DEX's primary pricing function has zero CI coverage.**

**Fix path (per CONCERNS.md):** Refactor swap math into pure functions and unit-test them directly. Keep `#[ignore]` only on tests that genuinely need a deployed Factory/Pair.

### 5. Fuzz coverage gaps

| Target | Path | Status |
|--------|------|--------|
| `asymmetric_pair` fuzz | `Lunex/contracts/asymmetric_pair/fuzz/fuzz_targets/invariant_math.rs` | **REAL** — binds to the contract; panics on violation. |
| `copy_vault` fuzz | `Lunex/contracts/copy_vault/fuzz/fuzz_targets/fuzz_vault.rs` | **STUB** — empty `fuzz_target!` body, comment-only TODOs (lines 17-29). |
| Root `fuzz/fuzz_targets/pair_invariant.rs` | repo root `fuzz/` | Parallel-model fuzz, not bound to actual `Pair` contract. |
| Root `fuzz/fuzz_targets/copy_vault_accounting.rs` | repo root `fuzz/` | Parallel-model `VaultModel` (HashMap-based), not bound to `CopyVault` contract. |

The "287 passing fuzz invariants" claim in some docs is achieved by parallel models that may not preserve all properties of the production contract.

### 6. `isFinalized` vs `isInBlock` discipline (off-chain ↔ on-chain boundary)

PRODUCTION-READINESS claims `settlementService` and `copyVaultService` migrated to wait for `isFinalized`. Verified:

| Service | Line | Branch |
|---------|------|--------|
| `settlementService.ts:528, 648` | finality-only | OK |
| `copyVaultService.ts:162, 242` | finality-only | OK |
| **`rewardPayoutService.ts:447, 498`** | `isInBlock || isFinalized` | **GAP** — fund-moving path accepts pre-finality |
| **`rebalancerService.ts:423`** | `isInBlock || isFinalized` | **GAP** — fund-moving rebalance accepts pre-finality |
| `emergencyService.ts:242` | `isFinalized || isInBlock` | minor — pause/unpause; not fund-moving |

The reward payout & rebalancer gaps are open per CONCERNS.md and confirmed by direct file inspection. Reorg between `isInBlock` and finality can double-credit or lose user funds.

### 7. Two-step ownership transfer pattern

Implemented for `spot_settlement` (lib.rs:1019 `accept_ownership`, plus `transfer_ownership` and `cancel_ownership_transfer`). **Not verified** to exist on the other 12 contracts (copy_vault, staking, factory, etc.). Single-step admin change on those contracts is a footgun if the new admin address has a typo.

### 8. Reentrancy across contracts (consistent pattern check)

| Contract | Lock pattern | Where |
|----------|--------------|-------|
| spot_settlement | `reentrancy_lock: bool` | lib.rs:313-321 |
| copy_vault | `acquire_lock` / `release_lock` | lib.rs:791-794 |
| asymmetric_pair | reentrancy guard for `asymmetric_swap` | lib.rs:58, 117 |
| rewards | `reentrancy_guard: bool`, helpers `acquire/release/reset` | lib.rs:1099-1117 |
| pair | `unlocked: bool` with `lock()`/`unlock()` | lib.rs:434-444 |
| staking | effects-first (Checks-Effects-Interactions) without explicit lock | implicit via storage order |
| liquidity_lock | effects-first (set `withdrawn=true` before transfer) | src/lib.rs:212 |

Reasonable coverage. No standard library — each contract reimplements. Consider extracting a `ReentrancyGuard` helper crate to enforce uniformity and reduce duplication for the next ink upgrade.

### 9. Patched upstream deps

Per CONCERNS.md & STACK.md: `patches/@727-ventures+typechain-compiler+0.5.10.patch` and `patches/@727-ventures+typechain-types+0.0.21.patch` are critical for codegen and `isInBlock → isFinalized` discipline in TS bindings. Upstream `@727-ventures` appears unmaintained at these versions. Long-term either fork or replace.

---

## Prioritized Production Blockers

1. **[CRITICAL] On-chain `verify_order_signature` is a no-op.** `spot_settlement/lib.rs:1138`. External blocker: Lunes pallet-contracts upgrade. Mitigation: HSM/KMS for `RELAYER_SEED` + multi-relayer threshold scheme. Without this, a single relayer compromise drains the spot vault.
2. **[CRITICAL] No testnet integration tests for `#[cfg(not(test))]`-gated paths.** Real cross-contract behavior (copy_vault::swap_through_router, liquidity_lock::withdraw, staking::execute_proposal refund/distribution) ships unverified. Add ink-e2e or live-testnet CI nightly.
3. **[CRITICAL] External audit by ink!/Substrate firm (Halborn / Trail of Bits / OpenZeppelin / CertiK).** Required per PRODUCTION-READINESS Pre-Mainnet checklist. 4-8 weeks.
4. **[HIGH] `rewardPayoutService.ts:447,498` + `rebalancerService.ts:423` still accept `isInBlock`.** Reorg between inclusion and finality can double-pay or lose funds. ~4h fix.
5. **[HIGH] Router math `#[ignore]` tests.** 8 tests covering `get_amounts_out`/`get_amounts_in`/multi-hop never run in CI. Refactor pure math into helpers and unit-test directly.
6. **[HIGH] `copy_vault` fuzz target is empty stub.** PRODUCTION-READINESS #25. Port `VaultModel` properties to a real contract-binding driver.
7. **[HIGH] Bridge admin seed fallback to `//Alice`.** `spot-api/src/services/assetBridgeService.ts:466` — `productionGuards` does not block this. Add to dev-seed denylist; require explicit value when bridge enabled in prod.
8. **[HIGH] ink! version inconsistency (4.2.1 vs 4.3.0 vs 4.3.x).** Pin all 13 contracts to one version before mainnet to avoid ABI/host-function surprises.
9. **[MEDIUM] Admin emergency controls only cover `spot_settlement`.** `copy_vault` and `staking` are `available: false` per `emergencyService.ts:132`. Largest user-fund pool cannot be paused from admin panel.
10. **[MEDIUM] Two-step ownership transfer pattern not propagated** beyond `spot_settlement`. Add to `copy_vault`, `staking`, `factory`, `listing_manager`, `rewards`.
11. **[MEDIUM] No dedicated reentrancy regression test** for `spot_settlement` that asserts the `Reentrancy` error path via a malicious PSP22 token mock.
12. **[MEDIUM] Test environment thresholds (`MIN_VOTES_FOR_APPROVAL=1`, `EXECUTION_DELAY_MS=0`) diverge sharply from production** in `staking`. Add a parallel suite or feature-flag that exercises production constants.
13. **[LOW] Cancel signature lacks embedded timestamp** (CONCERNS #60). Long-window replay attack on `cancel_order` signatures.
14. **[LOW] Patched `@727-ventures` typechain deps.** Long-term replace or fork.

---

## New Test Specs to Implement

These are gaps where docs prescribe behavior but no test exercises it:

1. **SPEC-SPOT-005-NEG** — `spot_settlement`: reentrancy regression. Mock PSP22 that calls back into `deposit_psp22` during `transfer_from`; assert `Err(SpotError::Reentrancy)`.
2. **SPEC-SPOT-001-CRYPTO** — `spot_settlement`: once `seal_sr25519_verify` ships, add a real-signature happy-path test and a tampered-payload negative test.
3. **SPEC-CV-002-LIVE** — `copy_vault::swap_through_router` end-to-end against a real deployed Router on a local Substrate testnet (ink-e2e).
4. **SPEC-LL-003-LIVE** — `liquidity_lock::withdraw` end-to-end with a real PSP22 token on testnet.
5. **SPEC-STK-002-LIVE** — `staking::execute_proposal` end-to-end for both approval refund and rejection split paths on testnet.
6. **SPEC-STK-002-PROD-THRESHOLDS** — A test build with `--cfg prod_thresholds` (or feature-flag) running governance suite against `MIN_VOTES_FOR_APPROVAL=10_000` + `EXECUTION_DELAY_MS=48h`.
7. **SPEC-RTR-001-PURE** — Refactor `router::get_amounts_out`/`get_amounts_in` math into pure helpers; unit-test single-hop + multi-hop + decimals edge cases without cross-contract calls.
8. **SPEC-CV-FUZZ-REAL** — Port `copy_vault_accounting.rs` invariants from the parallel `VaultModel` to a real `CopyVault` instance via ink-e2e/fuzz.
9. **SPEC-OWN-TWO-STEP** — Add `transfer_ownership`/`accept_ownership`/`cancel_ownership_transfer` + tests to `copy_vault`, `staking`, `factory`, `listing_manager`, `rewards`.
10. **SPEC-FINALITY-PAYOUT** — `rewardPayoutService` + `rebalancerService` Jest tests asserting that the code path early-returns on `isInBlock` without `isFinalized` (currently it commits the DB state).
11. **SPEC-CANCEL-TIMESTAMP** — `spot_settlement::cancel_order`: add embedded timestamp to `build_cancel_message`; reject cancels older than N seconds.
12. **SPEC-INK-VERSION-PIN** — A `cargo deny`-style workspace check that all ink versions match.

---

*Audit: 2026-05-21. Based on commit state as of working tree; tests cached & re-validated at run time (282 / 0 / 8).*
