# AMM Core Cross-Contract Edge Map

Cluster: **router / factory / pair**
Audited files:
- `contracts/router/lib.rs`
- `contracts/factory/lib.rs`
- `contracts/pair/lib.rs`

---

## Stored Address References (WIRING)

| Contract | Field | Type | Set Where | Evidence |
|---|---|---|---|---|
| router | `factory` | `AccountId` | constructor param | `router/lib.rs:442,460` |
| router | `wnative` | `AccountId` | constructor param | `router/lib.rs:444,461` |
| pair | `factory` | `AccountId` | constructor param | `pair/lib.rs:333,408,410` |
| pair | `token_0` | `AccountId` | constructor param | `pair/lib.rs:331,408,411` |
| pair | `token_1` | `AccountId` | constructor param | `pair/lib.rs:332,408,412` |
| pair | `protocol_fee_to` | `Lazy<Option<AccountId>>` | `set_protocol_fee_to` msg (caller must == factory) | `pair/lib.rs:419` (init None) |
| pair | `trading_rewards_contract` | `Lazy<Option<AccountId>>` | `set_trading_rewards_contract` msg (caller must == factory) | `pair/lib.rs:420` (init None) |
| factory | `pair_contract_code_hash` | `Lazy<Hash>` | constructor param | `factory/lib.rs:59,94` |
| factory | `fee_to` | `Lazy<AccountId>` | `set_fee_to` msg (caller must == fee_to_setter) | `factory/lib.rs:49` |

---

## Outbound Cross-Contract Edges

### FACTORY → PAIR (instantiate)

| # | CALLER | CALLEE | Selector / Method | Args | Value | Return | WIRING | TRUST | STATUS |
|---|---|---|---|---|---|---|---|---|---|
| F1 | `factory::create_pair` (`factory/lib.rs:260`) | `pair::new` (PairContractRef constructor) | ink! `instantiate` via `PairContractRef::new(...).code_hash(hash).instantiate()` | `(factory_address, token_0, token_1)` + salt = `[token_0_bytes ++ token_1_bytes]` | 0 (endowment=0) | deployed `AccountId` | `pair_contract_code_hash` set at factory constructor (`factory/lib.rs:94,283`); uses `Lazy::get().unwrap_or_default()` — zero hash if never set | Fully on-chain | VERIFIED |

---

### ROUTER → FACTORY

| # | CALLER | CALLEE | Selector | Args | Value | Return | WIRING | TRUST | STATUS |
|---|---|---|---|---|---|---|---|---|---|
| R1 | `router::add_liquidity` (`router/lib.rs:655`) | `factory::get_pair` | `selector_bytes!("get_pair")` | `(self.factory, token_0, token_1)` | 0 | `Option<AccountId>` | `self.factory` set at constructor `router/lib.rs:460` | Fully on-chain | VERIFIED |
| R2 | `router::remove_liquidity` (`router/lib.rs:782`) | `factory::get_pair` | `selector_bytes!("get_pair")` | `(self.factory, token_0, token_1)` | 0 | `Option<AccountId>` | same as R1 | Fully on-chain | VERIFIED |
| R3 | `router::swap_exact_tokens_for_tokens` (`router/lib.rs:882`) | `factory::get_pair` | `selector_bytes!("get_pair")` | `(self.factory, path[0], path[1])` | 0 | `Option<AccountId>` | same as R1 | Fully on-chain | VERIFIED |
| R4 | `router::swap_tokens_for_exact_tokens` (`router/lib.rs:961`) | `factory::get_pair` | `selector_bytes!("get_pair")` | `(self.factory, path[0], path[1])` | 0 | `Option<AccountId>` | same as R1 | Fully on-chain | VERIFIED |
| R5 | `router::swap_tokens_for_exact_tokens` (`router/lib.rs:1005`) | `factory::get_pair` | `selector_bytes!("get_pair")` | `(self.factory, output, path[i+2])` — lookahead for multi-hop next-pair | 0 | `Option<AccountId>` | same as R1 | Fully on-chain | VERIFIED |
| R6 | `router::swap_tokens_for_exact_tokens` (`router/lib.rs:1012`) | `factory::get_pair` | `selector_bytes!("get_pair")` | `(self.factory, input, output)` — per-hop pair lookup | 0 | `Option<AccountId>` | same as R1 | Fully on-chain | VERIFIED |
| R7 | `router::swap_exact_native_for_tokens` (`router/lib.rs:1216`) | `factory::get_pair` | `selector_bytes!("get_pair")` | `(self.factory, path[0], path[1])` | 0 | `Option<AccountId>` | same as R1 | Fully on-chain | VERIFIED |
| R8 | `router::swap_exact_tokens_for_native` (`router/lib.rs:1289`) | `factory::get_pair` | `selector_bytes!("get_pair")` | `(self.factory, path[0], path[1])` | 0 | `Option<AccountId>` | same as R1 | Fully on-chain | VERIFIED |

