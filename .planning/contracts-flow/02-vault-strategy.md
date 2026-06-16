# 02 — Vault / Strategy Cross-Contract Edge Map

**Cluster:** `copy_vault` · `asymmetric_pair`
**Source files analysed:**
- `Lunex/contracts/copy_vault/lib.rs` (3 798 lines, last modified 2026-06-14)
- `Lunex/contracts/asymmetric_pair/lib.rs` (630 lines)

---

## 1. Selector constants (copy_vault/lib.rs L145–171)

All five outbound call targets are identified by hardcoded `[u8; 4]` consts.
A dedicated unit test (`test_selectors_match_deployed_labels`, lib.rs L2348–2374)
asserts each const equals the canonical `ink::selector_bytes!()` value.

| Const | Value | Canonical label | Deployed contract |
|---|---|---|---|
| `PSP22_APPROVE_SELECTOR` | `[0xb2,0x0f,0x1b,0xbd]` | `PSP22::approve` | psp22_token / wnative |
| `ROUTER_SWAP_EXACT_TOKENS_SELECTOR` | `[0xa0,0xac,0x73,0xcf]` | `swap_exact_tokens_for_tokens` | router |
| `PSP22_BALANCE_OF_SELECTOR` | `[0x65,0x68,0x38,0x2f]` | `PSP22::balance_of` | psp22_token / wnative |
| `FACTORY_GET_PAIR_SELECTOR` | `[0x33,0x7d,0xaf,0x4f]` | `get_pair` | factory |
| `PAIR_GET_RESERVES_SELECTOR` | `[0x8a,0x0d,0x11,0x6f]` | `get_reserves` | pair_contract |
| `ROUTER_GET_AMOUNT_OUT_SELECTOR` | `[0xa8,0x54,0x49,0x16]` | `get_amount_out` | router |

---

## 2. Stored contract-address references (copy_vault/lib.rs)

| Field | Type | Default | Set via | Getter |
|---|---|---|---|---|
| `router` | `Option<AccountId>` | `None` (L531) | `set_router(router)` L1499, admin-only (`ensure_admin`) | `router_address()` L1507 |
| `factory` | `Option<AccountId>` | `None` (L535) | `set_valuation_infra(factory, wnative)` L1519, admin-only | `get_valuation_infra()` L1532 |
| `wnative` | `Option<AccountId>` | `None` (L536) | same setter above | same getter |

No address is passed in the constructor (`new(leader, performance_fee_bps)` L502).
All three addresses are post-deployment admin calls; until set, any code path
that reads them returns `VaultError::RouterNotConfigured` or
`VaultError::ValuationInfraNotConfigured`.

---

## 3. Edge table — copy_vault outbound calls

> **CFG gate legend**
> `PROD` = inside `#[cfg(not(test))]` block — real call on-chain, skipped in unit tests.
> `TEST` = inside `#[cfg(test)]` block — mock only, never executes on-chain.

---

### Edge CV-1 — PSP22::approve (token_in → router allowance)

| Field | Detail |
|---|---|
| **Caller** | `copy_vault::swap_through_router` (lib.rs L1226) |
| **Callee contract** | PSP22 token at address `token_in` (caller-supplied) |
| **Callee message** | `PSP22::approve(spender, value)` |
| **Selector** | `PSP22_APPROVE_SELECTOR` = `[0xb2,0x0f,0x1b,0xbd]` (L145, L1231) |
| **Args** | `spender = router` (stored `Option<AccountId>`, L1232), `value = amount_in` (L1233) |
| **Value transferred** | 0 (L1229) |
| **Return decoded** | `Result<(), Psp22ErrorMirror>` (L1235); triple-unwrap `Ok(Ok(Ok(())))` or reverts with `VaultError::TokenApproveFailed` (L1238–1243) |
| **CFG gate** | `#[cfg(not(test))]` (lib.rs L1217) — PROD only |
| **Wiring** | `router` address from `self.router` set via `set_router()` admin call |
| **Trust** | Caller (leader) supplies `token_in`; no whitelist check before approve — any PSP22 can be targeted |
| **Status** | **VERIFIED** |

---

### Edge CV-2 — Router::swap_exact_tokens_for_tokens

| Field | Detail |
|---|---|
| **Caller** | `copy_vault::swap_through_router` (lib.rs L1264) |
| **Callee contract** | Router at `self.router` |
| **Callee message** | `swap_exact_tokens_for_tokens(amount_in, amount_out_min, path, to, deadline)` |
| **Selector** | `ROUTER_SWAP_EXACT_TOKENS_SELECTOR` = `[0xa0,0xac,0x73,0xcf]` (L149, L1270) |
| **Args** | `amount_in` (L1272), `min_amount_out` (L1273), `path = [token_in, token_out]` (L1261–1274), `to = self.env().account_id()` (L1275), `deadline = block_timestamp + SWAP_DEADLINE_WINDOW_MS` (L1276) |
| **Value transferred** | 0 (L1265 gas_limit 0, transferred_value 0) |
| **Return decoded** | `Result<Vec<Balance>, RouterErrorMirror>` (L1278); last element of `amounts` vec is `amount_out` credited to vault (L1281–1295) |
| **CFG gate** | `#[cfg(not(test))]` (lib.rs L1217) — PROD only |
| **Test stub** | `#[cfg(test)]` block L1297–1303: skips the call, sets `amount_out = min_amount_out` (no-op mock) |
| **Wiring** | `router` = `self.router` (stored); must be set before call or reverts with `VaultError::RouterNotConfigured` (L1110–1117) |
| **Trust** | Off-chain dependency: router contract must be the correct Lunex router deployment; vault blindly trusts return value |
| **Status** | **VERIFIED** |

