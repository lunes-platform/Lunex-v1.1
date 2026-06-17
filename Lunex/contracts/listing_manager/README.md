# ListingManager

Orchestrates the token listing flow on the Lunex DEX: collects the listing fee
(LUNES PSP22), splits it (20% staking / 50% treasury / 30% rewards), and — as of
B1 — creates a **real on-chain LP lock** via a cross-contract call to
`liquidity_lock::create_lock`. A token can no longer be marked `Active` without
the LP actually being locked.

## Deployment Order (REQUIRED)

`liquidity_lock::new(manager)` takes its manager at construction, but
`listing_manager::new(..)` takes the `liquidity_lock` address — a chicken-and-egg
dependency. Resolve it with `set_manager` after both are deployed:

1. **Deploy `liquidity_lock`** with `new(manager = <deployer/admin placeholder>)`.
   The manager is rewired in step 3; any address works here (the deployer is
   simplest).
2. **Deploy `listing_manager`** with
   `new(lunes_token, liquidity_lock, treasury, rewards_pool, staking_pool)`,
   passing the `liquidity_lock` address from step 1.
3. **Call `liquidity_lock.set_manager(listing_manager_addr)`** as the
   `liquidity_lock` admin. This authorizes `listing_manager` to call
   `create_lock` (which is gated by `ensure_manager`). **Until this runs,
   `list_token` will fail with `LockCreationFailed`** (the inner
   `Unauthorized` from `liquidity_lock` is mapped to `LockCreationFailed`).

### Per-call pre-condition

Before `list_token`, the lister must have **approved the listing fee** to this
contract (`PSP22::approve(listing_manager, fee)` on the LUNES token) so Step 1's
`transfer_from` succeeds. The LP tokens to be locked must likewise be held/approved
per the `liquidity_lock` custody model.

## On-chain proof (PASSED)

The happy path is **proven on-chain** against a live Lunes node by
`spot-api/scripts/prove-b1-lp-lock.ts`. The script:

1. deploys a PSP22 token (the LUNES fee token) and `liquidity_lock`
   (`manager = deployer`);
2. pre-creates one dummy lock as the deployer → `liquidity_lock.next_id` becomes
   `1` (so `lock_id` and `listing_id` can no longer collide at `0`);
3. deploys `listing_manager`, calls `liquidity_lock.set_manager(listing_manager)`;
4. approves the tier-1 fee and calls `list_token` (`listing_id = 0`);
5. asserts `get_listing(0).lock_id == 1` (**not** `listing_id`) **and**
   `liquidity_lock.get_lock(1).is_some()` with `lp_amount`/`owner`/`tier`
   matching.

Result (2026-06-17, lunes-nightly dev node): **PASS** — `list_token` returned a
real `lock_id = 1` and `get_lock(1)` is present. Under the old stub, `get_lock(1)`
would be `None`, so this fails closed against the regression.

```sh
cd spot-api && node_modules/.bin/ts-node --transpile-only scripts/prove-b1-lp-lock.ts
```

### Why off-chain unit tests can't cover this

`list_token` hits Step 1 (`PSP22Ref::transfer_from` to a non-deployed address)
before Step 4 off-chain, so the `create_lock` path is unreachable in unit tests
(documented in the `#[cfg(test)]` module and blocker spec
`.planning/blockers-roadmap-2026-06-16/01-lp-lock-not-enforced.md`). The on-chain
script above is the proof of record. An in-tree `ink_e2e` test is a future nicety;
the cross-contract call also mirrors the working `PSP22Ref` analog in the same
file (proven-by-construction), with atomicity (`?` before any insert/emit)
statically guaranteed.

## Tests

```sh
rustup run 1.85.0 cargo test -p listing_manager   # Homebrew cargo 1.94 is incompatible
```
