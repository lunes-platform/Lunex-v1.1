# Token Layer — Cross-Contract Communication Map

**Contracts:** `asset_wrapper` · `wnative` · `psp22`
**Audited:** 2026-06-16
**Method:** static grep of every `.rs` file; no edge is inferred — all cited by file:line.

---

## 1. Stored Address References (wiring surface)

| Contract | Field | Type | Set by | File:line |
|---|---|---|---|---|
| `asset_wrapper` | `admin` | `AccountId` | constructor arg + `set_admin` | `asset_wrapper/src/lib.rs:145,189,514–526` |
| `asset_wrapper` | *(no peer contract address)* | — | — | — |
| `wnative` | *(no stored AccountId)* | — | — | — |
| `psp22` | `owner` | `AccountId` | constructor (`Self::env().caller()`) | `psp22/lib.rs:55,82` |

**Observation:** None of the three contracts store the `AccountId` of another *ink! contract*. `asset_wrapper.admin` is the relayer EOA (off-chain account), not a contract reference. `psp22.owner` is the deployer EOA.

---

## 2. Outbound Cross-Contract Call Edges

> **Result: ZERO outbound cross-contract calls in all three contracts.**
>
> `grep -rn 'build_call\|CallBuilder\|ContractRef\|ExecutionInput\|Selector::\|selector_bytes\|chain_extension\|try_call\|\.invoke'` across all three contracts returned **no matches**.

| # | Edge | Status |
|---|---|---|
| — | *No outbound cross-contract calls found* | — |

---

## 3. Pallet / Chain-Extension / Native Transfer Calls

| # | CALLER `contract::fn` (file:line) | CALLEE / mechanism | Args | Value? | Return | STATUS |
|---|---|---|---|---|---|---|
| W-1 | `wnative::deposit` (`wnative/lib.rs:240`) | `self.env().transferred_value()` — reads attached native value from the call | — | receives `transferred_value` | `Balance` | VERIFIED |
| W-2 | `wnative::withdraw` (`wnative/lib.rs:266,283–285`) | `self.env().transfer(caller, amount)` — ink! host function, sends native tokens to caller | `caller: AccountId`, `amount: Balance` | sends `amount` LUNES | `Result<(), TransferFailed>` | VERIFIED |
| W-3 | `asset_wrapper::request_withdraw` (`asset_wrapper/src/lib.rs:367–378`) | **no pallet call** — burns PSP22 balance internally, then `self.env().emit_event(WithdrawRequest{…})` | `from, amount, asset_id` | none | event only | VERIFIED |
| W-4 | `asset_wrapper::mint_with_ref` (`asset_wrapper/src/lib.rs:395–443`) | **no pallet call** — mints PSP22 balance internally; relayer must have already executed `assets.transfer` off-chain | `to, amount, deposit_ref` | none | emits `Mint` event | VERIFIED |

---

## 4. Critical Path: `asset_wrapper` Deposit / Withdraw Architecture

### WRAP (deposit → PSP22 mint)

```
Step 1 [OFF-CHAIN EXTRINSIC]:  User calls pallet-assets::transfer(asset_id, bridgeAccount, amount)
Step 2 [OFF-CHAIN RELAYER]:    Relayer watches finalized blocks for that extrinsic
Step 3 [ON-CHAIN CONTRACT]:    Relayer calls asset_wrapper::mint_with_ref(user, amount, deposit_ref)
                                  → checks admin, pause, mint_cap, deduplication
                                  → calls self._mint(to, amount)  [internal PSP22 balance update]
                                  → emits Mint { to, amount, asset_id, deposit_ref }
```

**File evidence:**
- Architecture comment: `asset_wrapper/src/lib.rs:20–24`
- `mint_with_ref` body: `asset_wrapper/src/lib.rs:395–443`
- No chain-extension or pallet call inside contract: confirmed by grep

### UNWRAP (PSP22 burn → pallet-assets release)

```
Step 1 [ON-CHAIN CONTRACT]:    User calls asset_wrapper::request_withdraw(amount)
                                  → burns PSP22 balance (internal)
                                  → emits WithdrawRequest { from, amount, asset_id }
                                  file:line  asset_wrapper/src/lib.rs:349–378
Step 2 [OFF-CHAIN RELAYER]:    Relayer watches contract events for WithdrawRequest
Step 3 [OFF-CHAIN EXTRINSIC]:  Relayer calls pallet-assets::transfer(asset_id, user, amount)
```