---

### ROUTER → PAIR

| # | CALLER | CALLEE | Selector | Args | Value | Return | WIRING | TRUST | STATUS |
|---|---|---|---|---|---|---|---|---|---|
| R9 | `router::add_liquidity` (`router/lib.rs:660`) | `pair::get_reserves` | `selector_bytes!("get_reserves")` | `(pair)` | 0 | `(Balance, Balance, u64)` | pair addr returned by factory::get_pair (R1) | Fully on-chain | VERIFIED |
| R10 | `router::add_liquidity` (`router/lib.rs:708`) | `pair::mint` | `selector_bytes!("mint")` | `(pair, to)` | 0 | `Balance` (LP minted) | same as R9 | Fully on-chain | VERIFIED |
| R11 | `router::remove_liquidity` (`router/lib.rs:792`) | `pair::burn` | `selector_bytes!("burn")` | `(pair, to)` | 0 | `(Balance, Balance)` | pair addr from R2 | Fully on-chain | VERIFIED |
| R12 | `router::swap_tokens_for_exact_tokens` (`router/lib.rs:1015`) | `pair::swap` | `selector_bytes!("swap")` | `(pair, amount_0_out, amount_1_out, to)` | 0 | `()` | pair addr from R6 | Fully on-chain | VERIFIED |

---

### ROUTER → PSP22 tokens (external)

| # | CALLER | CALLEE | Selector | Args | Value | Return | WIRING | TRUST | STATUS |
|---|---|---|---|---|---|---|---|---|---|
| R13 | `router::add_liquidity` (`router/lib.rs:701`) | `PSP22::transfer_from` on `token_a` | `selector_bytes!("PSP22::transfer_from")` | `(token_a, caller, pair, amount_a, [])` | 0 | `Result<(),PSP22Error>` | token_a = caller-supplied param; pair from R1 | Depends on caller having set allowance off-chain | VERIFIED |
| R14 | `router::add_liquidity` (`router/lib.rs:703`) | `PSP22::transfer_from` on `token_b` | `selector_bytes!("PSP22::transfer_from")` | `(token_b, caller, pair, amount_b, [])` | 0 | `Result<(),PSP22Error>` | token_b = caller-supplied param | same | VERIFIED |
| R15 | `router::remove_liquidity` (`router/lib.rs:787`) | `PSP22::transfer_from` on LP token (`pair`) | `selector_bytes!("PSP22::transfer_from")` | `(pair, caller, pair, liquidity, [])` | 0 | `Result<(),PSP22Error>` | pair addr from R2; LP token contract IS the pair contract | Depends on caller having approved pair on the LP token off-chain | VERIFIED |
| R16 | `router::swap_exact_tokens_for_tokens` (`router/lib.rs:885`) | `PSP22::transfer_from` on `path[0]` | `selector_bytes!("PSP22::transfer_from")` | `(path[0], caller, pair, amounts[0], [])` | 0 | `Result<(),PSP22Error>` | path[0] caller-supplied; pair from R3 | off-chain allowance required | VERIFIED |
| R17 | `router::swap_tokens_for_exact_tokens` (`router/lib.rs:964`) | `PSP22::transfer_from` on `path[0]` | `selector_bytes!("PSP22::transfer_from")` | `(path[0], caller, pair, amounts[0], [])` | 0 | `Result<(),PSP22Error>` | same as R16 | off-chain allowance required | VERIFIED |
| R18 | `router::remove_liquidity_native` (`router/lib.rs:1151`) | `PSP22::transfer` on `token` | `selector_bytes!("PSP22::transfer")` | `(token, to, amount_token, [])` | 0 | `Result<(),PSP22Error>` | token = caller-supplied param | Fully on-chain (router sends its own balance) | VERIFIED |
| R19 | `router::swap_exact_tokens_for_native` (`router/lib.rs:1292`) | `PSP22::transfer_from` on `path[0]` | `selector_bytes!("PSP22::transfer_from")` | `(path[0], caller, pair, amounts[0], [])` | 0 | `Result<(),PSP22Error>` | path[0] caller-supplied | off-chain allowance required | VERIFIED |

