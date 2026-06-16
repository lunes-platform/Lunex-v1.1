# 06 — Rewards Contract Edges + Master Cross-Contract Adjacency List

Generated: 2026-06-16. Read-only analysis. Every cited file:line is confirmed against source.

---

## PART 1 — `rewards` Contract: All Outbound Cross-Contract Edges

**Contract:** `contracts/rewards/lib.rs` (`pub mod trading_rewards`, struct `TradingRewardsContract`)

### Stored Contract References

| Field | Type | Storage location |
|---|---|---|
| `authorized_router` | `AccountId` | lib.rs:164 — set in constructor, changeable via `set_authorized_router` (lib.rs:617) |
| `staking_contract` | `Option<AccountId>` | lib.rs:186 — starts `None`, set via `set_staking_contract` (lib.rs:927) |

### Edge R-1 — `rewards::receive_fee_allocation` → staking (native LUNES transfer)

| Field | Value |
|---|---|
| **CALLER** | `trading_rewards::receive_fee_allocation` (lib.rs:968–974) |
| **CALLEE** | `staking_contract` address — native value transfer via `Self::env().transfer(staking_address, staking_rewards_amount)` |
| **SELECTOR** | None — this is a plain `env().transfer()` (native value, no ink! message call). The code comment says "Aqui deveria chamar o contrato de staking para notificar / mas por simplicidade vamos só transferir". No ABI message invoked. |
| **WIRING** | `self.staking_contract: Option<AccountId>` — set by admin-only `set_staking_contract(staking_address)` at lib.rs:927–935. Starts as `None`; call is skipped if `None`. |
| **STATUS** | **VERIFIED** — transfer path is live code (no `#[cfg(not(test))]` guard). Address source is admin-gated setter. |

**Note:** The comment in source explicitly acknowledges this is NOT a proper cross-contract ABI call to `fund_staking_rewards` — it is an orphan value transfer with no staking-side notification. This is a design gap (staking contract will receive LUNES but has no record of the source).

### Edge R-2 — `rewards::claim_rewards` → user (native LUNES transfer)

| Field | Value |
|---|---|
| **CALLER** | `trading_rewards::claim_rewards` (lib.rs:560) |
| **CALLEE** | `caller` (EOA or contract) — `Self::env().transfer(caller, amount)` |
| **SELECTOR** | None — native value transfer, not a cross-contract ABI call |
| **WIRING** | Not applicable; target is always `self.env().caller()` |
| **STATUS** | **VERIFIED** — internal fund movement, not a directed contract→contract edge |

### Edge R-3 — `rewards::claim_epoch_rewards` → user (native LUNES transfer)

| Field | Value |
|---|---|
| **CALLER** | `trading_rewards::claim_epoch_rewards` (lib.rs:828) |
| **CALLEE** | `caller` — same pattern as R-2 |
| **STATUS** | **VERIFIED** — same as R-2 |

### Stored Contract Address — authorized_router

The `authorized_router` field (lib.rs:164) is used solely as an **access-control check** (`ensure_authorized_router` at lib.rs:1084–1086: `if Self::env().caller() != self.authorized_router { ... }`). It is **not used to make an outbound call**. No edge to record.

### Summary: rewards outbound ABI call count

| Edge | Type | Status |
|---|---|---|
| `receive_fee_allocation` → staking (value transfer, no message) | Cross-contract value push | VERIFIED — but design gap: no ABI notification |
| `claim_rewards` → caller | EOA/user payout | VERIFIED — not a contract→contract call |
| `claim_epoch_rewards` → caller | EOA/user payout | VERIFIED — not a contract→contract call |

**True cross-contract ABI message calls from `rewards`: ZERO.** The staking "call" is a raw `env().transfer()` with no selector and no message, meaning the staking contract receives native LUNES but is never invoked. The rewards contract is a **sink** in the call graph, not a hub.

---

## PART 2 — Master Cross-Contract Adjacency List (All 13 Contracts)

Format: `CALLER contract::fn (file:line)` → `CALLEE contract::message [selector]` | WIRING | STATUS

