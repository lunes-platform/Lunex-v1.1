---
phase: audit-contracts
reviewed: 2026-06-03T21:05:00Z
depth: deep
files_reviewed: 16
files_reviewed_list:
  - Cargo.toml
  - package.json
  - rust-toolchain.toml
  - Lunex/contracts/spot_settlement/Cargo.toml
  - Lunex/contracts/spot_settlement/lib.rs
  - Lunex/contracts/copy_vault/lib.rs
  - Lunex/contracts/liquidity_lock/src/lib.rs
  - Lunex/contracts/router/lib.rs
  - Lunex/contracts/factory/lib.rs
  - Lunex/contracts/rewards/lib.rs
  - Lunex/contracts/staking/lib.rs
  - scripts/deploy-lunes.ts
  - scripts/deploy-remaining-contracts.ts
  - scripts/verify-deployment.ts
  - docs/LOCAL_TESTNET_DEPLOY.md
  - docs/features/production-readiness-v1/SPEC.md
findings:
  critical: 3
  warning: 3
  info: 0
  total: 6
status: issues_found
---
# Phase audit-contracts: Code Review Report

**Reviewed:** 2026-06-03T21:05:00Z
**Depth:** deep
**Files Reviewed:** 16
**Status:** issues_found

## Summary

Auditoria read-only dos contratos ink!/Substrate do Lunex com foco em prontidão de produção, cross-contract calls, artefatos/ABI e verificabilidade de deploy. O estado atual é **no-go para produção**: há um bypass criptográfico explícito no settlement, um cross-call funcionalmente quebrado no `CopyVault` e o pipeline de verificação pós-deploy não consegue validar o conjunto padrão de artefatos/métodos que o próprio repositório documenta.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: SpotSettlement aceita qualquer assinatura não nula

**File:** `Lunex/contracts/spot_settlement/lib.rs:1117`
**Issue:** `verify_order_signature()` documenta que a verificação criptográfica on-chain não existe no runtime atual e, na prática, apenas rejeita assinatura `[0u8; 64]` antes de retornar `Ok(())` em `Lunex/contracts/spot_settlement/lib.rs:1138-1147`. Isso deixa a validade econômica do settlement dependente do relayer off-chain; relayer comprometido ou bugado consegue liquidar ordens não autorizadas.
**Fix:**
```rust
fn verify_order_signature(&self, order: &SignedOrder) -> Result<(), SpotError> {
    // produção: bloquear até existir verificação on-chain real
    Err(SpotError::InvalidSignature)
}
```
ou migrar o fluxo para um runtime/host function que exponha `sr25519_verify` e só liberar produção quando a prova for validada on-chain.

### CR-02: CopyVault chama um selector que não existe na ABI do Router

**File:** `Lunex/contracts/copy_vault/lib.rs:840`
**Issue:** `swap_through_router()` monta um cross-contract call usando `ink::selector_bytes!("Router::swap")` em `Lunex/contracts/copy_vault/lib.rs:849-856`. No contrato `router`, porém, `swap` em `Lunex/contracts/router/lib.rs:118-138` é apenas helper Rust para chamar o `pair`, não uma `#[ink(message)]`. As mensagens públicas reais começam em `Lunex/contracts/router/lib.rs:504` e os swaps expostos são `swap_exact_tokens_for_tokens`, `swap_tokens_for_exact_tokens`, `swap_exact_native_for_tokens` e `swap_exact_tokens_for_native` (`Lunex/contracts/router/lib.rs:837`, `914`, `1167`, `1237`). Em produção, esse call vai trapar/falhar sempre.
**Fix:**
```rust
// alinhar com uma #[ink(message)] real do router
ink::selector_bytes!("swap_exact_tokens_for_tokens")
```
ou introduzir uma `#[ink(message)] pub fn swap(...)` real no `router`, compilar novo ABI e cobrir com teste ink! E2E.

### CR-03: O script oficial de verificação pós-deploy está desalinhado do build real e dos métodos expostos