---

### ROUTER → WNATIVE contract

| # | CALLER | CALLEE | Selector | Args | Value | Return | WIRING | TRUST | STATUS |
|---|---|---|---|---|---|---|---|---|---|
| R20 | `router::add_liquidity_native` (`router/lib.rs:1078`) | `WNative::deposit` | `selector_bytes!("deposit")` | `(self.wnative)` | `amount_native` transferred | `Result<(),()>` | `self.wnative` set at constructor `router/lib.rs:461` | Fully on-chain; native value forwarded | VERIFIED |
| R21 | `router::add_liquidity_native` (`router/lib.rs:1095`) | `WNative::withdraw` | `selector_bytes!("withdraw")` | `(self.wnative, amount_native)` | 0 | `Result<(),()>` | same as R20 | Fully on-chain (rollback path) | VERIFIED |
| R22 | `router::remove_liquidity_native` (`router/lib.rs:1155`) | `WNative::withdraw` | `selector_bytes!("withdraw")` | `(self.wnative, amount_native)` | 0 | `Result<(),()>` | same as R20 | Fully on-chain | VERIFIED |
| R23 | `router::swap_exact_native_for_tokens` (`router/lib.rs:1204`) | `WNative::deposit` | `selector_bytes!("deposit")` | `(self.wnative)` | `amount_in` transferred | `Result<(),()>` | same as R20 | Fully on-chain; native value forwarded | VERIFIED |
| R24 | `router::swap_exact_native_for_tokens` (`router/lib.rs:1219`) | `WNative::transfer` (PSP22 transfer on WNative) | `selector_bytes!("transfer")` | `(self.wnative, pair, amounts[0])` | 0 | `Result<(),()>` | same as R20; pair from R7 | Fully on-chain | VERIFIED |
| R25 | `router::swap_exact_tokens_for_native` (`router/lib.rs:1300`) | `WNative::withdraw` | `selector_bytes!("withdraw")` | `(self.wnative, final_amount)` | 0 | `Result<(),()>` | same as R20 | Fully on-chain | VERIFIED |

---

### PAIR → PSP22 tokens (external)

