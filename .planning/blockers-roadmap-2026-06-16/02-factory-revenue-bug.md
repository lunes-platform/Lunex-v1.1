# B4 — Factory Revenue Bug: New Pairs Collect No Fees or Rewards

**Blocker ID:** B4 (factory revenue)  
**Severity:** P0 — silent revenue loss + rewards non-functional  
**Contracts touched:** `factory`, `pair`

---

## SPEC

### Problem

`factory/lib.rs:290–295` instantiates the pair contract via `PairContractRef::new(factory_address, token_0, token_1).instantiate()` but never calls `pair::set_protocol_fee_to` or `pair::set_trading_rewards_contract` afterward. Both fields are initialized to `None` in `pair/lib.rs:419–420`.

Consequence: **every pair created after genesis collects zero protocol fees and notifies no rewards contract**, because the fee-to and rewards collection paths are gated on `Option<AccountId>` being `Some(...)`.

### Verified Signatures

```rust
// pair/lib.rs:1312-1316
pub fn set_protocol_fee_to(&mut self, fee_to: AccountId) -> Result<(), PairError> {
    if self.env().caller() != self.factory { return Err(PairError::...); }
    self.protocol_fee_to.set(&Some(fee_to));
    Ok(())
}

// pair/lib.rs:1323-1330
pub fn set_trading_rewards_contract(
    &mut self,
    rewards_contract: AccountId,
) -> Result<(), PairError> {
    if self.env().caller() != self.factory { return Err(PairError::...); }
    self.trading_rewards_contract.set(&Some(rewards_contract));
    Ok(())
}
```

Both are guarded `caller == self.factory`. Factory already holds its own address as `factory_address` (line 287). The call must originate **from the factory contract** — exactly what happens when `create_pair` calls them after instantiation.

### Factory Storage (Confirmed Missing Fields)

`factory/lib.rs:60–130` shows storage fields: `fee_to`, `fee_to_setter`, `get_pair`, `all_pairs`, `all_pairs_len`, `pair_contract_code_hash`, `min_pool_liquidity`. **No `protocol_fee_to` or `trading_rewards_contract` field.** These must be added so `create_pair` can pass the addresses to each new pair.

### Two Fix Options

**Option A — Factory calls setters post-instantiate (recommended)**

After `let pair_address = pair.instantiate()` (line 295), the factory calls `pair.set_protocol_fee_to(fee_to_addr)` and `pair.set_trading_rewards_contract(rewards_addr)` using a `PairContractRef` reference. This requires factory to store `protocol_fee_to: AccountId` and `trading_rewards_contract: AccountId` in its own storage.

Pros: setters can be updated once in factory, all pairs created thereafter pick up the new values.  
Cons: requires factory storage migration (two new fields) + factory constructor change.

**Option B — Pass addresses in pair constructor**

Modify `pair::new(factory, token_0, token_1, fee_to, rewards_contract)` to accept them at construction time.

Pros: simpler call chain.  
Cons: pair ABI change ripples to all callers, factory still needs to know the addresses, defeats the "factory manages fee routing" design intent.

**Recommendation: Option A.** It matches the existing design where `factory::set_fee_to` already manages the fee recipient, and the pair setters are already guarded by `caller == factory`.

### BOUNDARY

- **Must NOT change:** pair internal AMM logic, swap math, fee accumulation accounting (already working, just not directed anywhere).
- **Must NOT change:** pair's `caller == factory` guard on setters — this is a security invariant.
- **No business logic leaks to frontend:** fee routing is entirely contract-side.
- **Must NOT change:** existing pairs already deployed (this fix applies to newly created pairs going forward; retroactive patching of existing pairs requires a separate admin call).

### RISK

| Risk | Likelihood | Mitigation |
|---|---|---|
| Factory storage layout change breaks existing deployed factory | High | ink! storage is SCALE-encoded; adding new fields requires a storage migration message or re-deploy with new address |
| `fee_to` and `rewards` addresses may not be known at factory deploy time | Medium | Store as `Option<AccountId>`; if `None`, skip setter call. Gate `create_pair` with a check or allow pairs with no fee routing initially |
| Cross-contract call from factory to pair post-instantiate adds gas cost | Low | Acceptable; document in gas estimates |
| Retroactive fix for already-deployed pairs | Low (testnet only, no prod yet) | Call `set_protocol_fee_to` and `set_trading_rewards_contract` directly on existing pair addresses via factory admin call or one-shot migration message |

---

## BREAK

### Task B4-T1: Write failing test proving new pairs have None fee routing

**Files:** `Lunex/contracts/factory/lib.rs` (test module)  
**Acceptance:** Test calls `create_pair`, then calls `pair.get_protocol_fee_to()` and asserts it is `Some(expected_addr)` — this fails today because factory never sets it  
**Verify:**
```bash
cd Lunex/contracts/factory && cargo test test_new_pair_has_fee_routing 2>&1 | grep -E 'FAILED|error'
```
**Boundary:** Test only  
**Risk:** None — TDD anchor

---

### Task B4-T2: Add `protocol_fee_to` and `trading_rewards_contract` fields to factory storage

