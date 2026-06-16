---
phase: quick-260616-ll7-b2
plan: 01
subsystem: contracts/asset_wrapper
tags: [custody, escrow, withdraw, ink, psp22, B2, fund-safety, tdd]
requires:
  - asset_wrapper PSP22 internals (_transfer, _burn, ensure_admin, ensure_not_paused)
provides:
  - Escrow withdrawal lifecycle (request → confirm | reclaim)
  - WithdrawQueued / WithdrawConfirmed / WithdrawReclaimed events
  - confirm_withdraw / reclaim_withdraw / set_reclaim_window messages
affects:
  - spot-api relayer (must migrate to confirm_withdraw — PRE-DEPLOY BLOCKER)
  - subquery-node indexer (must add new event handlers — PRE-DEPLOY BLOCKER)
tech-stack:
  added: []      # no new crates; reuses existing ink!/scale deps
  patterns:
    - transfer-to-self escrow (contract account holds tokens)
    - mirror of mint_with_ref deposit-ref dedup via monotonic next_withdrawal_id
key-files:
  created: []
  modified:
    - Lunex/contracts/asset_wrapper/src/lib.rs
decisions:
  - "Escrow = transfer-to-self; burn deferred to confirm_withdraw (admin-only)"
  - "reclaim_withdraw intentionally NOT pause-gated (never trap user funds)"
  - "WithdrawRequest event kept DEFINED but never emitted (fail-safe + SubQuery compat)"
metrics:
  duration: ~25m
  completed: 2026-06-16
  tasks: 3
  files: 1
  tests: 36 passed / 0 failed (was 29)
---

# Quick Task 260616-ll7 (B2): asset_wrapper Escrow Withdraw — Summary

**One-liner:** Replaced `asset_wrapper`'s burn-on-request withdrawal with an
on-chain transfer-to-self **escrow lifecycle** (request → relayer `confirm` →
burn, with an owner `reclaim` fallback after a deadline), eliminating the P0
burn-without-delivery custody risk.

## What changed (`Lunex/contracts/asset_wrapper/src/lib.rs`)