---

### Edge CV-3 — PSP22::balance_of (per tracked token, equity valuation)

| Field | Detail |
|---|---|
| **Caller** | `copy_vault::psp22_balance_of(token)` (lib.rs L1869), called from equity valuation path (`calculate_total_equity`, `deposit`, `withdraw`) |
| **Callee contract** | PSP22 token at address `token` |
| **Callee message** | `PSP22::balance_of(owner)` |
| **Selector** | `PSP22_BALANCE_OF_SELECTOR` = `[0x65,0x68,0x38,0x2f]` (L153, L1882) |
| **Args** | `owner = self.env().account_id()` (vault's own address) (L1883) |
| **Value transferred** | 0 |
| **Return decoded** | `Balance` (L1885); maps `Err` → `VaultError::ValuationUnavailable` (L1888–1890) |
| **CFG gate** | `#[cfg(not(test))]` (lib.rs L1870) — PROD only |
| **Test stub** | `#[cfg(test)]` L1892–1894: returns `test_mocks::psp22_balance(token)` from `thread_local! PSP22_BALANCES` (BTreeMap, L2091–2093) |
| **Wiring** | `token` address comes from vault's `tracked_tokens: Mapping<u32, AccountId>` — set by `add_tracked_token()` |
| **Trust** | Trusted (vault calls its own tracked-token list); malicious PSP22 could return inflated balance (no additional guard at this layer) |
| **Status** | **VERIFIED** |

---

### Edge CV-4 — Factory::get_pair (pair address resolution)

| Field | Detail |
|---|---|
| **Caller** | `copy_vault::pair_reserves(token, wnative, factory)` (lib.rs L1913) |
| **Callee contract** | Factory at `self.factory` |
| **Callee message** | `get_pair(token_a, token_b) -> Option<AccountId>` |
| **Selector** | `FACTORY_GET_PAIR_SELECTOR` = `[0x33,0x7d,0xaf,0x4f]` (L157, L1918) |
| **Args** | `token_a = token`, `token_b = wnative` (L1919–1920) |
| **Value transferred** | 0 |
| **Return decoded** | `Option<AccountId>` (L1922); `None` or error → `VaultError::ValuationUnavailable` (L1924–1927) |
| **CFG gate** | `#[cfg(not(test))]` (lib.rs L1906) — PROD only |
| **Test stub** | `#[cfg(test)]` L1951–1954: ignores factory/wnative; calls `test_mocks::pair_reserves(token)` from `PAIR_RESERVES` BTreeMap (L2093) |
| **Wiring** | `factory` read from `self.factory` via `require_valuation_infra()` (L1782–1786); set via `set_valuation_infra()` admin call |
| **Trust** | Off-chain dependency: factory must match deployed contract |
| **Status** | **VERIFIED** |

---

### Edge CV-5 — Pair::get_reserves (reserve query)

| Field | Detail |
|---|---|
| **Caller** | `copy_vault::pair_reserves(...)` (lib.rs L1929), immediately after CV-4 resolves the pair address |
| **Callee contract** | Pair contract at address returned by CV-4 (`pair` local var, L1930) |
| **Callee message** | `get_reserves() -> (Balance, Balance, u64)` |
| **Selector** | `PAIR_GET_RESERVES_SELECTOR` = `[0x8a,0x0d,0x11,0x6f]` (L162, L1934) |
| **Args** | none |
| **Value transferred** | 0 |
| **Return decoded** | `(reserve_0, reserve_1, _timestamp)` (L1936–1939); re-ordered by `token_0 < token_1` byte order to yield `(reserve_token, reserve_native)` (L1941–1949) |
| **CFG gate** | `#[cfg(not(test))]` same block as CV-4, L1906 |
| **Test stub** | same as CV-4: `test_mocks::pair_reserves(token)` (L1951–1954) |
| **Wiring** | `pair` address is transient — not stored; resolved at call time via CV-4. No persistent pair-address field in storage |
| **Trust** | Off-chain dependency: resolved pair must be a genuine pair_contract; pair address returned by factory is trusted |
| **Status** | **VERIFIED** |

---

### Edge CV-6 — Router::get_amount_out (spot price for equity valuation)

| Field | Detail |
|---|---|
| **Caller** | `copy_vault::quote_token_to_native(token, amount)` (lib.rs L1981) |
| **Callee contract** | Router at `self.router` |
| **Callee message** | `get_amount_out(amount_in, reserve_in, reserve_out) -> Result<Balance, RouterError>` |
| **Selector** | `ROUTER_GET_AMOUNT_OUT_SELECTOR` = `[0xa8,0x54,0x49,0x16]` (L171, L1987) |
| **Args** | `amount` (L1989), `reserve_token` (L1990), `reserve_native` (L1991) — reserves from CV-5 |
| **Value transferred** | 0 |
| **Return decoded** | `Result<Balance, RouterErrorMirror>` (L1993); `Ok(Ok(price))` extracted; error → `VaultError::ValuationUnavailable` |
| **CFG gate** | `#[cfg(not(test))]` (lib.rs L1973) — PROD only |
| **Test stub** | `#[cfg(test)]` L2000–2016: pure arithmetic fallback `amount * reserve_native / reserve_token` using `checked_mul`/`checked_div` (no router call) |
| **Wiring** | `router` = `self.router`; also requires `self.factory` and `self.wnative` set (via `require_valuation_infra` L1966) |
| **Trust** | Off-chain dependency: router's fee formula (used in `get_amount_out`) must match deployed metadata |
| **Status** | **VERIFIED** |

---

## 4. Call-graph summary — copy_vault

```
copy_vault::swap_through_router
  ├─[PROD] CV-1 → psp22_token::PSP22::approve(router, amount_in)
  └─[PROD] CV-2 → router::swap_exact_tokens_for_tokens(amount_in, min_out, path, self, deadline)
      [TEST]   → no-op stub (amount_out = min_amount_out)

copy_vault::calculate_total_equity / deposit / withdraw
  └─ copy_vault::psp22_balance_of(token)
       ├─[PROD] CV-3 → psp22_token::PSP22::balance_of(vault)
       └─[TEST]   → test_mocks::psp22_balance(token)

copy_vault::quote_token_to_native(token, amount)
  └─ copy_vault::pair_reserves(token, wnative, factory)
       ├─[PROD] CV-4 → factory::get_pair(token, wnative)   → pair_addr
       └─[PROD] CV-5 → pair_addr::get_reserves()           → (r0, r1, _)
  ├─[PROD] CV-6 → router::get_amount_out(amount, r_token, r_native)
  └─[TEST]   → pure arithmetic (r_native * amount / r_token)

copy_vault::add_tracked_token
  └─ copy_vault::pair_reserves + quote_token_to_native (same CV-4/5/6 path)
     [used at add-time to verify pair exists and has min liquidity]
```

---

## 5. Edge table — asymmetric_pair outbound calls

Comprehensive grep for `build_call`, `try_invoke`, `ink::env::call`, `ExecutionInput`,
`Selector::new`, `transfer_from`, `ContractRef` across
`asymmetric_pair/lib.rs` (630 lines) returned **zero hits**.

The `asymmetric_swap` message (L406–L459) is pure in-contract math:
curve state mutation (`current_volume`, `buy_curve.k`, `sell_curve.k`),
arithmetic helpers (`compute_liquidity`), and event emission only.

The comment at L292 explicitly states:
> `// Reduce buy_curve.k (simplified: full accounting done by PSP22 transfer off-chain)`

Token transfers for `asymmetric_pair` are delegated to the **caller** (off-chain or
a router/wrapper contract) and are not executed by this contract.

### Stored address fields (asymmetric_pair/lib.rs L110–128)

| Field | Type | Role | Cross-contract use? |
|---|---|---|---|
| `owner` | `AccountId` | access control | No — only compared against `caller()` |
| `manager` | `Option<AccountId>` | access control | No — only compared against `caller()` |
| `base_token` | `AccountId` | token identity | No — stored metadata only, never called |
| `quote_token` | `AccountId` | token identity | No — stored metadata only, never called |

No outbound cross-contract edges exist in `asymmetric_pair`.

---

## 6. Counts

| Status | Count | Contracts |
|---|---|---|
| **VERIFIED** | 6 | copy_vault (CV-1 through CV-6) |
| **UNVERIFIED** | 0 | — |
| **STUBBED (`#[cfg(test)]`)** | 5 | CV-1/2 (one shared `#[cfg(not(test))]` block), CV-3, CV-4/5 (one shared block), CV-6 — each has a distinct `#[cfg(test)]` mock path |

> Note on STUBBED count: each of the 4 `cfg` gates (L1217, L1870, L1906, L1973) has a
> corresponding `#[cfg(test)]` branch. CV-4 and CV-5 share one gate and one mock
> (the `pair_reserves` fn). This is not a defect — it is the intended ink! unit-test
> pattern and the production paths are validated by the E2E scripts
> `spot-api/scripts/e2e-copy-vault-swap.ts` and `e2e-copy-vault-equity.ts`.
>
> `asymmetric_pair` has **zero** cross-contract calls — no edges, no stubs.
