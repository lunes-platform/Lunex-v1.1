# Coesão 07 — Simulação de Volume Multi-Usuário On-Chain (Lunex DEX)

**Data:** 2026-06-12
**Script:** `spot-api/scripts/simulate-onchain-volume.ts`
**Execução:** `cd spot-api && npx ts-node scripts/simulate-onchain-volume.ts`
**Node:** dev local `ws://127.0.0.1:9944` (chain `Development`)

## Objetivo

Provar que múltiplos usuários (cada um uma conta Substrate própria, assinando suas
próprias transações) conseguem gerar volume **real on-chain** no par WLUNES/LUSDT
via o router ink! — swaps, add/remove liquidity e staking — acumulando volume e
movendo o preço de mercado.

## Setup confirmado

- **5 traders** sr25519 com seeds determinísticas `//Trader1`..`//Trader5`
  (documentadas no script; reproduzíveis).
- Fundados a partir de Alice:
  - 100 LUNES nativo cada (`balances.transferKeepAlive`).
  - Cada trader embrulhou 30 LUNES → WLUNES (`wnative.deposit`, payable, pagando o
    próprio nativo).
  - Alice transferiu 50 000 LUSDT a cada um (`psp22.transfer(to, value, data)`).
  - Approve do router para WLUNES e LUSDT por trader.
- Decimais confirmados on-chain: **WLUNES = 8**, **LUSDT = 6**. token0 = WLUNES,
  token1 = LUSDT.

## Relatório de volume (números reais — run final)

| Métrica | Valor |
|---|---|
| Usuários de trade | 5 |
| Rodadas | 4 |
| Swaps WLUNES→LUSDT | 20 |
| Swaps LUSDT→WLUNES | 20 |
| Swaps totais | 40 |
| Volume WLUNES movimentado | 34.3682 WLUNES |
| Volume LUSDT movimentado | 46 537.31 LUSDT |
| add_liquidity | 8 (Trader1 ×4, Trader2 ×4) |
| remove_liquidity | 3 (Trader1) |
| stakes | 1 (Trader5, 10 LUNES, duração 30 dias) |
| Reservas inicial | 53.0000 WLUNES / 94 366.85 LUSDT |
| Reservas final | 74.5723 WLUNES / 81 908.88 LUSDT |
| Preço inicial | 1 780.51 LUSDT/WLUNES |
| Preço final | 1 098.38 LUSDT/WLUNES |
| **Impacto no preço** | **-38.31%** |
| Falhas | NENHUMA |

Evolução do preço por rodada (impacto cumulativo de pressão líquida de venda de
WLUNES): 1780.51 → 1556.13 → 1373.26 → 1222.68 → 1098.38 LUSDT/WLUNES.

## Robustez implementada

- **Dry-run (`.query`) antes de cada tx** que move fundo → captura revert cedo
  (desempacota `Result::Err` em 1 ou 2 camadas).
- **try/catch por operação**: falha registra motivo e a simulação continua.
- Espera de `isInBlock || isFinalized` por tx (isInBlock aceitável em node dev
  local — documentado no cabeçalho do script).
- Nonce gerido pelo polkadot.js via `signAndSend` sequencial por conta.
- Unwrap de `Result` aninhado:
  - `balance_of` / `get_pair` / `get_reserves` → 1 camada `{ ok: V }`.
  - `get_amount_out` → **2 camadas `{ ok: { ok: N } }`** (desempacotadas as duas).

## Falhas observadas durante o desenvolvimento (resolvidas)

1. **`ContractTrapped` (module 24, err `0x02000000`) em todo swap/addLiquidity.**
   Causa-raiz: `proofSize` do dry-run estava em `1_000_000` — insuficiente para as
   chamadas cross-contract aninhadas (router → factory → pair → psp22). Validado por
   probe: `proofSize: 1e6` → ContractTrapped; `proofSize: 5e6` → OK
   (`{ok:{ok:[60000000,1051122417]}}`). **Fix:** dry-run gas elevado para
   `refTime 500e9 / proofSize 5e6`. Lição transferível: dry-run de mensagens
   multi-hop precisa de proofSize generoso, não o teto mínimo usado em queries puras.

2. **`stake` revertia com `InvalidDuration`.** `duration` é em **blocos**, com
   `MIN_DURATION = 7*24*60*30 = 302 400`. **Fix:** usar 30 dias = `1 296 000` blocos.

Na execução final: **0 falhas**.

## Conclusão

O fluxo multi-usuário on-chain do Lunex DEX está coeso: contas independentes
assinam suas próprias txs, o router executa swaps bidirecionais com slippage e price
impact reais, add/remove liquidity e staking funcionam, e o volume acumulado moveu
o preço do par de forma consistente (-38% sob pressão de venda líquida de WLUNES).
