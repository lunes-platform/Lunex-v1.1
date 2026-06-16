# B3 — Signature-Enforcement Toggle Has No Timelock

**Blocker ID:** B3  
**Severity:** P0 — owner compromise enables instant order forgery  
**Contracts touched:** `spot_settlement`

---

## SPEC

### Problem

`spot_settlement/lib.rs:1379–1390` (`set_signature_verification_enforced`) is guarded by `ensure_owner()` only and takes effect immediately. A compromised owner key can call `set_signature_verification_enforced(false)` in one transaction, then in the next block submit forged orders via `settle_trade` with the signature check bypassed.

Critically: this is NOT a hypothetical path. The code at line 1346 explicitly documents "EXPLICIT TESTNET MODE (`enforced == false`)" where settlement proceeds without signature verification. The zero-check path is a production escape hatch with no timelock.

### Verification: ECDSA Is Real (Old Blocker Obsolete)

Confirmed in `spot_settlement/lib.rs`:
- Line 208: `recovers the public key via `ecdsa_recover` and compares it with`  
- Line 1339: `.ecdsa_recover(&order.attestation, &message_hash)`  
- Line 1504: `` `ecdsa_recover` is a pure function, fully supported by the ink! ``

**The old `seal_sr25519` concern is obsolete.** Signature verification is real on-chain ECDSA. The only remaining risk is the toggle itself being too easy to disable.

### Two-Step Ownership Pattern (Verified, Reusable)

The existing `transfer_ownership` / `accept_ownership` / `pending_owner` pattern is confirmed at lines 1113–1148:

```rust
// spot_settlement/lib.rs:1113-1116
pub fn transfer_ownership(&mut self, new_owner: AccountId) -> Result<(), SpotError> {
    self.ensure_owner()?;
    self.pending_owner = Some(new_owner);
    Ok(())
}

// spot_settlement/lib.rs:1132-1141
pub fn accept_ownership(&mut self) -> Result<(), SpotError> {
    let caller = self.env().caller();
    match self.pending_owner {
        Some(pending) if pending == caller => {
            self.owner = caller;
            self.pending_owner = None;
            Ok(())
        }
        _ => Err(SpotError::AccessDenied),
    }
}
```

Storage already contains `pending_owner: Option<AccountId>` (line 322) and `signature_verification_enforced: bool` (line 353).

### Proposed Fix: Timelocked Toggle

Mirror the two-step ownership pattern for the enforcement toggle:

```
propose_disable_enforcement()   → sets pending_enforce_off = Some(timestamp + TIMELOCK_MS)
cancel_disable_enforcement()    → clears pending_enforce_off
execute_disable_enforcement()   → callable only after deadline; sets enforced = false
```

**Re-enabling enforcement (`set_signature_verification_enforced(true)`) can remain immediate** — there is no security risk in enabling protection faster.

**TIMELOCK_MS**: 48 hours (match `DEFAULT_TIMELOCK_DELAY_MS` = 48h already used in `listing_manager`). Alternatively, use the existing `timelock_delay` field if present in `spot_settlement` (check storage — only `pending_owner` and `signature_verification_enforced` confirmed; `timelock_delay` not confirmed in this contract).

### Exact Files to Touch

| File | Change |
|---|---|
| `Lunex/contracts/spot_settlement/lib.rs` | Storage: add `pending_enforcement_off: Option<u64>` (timestamp) and `enforcement_timelock_ms: u64` |
| `Lunex/contracts/spot_settlement/lib.rs` | Add `propose_disable_enforcement()` — owner-only, sets `pending_enforcement_off = Some(now + enforcement_timelock_ms)`, emits `EnforcementDisableProposed { deadline }` |
| `Lunex/contracts/spot_settlement/lib.rs` | Add `cancel_disable_enforcement()` — owner-only, clears `pending_enforcement_off`, emits `EnforcementDisableCancelled` |
| `Lunex/contracts/spot_settlement/lib.rs` | Add `execute_disable_enforcement()` — owner-only, requires `pending_enforcement_off.is_some() && now >= deadline`, sets `signature_verification_enforced = false`, clears pending, emits `SignatureEnforcementChanged { enforced: false }` |
| `Lunex/contracts/spot_settlement/lib.rs` | Keep `set_signature_verification_enforced(true)` immediate (re-enabling is safe) |
| `Lunex/contracts/spot_settlement/lib.rs` | Repurpose or gate `set_signature_verification_enforced(false)` — either make it call through to `propose_disable_enforcement`, or make it Err with "use propose_disable_enforcement" |
| `Lunex/contracts/spot_settlement/lib.rs` | Error enum: add `EnforcementTimelockNotExpired`, `NoPendingEnforcementDisable` |