Abbreviations used:
- `[V]` = VERIFIED
- `[U]` = UNVERIFIED (address set somewhere but cannot confirm it is always populated before call)
- `[S]` = STUBBED (code path guarded by `#[cfg(not(test))]` — real call exists in prod build)
- `env().transfer` = native value push, no ABI selector

---

### `factory` → `pair`

| # | Caller `fn` (file:line) | Callee message + selector | Wiring | Status |
|---|---|---|---|---|
| F1 | `factory::create_pair` (factory/lib.rs:290) | `PairContractRef::new` — ink! instantiation (constructor) | `pair_contract_code_hash: Lazy<Hash>` field (factory/lib.rs); code hash passed to `.code_hash()`. `pair_contract_code_hash` is set in factory constructor from parameter. | **[V]** |

Note: Factory does NOT call `pair::set_trading_rewards_contract` after creating a pair — that setter exists on pair (pair/lib.rs:1323) but must be called externally (by the factory admin or deployer) after deployment. No automated wiring in `create_pair`.

---

### `router` → `factory`

| # | Caller `fn` (file:line) | Callee message + selector | Wiring | Status |
|---|---|---|---|---|
| R1 | `router::add_liquidity` (router/lib.rs:655) | `FactoryRef::get_pair(factory, token_0, token_1)` [`get_pair` selector] | `self.factory: AccountId` — set in constructor `new(factory, wnative)` at router/lib.rs:458 | **[V]** |
| R2 | `router::remove_liquidity` (router/lib.rs:782) | `FactoryRef::get_pair(...)` | same | **[V]** |
| R3 | `router::swap_exact_tokens_for_tokens` (router/lib.rs:882) | `FactoryRef::get_pair(...)` | same | **[V]** |
| R4 | `router::swap_tokens_for_exact_tokens` (router/lib.rs:961, 1005, 1012) | `FactoryRef::get_pair(...)` | same | **[V]** |
| R5 | `router::swap_exact_native_for_tokens` (router/lib.rs:1216) | `FactoryRef::get_pair(...)` | same | **[V]** |
| R6 | `router::swap_exact_tokens_for_native` (router/lib.rs:1289) | `FactoryRef::get_pair(...)` | same | **[V]** |
| R7 | `router::get_amount_in` / `get_amount_out` helpers (router/lib.rs:1530, 1565, 1616) | `FactoryRef::get_pair(...)` | same | **[V]** |

---

### `router` → `pair`

| # | Caller `fn` (file:line) | Callee message + selector | Wiring | Status |
|---|---|---|---|---|
| P1 | `router::add_liquidity` (router/lib.rs:660) | `PairRef::get_reserves(pair)` [`get_reserves` selector = `[0x8a,0x0d,0x11,0x6f]`] | `pair` addr returned by `FactoryRef::get_pair` at runtime | **[V]** |
| P2 | `router::add_liquidity` (router/lib.rs:708) | `PairRef::mint(pair, to)` [`mint` selector] | same | **[V]** |
| P3 | `router::remove_liquidity` (router/lib.rs:792) | `PairRef::burn(pair, to)` [`burn` selector] | same | **[V]** |
| P4 | `router::swap_tokens_for_exact_tokens` (router/lib.rs:1015) | `PairRef::swap(pair, ...)` [`swap` selector] | same | **[V]** |
| P5 | `router::get_amount_in` helpers (router/lib.rs:1534, 1569, 1620) | `PairRef::get_reserves(pair)` | same | **[V]** |

---

### `router` → `psp22` (any PSP22-implementing token)

