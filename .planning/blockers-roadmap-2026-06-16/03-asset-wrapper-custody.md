# B2 — asset_wrapper Withdraw Off-Chain Custody

**Blocker ID:** B2  
**Severity:** P0 — user funds at risk (burn-without-delivery)  
**Contracts touched:** `asset_wrapper`

---

## SPEC

### Problem

`asset_wrapper/src/lib.rs:349–378` (`request_withdraw`) burns the caller's PSP22 tokens immediately, then emits a `WithdrawRequest` event. The delivery of the underlying pallet-asset is entirely off-chain: a relayer must detect the event and send the native asset. If the relayer is:

- Offline: user's PSP22 is burned, native asset never arrives.
- Compromised: relayer selectively ignores withdrawals.
- Slow: user has no on-chain timeout or reclaim path.

There is no `pending_withdrawals` mapping, no `claim` function, and no timeout/reclaim window in the current contract. The `total_withdrawn` counter tracks aggregate burned amount but cannot be used to reclaim individual requests.

### Design Options

**Option A — Escrow + Relayer Claim (recommended)**

Instead of burning immediately:
1. User calls `request_withdraw(amount)` → tokens are escrowed (locked in contract storage, NOT burned yet), a `PendingWithdrawal` record is created with `(id, caller, amount, deadline_block)`.
2. Relayer delivers native asset off-chain AND calls `confirm_withdraw(id)` on-chain → PSP22 tokens burned, record closed.
3. If relayer does NOT call `confirm_withdraw` within `N` blocks: user calls `reclaim_withdraw(id)` → escrowed tokens returned, record deleted.

Pros: user funds are recoverable in all failure modes. On-chain proof of delivery (relayer must interact with the contract). Auditable.  
Cons: requires escrow storage (Mapping<WithdrawalId, PendingWithdrawal>), two extra messages, one more field. Relayer integration requires calling `confirm_withdraw` per withdrawal (replaces the "just watch event" model).

**Option B — Time-Bounded Dispute / Reclaim Window**

Burn immediately (current behavior) but save a `PendingBurn` record. User can call `reclaim_burn(id)` within `N` blocks if native delivery hasn't been confirmed on-chain via a `confirm_delivery(id)` relayer call. After the window, record is pruned.

Pros: preserves relayer's current "watch and act" model; reclaim is the exception path.  
Cons: user's PSP22 is already burned — reclaim requires re-minting, which reintroduces the `mint_with_ref` path and deposit-reference deduplication complexity. Slightly harder to reason about invariants.

**Option C — No On-Chain Change (Status Quo)**

Accept relayer trust assumption, document it, add monitoring. NOT acceptable for mainnet (incompatible with trustless DEX claim).

### Recommendation: **Option A (Escrow + Relayer Claim)**

Rationale:
- Preserves user funds at all times on-chain — the strongest safety guarantee.
- Maps cleanly to the existing `deposit_ref` deduplication pattern in `mint_with_ref` (the relayer already tracks unique references).
- Auditors will require this; Option B still requires trust in relayer liveness.
- The `confirm_withdraw` call by relayer is already a natural fit with the existing `admin` (relayer) role.

### Exact Files to Touch

| File | Change |
|---|---|
| `Lunex/contracts/asset_wrapper/src/lib.rs` | Add `WithdrawalId = u64`, `PendingWithdrawal` struct, `pending_withdrawals: Mapping<WithdrawalId, PendingWithdrawal>`, `next_withdrawal_id: WithdrawalId`, `reclaim_window_blocks: u32` fields to storage |
| `Lunex/contracts/asset_wrapper/src/lib.rs` | Refactor `request_withdraw`: escrow tokens (transfer to self or lock balance), save record, emit `WithdrawQueued` event — do NOT burn |
| `Lunex/contracts/asset_wrapper/src/lib.rs` | Add `confirm_withdraw(id: WithdrawalId)` — admin/relayer-only: burns escrowed tokens, emits `WithdrawConfirmed` |
| `Lunex/contracts/asset_wrapper/src/lib.rs` | Add `reclaim_withdraw(id: WithdrawalId)` — callable by owner of the request after deadline; returns escrowed tokens |
| `Lunex/contracts/asset_wrapper/src/lib.rs` | Add `set_reclaim_window(blocks: u32)` — admin-only |
| `Lunex/contracts/asset_wrapper/src/lib.rs` | Error enum: add `WithdrawalNotFound`, `WithdrawalNotExpired`, `WithdrawalAlreadyConfirmed`, `NotWithdrawalOwner` |

