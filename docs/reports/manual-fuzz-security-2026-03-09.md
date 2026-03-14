# Manual Fuzz Security Report

## Metadata

- Date: 2026-03-09
- Scope: `pair` and `copy_vault` security hardening
- Execution mode: local manual run
- Related workflow: `.github/workflows/manual-fuzz-security.yml`
- Related Windsurf workflow: `.windsurf/workflows/fuzz-security.md`

## Commands Executed

### Environment

```bash
cargo fuzz --version
rustup toolchain list
cargo install cargo-fuzz --locked
```

### Fuzz Targets

```bash
cargo +nightly fuzz run pair_invariant -- -max_total_time=20
cargo +nightly fuzz run copy_vault_accounting -- -max_total_time=20
cargo +nightly fuzz run spot_settlement_replay -- -max_total_time=20
```

### Deterministic Security Suite

```bash
cargo test --test security_tests
```

## Results

### pair_invariant

- Status: PASS
- Runtime: ~21 seconds
- Result: no crash, no panic, no invariant failure observed
- Coverage notes: libFuzzer discovered and retained a small corpus during execution

### copy_vault_accounting

- Status: PASS
- Runtime: ~21 seconds
- Result: no crash, no panic, no accounting invariant failure observed
- Coverage notes: libFuzzer expanded corpus significantly during execution

### spot_settlement_replay

- Status: PASS
- Runtime: ~21 seconds
- Result: no crash, no panic, no replay/cancel invariant failure observed in the model
- Coverage notes: libFuzzer explored nonce reuse, cancellation, expiry, token mismatch, side mismatch, and partial/full fill state transitions

### security_tests

- Status: PASS
- Tests passed: 13 / 13
- Result: no failing checks in reentrancy, overflow, underflow, replay, slippage, access control, or K-invariant scenarios

## Observed Warnings

### Root Rust crate warnings

- `src/decimal_utils.rs`
  - unused variable: `in_decimals`
- `src/native_assets_integration.rs`
  - unused variable: `address`
  - unused variable: `asset_id`
  - unused variable: `address`

### Test-only warnings

- `tests/security_tests.rs`
  - unused field: `target_contract`
  - unused method: `reset`
  - unused fields: `token_0`, `token_1`, `factory`, `wnative`

These warnings did not block execution.

## Security Interpretation

- No immediate invariant break was found in the new manual fuzz targets.
- No deterministic regression was identified in the existing `security_tests` suite.
- This does not replace deeper fuzz campaigns or external audit.

## Recommended Next Steps

1. Increase fuzz duration from 20 seconds to 5-15 minutes per target.
2. Add a third fuzz target for replay/order validation around `spot_settlement` or signed request handling.
3. Convert any future fuzz crash into a deterministic regression test under `tests/`.
4. Attach this report to the pre-launch security review document.
