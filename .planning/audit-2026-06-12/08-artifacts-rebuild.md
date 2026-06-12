# 08 — Rebuild de Artifacts vs Source (P1: artifacts desatualizados)

**Data:** 2026-06-12
**Objetivo:** Fechar o P1 "artifacts desatualizados vs source" — rebuildar os 13 contratos a partir do código-fonte atual e comparar com os `.contract` commitados em `artifacts/`.

## Ambiente de build

- Toolchain: **rustc 1.85.0** (pinado por `rust-toolchain.toml` via rustup — o Rust do Homebrew 1.94.1 quebra o build)
- **cargo-contract 4.1.1**
- Comando: `cargo contract build --release` executado a partir do diretório de cada contrato (necessário: o rustup resolve o toolchain pelo cwd; rodar com `--manifest-path` a partir de fora do repo seleciona o stable 1.94 e o build de `core` falha com erro de `panic_immediate_abort`)
- Saída dos builds: `target/ink/<crate>/` (nada em `artifacts/` foi sobrescrito)

## Tabela por contrato

| Contrato | Build | Hash novo vs commitado | Drift de mensagens (novo vs commitado) |
|---|---|---|---|
| factory | ✅ OK (7m51s) | ❌ DIFERENTE (`0x2ac0f6…` vs `0x264725…`) | +2: `get_min_pool_liquidity`, `set_min_pool_liquidity` (9 → 11 msgs) |
| pair | ✅ OK (com workaround*) | ❌ DIFERENTE (`0xbd4411…` vs `0xf51423…`) | **+21 mensagens** (10 → 31): toda a interface PSP22 (`transfer`, `transfer_from`, `approve`, `allowance`, `balance_of`, `total_supply`, `increase_allowance`, `decrease_allowance`) + `admin`, `pause`/`unpause`/`is_paused`, `skim`, `collect_protocol_fees`, `collect_rewards_fees`, `get_accumulated_protocol_fees`, `get_accumulated_rewards_fees`, `get_protocol_fee_to`, `set_protocol_fee_to`, `get_trading_rewards_contract`, `set_trading_rewards_contract` |
| asymmetric_pair | ❌ **FALHOU** | — | Sem artifact commitado em `artifacts/` |
| router | ✅ OK (5m39s) | ❌ DIFERENTE (`0x0a3bde…` vs `0xa6f042…`) | **+13 mensagens** (6 → 19): `add_liquidity_native`, `remove_liquidity_native`, `swap_exact_native_for_tokens`, `swap_exact_tokens_for_native`, `quote`, `get_amount_in`, `get_amount_out`, `admin`, `pause`/`unpause`/`is_paused`, `get_max_price_impact_bps`, `set_max_price_impact_bps` |
| psp22 | ✅ OK (5m02s) | — (sem artifact commitado) | novo: 11 msgs, hash `0xf5a78c…` |
| wnative | ✅ OK (6m45s) | ❌ DIFERENTE (`0x0ab205…` vs `0xcecdd9…`) | 0 adicionadas / 0 removidas (13 msgs em ambos — bytecode difere) |
| staking | ✅ OK (4m44s) | ❌ DIFERENTE (`0xe5eeb4…` vs `0x912f61…`) | 0 adicionadas / 0 removidas (30 msgs em ambos — bytecode difere) |
| rewards (trading_rewards) | ✅ OK (6m32s) | ❌ DIFERENTE (`0x877638…` vs `0x7a23ce…`) | 0 adicionadas / 0 removidas (29 msgs em ambos — bytecode difere) |
| liquidity_lock | ✅ OK (9m33s) | — (sem artifact commitado) | novo: 9 msgs, hash `0x19a7c6…` |
| listing_manager | ✅ OK (8m51s) | — (sem artifact commitado) | novo: 19 msgs, hash `0x64a2e4…` |
| asset_wrapper | ✅ OK (8m37s) | — (sem artifact commitado) | novo: 24 msgs, hash `0x7597aa…` |
| copy_vault | ✅ rebuilt 2026-06-12 (com mudanças de código desta sessão) | — (sem artifact commitado) | novo: 21 msgs, hash `0xbfe6d3…` |
| spot_settlement | ✅ rebuilt 2026-06-12 (com mudanças de código desta sessão) | — (sem artifact commitado) | novo: 29 msgs, hash `0x77ec87…` |

Hashes completos dos novos builds em `target/ink/<crate>/<crate>.contract` (campo `source.hash`).

### *Workaround do pair

O build do `pair` falha com o cargo-contract 4.1.1 no repo por dois problemas encadeados:

1. `target/ink/pair_contract/.target` obsoleto (resquício de cargo-contract antigo): `ERROR: Cannot read .../target/ink/pair_contract/.target. A clean build will fix this.` — resolvido removendo `target/ink/pair_contract/`.
2. `Lunex/contracts/pair/Cargo.toml` declara `crate-type = ["cdylib", "rlib"]` em `[lib]`, o que o cargo-contract 4.x rejeita: `the target 'pair_contract' is a binary and can't have any crate-types set (currently "cdylib, rlib")`.

