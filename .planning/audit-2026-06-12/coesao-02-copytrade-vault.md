# Coesão 02 — Copy-trade + Copy-vault

- **Validador:** Coesão 2/6 (somente leitura)
- **Data:** 2026-06-12
- **Fluxo:** sinal do leader → replicação no vault → contabilidade posições/PnL → saque proporcional à cota
- **Tese:** "Um seguidor aloca capital num vault, o sistema replica fielmente os trades do leader com proteção (slippage), contabiliza posições/PnL corretamente, e o seguidor consegue sacar o valor real proporcional à sua cota."

## Veredito de coesão: **PARCIAL** (forte, com 1 gap de fechamento de fluxo)

A pilha está **substancialmente coerente** e os achados P0 desta sessão foram fechados. O `copy_vault/lib.rs` **já implementa o modelo-alvo do ADR-002** (multi-ativo, equity = nativo + wnative(1:1) + Σ valuation on-chain dos tracked tokens, falha de cotação fail-explícito). O `copytradeService` fechou slippage fail-closed e executionPrice fabricado. O gap residual é o **fluxo de saque quando há posição aberta em PSP22**: o contrato falha explicitamente (`InsufficientNativeLiquidity`) mas o fluxo em duas fases (`request_withdrawal`/`claim_withdrawal`) que tornaria o saque **completável** ainda é TODO — então HOJE um seguidor de um vault com posição aberta não consegue sacar até o leader desfazer a posição manualmente. A tese é verdadeira no caminho feliz (vault em caixa nativo) e bloqueada no caminho com posições abertas.

---

## Tabela de handoffs (contrato → spot-api → mcp → frontend)

| # | Handoff | Origem (file:line) | Destino | Coeso? | Observação |
|---|---------|--------------------|---------|--------|------------|
| H1 | Sinal AUTO → execução live no vault | `copytradeService.ts` recordSignal (chunk 11) | `routeAndExecute` → order/trades | OK | Falha de live execution em modo AUTO cai para journaling/continuation; em modo explícito relança erro |
| H2 | Execução ASYMMETRIC → wallet continuation | `copytradeService.ts:~5` (intentHasSlippageProtection) | Prisma `CopyTradeWalletContinuation` | OK | **Fail-closed**: intent sem `minAmountOut>0` é descartado (não vira continuation) — corrigido hoje |
| H3 | Continuation PENDING → confirmação | `copytradeService.confirmWalletSignalContinuation` | DB (signal EXECUTED + execution + leaderTrade) | OK | Idempotente: status CONFIRMED retorna `alreadyConfirmed`; execution só criada se `count===0` |
| H4 | Continuation stale → expiração | `copytradeWalletContinuationScheduler.runSweep` → `expirePendingWalletContinuations` | DB (expira PENDING) | OK | Scheduler **só expira**; nunca re-executa nem confirma → não duplica/perde sinal |
| H5 | executionPrice → PnL / performance fee | `copytradeService.ts:~11` | leaderTrade PnL %, performance fee on-chain | OK | **Nunca fabrica preço de `amountOutMin`** (lança erro explícito) — corrigido hoje |
| H6 | deposit/withdraw off-chain → contrato real | `copyVaultService.deposit/withdraw` | `copy_vault.deposit/withdraw` (on-chain, espera `isFinalized`) | OK | Aguarda finalidade antes de retornar; shares/amount parseados de eventos pelo caller |
| H7 | Equity DB ↔ equity on-chain | `vaultReconciliationService.reconcileVault` | `CopyVault.totalEquity` | **PARCIAL** | Ver lacuna L1: expectedEquity é fórmula off-chain (deposits−withdrawals+realizedPnl), NÃO o equity on-chain; ignora ganho/perda **não-realizado** das posições abertas |
| H8 | Swap real → equity completo | `copy_vault.swap_through_router:1088` | `get_vault_equity_internal` (tracked tokens) | OK | token_out auto-trackeado antes do swap (invariante 1); equity sempre enxerga o ativo adquirido |
| H9 | Slippage off-chain → swap on-chain | `copytradeService` minAmountOut → contractCallIntent | `swap_through_router(min_amount_out)` | OK | `amount_out < min_amount_out` ⇒ revert `SlippageExceeded` (l.~1298); selector real `0xa0ac73cf` |