| # | CALLER | CALLEE | Selector | Args | Value | Return | WIRING | TRUST | STATUS |
|---|---|---|---|---|---|---|---|---|---|
| P1 | `pair::mint` (`pair/lib.rs:633`) | `PSP22::balance_of` on `token_0` | `selector_bytes!("PSP22::balance_of")` | `(self.token_0, contract_address)` | 0 | `Balance` | `self.token_0` set at constructor param | Fully on-chain | VERIFIED |
| P2 | `pair::mint` (`pair/lib.rs:638`) | `PSP22::balance_of` on `token_1` | `selector_bytes!("PSP22::balance_of")` | `(self.token_1, contract_address)` | 0 | `Balance` | `self.token_1` set at constructor param | Fully on-chain | VERIFIED |
| P3 | `pair::burn` (`pair/lib.rs:769`) | `PSP22::balance_of` on `token_0` | `selector_bytes!("PSP22::balance_of")` | `(self.token_0, contract_address)` | 0 | `Balance` | same as P1 | Fully on-chain | VERIFIED |
| P4 | `pair::burn` (`pair/lib.rs:774`) | `PSP22::balance_of` on `token_1` | `selector_bytes!("PSP22::balance_of")` | `(self.token_1, contract_address)` | 0 | `Balance` | same as P2 | Fully on-chain | VERIFIED |
| P5 | `pair::burn` (`pair/lib.rs:822`) | `PSP22::transfer` on `token_0` | `selector_bytes!("PSP22::transfer")` | `(self.token_0, to, amount_0, [])` | 0 | `Result<(),PSP22Error>` | same as P1 | Fully on-chain | VERIFIED |
| P6 | `pair::burn` (`pair/lib.rs:827`) | `PSP22::transfer` on `token_1` | `selector_bytes!("PSP22::transfer")` | `(self.token_1, to, amount_1, [])` | 0 | `Result<(),PSP22Error>` | same as P2 | Fully on-chain | VERIFIED |
| P7 | `pair::swap` (`pair/lib.rs:920`) | `PSP22::transfer` on `token_0` | `selector_bytes!("PSP22::transfer")` | `(self.token_0, to, amount_0_out, [])` | 0 | `Result<(),PSP22Error>` | same as P1 | Optimistic (before invariant check) | VERIFIED |
| P8 | `pair::swap` (`pair/lib.rs:927`) | `PSP22::transfer` on `token_1` | `selector_bytes!("PSP22::transfer")` | `(self.token_1, to, amount_1_out, [])` | 0 | `Result<(),PSP22Error>` | same as P2 | Optimistic (before invariant check) | VERIFIED |
| P9 | `pair::swap` (`pair/lib.rs:937`) | `PSP22::balance_of` on `token_0` | `selector_bytes!("PSP22::balance_of")` | `(self.token_0, contract_address)` | 0 | `Balance` | same as P1 | Fully on-chain (post-transfer balance check) | VERIFIED |
| P10 | `pair::swap` (`pair/lib.rs:942`) | `PSP22::balance_of` on `token_1` | `selector_bytes!("PSP22::balance_of")` | `(self.token_1, contract_address)` | 0 | `Balance` | same as P2 | Fully on-chain (post-transfer balance check) | VERIFIED |
| P11 | `pair::sync` (`pair/lib.rs:1072`) | `PSP22::balance_of` on `token_0` | `selector_bytes!("PSP22::balance_of")` | `(self.token_0, contract_address)` | 0 | `Balance` | same as P1 | Fully on-chain | VERIFIED |
| P12 | `pair::sync` (`pair/lib.rs:1077`) | `PSP22::balance_of` on `token_1` | `selector_bytes!("PSP22::balance_of")` | `(self.token_1, contract_address)` | 0 | `Balance` | same as P2 | Fully on-chain | VERIFIED |
| P13 | `pair::skim` (`pair/lib.rs:1109`) | `PSP22::balance_of` on `token_0` | `selector_bytes!("PSP22::balance_of")` | `(self.token_0, contract_address)` | 0 | `Balance` | same as P1 | Fully on-chain | VERIFIED |
| P14 | `pair::skim` (`pair/lib.rs:1114`) | `PSP22::balance_of` on `token_1` | `selector_bytes!("PSP22::balance_of")` | `(self.token_1, contract_address)` | 0 | `Balance` | same as P2 | Fully on-chain | VERIFIED |
| P15 | `pair::skim` (`pair/lib.rs:1126`) | `PSP22::transfer` on `token_0` | `selector_bytes!("PSP22::transfer")` | `(self.token_0, to, excess_0, [])` | 0 | `Result<(),PSP22Error>` | same as P1 | Fully on-chain | VERIFIED |
| P16 | `pair::skim` (`pair/lib.rs:1133`) | `PSP22::transfer` on `token_1` | `selector_bytes!("PSP22::transfer")` | `(self.token_1, to, excess_1, [])` | 0 | `Result<(),PSP22Error>` | same as P2 | Fully on-chain | VERIFIED |
| P17 | `pair::collect_protocol_fees` (`pair/lib.rs:1403`) | `PSP22::transfer` on `token_0` | `selector_bytes!("PSP22::transfer")` | `(self.token_0, fee_to, fees_0, [])` | 0 | `Result<(),PSP22Error>` | `fee_to` = `self.protocol_fee_to.get()` — set via `set_protocol_fee_to` (caller must == factory); None at init | Fully on-chain; gated on fee_to set | VERIFIED |
| P18 | `pair::collect_protocol_fees` (`pair/lib.rs:1410`) | `PSP22::transfer` on `token_1` | `selector_bytes!("PSP22::transfer")` | `(self.token_1, fee_to, fees_1, [])` | 0 | `Result<(),PSP22Error>` | same as P17 | same as P17 | VERIFIED |
| P19 | `pair::collect_rewards_fees` (`pair/lib.rs:1448`) | `PSP22::transfer` on `token_0` | `selector_bytes!("PSP22::transfer")` | `(self.token_0, rewards_contract, fees_0, [])` | 0 | `Result<(),PSP22Error>` | `rewards_contract` = `self.trading_rewards_contract.get()` — set via `set_trading_rewards_contract` (caller must == factory); None at init | Fully on-chain; gated on contract set | VERIFIED |
| P20 | `pair::collect_rewards_fees` (`pair/lib.rs:1455`) | `PSP22::transfer` on `token_1` | `selector_bytes!("PSP22::transfer")` | `(self.token_1, rewards_contract, fees_1, [])` | 0 | `Result<(),PSP22Error>` | same as P19 | same as P19 | VERIFIED |

