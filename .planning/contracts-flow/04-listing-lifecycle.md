# 04 — Listing Lifecycle: Cross-Contract Edge Map

**Cluster:** `listing_manager` + `liquidity_lock`
**Audit date:** 2026-06-16
**Rule:** No edge invented. Every edge must be proven by code citation. UNVERIFIED = missing evidence stated explicitly.

---

## Storage: Stored Contract-Address References

| Contract | Field | Type | Set where | File:line |
|---|---|---|---|---|
| `listing_manager` | `lunes_token` | `AccountId` | Constructor arg `lunes_token` | `listing_manager/src/lib.rs:186,290` |
| `listing_manager` | `liquidity_lock` | `AccountId` | Constructor arg `liquidity_lock` | `listing_manager/src/lib.rs:187,291,299` |
| `listing_manager` | `treasury` | `AccountId` | Constructor arg `treasury` | `listing_manager/src/lib.rs:188,292` |
| `listing_manager` | `rewards_pool` | `AccountId` | Constructor arg `rewards_pool` | `listing_manager/src/lib.rs:189,293` |
| `listing_manager` | `staking_pool` | `AccountId` | Constructor arg `staking_pool` | `listing_manager/src/lib.rs:190,294` |
| `liquidity_lock` | `manager` | `AccountId` | Constructor arg `manager`; mutable via `set_manager` (admin-only) | `liquidity_lock/src/lib.rs:45,105,119` |
| `liquidity_lock` | `admin` | `AccountId` | `Self::env().caller()` at construction | `liquidity_lock/src/lib.rs:43,107` |

**No setter for `listing_manager.liquidity_lock`** — there is no `set_liquidity_lock` function. The address is constructor-only and immutable after deployment. `grep` confirms zero occurrences of `self.liquidity_lock =` in the source.

---

## Cross-Contract Edge Table

### EDGE 1 — Fee collection: `listing_manager::list_token` → `lunes_token PSP22::transfer_from`

| Field | Detail |
|---|---|
| **CALLER** | `listing_manager::list_token` — `listing_manager/src/lib.rs:364-369` |
| **CALLEE** | `<lunes_token>::PSP22::transfer_from` |
| **SELECTOR** | `ink::selector_bytes!("PSP22::transfer_from")` (blake2b-256 of string, first 4 bytes) — `lib.rs:124` |
| **ARGS** | `from = caller`, `to = contract_addr (self)`, `amount = cfg.listing_fee`, `data = []` |
| **VALUE** | 0 native tokens transferred |
| **RETURN** | `Result<(), PSP22Error>` — mapped to `Error::TransferFailed` on error |
| **WIRING** | `self.lunes_token` set at constructor (`lib.rs:186,298`). No runtime setter. |
| **TRUST** | Fully on-chain. Caller must have pre-approved `listing_fee` to `listing_manager` address. Standard PSP22 allowance. |
| **STATUS** | **VERIFIED** — `build_call` + `selector_bytes!("PSP22::transfer_from")` + `.try_invoke()` at `lib.rs:119-133` |

---

### EDGE 2 — Fee distribution to staking pool: `listing_manager::list_token` → `lunes_token PSP22::transfer`

| Field | Detail |
|---|---|
| **CALLER** | `listing_manager::list_token` — `listing_manager/src/lib.rs:399` |
| **CALLEE** | `<lunes_token>::PSP22::transfer` |
| **SELECTOR** | `ink::selector_bytes!("PSP22::transfer")` — `lib.rs:98` |
| **ARGS** | `to = self.staking_pool`, `amount = staking_amt` (20% of fee, BPS 2000/10000), `data = []` |
| **VALUE** | 0 native tokens |
| **RETURN** | `Result<(), PSP22Error>` → `Error::TransferFailed` |
| **WIRING** | `self.staking_pool` set at constructor (`lib.rs:190,294`). No runtime setter observed (admin setters for staking_pool may exist — see note below). |
| **TRUST** | Fully on-chain. |
| **STATUS** | **VERIFIED** — `PSP22Ref::transfer` helper at `lib.rs:87-107` called at `lib.rs:399` |