| # | Caller `fn` (file:line) | Callee message + selector | Wiring | Status |
|---|---|---|---|---|
| T1 | `router::add_liquidity` (router/lib.rs:701) | `PSP22Ref::transfer_from(token_a, caller, pair, amount_a)` [`PSP22::transfer_from` = `0x54b3c76e`] | token addr from call arguments | **[V]** |
| T2 | `router::add_liquidity` (router/lib.rs:703) | `PSP22Ref::transfer_from(token_b, ...)` | same | **[V]** |
| T3 | `router::remove_liquidity` (router/lib.rs:787) | `PSP22Ref::transfer_from(pair, caller, pair, liquidity)` | pair addr | **[V]** |
| T4 | `router::swap_exact_tokens_for_tokens` (router/lib.rs:885) | `PSP22Ref::transfer_from(path[0], caller, pair, amounts[0])` | path from call arguments | **[V]** |
| T5 | `router::swap_tokens_for_exact_tokens` (router/lib.rs:964) | `PSP22Ref::transfer_from(path[0], ...)` | same | **[V]** |
| T6 | `router::swap_exact_tokens_for_native` (router/lib.rs:1292) | `PSP22Ref::transfer_from(path[0], caller, pair, amounts[0])` | same | **[V]** |
| T7 | `router::remove_liquidity_native` (router/lib.rs:1151) | `PSP22Ref::transfer(token, to, amount_token)` [`PSP22::transfer`] | same | **[V]** |

---

### `router` → `wnative`

| # | Caller `fn` (file:line) | Callee message + selector | Wiring | Status |
|---|---|---|---|---|
| W1 | `router::add_liquidity_native` / `swap_exact_native_for_tokens` (router/lib.rs:1078, 1204) | `WNativeRef::deposit(wnative, amount_native)` [`deposit` selector] | `self.wnative: AccountId` — constructor param | **[V]** |
| W2 | `router::remove_liquidity_native` / `swap_exact_tokens_for_native` (router/lib.rs:1155, 1300) | `WNativeRef::withdraw(wnative, amount_native)` [`withdraw` selector] | same | **[V]** |
| W3 | `router::swap_exact_native_for_tokens` (router/lib.rs:1219) | `WNativeRef::transfer(wnative, pair, amounts[0])` [`PSP22::transfer`] | same | **[V]** |

---

### `pair` → `psp22` (token_0 / token_1)

| # | Caller `fn` (file:line) | Callee message + selector | Wiring | Status |
|---|---|---|---|---|
| PA1 | `pair::mint` (pair/lib.rs:1072, 1077) | `PSP22Ref::balance_of(token_0/token_1, contract_address)` [`PSP22::balance_of` = `0x6568382f`] | `self.token_0`, `self.token_1` — set in constructor `new(factory, token_0, token_1)` | **[V]** |
| PA2 | `pair::burn` (pair/lib.rs:1109, 1114) | `PSP22Ref::balance_of(token_0/token_1, ...)` | same | **[V]** |
| PA3 | `pair::sync` / `skim` (pair/lib.rs:1126, 1133) | `PSP22Ref::transfer(token_0/token_1, to, excess)` [`PSP22::transfer`] | same | **[V]** |
| PA4 | `pair::collect_protocol_fees` (pair/lib.rs:1403, 1410) | `PSP22Ref::transfer(token_0/token_1, fee_to, fees)` | `self.protocol_fee_to: Lazy<Option<AccountId>>` — set by `set_protocol_fee_to` (pair/lib.rs:1312); only factory can call. UNVERIFIED: no automated call from factory after pair creation — must be wired externally. | **[U]** — setter exists (pair/lib.rs:1312), but factory does not call it; must be invoked by admin post-deployment |
| PA5 | `pair::collect_rewards_fees` (pair/lib.rs:1448, 1455) | `PSP22Ref::transfer(token_0/token_1, rewards_contract, fees)` | `self.trading_rewards_contract: Lazy<Option<AccountId>>` — set by `set_trading_rewards_contract` (pair/lib.rs:1323); only factory can call. Factory does NOT call this automatically on `create_pair`. | **[U]** — setter exists, factory does not wire it on creation |
| PA6 | `pair::mint` (pair/lib.rs:126 area) | `PSP22Ref::transfer_from(token, from, pair, amount)` — internal `_safe_transfer_from` helper | caller address from router | **[V]** |

---

### `pair` → `factory` (read-only)

No outbound calls from pair to factory found. Factory address is stored (`self.factory`) and used only for access-control checks (`require!(caller == self.factory, ...)`), not for ABI calls.

---

