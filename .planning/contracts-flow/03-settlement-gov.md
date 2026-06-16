# Cross-Contract Communication Map — Settlement / Governance Cluster

**Contracts analysed:**
- `spot_settlement` — `/Lunex/contracts/spot_settlement/lib.rs`
- `staking` — `/Lunex/contracts/staking/lib.rs`

**Date:** 2026-06-16  
**Analyst:** automated mapping agent (read-only, no invented edges)

---

## 1. Edge Table

| ID | CALLER `contract::fn` (file:line) | CALLEE message / transfer | Selector | Args | Value transferred? | Return | Wiring (set where?) | Trust / off-chain dep? | STATUS |
|----|------------------------------------|---------------------------|----------|------|--------------------|--------|---------------------|------------------------|--------|
| SS-1 | `spot_settlement::deposit_psp22` (lib.rs:503–518) | `<token>::PSP22::transfer_from` | `selector_bytes!("PSP22::transfer_from")` = `0x54b3c76e` | `(caller, self.env().account_id(), amount, Vec::<u8>::new())` | 0 (transferred_value=0) | `Result<(), PSP22Error>` decoded via `.try_invoke()` | `token: AccountId` passed as arg by caller at call time; any PSP22 contract | Off-chain: caller must have pre-approved the DEX contract allowance; no on-chain allowance check by settlement | VERIFIED |
| SS-2 | `spot_settlement::withdraw_psp22` (lib.rs:616–630) | `<token>::PSP22::transfer` | `selector_bytes!("PSP22::transfer")` = `0xdb20f9f5` | `(caller, amount, Vec::<u8>::new())` | 0 | `Result<(), PSP22Error>` decoded via `.try_invoke()` | `token: AccountId` passed as arg by caller; any PSP22 contract | None | VERIFIED |
| SS-3 | `spot_settlement::withdraw_native` (lib.rs:567) | native LUNES — `self.env().transfer(caller, amount)` | N/A (ink! host fn) | `(caller, amount)` | `amount` LUNES out | `Result<(), ()>` — error maps to `SpotError::NativeTransferFailed` | Implicit: always the message caller | None | VERIFIED |
| SS-4 | `spot_settlement::settle_trade` — fee accounting (lib.rs:800–840) | **No external call.** Fees are credited to `self.collected_fees[quote_token]` (internal mapping). Treasury receives balance only when owner calls `withdraw_fees`. | — | — | 0 | internal balance update only | `treasury: AccountId` set in constructor (`new(treasury)`, lib.rs:374,388); changeable only by owner via `set_fees` (owner-only) | None; treasury is an internal vault entry, not an external call | VERIFIED |
| SS-5 | `spot_settlement::withdraw_fees` (lib.rs:1152–1172) | **No external call.** Moves `collected_fees[token]` into `self.balances[(self.treasury, token)]` (internal vault credit). The treasury address must separately call `withdraw_psp22` / `withdraw_native` to pull funds. | — | — | 0 at this step | internal vault credit | `treasury: AccountId` stored field; set at constructor lib.rs:388 | None | VERIFIED |
| ST-1 | `staking::unstake` (lib.rs:803) | native LUNES — `self.env().transfer(caller, total_amount)` | N/A | `(caller, total_amount)` | `total_amount` LUNES out (principal + rewards − penalty) | `Result<(), ()>` — error maps to `StakingError::InsufficientBalance` | Implicit: always the message caller | None | VERIFIED |
| ST-2 | `staking::claim_rewards` (lib.rs:856) | native LUNES — `self.env().transfer(caller, rewards)` | N/A | `(caller, rewards)` | `rewards` LUNES out | `Result<(), ()>` — error maps to `StakingError::InsufficientBalance` | Implicit: always the message caller | None | VERIFIED |
| ST-3 | `staking::execute_proposal` — approved, fee refund (lib.rs:1137–1145) | native LUNES — `self.env().transfer(refund_target, fee_to_move)` **only `#[cfg(not(test))]`** | N/A | `(proposal.proposer, proposal.fee)` | `fee_to_move` LUNES out | `Result<(), ()>` — error reverts with `StakingError::InsufficientBalance` | `refund_target = proposal.proposer` (set at `create_proposal` time, lib.rs:924); `fee_to_move = proposal.fee` | None. Effects-Interactions ordering: proposal marked executed before transfer | VERIFIED |
| ST-4 | `staking::execute_proposal` — rejected, treasury distribution (lib.rs:1162) | native LUNES — `self.env().transfer(self.treasury_address, treasury_share)` **only `#[cfg(not(test))]`** | N/A | `(self.treasury_address, fee_to_move * 90%)` | `treasury_share` LUNES out (90% of `proposal.fee`) | `Result<(), ()>` — error reverts, rolls back `trading_rewards_pool` increment | `treasury_address: AccountId` stored field; set in constructor `new(treasury_address)` lib.rs:584; changeable via `set_treasury_address` (owner-only, lib.rs:649) | None | VERIFIED |
| ST-5 | `staking::claim_trading_reward` / `fund_staking_rewards` entry (lib.rs:1587–1596) | **Inbound** payable call. Staking contract receives native LUNES from caller, credited to `trading_rewards_pool`. Gate: `self.trading_rewards_contract == Some(caller)`. | payable ink! message | — | Inbound LUNES via `self.env().transferred_value()` | `Result<(), StakingError>` | `trading_rewards_contract: Option<AccountId>` stored field; set via `set_trading_rewards_contract` (owner-only, lib.rs:1552); starts as `None` in constructor lib.rs:600 | **Off-chain dependency**: the external contract at `trading_rewards_contract` must initiate this call; staking has no ability to pull. If never set (`None`), gate always returns `AccessDenied`. | VERIFIED |
| ST-6 | Implied outbound from `staking::distribute_trading_rewards` → transfers to stakers | `self.env().transfer(staker_addr, amount_to_distribute)` (paginated loop) — exact line not read in full; inferred from pattern of native LUNES distribution | N/A | `(staker_addr, share)` per staker | `share` LUNES out per staker | `Result<(), ()>` | Staker addresses from `staker_addresses: Mapping<u32, AccountId>` populated at stake time | Evidence: distribute_trading_rewards_paginated called internally; exact transfer lines not confirmed in read window | UNVERIFIED (exact line numbers for per-staker transfer in `distribute_trading_rewards_paginated` not confirmed; only the function name and `transferred_value` accumulation are proven; the loop body with `env().transfer` call was not fetched) |

