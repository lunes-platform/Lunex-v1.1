# B5 — rewards→staking Bare Transfer Without ABI Notification

**Blocker ID:** B5  
**Severity:** P1 — staking rewards silently lost / misaccounted  
**Contracts touched:** `rewards`, `staking`

---

## SPEC

### Problem

`rewards/lib.rs:967–979` (`receive_fee_allocation`, payable message) does:

```rust
// rewards/lib.rs:967-978 (actual code)
if let Some(staking_address) = self.staking_contract {
    if staking_rewards_amount > 0 {
        if Self::env()
            .transfer(staking_address, staking_rewards_amount)
            .is_err()
        {
            return Err(TradingRewardsError::InsufficientBalance);
        }
        // Aqui deveria chamar o contrato de staking para notificar
        // mas por simplicidade vamos só transferir
    }
}
```

The comment "por simplicidade vamos só transferir" explicitly documents the shortcut. The bare native-token `env().transfer()` sends LUNES to `staking_address` but `staking::fund_staking_rewards` (the proper ABI entry-point) is never called.

### Verified `staking::fund_staking_rewards` Signature

```rust
// staking/lib.rs:1577-1596
#[ink(message, payable)]
pub fn fund_staking_rewards(&mut self) -> Result<(), StakingError> {
    self.ensure_not_paused()?;

    let caller = self.env().caller();
    if self.trading_rewards_contract != Some(caller) {
        return Err(StakingError::AccessDenied);
    }

    let amount = self.env().transferred_value();
    if amount == 0 {
        return Err(StakingError::ZeroAmount);
    }

    self.trading_rewards_pool = self
        .trading_rewards_pool
        .checked_add(amount)
        .ok_or(StakingError::Overflow)?;

    self.env().emit_event(TradingRewardsFunded { ... });
}
```

`fund_staking_rewards` is `#[ink(message, payable)]`. It:
1. Guards `caller == self.trading_rewards_contract` (rewards contract must be registered in staking)
2. Reads `transferred_value()` — the LUNES must be sent WITH the call, not separately
3. Increments `trading_rewards_pool` on-chain
4. Emits `TradingRewardsFunded` event for SubQuery

With the bare `env().transfer()` approach:
- `trading_rewards_pool` counter in staking is **never incremented** → staking contract doesn't know it has new rewards
- `TradingRewardsFunded` event is **never emitted** → SubQuery indexer blind to rewards funding
- `fund_staking_rewards` access guard (`trading_rewards_contract != Some(caller)`) is **never exercised**
- Staking contract receives LUNES balance but has no accounting entry for it

### Why the Bare Transfer Approach Is NOT Acceptable

1. **State divergence**: staking's on-chain `trading_rewards_pool` counter disagrees with actual balance → reward calculation corrupted.
2. **SubQuery blindness**: `TradingRewardsFunded` event not emitted → indexer cannot show users pending rewards.
3. **Security**: the authorized-caller guard in `fund_staking_rewards` (`trading_rewards_contract != Some(caller)`) exists to prevent unauthorized reward injection. By bypassing it, any contract that can call `env().transfer()` to staking can fund rewards — defeating the access control design.

### Fix: Replace `env().transfer()` with `build_call` to `fund_staking_rewards`

Send LUNES WITH the cross-contract message call. The `build_call` pattern is already used in `liquidity_lock/src/lib.rs:226–245` for PSP22 transfers, and the `listing_manager/src/lib.rs:93–130` uses `build_call` + selectors.

The key difference: `fund_staking_rewards` is `payable` — the call must use `.transferred_value(staking_rewards_amount)` in the `build_call` builder to attach LUNES to the message.

### Prerequisite: `trading_rewards_contract` Must Be Set in Staking

`staking/lib.rs:1552–1563` shows `set_trading_rewards_contract(contract_address)` exists and is owner-controlled. This must be set to the `rewards` contract's address post-deployment. Currently `staking.trading_rewards_contract` defaults to `None`, so even if `fund_staking_rewards` were called, it would return `AccessDenied`.

**Deploy sequence dependency:** `rewards` contract must be deployed → `staking::set_trading_rewards_contract(rewards_addr)` must be called → then `receive_fee_allocation` can call `fund_staking_rewards` successfully.

### Exact Files to Touch

