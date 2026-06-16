# Blockers Roadmap — ink! Contracts Production Readiness

**Date:** 2026-06-16  
**Scope:** 5 proven production blockers in Lunex DEX ink! contracts  
**Source docs:** `.planning/PRODUCTION-CODE-GAPS-2026-06-16.md`, `.planning/contracts-flow/00-MASTER-FLOWCHART.md`

---

## The 5 Blockers

| ID | File | Short Description | Severity |
|---|---|---|---|
| B1 | `01-lp-lock-not-enforced.md` | LP lock never called on-chain in `list_token` — rug-pull vector | P0 |
| B2 | `03-asset-wrapper-custody.md` | `request_withdraw` burns PSP22 before delivery confirmed — user funds at risk | P0 |
| B3 | `04-signature-toggle-timelock.md` | `set_signature_verification_enforced(false)` is immediate — no timelock | P0 |
| B4 | `02-factory-revenue-bug.md` | `create_pair` never calls `set_protocol_fee_to`/`set_trading_rewards_contract` — zero fee/reward collection | P0 |
| B5 | `05-rewards-staking-bare-transfer.md` | `env().transfer()` to staking — `fund_staking_rewards` never called, staking pool not credited | P1 |

---

## Recommended Execution Order

### Phase 1 — P0 Security-Critical (parallel tracks possible)

**Track A:** `B3` → `B1`  
**Track B:** `B2`

```
Week 1
├── B3 (spot_settlement timelock)     — self-contained, pure unit tests, no cross-contract deps
│   ↓ unblocks: spot_settlement can be declared safe to deploy
└── B2 (asset_wrapper escrow)         — self-contained, no cross-contract calls in the fix itself

Week 2
└── B1 (LP lock enforcement)          — depends on liquidity_lock already deployed + manager set
    ↓ unblocks: listing_manager can be declared safe to deploy
```

**Rationale for B3 first:**  
- Fully self-contained in one contract, zero cross-contract dependencies.  
- Timelock pattern reuses existing `pending_owner` infrastructure — lowest new-code surface.  
- spot_settlement is the highest-value contract (settles all trades); securing it first is highest leverage.  
- Pure unit tests only — no ink-e2e harness needed.

**Rationale for B2 second (parallel with B3):**  
- Also self-contained (no cross-contract calls in the fix).  
- Storage escrow pattern has no dependency on other contracts being deployed.  
- Can proceed independently of B3.

**Rationale for B1 third:**  
- Depends on `liquidity_lock` being correctly deployed with `listing_manager` registered as manager.  
- Requires ink-e2e harness for the success-path test.  
- Must be done after B3/B2 so the team has the e2e harness infrastructure ready.

### Phase 2 — Revenue Restoration

**B4** (factory revenue bug)

```
Week 3
└── B4 (factory fee routing)          — storage layout change + post-instantiate calls
    ↓ unblocks: protocol fees actually collected, trading rewards flow activated
```

**Rationale for B4 last among P0s:**  
- Factory storage change is a deployment-coordination risk (existing factory must be upgraded or redeployed).  
- No user funds are lost (just revenue leakage), so it is slightly less urgent than B1/B2/B3.  
- Requires factory+pair ink-e2e harness, which should be available after B1 sets up the harness.

### Phase 3 — Revenue Accounting Integrity

**B5** (rewards→staking)

```
Week 3–4 (can parallel with B4)
└── B5 (rewards staking notification)  — replace bare transfer with build_call
    ↓ unblocks: staking rewards properly credited and indexable
```

**Rationale:** B5 is P1 because staking receives the LUNES balance even without the ABI call — users won't lose staked funds. The bug is that `trading_rewards_pool` is not credited, causing silent under-distribution. Fix is low risk (small diff) and can proceed in parallel with B4.

### Full Dependency Graph

```
B3 (no deps)
│
B2 (no deps)
│
B1 ─── requires: liquidity_lock deployed + set_manager called
│
B4 ─── requires: factory+pair e2e harness (from B1 setup)
│
B5 ─── requires: rewards+staking deployed + set_trading_rewards_contract called
```

---

## Test Harness Requirements Per Blocker

| Blocker | Pure Unit Tests | ink-e2e Required | Contracts in ink-e2e |
|---|---|---|---|
| B3 (timelock) | Yes — all logic | No (optional) | spot_settlement only |
| B2 (escrow) | Yes — all logic | Yes for block-number test | asset_wrapper only |
| B1 (LP lock) | Partial (error path) | **Yes — success path critical** | listing_manager + liquidity_lock |
| B4 (factory fees) | Partial (logic only) | **Yes — fee collection** | factory + pair |
| B5 (rewards notify) | Partial (error path) | **Yes — pool accounting** | rewards + staking |