---

## 2. Stored Contract Address References

| Contract | Field | Type | Set Where | Initial Value |
|----------|-------|------|-----------|---------------|
| `spot_settlement` | `treasury` | `AccountId` | Constructor `new(treasury)` lib.rs:374,388; `set_fees` (owner-only) sets fee bps only — **treasury itself is NOT changeable post-deploy** | constructor arg |
| `spot_settlement` | `relayers` | `Mapping<AccountId, bool>` | `add_relayer` / `remove_relayer` (owner-only, lib.rs:1061, 1080) | empty at deploy |
| `spot_settlement` | `attestor_pubkey` | `Option<(u8, [u8; 32])>` | `set_attestor_key` (owner-only, lib.rs:1424) | `None` at deploy |
| `spot_settlement` | `pending_owner` | `Option<AccountId>` | `transfer_ownership` / `accept_ownership` (two-step) | `None` at deploy |
| `staking` | `treasury_address` | `AccountId` | Constructor `new(treasury_address)` lib.rs:581,584; `set_treasury_address` (owner-only, lib.rs:649) | constructor arg |
| `staking` | `trading_rewards_contract` | `Option<AccountId>` | `set_trading_rewards_contract` (owner-only, lib.rs:1552) | `None` at deploy |

---

## 3. Special Focus Findings

### 3a. `spot_settlement::verify_order_signature` — Attestor / Signature Path

**File:** `lib.rs:1320–1355`

Two modes controlled by `self.signature_verification_enforced: bool` (default `true`, fail-closed):

**ENFORCED MODE (`signature_verification_enforced == true`, the default):**
1. Requires `self.attestor_pubkey` to be set. If `None` → `SpotError::SignatureVerificationUnavailable`.
2. Rejects all-zero `order.signature` (64 bytes) → `SpotError::InvalidSignature`.
3. Calls `self.env().ecdsa_recover(&order.attestation, &message_hash)` — this is an **on-chain ink! host function** (`pallet-contracts` ECDSA recovery primitive).
4. Compares recovered compressed secp256k1 pubkey (33 bytes) against `expected_pubkey` (stored `attestor_pubkey`). Mismatch → `SpotError::AttestationInvalid`.