| File | Lines | Change |
|---|---|---|
| `Lunex/contracts/rewards/lib.rs` | 967–978 | Replace `Self::env().transfer(...)` with `build_call` to `fund_staking_rewards` with `transferred_value(staking_rewards_amount)` |
| `Lunex/contracts/rewards/lib.rs` | imports | Add `use ink::env::call::{build_call, ExecutionInput, Selector};` if not present |
| `Lunex/contracts/rewards/lib.rs` | Error enum | Add `StakingNotificationFailed` variant |
| Deployment docs | — | Document `staking::set_trading_rewards_contract(rewards_addr)` as required post-deploy step |

### BOUNDARY

- **Must NOT change:** `rewards.rewards_pool` accounting (trading rewards portion), `receive_fee_allocation` payable message signature, `RewardsPoolFunded` event.
- **Must NOT change:** staking contract internals — `fund_staking_rewards` signature is used as-is.
- **No business logic leaks to frontend:** the fix is entirely within the rewards contract payable path.
- **Must NOT change:** the 90%/10% split logic between trading and staking.

### RISK

| Risk | Likelihood | Mitigation |
|---|---|---|
| `staking.trading_rewards_contract` not set → `fund_staking_rewards` returns `AccessDenied` → `receive_fee_allocation` fails → fee allocation reverts | High | Document deploy order; add graceful handling: if `trading_rewards_contract` is `None`, log and skip (but this silences accounting bug — prefer hard error with clear message) |
| Native LUNES must be attached to the `build_call` — the rewards contract must hold sufficient LUNES at call time | Medium | `receive_fee_allocation` is itself `payable`; the incoming `transferred_value` is the source; rewards contract passes it through — works if the `staking_rewards_amount` ≤ `env().transferred_value()` |
| Rewards contract currently stores `staking_contract: Option<AccountId>` but staking checks `trading_rewards_contract` — naming mismatch must not cause confusion | Low | The two fields refer to the same address from opposite perspectives; document in code comments |
| `build_call` with `transferred_value > 0` sends the contract's own balance — ensure rewards contract holds the LUNES at the time of the call (it does: the call arrives in `receive_fee_allocation` which is `payable`) | Low | Verify with unit test |

---

## BREAK

### Task B5-T1: Write failing test proving bare transfer doesn't update staking accounting

**Files:** `Lunex/contracts/rewards/lib.rs` (test module)  
**Acceptance:** Test asserts that after `receive_fee_allocation`, a mock staking contract's `trading_rewards_pool` is incremented — this fails because the bare transfer never calls `fund_staking_rewards`  
**Verify:**
```bash
cd Lunex/contracts/rewards && cargo test test_fee_allocation_notifies_staking 2>&1 | grep FAILED
```
**Boundary:** Test only  
**Risk:** None — TDD anchor

---

### Task B5-T2: Add `StakingNotificationFailed` error variant to rewards

**Files:** `Lunex/contracts/rewards/lib.rs` (TradingRewardsError enum)  
**Acceptance:** `cargo check -p rewards` passes  
**Verify:** `grep 'StakingNotificationFailed' Lunex/contracts/rewards/lib.rs`  
**Boundary:** Error enum only  
**Risk:** None

---

### Task B5-T3: Add `build_call` imports to rewards if not present

**Files:** `Lunex/contracts/rewards/lib.rs` (imports section)  
**Acceptance:** `use ink::env::call::{build_call, ExecutionInput, Selector};` present  
**Verify:** `grep 'build_call' Lunex/contracts/rewards/lib.rs`  
**Boundary:** Imports only  
**Risk:** None

---

### Task B5-T4: Replace bare `transfer` with `build_call` to `fund_staking_rewards`

**Files:** `Lunex/contracts/rewards/lib.rs` (lines 967–978)  
**Acceptance:**
  - `Self::env().transfer(staking_address, ...)` removed
  - Replaced with `build_call` targeting `staking_address`, selector `ink::selector_bytes!("fund_staking_rewards")`, `transferred_value(staking_rewards_amount)`, no push_arg (fn takes no parameters)
  - On error: return `Err(TradingRewardsError::StakingNotificationFailed)`
  - Comment "por simplicidade" removed
