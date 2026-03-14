# Lunex Fuzz and Invariant Testing Plan

## Objective

Add a practical security testing layer for Lunex smart contracts and protocol-critical flows before launch.

This plan complements:
- the pre-launch security checklist
- DeFi attack simulation
- red-team review
- external audit

## Critical Surfaces

### Priority 1

- `Lunex/contracts/copy_vault/lib.rs`
- `Lunex/contracts/spot_settlement/lib.rs`
- `Lunex/contracts/router/lib.rs`
- `Lunex/contracts/pair/lib.rs`

### Priority 2

- `Lunex/contracts/staking/lib.rs`
- `Lunex/contracts/rewards/lib.rs`
- backend signed-auth and settlement validation flows in `spot-api`

## Testing Layers

### 1. Unit tests

Use deterministic examples for:
- success cases
- access control checks
- replay rejection
- slippage checks
- liquidity math
- copy vault accounting transitions

### 2. Property tests

Use randomized input generation to assert invariants over many execution paths.

Recommended invariants:

#### Pair / Router

- reserves never underflow
- fee-adjusted `x * y` does not decrease after valid swaps
- minted liquidity is never negative or zero for valid first deposits
- withdrawals cannot exceed reserves
- invalid paths and zero values are always rejected

#### Copy Vault

- `total_equity` cannot diverge from actual vault balance source of truth
- user shares never become negative
- total shares never decrease except through burn paths
- withdrawing more shares than owned always fails
- asset/share conversions remain monotonic

#### Spot Settlement

- used nonces cannot be reused
- an order with invalid trusted origin never becomes eligible for settlement
- balances cannot become negative after settlement transitions

### 3. Invariant tests

Run longer randomized sequences of operations, not isolated calls.

Recommended stateful sequences:
- deposit -> deposit -> withdraw -> withdraw
- add liquidity -> swap -> remove liquidity
- leader signal -> follower scaling -> settlement
- signed request -> replay -> rejection

### 4. Fuzz testing

Use dedicated fuzzing when ready for heavier security work.

Recommended tooling:
- `cargo-fuzz` for Rust-level targets
- API fuzzing with ZAP, RESTler, or equivalent

Suggested fuzz targets:
- share math in `copy_vault`
- swap math in `pair` and `router`
- settlement input validation in `spot_settlement`
- backend signed payload validation in `spot-api`

## Current Practical Approach in This Repo

Because the current workspace already contains Rust security tests, the safest first step is:
- keep deterministic security tests in `tests/security_tests.rs`
- add randomized property tests in a separate Rust test target
- wire those tests into pre-launch validation

This avoids introducing a mandatory `cargo fuzz` dependency into the default CI path right away.

## Initial Invariants to Automate

### Pair math

- valid swaps preserve or increase fee-adjusted invariant
- swaps requesting more output than reserves must fail
- reserve math must use checked arithmetic

### Vault accounting

- deposits increase assets and shares monotonically
- withdrawals never exceed owned shares
- total shares equals sum of user shares in the model
- total assets never go negative

### Replay protection

- nonce sequence must be strictly increasing per actor
- duplicate nonce is always rejected

## Recommended Rollout

### Phase 1

- property tests in workspace Rust tests
- pre-launch workflow runs targeted property tests
- findings documented in release review

### Phase 2

- isolated `cargo fuzz` target for `copy_vault` and `pair`
- nightly or manual fuzz workflow in GitHub Actions
- corpus retention for regression replay

### Phase 3

- API fuzzing against staging
- state desync simulations for chain/indexer/database/frontend
- long-running randomized scenario tests for copy trading

## Exit Criteria Before Launch

The release should be blocked if any of the following occurs:
- invariant failure in pair math
- share inflation or vault accounting mismatch
- replay acceptance for signed actions
- settlement accepts untrusted order origin
- follower scaling produces disproportionate notional exposure

## Minimal Commands

### Property tests

```bash
cargo test --test property_security_invariants
```

### Existing security tests

```bash
cargo test --test security_tests
```

### Pre-launch workflow

Use:
- `.github/workflows/prelaunch-security.yml`
- `docs/PRELAUNCH_SECURITY_REVIEW_TEMPLATE.md`
- `.windsurf/workflows/pre-launch-security-review.md`