### Existing Pattern Reused

`mint_with_ref` (lines 395–430) already uses `deposit_ref: u64` as a unique ID stored on-chain in `processed_deposits: Mapping<u64, bool>` for deduplication. The `WithdrawalId` pattern mirrors this exactly.

The `ensure_admin` guard already exists for relayer-only operations.

### BOUNDARY

- **Must NOT change:** `mint_with_ref`, `deposit_ref` deduplication, `mint_cap`, existing PSP22 transfer/balance logic.
- **Must NOT change:** `WithdrawRequest` event signature (SubQuery indexer may depend on it). Add a new `WithdrawQueued` event instead; either keep `WithdrawRequest` as a deprecated alias or remove only after confirming SubQuery mapping.
- **No business logic leaks to frontend:** all custody logic is contract-side. Frontend only needs to call `request_withdraw`, `reclaim_withdraw`, and monitor `WithdrawConfirmed`.
- **Relayer integration:** must be updated to call `confirm_withdraw(id)` instead of just watching the event. This is a backend change (relayer) but is coordinated with the contract plan.

### RISK

| Risk | Likelihood | Mitigation |
|---|---|---|
| PSP22 escrow requires contract to "hold" tokens — must track balance separately from `total_supply` | Medium | Use a `escrowed_balance: Mapping<AccountId, Balance>` or subtract from spendable balance via custom balance tracking |
| Ink! PSP22 `_burn` vs escrow confusion | Medium | Do NOT call `_burn` in `request_withdraw`; instead track locked balance |
| Relayer must be updated to call `confirm_withdraw` | High | Coordinate with spot-api relayer service; this is outside the contract scope but must be planned |
| `reclaim_window_blocks` config: too short → relayer can't confirm; too long → DoS via many pending requests | Medium | Default 14400 blocks (~48h at 12s/block); configurable via admin |
| Storage growth: many unconfirmed requests | Low | Admin can call `reclaim_withdraw` on expired ones; add a `max_pending_per_user` guard |

---

## BREAK

### Task B2-T1: Add `PendingWithdrawal` struct and storage fields

**Files:** `Lunex/contracts/asset_wrapper/src/lib.rs` (storage struct + new types)  
**Acceptance:** `cargo check -p asset_wrapper` passes with new fields  
**Verify:** `grep 'PendingWithdrawal\|next_withdrawal_id\|pending_withdrawals' Lunex/contracts/asset_wrapper/src/lib.rs`  
**Boundary:** Storage only; no message logic  
**Risk:** ink! storage layout change — new fields appended to end are safe

New types:
```rust
pub type WithdrawalId = u64;

#[derive(scale::Encode, scale::Decode, Clone)]
#[cfg_attr(feature = "std", derive(scale_info::TypeInfo))]
pub struct PendingWithdrawal {
    pub owner:         AccountId,
    pub amount:        Balance,
    pub deadline_block: u32,
}
```

---

### Task B2-T2: Write failing tests for escrow behavior

**Files:** `Lunex/contracts/asset_wrapper/src/lib.rs` (test module)  
**Acceptance:** Two tests fail:
  1. `test_request_withdraw_escrows_not_burns` — asserts `balance_of(caller)` unchanged after call (current code burns it → test fails)
  2. `test_reclaim_after_deadline_returns_tokens` — function doesn't exist yet → compile error  
**Verify:**
```bash
cd Lunex/contracts/asset_wrapper && cargo test test_request_withdraw_escrows_not_burns 2>&1 | grep FAILED
```
**Boundary:** Tests only  
**Risk:** None

---

### Task B2-T3: Add new error variants

**Files:** `Lunex/contracts/asset_wrapper/src/lib.rs` (WrapperError enum)  
**Acceptance:** `WithdrawalNotFound`, `WithdrawalNotExpired`, `WithdrawalAlreadyProcessed`, `NotWithdrawalOwner` added  
**Verify:** `cargo check -p asset_wrapper`  
**Boundary:** Error enum only  
**Risk:** None

---

### Task B2-T4: Refactor `request_withdraw` to escrow instead of burn

**Files:** `Lunex/contracts/asset_wrapper/src/lib.rs` (lines 349–378)  
**Acceptance:**
  - Tokens are transferred to contract itself (or escrowed balance mapping decrements spendable balance)
  - `PendingWithdrawal` record saved with `deadline_block = current_block + reclaim_window_blocks`
  - `WithdrawQueued { id, owner, amount, deadline_block }` event emitted
  - `total_withdrawn` NOT incremented until `confirm_withdraw`
