# B1 — LP Lock Not Enforced On-Chain

**Blocker ID:** B1  
**Severity:** P0 — rug-pull vector  
**Contracts touched:** `listing_manager`, `liquidity_lock`

---

## SPEC

### Problem

`listing_manager/src/lib.rs` Step 4 (lines 415–421) sets `lock_id = listing_id` and immediately proceeds to Step 5 (save record with `status: ListingStatus::Active`). The actual `liquidity_lock::create_lock` call never happens on-chain. A comment says the "off-chain relayer verifies LP transfer and calls create_lock on behalf of the user." This means a token creator can complete a listing with `lp_amount > 0` recorded on-chain while the LP is never actually locked — a direct rug-pull surface.

### Why It Blocks Prod

- Any token can be listed, receive the Active badge, and immediately rug: the LP is not in `liquidity_lock` storage.
- The SubQuery indexer reads `lock_id` from the `TokenListed` event and displays it as "locked" — false signal to users.
- External auditors will reject this as a critical custody gap on first review.

### Exact Files to Touch

| File | Lines | Change |
|---|---|---|
| `Lunex/contracts/listing_manager/src/lib.rs` | 185–191 (storage struct) | Add no new field — `liquidity_lock: AccountId` already exists at line 187 |
| `Lunex/contracts/listing_manager/src/lib.rs` | 1–40 (imports) | Add `use ink::env::call::{build_call, ExecutionInput, Selector};` — already present (line 35); add cross-contract `Result<u64>` return type alias if needed |
| `Lunex/contracts/listing_manager/src/lib.rs` | 415–422 (Step 4) | Replace `let lock_id: u64 = listing_id;` with a `build_call` to `liquidity_lock::create_lock`; return `Err` on failure |
| `Lunex/contracts/listing_manager/src/lib.rs` | Error enum | Add `LockCreationFailed` variant |
| `Lunex/contracts/liquidity_lock/src/lib.rs` | 147 (`ensure_manager`) | Verify `listing_manager` contract address is set as the manager **before** deployment |

### Verified Signature of `liquidity_lock::create_lock`

```rust
// liquidity_lock/src/lib.rs:136-146
pub fn create_lock(
    &mut self,
    owner:            AccountId,   // token lister (caller of list_token)
    pair_address:     AccountId,
    lp_token:         AccountId,
    lp_amount:        Balance,
    lunes_amount:     Balance,
    token_amount:     Balance,
    lock_duration_ms: u64,
    tier:             u8,
) -> Result<LockId>   // returns u64
```

`ensure_manager` gates this call — the `listing_manager` contract address must be registered as manager in `liquidity_lock` before the call succeeds.

### Selector

```rust
ink::selector_bytes!("create_lock")
```

(Matches the ink! 4.x default: Blake2-256 of `"create_lock"`.)

### Analog Pattern

`listing_manager/src/lib.rs:81–130` uses `build_call` + `ExecutionInput` + `Selector::new(ink::selector_bytes!(...))` for PSP22 transfers. The LP lock call mirrors this exactly, with `AccountId` + `Balance` + `u64` + `u8` args appended via `.push_arg()`.

### BOUNDARY

- **Must NOT change:** listing fee collection (Steps 1–3), fee split BPS constants, `ListingRecord` shape (except `lock_id` is now populated from the call return value, not `= listing_id`), `LiquidityLockRef` is NOT introduced — use raw `build_call` to avoid adding a contract dependency crate.
- **Must NOT change:** any frontend or SDK code. The `lock_id` field remains `u64`; its value will differ from `listing_id` once `liquidity_lock::next_id` diverges, but that is correct behavior.
- **No business logic leaks to frontend:** the listing status transitions entirely on-chain.

### RISK

| Risk | Likelihood | Mitigation |
|---|---|---|
| `ensure_manager` rejects because `listing_manager` address not registered in `liquidity_lock` | High (deployment order dependency) | Document required deploy sequence: deploy `liquidity_lock` → `set_manager(listing_manager_addr)` → deploy/upgrade `listing_manager` |
| Caller must pre-transfer LP tokens to `liquidity_lock` before `list_token` | Medium | Document pre-condition; `list_token` calldata must include approval proof |
| `build_call` gas limit 0 causes OOG in sub-call | Low | Test with ink-e2e; set explicit gas limit if needed |
| `lock_id` returned by `create_lock` will NOT equal `listing_id` if other locks were created first | Low | This is correct — stop asserting equality in any test |

---

## BREAK

### Task B1-T1: Add `LockCreationFailed` error variant

**Files:** `Lunex/contracts/listing_manager/src/lib.rs` (Error enum)  
**Acceptance:** `cargo check -p listing_manager` passes  
**Verify:** `grep 'LockCreationFailed' Lunex/contracts/listing_manager/src/lib.rs`  
**Boundary:** Error enum only; no logic change  
**Risk:** None

---

### Task B1-T2: Write failing unit test for LP lock enforcement

**Files:** `Lunex/contracts/listing_manager/src/lib.rs` (test module)  
**Acceptance:** Test fails at compile or runtime because `list_token` does not call `create_lock`  
**Verify:**
```bash
cd Lunex/contracts/listing_manager && cargo test test_list_token_calls_create_lock 2>&1 | grep -E 'FAILED|error'
```
**Boundary:** Test only; no production code change  
**Risk:** None — TDD anchor