### `listing_manager` → `psp22` (lunes_token)

| # | Caller `fn` (file:line) | Callee message + selector | Wiring | Status |
|---|---|---|---|---|
| LM1 | `listing_manager::list_token` (listing_manager/src/lib.rs:364) | `PSP22Ref::transfer_from(lunes_token, caller, self, listing_fee)` [`PSP22::transfer_from` = `0x54b3c76e`] | `self.lunes_token: AccountId` — constructor param (lib.rs:290) | **[V]** |
| LM2 | `listing_manager::list_token` (listing_manager/src/lib.rs:399) | `PSP22Ref::transfer(lunes_token, staking_pool, staking_amt)` [`PSP22::transfer`] | `self.staking_pool: AccountId` — constructor param; updatable via `set_staking_pool` (lib.rs:479) | **[V]** |
| LM3 | `listing_manager::list_token` (listing_manager/src/lib.rs:403) | `PSP22Ref::transfer(lunes_token, treasury, treasury_amt)` | `self.treasury: AccountId` — constructor param; updatable via `set_treasury` (lib.rs:465) | **[V]** |
| LM4 | `listing_manager::list_token` (listing_manager/src/lib.rs:406) | `PSP22Ref::transfer(lunes_token, rewards_pool, rewards_amt)` | `self.rewards_pool: AccountId` — constructor param; updatable via `set_rewards_pool` (lib.rs:472) | **[V]** |

Note: `listing_manager` sends fees to `staking_pool`, `treasury`, and `rewards_pool` as plain PSP22 transfers (no ABI message to staking or rewards contracts — just token movements to those addresses). `liquidity_lock` address is stored (constructor param) but only used as a bookkeeping reference; `listing_manager` does NOT call `liquidity_lock::create_lock` — comment at lib.rs:Step 4 says "The off-chain relayer verifies LP transfer and calls create_lock on behalf of the user."

---

### `liquidity_lock` → `psp22` (lp_token)

| # | Caller `fn` (file:line) | Callee message + selector | Wiring | Status |
|---|---|---|---|---|
| LL1 | `liquidity_lock::withdraw` (liquidity_lock/src/lib.rs:226–253) | `PSP22::transfer(lp_token, owner, lp_amount)` via `build_call` [`PSP22::transfer` = `ink::selector_bytes!("PSP22::transfer")`] | `record.lp_token: AccountId` — stored in lock record at `create_lock` time (supplied by caller). Guard: `#[cfg(not(test))]` — bypassed in unit tests. | **[S]** — production build performs real call; unit tests bypass it |

---

### `staking` → (outbound)

The staking contract (`contracts/staking/lib.rs`) stakes and unstakes native LUNES (not a PSP22 token). All its transfers are `self.env().transfer(caller, amount)` — native value to callers (EOAs). No `build_call`, no `PSP22Ref`, no `ContractRef` found. The `treasury_address: AccountId` (lib.rs:530) receives native LUNES via `env().transfer(self.treasury_address, ...)` in `execute_proposal` (lib.rs:1162) — a value push, not an ABI message call.

| # | Caller `fn` (file:line) | Callee | Status |
|---|---|---|---|
| ST1 | `staking::unstake` (staking/lib.rs:803) | `env().transfer(caller, total_amount)` — native LUNES to user | **[V]** — value push, not ABI call |
| ST2 | `staking::claim_rewards` (staking/lib.rs:856) | `env().transfer(caller, rewards)` — native LUNES to user | **[V]** — value push |
| ST3 | `staking::execute_proposal` (staking/lib.rs:1143) | `env().transfer(refund_target, fee_to_move)` — fee refund | **[V]** — value push |
| ST4 | `staking::execute_proposal` (staking/lib.rs:1162) | `env().transfer(self.treasury_address, treasury_share)` | `self.treasury_address: AccountId` — constructor param + `set_treasury_address` (lib.rs:649) | **[V]** — value push |

**Staking ABI message calls: ZERO.**

---

### `copy_vault` → `psp22` / `router` / `factory` / `pair`