---

## Verificação ponto a ponto

### 1. Idempotência sinal→execução; scheduler não duplica/perde
**COESO.** O `copytradeWalletContinuationScheduler` (56 linhas) **só chama `expirePendingWalletContinuations`** — não re-submete nem auto-confirma trades. A confirmação real ocorre apenas via `confirmWalletSignalContinuation`, que: (a) roda em `prisma.$transaction`, (b) retorna cedo `alreadyConfirmed` se status já é CONFIRMED, (c) cria a `copyTradeExecution` apenas se `existingExecutions === 0`. Não há caminho de duplicação ou perda silenciosa. A continuation só persiste se a persistência estiver disponível, senão degrada para journaling com log.warn.

### 2. Reconciliação off-chain ↔ equity on-chain; auto-repair sem mascarar perda
**PARCIAL — gap material (L1).** `vaultReconciliationService` calcula `expectedEquity = max(0, Σdeposits − ΣgrossWithdrawals + ΣrealizedPnl)` e, se `drift > DRIFT_THRESHOLD (0.01)`, **sobrescreve** `CopyVault.totalEquity` com esse valor calculado. Problemas:
- O "expected" é uma **fórmula contábil off-chain**, não o equity on-chain do contrato. O header do arquivo diz "On-chain query via CopyVaultService é usada quando a ABI está disponível" mas o `reconcileVault` atual **não chama o contrato** — usa só linhas do Prisma. Reconcilia DB-contra-DB, não DB-contra-cadeia.
- Só considera **PnL realizado** (signals com `realizedPnlPct`). O **PnL não-realizado** de posições PSP22 abertas (que o equity on-chain do ADR-002 agora reflete via valuation spot) é invisível. Logo a reconciliação pode "reparar" o `totalEquity` para um valor que **diverge do equity on-chain real** — mascarando ganho ou perda não-realizado.
- **Sobre o achado anterior (auto-repair em float sem teto):** confirmado que o repair **não tem teto/limite** — qualquer drift acima de 1 centavo é sobrescrito incondicionalmente (`prisma.copyVault.update` com `expectedEquity.toFixed(18)`). Usa `parseFloat`/`Math.abs` (float binário) sobre Decimals, então drift de arredondamento é esperado. Não há circuit-breaker para drift absurdo (ex.: 10x), nem alerta escalonado — só `log.warn`. Risco: um bug a montante que zere `realizedPnl` faz o reconciler "consertar" o equity para baixo silenciosamente.

### 3. Cota/share: depósito e saque usam a mesma base de valor?
**COESO (on-chain).** Ambos derivam de `equity_split_internal()` → `(native, tokens_value)`, somados ao `equity` completo (ADR-002). `deposit` calcula `equity_before_deposit = current_balance − amount` (com `checked_sub` → `EquityMismatch` se underflow, evitando share count desproporcional). `withdraw` usa `payout = shares × equity / total_shares`. **Mesma base de valor** → sem diluição/inflação de cota no contrato. Teste `test_*` confirma: 2º depósito após token PSP22 visível cobra cota a preço dobrado (correto). Falha de cotação reverte ambos (invariante 3) — não há janela de precificar cota com valuation parcial.

### 4. Proteção do seguidor: slippage chega ao swap real? PnL/fee de número real?
**COESO.** Slippage: `copytradeService` exige `minAmountOut>0` para gerar continuation (fail-closed contra sandwich), e o contrato impõe `amount_out < min_amount_out ⇒ SlippageExceeded` (revert). PnL/fee: `executionPrice<=0` lança erro em vez de fabricar de `amountOutMin` (comentário explícito no código). Performance fee on-chain sai de `payout − cost_for_shares` real (só sobre lucro), nunca de parâmetro do leader (`amount_out` vem do retorno do router, não de input).