### BOUNDARY

- **Must NOT change:** `transfer_ownership` / `accept_ownership` / `pending_owner` — these are unrelated to the toggle.
- **Must NOT change:** the ECDSA verification path itself (lines 1326–1344) — it is correct.
- **Must NOT change:** `set_signature_verification_enforced(true)` immediate behavior — re-enabling protection needs no delay.
- **No business logic leaks to frontend:** admin UI for the toggle is purely informational; the timelock is enforced on-chain.
- **Preserve `is_signature_verification_enforced()` getter** — SubQuery indexer and monitoring depend on it.

### RISK

| Risk | Likelihood | Mitigation |
|---|---|---|
| Existing unit tests call `set_signature_verification_enforced(false)` directly (confirmed: line 1561) | High | Update tests to use `propose + advance_time + execute` flow; or keep the direct setter in test-only builds guarded by `#[cfg(test)]` |
| 48h timelock may be too long if emergency disable is needed for a legitimate bug | Low | Add an emergency multi-sig path (out of scope for this plan) or document the risk acceptance |
| `block_timestamp()` used for timelock — susceptible to slight validator manipulation | Low | Acceptable at 48h scale; document |
| Missing `enforcement_timelock_ms` in storage — requires storage layout change | Medium | Append to end of storage struct; safe in ink! |

---

## BREAK

### Task B3-T1: Write failing test proving immediate disable is possible today

**Files:** `Lunex/contracts/spot_settlement/lib.rs` (test module)  
**Acceptance:** Test calls `set_signature_verification_enforced(false)` and asserts it would FAIL with `EnforcementTimelockNotExpired` — this fails today because it succeeds immediately  
**Verify:**
```bash
cd Lunex/contracts/spot_settlement && cargo test test_disable_enforcement_requires_timelock 2>&1 | grep FAILED
```
**Boundary:** Test only  
**Risk:** None — TDD anchor

---

### Task B3-T2: Add storage fields for timelock state

**Files:** `Lunex/contracts/spot_settlement/lib.rs` (storage struct + constructor)  
**Acceptance:** `pending_enforcement_off: Option<u64>` and `enforcement_timelock_ms: u64 = 48*3600*1000` added; `cargo check` passes  
**Verify:** `grep 'pending_enforcement_off\|enforcement_timelock_ms' Lunex/contracts/spot_settlement/lib.rs`  
**Boundary:** Storage only  
**Risk:** Storage layout change — fields appended to end are safe

---

### Task B3-T3: Add error variants

**Files:** `Lunex/contracts/spot_settlement/lib.rs` (SpotError enum)  
**Acceptance:** `EnforcementTimelockNotExpired`, `NoPendingEnforcementDisable` added; `cargo check` passes  
**Verify:** `grep 'EnforcementTimelockNotExpired' Lunex/contracts/spot_settlement/lib.rs`  
**Boundary:** Error enum only  
**Risk:** None

---

### Task B3-T4: Implement `propose_disable_enforcement()`

**Files:** `Lunex/contracts/spot_settlement/lib.rs`  
**Acceptance:**
  - Owner-only (reuse `ensure_owner`)
  - Sets `self.pending_enforcement_off = Some(self.env().block_timestamp() + self.enforcement_timelock_ms)`
  - Emits `EnforcementDisableProposed { deadline: u64 }`
  - Returns `Err` if already pending (optional: allow re-proposal to reset clock)
**Verify:**
```bash
cd Lunex/contracts/spot_settlement && cargo test test_propose_disable_enforcement 2>&1 | grep 'ok'
```
**Boundary:** New message; no effect on `signature_verification_enforced` yet  
**Risk:** None

---

### Task B3-T5: Implement `cancel_disable_enforcement()`

**Files:** `Lunex/contracts/spot_settlement/lib.rs`  
**Acceptance:**
  - Owner-only
  - Clears `pending_enforcement_off`
  - Emits `EnforcementDisableCancelled`
  - Returns `NoPendingEnforcementDisable` if nothing pending