> Note: `grep` found `staking_pool_can_be_updated` in tests, implying a `set_staking_pool` admin setter exists. That setter is **not a cross-contract call** itself (just updates the stored address), but means the target is mutable by admin post-deploy. Same applies to treasury / rewards_pool. This is a **centralization trust surface**, not a new call edge.

---

### EDGE 3 — Fee distribution to treasury: `listing_manager::list_token` → `lunes_token PSP22::transfer`

| Field | Detail |
|---|---|
| **CALLER** | `listing_manager::list_token` — `listing_manager/src/lib.rs:403` |
| **CALLEE** | `<lunes_token>::PSP22::transfer` |
| **SELECTOR** | `ink::selector_bytes!("PSP22::transfer")` — same as Edge 2 |
| **ARGS** | `to = self.treasury`, `amount = treasury_amt` (50% of fee, BPS 5000/10000), `data = []` |
| **VALUE** | 0 native tokens |
| **RETURN** | `Result<(), PSP22Error>` → `Error::TransferFailed` |
| **WIRING** | `self.treasury` set at constructor (`lib.rs:188,292`). |
| **TRUST** | Fully on-chain. |
| **STATUS** | **VERIFIED** — `PSP22Ref::transfer` at `lib.rs:403` |

---

### EDGE 4 — Fee distribution to rewards pool: `listing_manager::list_token` → `lunes_token PSP22::transfer`

| Field | Detail |
|---|---|
| **CALLER** | `listing_manager::list_token` — `listing_manager/src/lib.rs:406` |
| **CALLEE** | `<lunes_token>::PSP22::transfer` |
| **SELECTOR** | `ink::selector_bytes!("PSP22::transfer")` — same as Edge 2 |
| **ARGS** | `to = self.rewards_pool`, `amount = rewards_amt` (30% of fee, BPS 3000/10000), `data = []` |
| **VALUE** | 0 native tokens |
| **RETURN** | `Result<(), PSP22Error>` → `Error::TransferFailed` |
| **WIRING** | `self.rewards_pool` set at constructor (`lib.rs:189,293`). |
| **TRUST** | Fully on-chain. |
| **STATUS** | **VERIFIED** — `PSP22Ref::transfer` at `lib.rs:406` |

---

### EDGE 5 — LP lock creation: `listing_manager::list_token` → `liquidity_lock::create_lock`

| Field | Detail |
|---|---|
| **CALLER** | `listing_manager::list_token` — `listing_manager/src/lib.rs:415-420` |
| **CALLEE** | `liquidity_lock::create_lock` |
| **SELECTOR** | N/A — NO CALL EXISTS IN CODE |
| **ARGS** | N/A |
| **VALUE** | N/A |
| **RETURN** | N/A |
| **WIRING** | `self.liquidity_lock` (`AccountId`) is stored at `lib.rs:187` and set in constructor at `lib.rs:299`, but **is never passed to `build_call`**. The field is read nowhere in the message body. |
| **TRUST** | **OFF-CHAIN RELAYER REQUIRED.** The code at `lib.rs:415-420` explicitly states: *"The off-chain relayer verifies LP transfer and calls create_lock on behalf of the user."* The contract assigns `lock_id = listing_id` (a local counter) and writes a `ListingRecord` with `status: Active` — **all without dispatching any on-chain message to `liquidity_lock`**. |
| **STATUS** | **STUBBED** — `self.liquidity_lock` address is stored but never used as the target of a `build_call`. The contract comment at `lib.rs:418-419` documents the off-chain dependency explicitly. |

---

### EDGE 6 — LP withdrawal: `liquidity_lock::withdraw` → `<lp_token> PSP22::transfer`