- **`request_withdraw`** no longer burns. It escrows via
  `_transfer(caller, self.env().account_id(), amount)` (tokens physically leave
  the caller's spendable balance into the contract account), stores a
  `PendingWithdrawal { owner, amount, deadline_block }`, and emits
  **`WithdrawQueued { id, owner, amount, deadline_block }`**. `total_withdrawn`
  is no longer bumped here. The legacy `WithdrawRequest` event is **NOT emitted**
  (kept defined for SubQuery decode compat).
- **`confirm_withdraw(id)`** — admin-only (`ensure_admin` + `ensure_not_paused`):
  looks up the record (`WithdrawalNotFound` if missing), burns the **contract's**
  escrowed tokens via `_burn(self.env().account_id(), amount)`, increments
  `total_withdrawn` (overflow-checked, no partial state mutation), removes the
  record, emits `WithdrawConfirmed`.
- **`reclaim_withdraw(id)`** — original requester only (`NotWithdrawalOwner`),
  rejected before deadline (`WithdrawalNotExpired`, `<` comparison so reclaim is
  allowed at exactly `deadline_block`), `_transfer`s escrow back to owner,
  removes the record, emits `WithdrawReclaimed`. **Intentionally NOT pause-gated**
  (documented inline) so a paused contract can never trap escrowed funds.
- **`set_reclaim_window(blocks)`** — admin-only. Default `reclaim_window_blocks`
  = 14400 (~48h @ 12s/block).
- New types: `WithdrawalId = u64`, `PendingWithdrawal` struct (with
  `StorageLayout` derive for the Mapping value).
- New storage (appended — layout-safe): `pending_withdrawals`,
  `next_withdrawal_id`, `reclaim_window_blocks`.
- New errors: `WithdrawalNotFound`, `WithdrawalNotExpired`,
  `WithdrawalAlreadyProcessed` (kept per spec; unreachable since the record is
  removed on first success), `NotWithdrawalOwner`.
- New read-only getter `reclaim_window_blocks()`.

## TDD trail (RED → GREEN → format)

| Commit | Phase | Result |
|---|---|---|
| `531797e` | RED — types/events/errors/storage + stubs + 7 failing tests | compiles; 7 new tests FAIL, 29 pre-existing PASS |
| `20541a1` | GREEN — escrow lifecycle + migrate 4 pre-existing tests | 36 passed / 0 failed |
| `763bc38` | style — `cargo fmt` (pinned 1.85.0) | 36 passed / 0 failed |

Verified independently with the **pinned toolchain** (`rustup run 1.85.0 cargo
test`; Homebrew `cargo` 1.94 is incompatible per STATE.md):
`test result: ok. 36 passed; 0 failed; 0 ignored` — exit 0. `cargo clippy` exit 0,
no `arithmetic_side_effects` warnings (all new math uses `checked_*`).

## Migrated pre-existing tests (escrow semantics, not deleted)

- `test_request_withdraw` — now asserts escrow (bob 600 / contract 400 / supply
  1000 / withdrawn 0), then admin `confirm_withdraw(0)` → supply 600 / withdrawn 400.
- `test_failed_request_withdraw_overflow_does_not_burn` → renamed
  **`test_failed_confirm_withdraw_overflow_does_not_burn`**: overflow now occurs
  at confirm; asserts escrow + record untouched on overflow, retry succeeds.
- `test_full_lifecycle_with_security` step 5 — request escrows, added a 5b admin
  `confirm_withdraw`; recomputed supply/withdrawn (final audit unchanged: minted
  8000 / withdrawn 1500 / supply 6500).
- `test_pause_blocks_operations` — added: `confirm_withdraw` blocked while paused;
  `reclaim_withdraw` succeeds while paused after deadline.

## Boundary audit (untouched, byte-stable)

`mint_with_ref`, `mint`, `_mint`, `_burn`, `_transfer`, `ensure_admin`,
`ensure_not_paused`, `processed_deposits`/`deposit_ref` dedup, `mint_cap`,
PSP22 transfer/transfer_from/approve/balance math. `grep -cE 'fn mint_with_ref|fn
_burn|fn _transfer|fn ensure_admin'` = 4. `git diff HEAD~2` shows **no** edits to
boundary function bodies. `Cargo.toml` unchanged (no new crates).

## ⚠️ REQUIRED PRE-DEPLOY FOLLOW-UP (out of scope here — NOT DEPLOYABLE WITHOUT IT)

This contract is **broken-SAFE, not broken-unsafe** until the relayer + indexer
are updated. Before deploying to ANY environment serving real withdrawals:

1. **spot-api relayer** must:
   - stop relying on `WithdrawRequest` (no longer emitted on the escrow path —
     an un-updated relayer simply stops delivering; funds sit reclaimable, none lost);
   - watch the new **`WithdrawQueued { id, owner, amount, deadline_block }`** event;
   - deliver the native pallet-asset off-chain, THEN call **`confirm_withdraw(id)`**
     on-chain;
   - confirm **well before `deadline_block`** to avoid racing a user
     `reclaim_withdraw` (default window 14400 blocks / ~48h; tune via
     `set_reclaim_window`).
2. **SubQuery indexer** must add handlers for **`WithdrawQueued`**,
   **`WithdrawConfirmed`**, **`WithdrawReclaimed`**. `WithdrawRequest` is kept
   DEFINED (now unemitted) so existing decoding does not break; remove it only
   after the indexer is updated.

## Deferred

- **ink-e2e lifecycle test (spec B2-T7)** — DEFERRED. All coverage here is pure
  ink! unit tests (no `ink-e2e`); block advancement uses
  `ink::env::test::advance_block`. An on-chain e2e (deploy → deposit →
  request_withdraw → advance blocks → reclaim) against substrate-contracts-node
  was not implemented.
- `WithdrawalAlreadyProcessed` is defined per spec but currently unreachable
  (record removal on first confirm/reclaim makes a second call return
  `WithdrawalNotFound`).
- Storage-growth `max_pending_per_user` guard (RISK row in spec) NOT added.

## Self-Check: PASSED
- `Lunex/contracts/asset_wrapper/src/lib.rs` — FOUND, modified.
- Commits FOUND: `531797e` (RED), `20541a1` (GREEN), `763bc38` (fmt).
- `cargo test` (1.85.0): 36 passed / 0 failed, exit 0.
