---
description: manual fuzz and attack-simulation run for Lunex security hardening
---
1. Start from a clean branch or the release ref you want to validate.
   - Confirm the target commit, branch, or tag.

2. Run the deterministic invariant tests first.
   - `cargo test --test property_security_invariants`
   - `cargo test --test security_tests`

3. Run the manual GitHub Actions workflow when you want a deeper fuzz pass.
   - Workflow:
     - `.github/workflows/manual-fuzz-security.yml`
   - Inputs:
     - `release_ref`
     - `fuzz_target`
     - `fuzz_seconds`

4. Run local fuzzing from the dedicated scaffold when needed.
   - Install once:
     - `cargo install cargo-fuzz --locked`
   - Pair invariant:
     - `cargo +nightly fuzz run pair_invariant -- -max_total_time=60`
   - Copy vault accounting:
     - `cargo +nightly fuzz run copy_vault_accounting -- -max_total_time=60`
   - Spot settlement replay:
     - `cargo +nightly fuzz run spot_settlement_replay -- -max_total_time=60`
   - Run these commands with the current working directory set to `fuzz/`.

5. Treat any crash, panic, or invariant failure as a release blocker.
   - Investigate the reproducer input.
   - Convert the reproducer into a deterministic regression test under `tests/`.

6. Add evidence to the release review.
   - Record:
     - fuzz target used
     - total time
     - whether crashes occurred
     - regression tests created