**Verify:**
```bash
cd Lunex/contracts/asset_wrapper && cargo test test_request_withdraw_escrows_not_burns 2>&1 | grep 'ok'
```
**Boundary:** Only `request_withdraw`; `mint_with_ref`, `_burn`, balance math untouched  
**Risk:** PSP22 transfer-to-self may need special handling; verify ink! allows `env().account_id()` as `to` in `PSP22::transfer`

---

### Task B2-T5: Implement `confirm_withdraw(id: WithdrawalId)`

**Files:** `Lunex/contracts/asset_wrapper/src/lib.rs`  
**Acceptance:**
  - Admin/relayer-only (reuse `ensure_admin` guard)
  - Looks up `PendingWithdrawal`; returns `WithdrawalNotFound` if missing
  - Burns the escrowed tokens via `_burn(withdrawal.owner, withdrawal.amount)`
  - Increments `total_withdrawn`
  - Removes record from mapping
  - Emits `WithdrawConfirmed { id, owner, amount }`
**Verify:**
```bash
cd Lunex/contracts/asset_wrapper && cargo test test_confirm_withdraw 2>&1 | grep 'ok'
```
**Boundary:** New message; existing messages untouched  
**Risk:** None

---

### Task B2-T6: Implement `reclaim_withdraw(id: WithdrawalId)`

**Files:** `Lunex/contracts/asset_wrapper/src/lib.rs`  
**Acceptance:**
  - Callable by the original requester only (`NotWithdrawalOwner` guard)
  - Returns `WithdrawalNotExpired` if `deadline_block > current_block`
  - Returns escrowed tokens to owner (reverse the escrow)
  - Removes record
  - Emits `WithdrawReclaimed { id, owner, amount }`
**Verify:**
```bash
cd Lunex/contracts/asset_wrapper && cargo test test_reclaim_after_deadline_returns_tokens 2>&1 | grep 'ok'
```
**Boundary:** New message; no relayer interaction  
**Risk:** Block number access via `self.env().block_number()` — confirm ink! DefaultEnvironment provides this

---

### Task B2-T7: ink-e2e test for full withdrawal lifecycle

**Files:** `tests/e2e_asset_wrapper_withdraw.rs`  
**Acceptance:** E2E test: deploy → deposit → `request_withdraw` → advance blocks → `reclaim_withdraw` → balance restored  
**Verify:**
```bash
cd Lunex/contracts/asset_wrapper && cargo test --features e2e-tests e2e_withdraw_lifecycle 2>&1 | grep 'ok'
```
**Boundary:** E2E only  
**Risk:** Block advancement in ink-e2e requires `advance_block` API or timestamp manipulation

---

## PLAN

### Implementation Approach

**Local pattern reused:** `mint_with_ref` (line 395+) demonstrates the `deposit_ref: u64` deduplication pattern with `processed_deposits: Mapping<u64, bool>`. The `PendingWithdrawal` escrow mirrors this: `pending_withdrawals: Mapping<WithdrawalId, PendingWithdrawal>` with `next_withdrawal_id: u64` auto-incrementing counter.

The `ensure_admin` guard (already present) is reused unchanged for `confirm_withdraw`.

Escrow mechanism: instead of `_burn` in `request_withdraw`, call `PSP22::transfer(caller, self.env().account_id(), amount)` to move tokens into contract custody, OR track a `locked_balance: Mapping<AccountId, Balance>` subtracted from usable balance. The simpler path is transfer-to-self — the contract holds the tokens as a PSP22 balance until confirmed or reclaimed.

### TDD Strategy

**First failing test (B2-T2):** Assert that after `request_withdraw`, `balance_of(caller)` is UNCHANGED (tokens escrowed, not burned). This fails against current code (which burns immediately) and precisely defines the behavior change.

**Second failing test:** Assert `reclaim_withdraw` does not exist yet (compile error). This enforces the new API exists before claiming "done."

Unit tests cover: request, confirm, reclaim, deadline not-yet-expired rejection, not-owner rejection. All pure ink! unit tests — no ink-e2e required for logic coverage.

B2-T7 (ink-e2e) validates the real block-number check for `deadline_block` using substrate-contracts-node's block advancement.

### Cross-Contract Test Harness

B2 unit tests are **self-contained** — no cross-contract calls involved. Only B2-T7 requires substrate-contracts-node. This is the lowest harness dependency of all 5 blockers.