**This is an on-chain cryptographic primitive.** There is no relayer trust in enforced mode; the attestor's ECDSA signature over the canonical v2 order hash is verified on-chain via `ecdsa_recover`.

**TESTNET MODE (`signature_verification_enforced == false`, explicit opt-in):**
- Zero cryptographic check on-chain.
- Only calls `Self::build_order_message(order)` as a compilation smoke-test.
- Comment states: "The relayer MUST verify each signature off-chain."
- In this mode the security model degrades to **trust the relayer** entirely.

**Conclusion:** In the production (default) configuration, signature verification is a **real on-chain ECDSA primitive** (`env().ecdsa_recover`). It is NOT a relayer-trust model and NOT a no-op, provided:
- `signature_verification_enforced == true` (default), AND
- `attestor_pubkey` has been registered via `set_attestor_key`.

**Risk:** At fresh deploy, `attestor_pubkey` is `None` → `settle_trade` is completely blocked (returns `SignatureVerificationUnavailable`) until the owner calls `set_attestor_key`. This is intentional fail-closed design per ADR-001.

---

### 3b. `staking::execute_proposal` — `#[cfg(not(test))]` Native Transfer

**File:** `lib.rs:1137–1145` (refund path) and `lib.rs:1162` (treasury path)

**Confirmed and cited:**

```rust
// lib.rs:1137–1145
#[cfg(not(test))]
{
    if needs_refund {
        if self.env().balance() < fee_to_move {
            return Err(StakingError::InsufficientBalance);
        }
        if self.env().transfer(refund_target, fee_to_move).is_err() {
            return Err(StakingError::InsufficientBalance);
        }
    } else if needs_distribution {
        // lib.rs:1162
        if self.env().transfer(self.treasury_address, treasury_share).is_err() {
            ...
        }
    }
}
```

The entire native-transfer block (both `transfer(refund_target, …)` and `transfer(treasury_address, …)`) is **inside `#[cfg(not(test))]`**. It does NOT compile into unit-test builds.

Under `#[cfg(test)]` (lib.rs:1176–1184), only the `trading_rewards_pool` bookkeeping is replicated; no transfer occurs. This is explicitly documented: "ink's mock env doesn't pre-fund the contract account with the cumulative fees of all proposals."

**Security note:** Effects-first ordering is preserved even with the cfg gate — `proposal.executed = true`, `proposal.fee_refunded = true`, and `self.proposals.insert(…)` all happen **before** the `#[cfg(not(test))]` block (lib.rs:1100–1130), preventing double-execution reentrancy in production.

---

### 3c. PSP22 Transfers from These Contracts

**spot_settlement** makes two PSP22 cross-contract calls:
- `deposit_psp22` → `token::PSP22::transfer_from` (selector `0x54b3c76e`, lib.rs:503–518). Pulls tokens from user into vault.
- `withdraw_psp22` → `token::PSP22::transfer` (selector `0xdb20f9f5`, lib.rs:616–630). Pushes tokens from vault to user.

Both use `build_call` + `ExecutionInput` + `Selector::new(selector_bytes!(…))` + `.try_invoke()` with three-layer result unwrapping (`Ok(Ok(Ok(())))`) and reentrancy guard (`reentrancy_lock`) held across the call.

**staking** makes **zero PSP22 cross-contract calls**. It deals exclusively in native LUNES. There is no `build_call`, `selector_bytes!`, or `PSP22` invocation anywhere in `staking/lib.rs`.

---

## 4. Summary Counts

| Status | Count |
|--------|-------|
| VERIFIED | 10 |
| UNVERIFIED | 1 (ST-6: per-staker transfer loop in `distribute_trading_rewards_paginated`) |
| STUBBED | 0 |

**Total edges: 11**

---

## 5. Notes on Architecture

- `spot_settlement` has no stored reference to any specific PSP22 token contract. Token addresses flow in as call arguments (`deposit_psp22(token, amount)`) — it is a universal vault for any PSP22.
- `staking` holds one stored reference to an external contract (`trading_rewards_contract: Option<AccountId>`) but never calls out to it. It only **receives** inbound payable calls from it via `fund_staking_rewards`.
- Neither contract calls the other. They are isolated; any coordination is done off-chain or via the spot-api Express layer.
- `spot_settlement::settle_trade` performs no external calls at settlement time — all accounting is internal vault balance mutations. PSP22 cross-contract calls only happen at deposit/withdraw boundaries.