**Files:** `Lunex/contracts/factory/lib.rs` (storage struct + Default + constructor)  
**Acceptance:** `cargo check -p factory` passes; new fields are `Option<AccountId>` with default `None`; constructor accepts optional addresses  
**Verify:** `grep 'protocol_fee_to\|trading_rewards_contract' Lunex/contracts/factory/lib.rs | wc -l` returns ≥ 4 (struct, default, constructor param, field init)  
**Boundary:** Storage struct and constructor only; no swap/AMM logic  
**Risk:** Breaking change to constructor ABI — all deployment scripts must be updated

---

### Task B4-T3: Add `set_protocol_fee_to_global` and `set_trading_rewards_global` admin messages to factory

**Files:** `Lunex/contracts/factory/lib.rs`  
**Acceptance:** Two new `#[ink(message)]` functions, guarded by `ensure_caller_is_fee_setter`, update the factory's stored addresses  
**Verify:** Unit test calling setter, then `create_pair`, checks both getter values on pair  
**Boundary:** Admin messages only; does not touch existing `set_fee_to` (that is a different concept — the address *receiving* fees, not routing them)  
**Risk:** None

---

### Task B4-T4: Call setters in `create_pair` post-instantiate

**Files:** `Lunex/contracts/factory/lib.rs` (lines 295–305)  
**Acceptance:** After `pair.instantiate()`, factory calls `pair_ref.set_protocol_fee_to(addr)` and `pair_ref.set_trading_rewards_contract(addr)` when the addresses are `Some`; on error, `create_pair` returns `Err`  
**Verify:**
```bash
cd Lunex/contracts/factory && cargo test 2>&1 | grep -E 'test result|FAILED'
```
**Boundary:** Only `create_pair`; swap/remove/add liquidity untouched  
**Risk:** `PairContractRef` reference must remain live after `.instantiate()` — verify ink! allows re-using the returned `PairContractRef` to call messages

Implementation sketch:
```rust
let pair_ref = PairContractRef::new(factory_address, token_0, token_1)
    .code_hash(code_hash).gas_limit(0).endowment(0).salt_bytes(&salt)
    .instantiate();
let pair_address: AccountId = *pair_ref.as_ref();

// Post-instantiate: wire up fee and rewards routing
if let Some(fee_to_addr) = self.protocol_fee_to {
    pair_ref.set_protocol_fee_to(fee_to_addr)
        .map_err(|_| FactoryError::PairSetupFailed)?;
}
if let Some(rewards_addr) = self.trading_rewards_contract {
    pair_ref.set_trading_rewards_contract(rewards_addr)
        .map_err(|_| FactoryError::PairSetupFailed)?;
}
```

---

### Task B4-T5: Add `FactoryError::PairSetupFailed` variant

**Files:** `Lunex/contracts/factory/lib.rs` (Error enum)  
**Acceptance:** Compiles; used in T4  
**Verify:** `grep 'PairSetupFailed' Lunex/contracts/factory/lib.rs`  
**Boundary:** Error enum only  
**Risk:** None

---

### Task B4-T6: Write ink-e2e test confirming fee routing end-to-end

**Files:** `tests/e2e_factory_fees.rs` or factory e2e module  
**Acceptance:** After `create_pair`, a swap occurs, `collect_protocol_fees` is called on pair, and fee_to address receives non-zero balance  
**Verify:**
```bash
cd Lunex/contracts/factory && cargo test --features e2e-tests e2e_pair_fee_routing 2>&1 | grep 'ok'
```
**Boundary:** E2E only  
**Risk:** Requires substrate-contracts-node with both factory + pair wasm

---

## PLAN

### Implementation Approach

**Local pattern to reuse:** `pair/lib.rs:1097` — `if self.env().caller() != self.factory` guard is already written and tested. The factory calling the setters from within `create_pair` satisfies this guard automatically because the caller at that point IS the factory contract.

The factory does NOT currently hold a `PairContractRef` trait object beyond instantiation. The key insight: the returned value from `.instantiate()` in ink! 4 is already a `PairContractRef` — it can be used directly to call `set_protocol_fee_to`. No additional `build_call` needed; just trait method calls on the returned ref.

**Analog:** `factory/lib.rs:287` shows `let factory_address = self.env().account_id()` — the factory is already aware it will be the caller for pair operations.

### TDD Strategy

1. **Task B4-T1 first (failing test):** Prove with a unit test (using ink! `#[cfg(test)]` with mock environment) that a freshly instantiated pair has `get_protocol_fee_to() == None`. This fails the requirement immediately.
2. **Tasks B4-T2 through B4-T4:** Implement incrementally; re-run unit tests after each.
3. **Task B4-T6 last:** ink-e2e confirms real cross-contract behavior with actual fee collection.

Unit tests for B4 can use the existing factory test infrastructure in `factory/lib.rs` (lines 387+), which already mocks `instantiate_contract` limitations (see comment at line 403: "Simulate pair registration (bypass instantiate_contract limitation)"). The fee routing test will similarly bypass real instantiation but verify that `set_protocol_fee_to` would be called.

### Cross-Contract Test Harness

ink-e2e requires both `factory.wasm` and `pair.wasm`. This is the same harness needed for B1 if a combined test suite is set up. See `00-INDEX.md` for harness recommendation.