Test skeleton:
```rust
#[ink::test]
fn test_list_token_creates_lock_on_chain() {
    // Arrange: deploy mock liquidity_lock tracking create_lock calls
    // Act: call list_token with lp_amount > 0
    // Assert: mock liquidity_lock.create_lock_called == true
    //         lock_id in ListingRecord != listing_id (shows real call happened)
    //         list_token returns Ok(listing_id)
}

#[ink::test]
fn test_list_token_reverts_if_lock_creation_fails() {
    // Arrange: mock liquidity_lock that returns Err
    // Act: call list_token
    // Assert: Err(Error::LockCreationFailed)
    //         no ListingRecord stored (atomicity)
}
```

---

### Task B1-T3: Replace Step 4 with `build_call` to `create_lock`

**Files:** `Lunex/contracts/listing_manager/src/lib.rs` (lines 415–421)  
**Acceptance:** The line `let lock_id: u64 = listing_id;` is gone; replaced by a `build_call` block returning `Result<u64>`; on `Err`, the fn returns `Err(Error::LockCreationFailed)`  
**Verify:**
```bash
cd Lunex/contracts/listing_manager && cargo test 2>&1 | grep -E 'test result|FAILED'
```
**Boundary:** Only Step 4; Steps 1-3 and Step 5 unchanged; `listing_id` counter still increments before the call (for determinism in events)  
**Risk:** If `lock_id` return value ≠ `listing_id`, update Step 5 to use returned `lock_id`

Implementation sketch:
```rust
// Step 4: call liquidity_lock::create_lock on-chain
let lock_call_result = build_call::<DefaultEnvironment>()
    .call(self.liquidity_lock)
    .gas_limit(0)
    .transferred_value(0)
    .exec_input(
        ExecutionInput::new(Selector::new(ink::selector_bytes!("create_lock")))
            .push_arg(&caller)
            .push_arg(&pair_address)
            .push_arg(&lp_token)
            .push_arg(&lp_amount)
            .push_arg(&lunes_liquidity)
            .push_arg(&token_liquidity)
            .push_arg(&lock_duration_ms)
            .push_arg(&tier),
    )
    .returns::<Result<u64>>()
    .invoke();

let lock_id: u64 = lock_call_result
    .map_err(|_| Error::LockCreationFailed)?
    .map_err(|_| Error::LockCreationFailed)?;
```

---

### Task B1-T4: Write ink-e2e integration test

**Files:** `Lunex/contracts/listing_manager/src/lib.rs` (e2e test module) or `tests/e2e_listing_lock.rs`  
**Acceptance:** End-to-end test deploys both `liquidity_lock` and `listing_manager`, calls `list_token`, asserts `liquidity_lock::get_lock(lock_id).is_some()`  
**Verify:**
```bash
cd Lunex/contracts/listing_manager && cargo test --features e2e-tests 2>&1 | grep -E 'test result|FAILED|ok'
```
**Boundary:** E2E only; uses real ink! `instantiate_contract`  
**Risk:** Requires local `substrate-contracts-node`; see 00-INDEX.md harness note

---

### Task B1-T5: Document deployment order

**Files:** `Lunex/contracts/listing_manager/README.md` (update) or inline constructor doc  
**Acceptance:** Deploy sequence documented: `liquidity_lock` → `set_manager(listing_manager)` → `listing_manager::new(...)` with `liquidity_lock` address  
**Verify:** Human review  
**Boundary:** Docs only  
**Risk:** None

---

## PLAN

### Implementation Approach

The existing `build_call` pattern in `listing_manager/src/lib.rs:93–130` (PSP22 transfer) is the direct analog. The diff is:

1. Target address: `self.liquidity_lock` (already in storage at line 187)
2. Selector: `ink::selector_bytes!("create_lock")`
3. Args: 8 positional args matching the `create_lock` signature (verified above)
4. Return type: `Result<u64>` (ink! SCALE-encoded)

No new imports needed — `build_call`, `ExecutionInput`, `Selector` are already imported at line 35.

### TDD Strategy

Start with **Task B1-T2** (failing unit test) before touching production code. In the ink! unit test environment, mock the cross-contract call by testing the observable effect: if `list_token` completes without calling `create_lock`, the test proves the gap. The simplest mock strategy in ink! `#[cfg(test)]` is to inject a mock `liquidity_lock` address and observe that no `LockCreated` event is emitted by `liquidity_lock` (which won't be deployed in unit test context — this is why B1-T4 needs ink-e2e).

For unit tests: test the error path — set `liquidity_lock = AccountId::from([0u8;32])` (zero address), call `list_token`, expect `Err(LockCreationFailed)`. This proves the call is attempted.

For the success path: requires ink-e2e (Task B1-T4) with both contracts deployed.

### Cross-Contract Test Harness

Requires `substrate-contracts-node` running locally. Both `listing_manager.wasm` and `liquidity_lock.wasm` must be compiled and uploaded. The `listing_manager` must be initialized with the `liquidity_lock` contract's deployed address, and `liquidity_lock::set_manager(listing_manager_addr)` must be called before the e2e test.