### ink-e2e Harness Setup (One-Time)

All ink-e2e tests require:
1. `substrate-contracts-node` running locally (or CI with `--features e2e-tests`)
2. Each contract compiled: `cargo contract build --release -p <contract>`
3. Contracts uploaded and deployed in test setup via `client.instantiate(...)` ink-e2e API

The shared harness can be initialized once in a workspace-level `tests/` directory. Recommended structure:
```
Lunex/contracts/tests/
├── common/
│   ├── mod.rs          # deploy helpers, shared accounts
│   └── fixtures.rs     # standard deploy sequences
├── e2e_listing_lock.rs       # B1
├── e2e_asset_wrapper.rs      # B2
├── e2e_factory_fees.rs       # B4
└── e2e_rewards_staking.rs    # B5
```

---

## Single Biggest Risk / Unknown

**The ink-e2e cross-contract test harness does not yet exist in this codebase.**

Three of the five blockers (B1, B4, B5) require ink-e2e tests for their critical success-path assertions:
- B1: Can't prove `create_lock` was actually called without deploying both contracts
- B4: Can't prove fees are collected without a real pair swap + `collect_protocol_fees` call
- B5: Can't prove `trading_rewards_pool` is incremented without deploying both rewards + staking

If `substrate-contracts-node` is not yet available in the CI environment, setting it up is a prerequisite before executing B1, B4, and B5. This is the single infrastructure gate that could block all three Phase 1/2 completions.

**Mitigation:** B3 and B2 (logic-only) can be completed and merged using only `cargo test` — no node needed. Use that window to set up the harness for B1, B4, B5.

---

## Verification Commands Summary

```bash
# B3 — all unit tests self-contained
cd Lunex/contracts/spot_settlement && cargo test 2>&1 | grep -E 'test result|FAILED'

# B2 — unit tests + optional e2e
cd Lunex/contracts/asset_wrapper && cargo test 2>&1 | grep -E 'test result|FAILED'

# B1 — unit + e2e
cd Lunex/contracts/listing_manager && cargo test 2>&1 | grep -E 'test result|FAILED'
cd Lunex/contracts/listing_manager && cargo test --features e2e-tests 2>&1 | grep -E 'test result|FAILED'

# B4 — unit + e2e
cd Lunex/contracts/factory && cargo test 2>&1 | grep -E 'test result|FAILED'
cd Lunex/contracts/factory && cargo test --features e2e-tests 2>&1 | grep -E 'test result|FAILED'

# B5 — unit + e2e
cd Lunex/contracts/rewards && cargo test 2>&1 | grep -E 'test result|FAILED'
cd Lunex/contracts/rewards && cargo test --features e2e-tests 2>&1 | grep -E 'test result|FAILED'
```

---

## Notes on Code Evidence (Patterns Verified)

All patterns cited in the blocker docs were verified in the actual source files before writing this plan:

| Claim | Verified |
|---|---|
| `create_lock` signature (8 params, returns `Result<LockId>`) | Yes — `liquidity_lock/src/lib.rs:136–146` |
| `build_call` + `selector_bytes!` pattern in listing_manager | Yes — `listing_manager/src/lib.rs:35, 93–130` |
| `liquidity_lock: AccountId` already in listing_manager storage | Yes — line 187 |
| `set_protocol_fee_to` guarded `caller == factory` | Yes — `pair/lib.rs:1312–1316` |
| `create_pair` does NOT call setters post-instantiate | Yes — `factory/lib.rs:295–305` shows only `register_pair` + `emit_event` |
| Factory has no `protocol_fee_to` or `trading_rewards_contract` storage field | Yes — `factory/lib.rs:60–130` storage struct confirmed missing |
| `transfer_ownership` / `accept_ownership` / `pending_owner` in spot_settlement | Yes — lines 1113–1148 |
| ECDSA via `ecdsa_recover` is real (not `seal_sr25519`) | Yes — lines 208, 1339, 1504 |
| `set_signature_verification_enforced(false)` is immediate, owner-only | Yes — lines 1379–1390 |
| `fund_staking_rewards` is `#[ink(message, payable)]` with `trading_rewards_contract` guard | Yes — `staking/lib.rs:1577–1596` |
| `rewards/lib.rs` uses bare `env().transfer()` to staking with explicit TODO comment | Yes — lines 968–979 |
| `request_withdraw` burns PSP22 immediately then emits event (no escrow) | Yes — `asset_wrapper/src/lib.rs:349–378` |