**File evidence:**
- Architecture comment: `asset_wrapper/src/lib.rs:26–29`
- `request_withdraw` body: `asset_wrapper/src/lib.rs:349–378`
- `emit_event(WithdrawRequest{…})`: `asset_wrapper/src/lib.rs:373–377`
- No `self.env().transfer`, no chain-extension, no `build_call`: confirmed by grep

**TRUST / custody surface:** The underlying asset (`pallet-assets` token) is held in `bridgeAccount` (an off-chain EOA controlled by the relayer). The contract burn is atomic and irreversible. Whether the user receives their pallet-assets tokens depends entirely on the relayer processing the `WithdrawRequest` event and executing the extrinsic. **This is an explicit off-chain dependency and a custody surface.** If the relayer is down, compromised, or censors the event, user funds remain locked in `bridgeAccount` with no on-chain recourse.

---

## 5. `wnative` — Wrap / Unwrap

| Op | Mechanism | On-chain? | File:line |
|---|---|---|---|
| `deposit` (wrap) | `self.env().transferred_value()` → internal `_mint` | **Yes — fully on-chain** | `wnative/lib.rs:240–258` |
| `withdraw` (unwrap) | internal `_burn` → `self.env().transfer(caller, amount)` | **Yes — fully on-chain** | `wnative/lib.rs:266–291` |

`wnative` has **no off-chain dependency**. The 1:1 peg is enforced by the ink! pallet-contracts host (`transferred_value` for wrap; `transfer` host fn for unwrap). The `is_healthy()` guard (`wnative/lib.rs:309`) verifies `self.env().balance() >= self.total_supply` as an invariant check.

---

## 6. `psp22` — Standard Token

`psp22` is a standalone token with no stored peer addresses and no outbound calls. `mint` is owner-only (deployer); used for test/devnet token issuance. PSP22 selectors are identical to `wnative` and `asset_wrapper` (intentional compatibility with Router/SpotSettlement).

| Selector | Message | File:line |
|---|---|---|
| `0x6568382f` | `balance_of` | `psp22/lib.rs:100` |
| `0x4d47d921` | `allowance` | `psp22/lib.rs:106` |
| `0xdb20f9f5` | `transfer` | `psp22/lib.rs:134` |
| `0x54b3c76e` | `transfer_from` | `psp22/lib.rs:146` |
| `0xb20f1bbd` | `approve` | `psp22/lib.rs:169` |

---

## 7. PSP22 Selector Compatibility Table (all three contracts)

All three contracts implement the same five PSP22 selectors identically — this is the interface contract relied on by `copy_vault`, `router`, and `spot_settlement` when they issue `build_call` against any token.

| Selector | Message | asset_wrapper | wnative | psp22 |
|---|---|---|---|---|
| `0x6568382f` | `balance_of` | ✓ `src/lib.rs:214` | ✓ `lib.rs:139` | ✓ `lib.rs:100` |
| `0x4d47d921` | `allowance` | ✓ `src/lib.rs:220` | ✓ `lib.rs:145` | ✓ `lib.rs:106` |
| `0xdb20f9f5` | `transfer` | ✓ `src/lib.rs:287` | ✓ `lib.rs:173` | ✓ `lib.rs:134` |
| `0x54b3c76e` | `transfer_from` | ✓ `src/lib.rs:300` | ✓ `lib.rs:185` | ✓ `lib.rs:146` |
| `0xb20f1bbd` | `approve` | ✓ `src/lib.rs:327` | ✓ `lib.rs:211` | ✓ `lib.rs:169` |

---

## 8. Summary Counts

| Status | Count |
|---|---|
| VERIFIED | 4 (W-1 through W-4) |
| UNVERIFIED | 0 |
| STUBBED | 0 |

---

## 9. Verdict

**`asset_wrapper` withdrawal is NOT enforced on-chain.**
`request_withdraw` burns the user's PSP22 tokens atomically on-chain and emits `WithdrawRequest` (`asset_wrapper/src/lib.rs:373–377`), but **the actual release of the underlying pallet-assets token is executed off-chain by the relayer** as a separate extrinsic. There is no chain-extension call, no `build_call`, and no `self.env().transfer` inside `request_withdraw`. The user's burn is irreversible; fulfilment depends entirely on the relayer.

**`wnative` wrap/unwrap is fully enforced on-chain** via ink! host functions (`transferred_value` / `self.env().transfer`). No off-chain dependency.