**Verify:**
```bash
cd Lunex/contracts/rewards && cargo test 2>&1 | grep -E 'test result|FAILED'
```
**Boundary:** Only the staking transfer path in `receive_fee_allocation`; trading pool accumulation unchanged  
**Risk:** If `staking_rewards_amount` exceeds `env().transferred_value()` due to rounding, call will fail — add overflow check

Implementation sketch:
```rust
if let Some(staking_address) = self.staking_contract {
    if staking_rewards_amount > 0 {
        build_call::<DefaultEnvironment>()
            .call(staking_address)
            .gas_limit(0)
            .transferred_value(staking_rewards_amount)
            .exec_input(
                ExecutionInput::new(Selector::new(
                    ink::selector_bytes!("fund_staking_rewards")
                ))
            )
            .returns::<Result<(), StakingError>>()
            .invoke()
            .map_err(|_| TradingRewardsError::StakingNotificationFailed)?
            .map_err(|_| TradingRewardsError::StakingNotificationFailed)?;
    }
}
```

---

### Task B5-T5: ink-e2e test for rewards→staking notification

**Files:** `tests/e2e_rewards_staking.rs`  
**Acceptance:** E2E test deploys both `rewards` and `staking`, sets `trading_rewards_contract` in staking, calls `receive_fee_allocation` with value, asserts staking's `trading_rewards_pool` is incremented and `TradingRewardsFunded` event was emitted  
**Verify:**
```bash
cd Lunex/contracts/rewards && cargo test --features e2e-tests e2e_rewards_notifies_staking 2>&1 | grep 'ok'
```
**Boundary:** E2E only  
**Risk:** Requires substrate-contracts-node; both `rewards.wasm` + `staking.wasm` must be compiled and deployed; `set_trading_rewards_contract` must be called pre-test

---

### Task B5-T6: Document deploy sequence

**Files:** `Lunex/contracts/rewards/README.md` or deployment script  
**Acceptance:** Documented: deploy `rewards` → `deploy staking` → `staking.set_trading_rewards_contract(rewards_addr)` → `rewards.set_staking_contract(staking_addr)` (bidirectional wiring)  
**Verify:** Human review  
**Boundary:** Docs/scripts  
**Risk:** None

---

## PLAN

### Implementation Approach

**Local pattern reused:** `liquidity_lock/src/lib.rs:226–245` — this is the clearest analog in the codebase for a payable cross-contract call with `build_call`. It sends PSP22 tokens WITH a message call. The rewards→staking call follows the same shape but with native value (`transferred_value`) instead of PSP22.

**Selector:** `ink::selector_bytes!("fund_staking_rewards")` — function name matches exactly; no namespace prefix needed (not a PSP22 trait method).

**Return type:** `Result<(), StakingError>` — SCALE-decodable. Use `.returns::<Result<(), StakingError>>()` in the builder.

### Why Bare Transfer Was "Simpler" and Why It's Wrong

`env().transfer(address, amount)` only moves the native token balance. The staking contract's `#[ink(message, payable)]` is NOT invoked — ink! messages are only triggered via ABI calls, not bare transfers. The staking contract receives LUNES in its balance but `trading_rewards_pool` is never incremented. This is analogous to sending ETH to a Solidity contract without calling a function — the contract can't track it.

### TDD Strategy

**First failing test (B5-T1):** Mock the staking contract in the rewards unit test environment. Assert that after `receive_fee_allocation`, the mock staking's `fund_staking_rewards` was called AND its `trading_rewards_pool` incremented. Current code will fail this (bare transfer, no mock call).

Unit test mocking strategy: In `#[cfg(test)]`, set `self.staking_contract = Some(mock_staking_addr)` where `mock_staking_addr` is a test account. Assert the mock emitted `TradingRewardsFunded` — this requires ink-e2e or a stub approach. For pure unit tests, assert that `env().transfer` is NOT called (can't directly assert this) vs assert `build_call` result propagates correctly.

Pragmatic approach: The clearest unit test is a negative — set staking_contract to zero address, call `receive_fee_allocation`, assert `Err(StakingNotificationFailed)` (since the build_call will fail). This proves the call attempt is made. B5-T5 (ink-e2e) proves the success path with real accounting.

### Cross-Contract Test Harness

B5-T5 requires substrate-contracts-node with both `rewards.wasm` and `staking.wasm`. This is the same node needed for B1 and B4, so infrastructure is shared. The `set_trading_rewards_contract` call must be part of the e2e setup fixture.