### 5. Estado atual torna o saque incoerente HOJE? Gap vs ADR-002
**SIM — gap de fechamento (L2).** O `copy_vault/lib.rs` **já migrou** para o modelo multi-ativo (não é mais "equity só-nativo"). Porém o `withdraw` (l.~9) tem o caminho:
```
if payout > native_balance { return Err(InsufficientNativeLiquidity); }
```
com **TODO explícito**: "fluxo não-bloqueante em duas fases request_withdrawal/claim_withdrawal com preço de cota congelado — adiado". Consequência: se o vault tem posição PSP22 aberta e o caixa nativo não cobre o payout, **o saque reverte e o seguidor fica preso** até o leader desfazer a posição (swap de volta para nativo). O contrato é fail-explícito (não paga parcial, não vende posição dentro do withdraw — alinhado ao ADR §5), mas o **fluxo completo de saque do ADR-002 não está implementado**. Os erros novos (`InsufficientNativeLiquidity`) e eventos (`EquitySnapshot`) existem, mas `request_withdrawal`/`claim_withdrawal` e os eventos `WithdrawalRequested`/`WithdrawalClaimed` não.

---

## Lacunas

| ID | Severidade | Lacuna | Local |
|----|-----------|--------|-------|
| L1 | ALTA | `vaultReconciliationService` reconcilia DB-contra-fórmula-off-chain, não contra equity on-chain; ignora PnL **não-realizado** de posições PSP22 abertas (que o equity ADR-002 agora reflete). Pode "reparar" `totalEquity` para um valor divergente da cadeia, mascarando ganho/perda não-realizado. Auto-repair sem teto/circuit-breaker; usa `parseFloat` (float) sobre Decimal. | `vaultReconciliationService.ts` (reconcileVault, DRIFT_THRESHOLD=0.01) |
| L2 | ALTA | Fluxo de saque do ADR-002 incompleto: `request_withdrawal`/`claim_withdrawal` + eventos `WithdrawalRequested`/`WithdrawalClaimed` ainda são TODO. Seguidor de vault com posição PSP22 aberta não consegue sacar até unwind manual do leader → tese de "sacar valor proporcional" bloqueada nesse cenário. | `copy_vault/lib.rs` withdraw (TODO ADR-002) |
| L3 | MÉDIA | Caminho real do `swap_through_router` (approve + swap_exact_tokens_for_tokens + decode `Vec<Balance>`) está sob `#[cfg(not(test))]`; unit tests usam `amount_out = min_amount_out`. O selector real (`0xa0ac73cf`) e a decodificação só são exercitados pelo script E2E `e2e-copy-vault-swap.ts`. É exatamente a classe de masking que o ADR-002 apontou como causa-raiz do P0-2 — mitigado por E2E, mas o ADR pedia trait `RouterRef`/`Psp22Ref` injetável (não adotado). | `copy_vault/lib.rs:1217` (#[cfg(not(test))]) |
| L4 | MÉDIA | `copyVaultService.deposit/withdraw` retornam `shares:'0'`/`amount:'0'` com comentário "Parsed from events by caller". A coesão depende de o caller parsear os eventos `Deposited`/EquitySnapshot e gravar shares reais no Prisma. Não verifiquei o caller (`socialService`/rota); se o caller não parsear, o DB grava cota incoerente com a cadeia → alimenta o drift de L1. | `copyVaultService.ts` deposit/withdraw |
| L5 | BAIXA | `execute_trade` (legado) ainda emite `TradeExecuted` sem executar swap real (achado prévio 08-slop). Coexiste com `swap_through_router`. Confirmar que o copytradeService só usa o caminho `swap_through_router` em produção e que `execute_trade` é devnet-only para não gerar equity/PnL fictício. | `copy_vault/lib.rs` execute_trade |

---

## Conclusão

O redesenho ADR-002 está **majoritariamente implementado no contrato** e os fixes de slippage/executionPrice do `copytradeService` se sustentam. O fluxo é coeso e fiel no caminho feliz. Dois pontos impedem VALIDADO pleno: o **saque não fecha** quando há posição aberta (L2, fluxo em duas fases é TODO) e a **reconciliação não reflete o equity multi-ativo on-chain** (L1, pode mascarar PnL não-realizado). Ambos são de fechamento de fluxo, não de regressão.