**File:** `scripts/verify-deployment.ts:99`
**Issue:** O verificador carrega ABI em `target/ink/<name>/<name>.json` (`scripts/verify-deployment.ts:99-106`), mas o build/deploy documentado usa nomes como `target/ink/factory_contract/factory_contract.contract` e `target/ink/router_contract/router_contract.contract` (`scripts/deploy-lunes.ts:58-65`, `docs/LOCAL_TESTNET_DEPLOY.md:170-176`). Depois disso, o mesmo script consulta métodos que não existem com esses nomes nas ABIs: `getFeeToSetter`, `wLunes`, `authorizedRouter`, `isPaused`, `allPairsLength`, `getContractStats` (`scripts/verify-deployment.ts:215`, `240`, `340`, `374`, `406`, `416`), enquanto os contratos expõem `fee_to_setter`, `wnative`, não expõem getter de `authorized_router`, usam `pause/unpause`, `all_pairs_length` e `get_stats` (`Lunex/contracts/factory/lib.rs:196,216`, `Lunex/contracts/router/lib.rs:563`, `Lunex/contracts/staking/lib.rs:1486,1498,1513`, `Lunex/contracts/rewards/lib.rs:590,617`). Resultado: o “verify” oficial não prova que o deploy real está íntegro.
**Fix:**
```ts
const ABI_PATHS = {
  factory: 'target/ink/factory_contract/factory_contract.json',
  router: 'target/ink/router_contract/router_contract.json',
  staking: 'target/ink/staking_contract/staking_contract.json',
  rewards: 'target/ink/trading_rewards_contract/trading_rewards_contract.json',
}
```
e alinhar cada query ao nome exato da `#[ink(message)]` publicada pelo contrato antes de usar esse script como gate de produção.

## Warnings

### WR-01: Os testes ativos não exercitam o hot path cross-contract do Router

**File:** `Lunex/contracts/router/lib.rs:1710`
**Issue:** Oito testes de add/remove liquidity e swap estão marcados com `#[ignore]` (`1710`, `1738`, `1872`, `1921`, `1950`, `2000`, `2081`, `2145`). Isso remove da CI justamente o caminho com Factory/Pair/PSP22 selectors e slippage real. O repositório também não traz testes `ink_e2e::test`; há apenas dependência `ink_e2e` em `Lunex/contracts/asymmetric_pair/Cargo.toml:25`.
**Fix:** mover a matemática pura para helpers unit-testáveis e adicionar ao menos uma suíte `ink_e2e` cobrindo `add_liquidity`, `remove_liquidity` e um swap real com PSP22/WNative.

### WR-02: Vários contratos têm comportamento de produção compilado para fora dos testes

**File:** `Lunex/contracts/copy_vault/lib.rs:847`
**Issue:** Caminhos críticos de produção são `#[cfg(not(test))]` e, portanto, nunca são validados pelo suite local: `copy_vault` faz isso no swap real (`Lunex/contracts/copy_vault/lib.rs:847-873`), `liquidity_lock` no `PSP22::transfer` de unlock (`Lunex/contracts/liquidity_lock/src/lib.rs:224-248`) e `staking` nos thresholds/atraso e no fluxo financeiro de `execute_proposal` (`Lunex/contracts/staking/lib.rs:502-512`, `1137-1172`). Isso cria divergência estrutural entre o binário testado e o binário de produção.
**Fix:** substituir stubs `#[cfg(test)]` por mocks/contratos auxiliares em `ink_e2e`, mantendo o mesmo bytecode/message path entre teste e release.

### WR-03: Não há trilha reprodutível/verificável única para build de release

**File:** `package.json:24`
**Issue:** O repositório mistura instruções incompatíveis de toolchain e não define build verificável. `README.md:259` fixa `cargo-contract@4.1.1`, `docs/LOCAL_TESTNET_DEPLOY.md:130-131` manda instalar `cargo-contract ^5`, `rust-toolchain.toml:2` fixa Rust `1.85.0`, a spec local fala em ink! `4.2.1` (`docs/specs/LOCAL_PROJECT_BOOTSTRAP_SPEC.md:25`), mas há contratos em `ink = "4.3"` e `ink = "4.3.0"` (`Lunex/contracts/asymmetric_pair/Cargo.toml:20`, `Lunex/contracts/spot_settlement/Cargo.toml:8`). Além disso, os scripts canônicos usam só `cargo contract build --release` (`package.json:26,44`) e não um fluxo `--verifiable`/pinned para reproduzir metadata/wasm de produção.
**Fix:** escolher uma única matriz suportada `(rust, cargo-contract, ink!)`, documentá-la em um único lugar e adicionar um comando canônico de build verificável para todos os contratos que gerem `.contract/.json/.wasm` reprodutíveis.

---

_Reviewed: 2026-06-03T21:05:00Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: deep_