**Verify:**
```bash
cd Lunex/contracts/spot_settlement && cargo test test_cancel_disable_enforcement 2>&1 | grep 'ok'
```
**Boundary:** New message  
**Risk:** None

---

### Task B3-T6: Implement `execute_disable_enforcement()`

**Files:** `Lunex/contracts/spot_settlement/lib.rs`  
**Acceptance:**
  - Owner-only
  - Returns `NoPendingEnforcementDisable` if `pending_enforcement_off.is_none()`
  - Returns `EnforcementTimelockNotExpired` if `now < deadline`
  - Sets `signature_verification_enforced = false`
  - Clears `pending_enforcement_off`
  - Emits `SignatureEnforcementChanged { enforced: false, changed_by: caller }`
**Verify:**
```bash
cd Lunex/contracts/spot_settlement && cargo test test_execute_disable_after_timelock 2>&1 | grep 'ok'
```
**Boundary:** Only this function; the existing `set_signature_verification_enforced` is handled in B3-T7  
**Risk:** None

---

### Task B3-T7: Gate `set_signature_verification_enforced(false)` path

**Files:** `Lunex/contracts/spot_settlement/lib.rs` (lines 1379–1390)  
**Acceptance:** Calling `set_signature_verification_enforced(false)` returns `Err(SpotError::EnforcementTimelockNotExpired)` (or redirects to the propose flow). Calling with `true` still works immediately.  
**Verify:**
```bash
cd Lunex/contracts/spot_settlement && cargo test test_disable_enforcement_requires_timelock 2>&1 | grep 'ok'
```
**Boundary:** Modify only the `false` branch of `set_signature_verification_enforced`; `true` branch untouched  
**Risk:** **Existing tests** at lines 1561, 1649, 1655 call `set_signature_verification_enforced(false)` directly — these must be updated to use the propose+execute flow or be marked `#[cfg(test)]`-only with a bypass

---

### Task B3-T8: Update affected unit tests

**Files:** `Lunex/contracts/spot_settlement/lib.rs` (test module, lines ~1550–1660)  
**Acceptance:** All existing tests pass; tests that disable enforcement use the new propose+advance_time+execute flow or are explicitly marked testnet-only  
**Verify:**
```bash
cd Lunex/contracts/spot_settlement && cargo test 2>&1 | grep -E 'test result|FAILED'
```
**Boundary:** Tests only  
**Risk:** `set_caller` + timestamp manipulation in ink! test environment — confirm `ink::env::test::set_block_timestamp` is available

---

## PLAN

### Implementation Approach

**Local pattern reused:** `transfer_ownership` / `accept_ownership` / `pending_owner` (lines 1113–1148) is the direct structural template:

| Ownership pattern | Enforcement toggle pattern |
|---|---|
| `pending_owner: Option<AccountId>` | `pending_enforcement_off: Option<u64>` (deadline timestamp) |
| `transfer_ownership(new_owner)` | `propose_disable_enforcement()` |
| `cancel_ownership_transfer()` | `cancel_disable_enforcement()` |
| `accept_ownership()` | `execute_disable_enforcement()` |

The key difference: ownership has no time constraint (the new owner must actively accept). The enforcement toggle adds a timestamp check (`now >= deadline`) in `execute_disable_enforcement`.

`re-enable` (`set_signature_verification_enforced(true)`) remains immediate — analogous to "current owner can always cancel."

**Existing `emit_event(SignatureEnforcementChanged)` pattern** (line 1385–1388) is reused verbatim in `execute_disable_enforcement`.

### TDD Strategy

**First failing test (B3-T1):** Prove `set_signature_verification_enforced(false)` succeeds immediately today, then assert it should fail with `EnforcementTimelockNotExpired`. This creates a red test that the entire B3 implementation must turn green.

Unit tests for B3 are **pure ink! unit tests** — no cross-contract calls, no ink-e2e needed. Use `ink::env::test::set_block_timestamp(now + 48h_ms)` to simulate timelock expiry. All logic is in-contract.

The timelock check in `execute_disable_enforcement` is the critical invariant: `assert!(deadline > now)` before calling execute must fail; `set_block_timestamp(deadline + 1)` then calling execute must succeed.

### Cross-Contract Test Harness

**Not required.** B3 is entirely self-contained in `spot_settlement`. Pure unit tests suffice for all logic. ink-e2e is optional for integration confidence but not blocking.