| Field | Detail |
|---|---|
| **CALLER** | `liquidity_lock::withdraw` — `liquidity_lock/src/lib.rs:226-247` |
| **CALLEE** | `<record.lp_token>::PSP22::transfer` |
| **SELECTOR** | `ink::selector_bytes!("PSP22::transfer")` — `lib.rs:232` |
| **ARGS** | `to = caller (owner)`, `amount = record.lp_amount`, `data = []` |
| **VALUE** | 0 native tokens |
| **RETURN** | `ink::MessageResult<Result<(), u8>>` — matched via `matches!(Ok(Ok(Ok(Ok(()))))))`. Rollback (resets `withdrawn = false`) on any non-OK result. |
| **WIRING** | `record.lp_token` is the LP PSP22 address stored in `LockRecord` at lock creation time — supplied as argument to `create_lock` (`lib.rs:140`). |
| **TRUST** | Fully on-chain when built without `#[cfg(test)]`. The call is guarded by `#[cfg(not(test))]` at `lib.rs:224` — **test builds bypass the PSP22 transfer entirely** (documented in comment at `lib.rs:220-223`). Production builds enforce it. |
| **STATUS** | **VERIFIED** (production path) — `build_call` + `selector_bytes!("PSP22::transfer")` + `.try_invoke()` at `lib.rs:226-247`. Test path is intentionally stubbed via `#[cfg(not(test))]`. |

---

### EDGE 7 — UNVERIFIED: LP token transfer into `liquidity_lock` before `create_lock`

| Field | Detail |
|---|---|
| **CLAIMED FLOW** | Per contract doc (`listing_manager/src/lib.rs:4-9, 317-320`): caller transfers LP tokens directly to `liquidity_lock` address **before** calling `list_token`, then an off-chain relayer calls `create_lock`. |
| **EVIDENCE MISSING** | There is no on-chain enforcement that LP tokens were actually received by `liquidity_lock` before `list_token` completes. `listing_manager` does not call `lp_token.balance_of(liquidity_lock)` or any equivalent check. `create_lock` itself does not verify that LP tokens arrived (it only requires `caller == manager`). |
| **STATUS** | **UNVERIFIED** — No on-chain proof that LP tokens are in custody before listing activates. |

---

## Critical Finding: Is the LP Lock Enforced On-Chain?

### The exact code path through `list_token` (step 4, `lib.rs:415-420`):

```rust
// ── Step 4: register lock ────────────────────────────────
// The caller must have transferred LP tokens to the LiquidityLock
// contract before calling list_token. The lock_id mirrors the
// listing_id for deterministic tracking. The off-chain relayer
// verifies LP transfer and calls create_lock on behalf of the user.
let lock_id: u64 = listing_id;
```

**`list_token` does NOT call `liquidity_lock::create_lock`.** It assigns `lock_id = listing_id` as a local integer and immediately proceeds to write `ListingRecord { status: Active, lock_id, ... }` and return `Ok(listing_id)`. The listing is marked `Active` with no LP tokens locked on-chain.

### What `self.liquidity_lock` is used for

The field at `lib.rs:187` is stored in contract state and set in the constructor at `lib.rs:299`. **It is never read inside `list_token` or any other `#[ink(message)]`.** Its only potential use is for the off-chain relayer to know the target address — it is not the source of any `build_call` dispatch.

---

## Summary Counts

| Status | Count |
|---|---|
| VERIFIED | 5 (Edges 1, 2, 3, 4, 6) |
| UNVERIFIED | 1 (Edge 7 — LP custody before listing) |
| STUBBED | 1 (Edge 5 — `list_token` → `create_lock`, documented as off-chain relayer) |

---

## Verdict

**THE LP LOCK IS NOT ENFORCED ON-CHAIN.**

`listing_manager::list_token` activates a listing (`status: Active`) and assigns a `lock_id` without ever dispatching a cross-contract call to `liquidity_lock::create_lock`. The lock creation is delegated to an off-chain relayer. If the relayer fails, is censored, or is malicious, a project can receive an `Active` listing with no LP tokens ever locked. This is a live rug-pull surface: the stored `self.liquidity_lock` address is never the target of a `build_call` inside `list_token`.

**Remediation path:** Replace the comment block at `lib.rs:415-420` with an actual `build_call` to `self.liquidity_lock` dispatching `create_lock`, using the LP token PSP22 address, `lp_amount`, `lunes_liquidity`, `token_liquidity`, `cfg.lock_duration_ms`, and `tier` as arguments. The caller must also pre-transfer LP tokens to `self.liquidity_lock` before calling `list_token`, and `listing_manager` should verify receipt (via `lp_token.balance_of(self.liquidity_lock)` check before and after, or require `create_lock` to return a valid `LockId`).