O build OK foi feito numa **cópia isolada em `/tmp/pair-build`** (lib.rs idêntico, apenas a linha `crate-type` removida do Cargo.toml + `rust-toolchain.toml` copiado). O artifact resultante ficou em `/tmp/pair-build/target/ink/pair_contract.contract`. **Fix definitivo:** remover a linha `crate-type` de `Lunex/contracts/pair/Cargo.toml` (é exatamente o que o cargo-contract 4.x exige; não altera o código do contrato).

### Falha do asymmetric_pair (erro real de fonte)

```
error: arithmetic operation that can potentially result in unexpected side-effects
   --> Lunex/contracts/asymmetric_pair/lib.rs:179:25
    |
179 |         let base_frac = (numerator as u128).checked_mul(FRAC_SCALE).unwrap_or(0) / x0;
    |
    = note: requested on the command line with `-D clippy::arithmetic-side-effects`
error: could not compile `asymmetric_pair` (lib) due to 1 previous error; 11 warnings emitted
```

O cargo-contract 4.1.1 nega `clippy::arithmetic_side_effects` obrigatoriamente (não existe flag para pular lint na 4.1.1 — `--skip-linting` foi testado e não existe). A divisão `/ x0` em `lib.rs:179` não é checada (`checked_div`). **O contrato não é compilável com o toolchain pinado até corrigir o código** (usar `checked_div(x0)` ou `#[allow]` justificado). O `.contract` antigo em `target/ink/asymmetric_pair/` (2026-03-13) foi gerado por toolchain anterior e não é reproduzível hoje.

## Achados adicionais

1. **Inversão de versão do ink!**: os 6 artifacts commitados em `artifacts/` declaram `source.language = "ink! 5.1.1"`, mas TODO o código-fonte atual pina **ink! 4.2.1/4.3.0** (os novos builds saem como `ink! 4.3.0`). Ou seja, os artifacts commitados não foram gerados desta árvore de fonte — vieram de outra linhagem (provável branch de migração ink5) e, ainda assim, têm MENOS mensagens que o fonte atual. Não correspondem ao código em nenhum sentido.
2. **`artifacts/` cobre só 6 de 13 contratos**: faltam `psp22`, `asymmetric_pair`, `liquidity_lock`, `listing_manager`, `asset_wrapper`, `copy_vault`, `spot_settlement`.
3. O cargo-contract 4.1.1 emite warning de compatibilidade com ink 4.2.x ("use cargo-contract 3.2.0 ou ink >=5.0.0"), mas os builds completam. Para builds reproduzíveis de produção, vale decidir: ou pina cargo-contract 3.2.0, ou migra os contratos para ink 5.x.
4. Confirmação do gatilho do P1: o `pair_contract.contract` commitado (e o pair deployado a partir dele) **não expõe a interface PSP22** que existe em `Lunex/contracts/pair/lib.rs:1149+` — o rebuild comprova: 10 → 31 mensagens.

## Veredito

**TODOS os 6 artifacts commitados em `artifacts/` estão obsoletos e DEVEM ser regenerados a partir do fonte atual antes de qualquer deploy:**

| Artifact commitado | Situação |
|---|---|
| `factory_contract.contract` | OBSOLETO — hash difere, faltam 2 mensagens (min pool liquidity) |
| `pair_contract.contract` | OBSOLETO (CRÍTICO) — hash difere, faltam 21 mensagens incl. toda a PSP22 |
| `router_contract.contract` | OBSOLETO (CRÍTICO) — hash difere, faltam 13 mensagens incl. rotas nativas e pause |
| `wnative_contract.contract` | OBSOLETO — interface igual, bytecode/hash difere |
| `staking_contract.contract` | OBSOLETO — interface igual, bytecode/hash difere |
| `trading_rewards_contract.contract` | OBSOLETO — interface igual, bytecode/hash difere |

Pré-requisitos para regenerar de forma limpa e completa:

1. Remover `crate-type = ["cdylib", "rlib"]` de `Lunex/contracts/pair/Cargo.toml` (bloqueia o build do pair com cargo-contract 4.x).
2. Corrigir `Lunex/contracts/asymmetric_pair/lib.rs:179` (divisão não checada) — hoje o contrato nem compila.
3. Limpar dirs antigos de `target/ink/` que tenham `.target` de cargo-contract antigo (caso do pair).
4. Definir o par toolchain/cargo-contract canônico do projeto (rustc 1.85.0 + cargo-contract 4.1.1 funcionou para 10/11; documentar) e regenerar `artifacts/` para os 13 contratos, não só 6.

Builds novos desta auditoria disponíveis em `target/ink/<crate>/` (e `/tmp/pair-build/target/ink/` para o pair). Nada foi commitado e `artifacts/` não foi tocado.