| # | Caller `fn` (file:line) | Callee message + selector | Wiring | Status |
|---|---|---|---|---|
| CV1 | `copy_vault::swap_through_router` (copy_vault/lib.rs:1226) | `PSP22::approve` on `token_in` via `build_call` [selector `0xb2,0x0f,0x1b,0xbd`] | `token_in` from call args | **[V]** |
| CV2 | `copy_vault::swap_through_router` (copy_vault/lib.rs:1264) | `router::swap_exact_tokens_for_tokens` via `build_call` [selector `0xa0,0xac,0x73,0xcf`] | `self.router: Option<AccountId>` — set via admin-only `set_router` (copy_vault/lib.rs:1499). Starts `None`. | **[U]** — `set_router` must be called by admin post-deployment; call reverts with `RouterNotConfigured` if not set |
| CV3 | `copy_vault` valuation helper (copy_vault/lib.rs:1877) | `PSP22::balance_of` on token via `build_call` [selector `0x65,0x68,0x38,0x2f`] | token from tracked list | **[V]** |
| CV4 | `copy_vault` valuation helper (copy_vault/lib.rs:1913) | `factory::get_pair` via `build_call` [selector `0x33,0x7d,0xaf,0x4f`] | `self.factory: Option<AccountId>` — set via admin-only `set_valuation_infra(factory, wnative)` (copy_vault/lib.rs:1519). Starts `None`. | **[U]** — must be wired post-deployment |
| CV5 | `copy_vault` valuation helper (copy_vault/lib.rs:1929) | `pair::get_reserves` via `build_call` [selector `0x8a,0x0d,0x11,0x6f`] | `pair` addr returned from factory call | **[V]** (if factory is wired) |
| CV6 | `copy_vault` valuation helper (copy_vault/lib.rs:1981) | `router::get_amount_out` via `build_call` [selector `0xa8,0x54,0x49,0x16`] | `self.router` | **[U]** — same as CV2 |

---

### `spot_settlement` → `psp22` (any token)

| # | Caller `fn` (file:line) | Callee message + selector | Wiring | Status |
|---|---|---|---|---|
| SS1 | `spot_settlement::deposit_psp22` (spot_settlement/lib.rs:503) | `PSP22::transfer_from(token, caller, self, amount)` via `build_call` [`PSP22::transfer_from` = `ink::selector_bytes!("PSP22::transfer_from")`] | `token: AccountId` from call args | **[V]** |
| SS2 | `spot_settlement::withdraw_psp22` (spot_settlement/lib.rs:616) | `PSP22::transfer(token, caller, amount)` via `build_call` [`PSP22::transfer`] | same | **[V]** |

---

### `rewards` → `staking` (see Part 1)

| # | Caller `fn` (file:line) | Callee | Wiring | Status |
|---|---|---|---|---|
| RW1 | `rewards::receive_fee_allocation` (rewards/lib.rs:968–974) | `env().transfer(staking_address, staking_rewards_amount)` — native LUNES push, NO ABI message | `self.staking_contract: Option<AccountId>` — set via admin-only `set_staking_contract` (rewards/lib.rs:927). Starts `None`. | **[U]** — address not set at construction; admin must call `set_staking_contract`. Also: design gap — staking contract receives LUNES but is not ABI-notified. |

---

### `asset_wrapper` → (outbound)

`asset_wrapper` implements the PSP22 surface (transfer, transfer_from, approve) internally. No `build_call`, no `ContractRef`, no outbound ABI calls found. Pure self-contained PSP22 wrapper for bridged assets.

---

### `asymmetric_pair` → (outbound)

`asymmetric_pair::asymmetric_swap` uses in-contract bonding curve math only. Comment at lib.rs:292 explicitly notes: "Reduce buy_curve.k (simplified: full accounting done by PSP22 transfer off-chain)". No `build_call`, no `PSP22Ref`, no outbound ABI calls. Zero outbound edges.

---

### `psp22` → (outbound)

Standalone PSP22 token contract. No outbound calls. Zero edges.

---

### `wnative` → (outbound)

Standalone wrapped-native token (PSP22 surface). No outbound calls. Zero edges.