---

## INBOUND: Who calls INTO these 3 contracts

> Only edges proven in the codebase at audit time. Callers outside this cluster are NOT confirmed here — left for synthesis agent.

| Callee | Message | Proven caller (within cluster) |
|---|---|---|
| `factory::get_pair` | read-only lookup | router (R1–R8) |
| `pair::get_reserves` | read-only | router (R9) |
| `pair::mint` | state-mutating | router (R10) |
| `pair::burn` | state-mutating | router (R11) |
| `pair::swap` | state-mutating | router (R12) |
| `pair::new` (constructor) | instantiate | factory (F1) |
| `pair::set_trading_rewards_contract` | state-mutating | **UNVERIFIED within cluster** — message is callable only by `self.factory`; no call site in factory/router code found. Off-chain actor (deployer) must call this via factory's `AccountId` or directly. |
| `pair::set_protocol_fee_to` | state-mutating | **UNVERIFIED within cluster** — same pattern; guarded by `caller == factory` check but no factory code calls it. |
| `pair::collect_protocol_fees` | state-mutating | **UNVERIFIED within cluster** — no caller in router or factory; assumed off-chain (fee bot) |
| `pair::collect_rewards_fees` | state-mutating | **UNVERIFIED within cluster** — no caller in router or factory; assumed off-chain (rewards bot) or `trading_rewards_contract` itself |

---

## UNVERIFIED Edges

| Edge | What is missing |
|---|---|
| Who calls `pair::set_protocol_fee_to` | No call site found in factory or router. The message is guarded by `caller == factory`. Must be invoked by an off-chain actor holding the factory key. No on-chain evidence of the wiring. |
| Who calls `pair::set_trading_rewards_contract` | Same as above. No call site in factory or router code. |
| Who calls `pair::collect_protocol_fees` | No call site in cluster. Off-chain actor assumed. |
| Who calls `pair::collect_rewards_fees` | No call site in cluster. Off-chain actor or `trading_rewards_contract` assumed. |
| Inbound callers from outside this cluster (staking, copy_vault, etc.) | Not audited here — left for synthesis agent. |

---

## Notes

1. **PSP22 selectors**: `PSP22::balance_of` uses `selector_bytes!("PSP22::balance_of")` (commented as `0x6568382f`). `PSP22::transfer` uses `selector_bytes!("PSP22::transfer")`. `PSP22::transfer_from` uses `selector_bytes!("PSP22::transfer_from")`. All are PSP22 spec standard selectors.
2. **WNativeRef::transfer** (`router/lib.rs:264`) calls `selector_bytes!("transfer")` (bare, not PSP22-namespaced) on the WNative contract — this is the WNative's PSP22-compatible `transfer` message.
3. **Factory `pair_contract_code_hash` safety**: Uses `Lazy::get().unwrap_or_default()` at `factory/lib.rs:283–285`. If the Lazy is somehow unset, `unwrap_or_default()` yields a zero hash and the instantiate will fail at runtime — not a panic, but a silent failure risk.
4. **Pair `swap` optimistic transfer**: P7/P8 send tokens out BEFORE the K-invariant check (P9/P10). This matches Uniswap v2 design and is intentional, but creates a reentrancy surface if the reentrancy lock (`unlocked`) is not enforced at entry.
5. **Router `remove_liquidity` L787**: calls `PSP22::transfer_from(pair, caller, pair, liquidity)` — the LP token contract is the pair itself; `from = caller`, `to = pair`. This burns the LP tokens by moving them into the pair before `burn` is called.

---

## Edge Count Summary

| Status | Count |
|---|---|
| VERIFIED | 46 (F1 + R1–R25 + P1–P20) |
| UNVERIFIED | 4 (set_protocol_fee_to caller, set_trading_rewards_contract caller, collect_protocol_fees caller, collect_rewards_fees caller) |
| STUBBED | 0 |

**Total edges: 50**
