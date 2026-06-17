---
status: complete
requirement: B4
date: 2026-06-17
branch: audit/production-readiness-2026-06-12
commits:
  - 5d283c4 fix(factory) wire routing into new pairs
  - c3f1716 fix(deploy) set factory fee-routing globals
  - f004176 test(onchain) B4 proof script (deferred run)
onchain_proof: DEFERRED (dev stack down)
---

# Quick Task 260617-jz6 — B4: Factory wires fee/rewards routing into new pairs (SUMMARY)

**Status:** Code complete, committed & unit/WASM-verified. On-chain proof **DEFERRED**.
**Requirement:** B4 (`.planning/blockers-roadmap-2026-06-16/02-factory-revenue-bug.md`) — silent protocol-fee revenue loss.
**Date:** 2026-06-17
**Branch:** audit/production-readiness-2026-06-12

> Context: the B4 fix was written and verified (unit + WASM) in a prior session
> that was cut short by an unexpected machine shutdown. This task recovered that
> work and committed it atomically. No new code was written here.

## What was broken

`factory.create_pair` registered every new pair with `protocol_fee_to = None`
and `trading_rewards_contract = None`. Pairs created through the factory
collected **no** protocol fees and never notified the trading-rewards
contract — a silent revenue-loss bug.

## The fix (committed)

1. **`Lunex/contracts/factory/lib.rs`** (`5d283c4`)
   - New error `PairSetupFailed`.
   - New storage fields `protocol_fee_to: Option<AccountId>` and
     `trading_rewards_contract: Option<AccountId>` (default `None`).
   - `create_pair` now wires both into each new pair **before** `register_pair`,
     propagating with `?` → on failure returns `Err(PairSetupFailed)` and
     registers **no** orphan pair (atomicity). The `caller == factory` guard on
     the pair is satisfied automatically (the factory is the caller).
   - Admin-gated globals (not constructor args, because the rewards contract is
     deployed *after* the factory): `set_protocol_fee_to_global`,
     `set_trading_rewards_global` (both `ensure_caller_is_fee_setter`), plus
     getters `get_protocol_fee_to_global` / `get_trading_rewards_global`.
   - Existing pairs unaffected — globals only apply to pairs created afterwards.
   - 3 ink unit tests: default-none, fee_setter-can-set, non-setter-denied.

2. **`spot-api/scripts/deploy-contracts.ts`** (`c3f1716`)
   - Step 7: after deploying `trading_rewards_contract`, calls
     `factory.setProtocolFeeToGlobal` (→ deployer/treasury placeholder for local)
     and `setTradingRewardsGlobal` (→ rewards address), each awaited to
     `isFinalized`.

3. **`spot-api/scripts/prove-b4-factory-fee-routing.ts`** (`f004176`)
   - On-chain proof: Factory with globals UNSET → new pair `get_protocol_fee_to()
     == None` (old behavior); Factory with globals SET → pair routing == the set
     addresses. **Run deferred** (dev stack down).

## Verification

| Check | Result |
|---|---|
| `cargo test` (factory, rustup 1.85.0) | ✅ **13 passed; 0 failed** (incl. 3 new B4 tests) |
| `cargo contract build --release` (factory) | ✅ `factory_contract.contract` produced (WASM) |
| On-chain proof (`prove-b4-factory-fee-routing.ts`) | ⏸ **DEFERRED** — needs dev stack (`:9944` + postgres + spot-api) up; user-gated (the 2026-06-14 incident was a dev-chain wipe) |

## Follow-ups (user-gated)

- Run the on-chain proof once the dev stack is intentionally brought up.
- In production, set `protocol_fee_to` to the real treasury (deploy script uses
  the deployer as a local placeholder).
- Pre-existing pairs need a per-pair admin call to retrofit routing (globals are
  forward-only) — track separately if any pre-B4 pairs must be patched.