---

## MASTER ADJACENCY LIST (Deduplicated, one line per edge)

```
factory         → pair           [F1]  factory::create_pair instantiates pair via PairContractRef::new             [V]
router          → factory        [R1-R7] router::{add_liquidity,remove_liquidity,swap_*,get_amount_*} → FactoryRef::get_pair [V]
router          → pair           [P1-P5] router::{add_liquidity,remove_liquidity,swap_*,get_amount_*} → PairRef::{get_reserves,mint,burn,swap} [V]
router          → psp22/token    [T1-T7] router::* → PSP22Ref::{transfer_from,transfer}                            [V]
router          → wnative        [W1-W3] router::* → WNativeRef::{deposit,withdraw,transfer}                       [V]
pair            → psp22/token_0  [PA1-PA6] pair::{mint,burn,sync,skim,collect_protocol_fees,collect_rewards_fees} → PSP22Ref::{balance_of,transfer,transfer_from} [V/U]
pair            → rewards        [PA5]  pair::collect_rewards_fees → PSP22Ref::transfer(token, rewards_contract)   [U] — wiring must be set externally post-deployment
listing_manager → psp22/lunes    [LM1-LM4] listing_manager::list_token → PSP22Ref::{transfer_from,transfer} on lunes_token [V]
liquidity_lock  → psp22/lp_token [LL1]  liquidity_lock::withdraw → PSP22::transfer(lp_token, owner, amount)       [S]
copy_vault      → psp22/token    [CV1,CV3] copy_vault::swap_through_router → PSP22::{approve,balance_of}          [V]
copy_vault      → router         [CV2,CV6] copy_vault::swap_through_router → router::{swap_exact_tokens,get_amount_out} [U] — set_router required
copy_vault      → factory        [CV4]  copy_vault valuation → factory::get_pair                                   [U] — set_valuation_infra required
copy_vault      → pair           [CV5]  copy_vault valuation → pair::get_reserves                                  [V] (conditional on CV4)
spot_settlement → psp22/token    [SS1,SS2] spot_settlement::{deposit_psp22,withdraw_psp22} → PSP22::{transfer_from,transfer} [V]
rewards         → staking        [RW1]  rewards::receive_fee_allocation → env().transfer(staking) [native value only, no ABI] [U] — set_staking_contract required; design gap: no ABI notify
staking         → (none)         [--]  all transfers are env().transfer to EOAs; no outbound ABI calls              [V]
asset_wrapper   → (none)         [--]  no outbound calls                                                           [V]
asymmetric_pair → (none)         [--]  no outbound calls; PSP22 accounting is off-chain                            [V]
psp22           → (none)         [--]  standalone                                                                   [V]
wnative         → (none)         [--]  standalone                                                                   [V]
```

---

## Totals

| Metric | Count |
|---|---|
| Distinct directed edges (caller contract → callee contract type) | **19** |
| VERIFIED `[V]` | **13** |
| UNVERIFIED `[U]` (setter exists, wiring requires external post-deploy call) | **5** (RW1, CV2, CV4, CV6, PA5/PA4) |
| STUBBED `[S]` (`#[cfg(not(test))]` guard — real call in prod) | **1** (LL1) |

### UNVERIFIED Edges Summary (dangling wiring risk)

| Edge | Risk |
|---|---|
| `pair::collect_rewards_fees` → rewards (PA5) | `set_trading_rewards_contract` on each pair must be called by factory admin after `create_pair`. Factory does not do this automatically. |
| `pair::collect_protocol_fees` → fee_to (PA4) | `set_protocol_fee_to` on each pair must be called by factory admin. Same gap. |
| `copy_vault` → router (CV2, CV6) | `set_router` must be called by admin before any `swap_through_router` call. |
| `copy_vault` → factory (CV4) | `set_valuation_infra` must be called by admin before valuation helpers work. |
| `rewards` → staking (RW1) | `set_staking_contract` must be called by rewards admin. Additionally: only a value push, no ABI message — staking has no way to attribute the received LUNES to the rewards contract. |
