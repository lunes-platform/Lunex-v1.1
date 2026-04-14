# Social Copytrade V1 TASKS

**Owner:** Core Protocol / Social Trading  
**SPEC:** [`./SPEC.md`](./SPEC.md)  
**Status:** completed

## Definition of Done

- `copytrade` vira a única camada canônica de vault.
- `social` fica restrito ao social graph e analytics.
- `signal` tem contrato explícito e testável.
- rewards, affiliate e reconciliation deixam de conflitar entre si.
- frontend, backend e SDK passam a compartilhar a mesma fonte de verdade.

## Phase 1 — SDD Baseline

- [x] Criar `PRD.md` da feature.
- [x] Criar `SPEC.md` da feature.
- [x] Criar `TASKS.md` da feature.
- [x] Registrar o pacote no mapa canônico de docs.

## Phase 2 — Canonicalization

- [x] Declarar `copytrade` como única superfície de vault.
- [x] Marcar `/social/vaults/:leaderId/deposit|withdraw` como legado e preparar remoção.
- [x] Remover a lógica de vault remanescente de `socialService`.
- [x] Garantir que o frontend continue usando apenas `/copytrade/*`.

## Phase 3 — Vault Accounting

- [x] Migrar qualquer fluxo de depósito/saque remanescente para `copytradeService`.
- [x] Revisar integração com `copyVaultService` para confirmação on-chain.
- [x] Corrigir o reconciliador para considerar PnL ou estado on-chain real.
- [x] Validar HWM fee, gross/net withdrawal e leader fee accrual.
- [x] Remover follow implícito no depósito (enrollment social explícito).

## Phase 4 — Signal and Execution Integrity

- [x] Escolher contrato canônico para `createSignal()`.
- [x] `Option A`: assumir e documentar journaling explícito.
- [x] Implementar a primeira fatia de `Option B` para execução server-side em rotas backend-executáveis (`ORDERBOOK` e `AMM_V1`).
- [x] Expor continuação wallet-assisted (`walletAssistedContinuation`) quando `AUTO` encontra rota `ASYMMETRIC`.
- [x] Persistir continuação wallet-assisted pendente e endpoint de confirmação assinada (`wallet-confirmation`) para reconciliação pós on-chain.
- [x] Implementar scheduler de expiração automática (`EXPIRED`) e endpoint privado de leitura de pendências (`pending-wallet`) para operação de agentes.
- [x] Enforçar guardrail econômico em `OPEN` (`notional estimado <= totalEquity` do vault).
- [x] Enforçar piso de execução (`amountOutMin`) antes da execução via roteador.
- [x] Enforçar piso de confirmação em `wallet-confirmation` (`amountOut >= signal.amountOutMin`).
- [x] Corrigir cálculo de `pnlDelta` de fechamento para referência de notional da abertura.
- [x] `Option B`: implementar execução real agregada do vault (server-side para `ORDERBOOK`/`AMM_V1`) com fallback wallet-assisted para `ASYMMETRIC`.
- [x] Remover dependência de `input.realizedPnlPct` como gatilho implícito de fechamento.
- [x] Garantir que `LeaderTrade`, `CopyTradeExecution` e `CopyVault.totalEquity` reflitam a mesma realidade.

## Phase 5 — Rewards and Distribution

- [x] Separar `staker rewards` de `copyVaultPosition`.
- [x] Alinhar schema comments, config e regra real de split de rewards.
- [x] Unificar contrato de claim entre backend, frontend e SDK.
- [x] Corrigir ranking de leaders/traders para a mesma fonte de verdade do reward engine.
- [x] Revisar payout de leader/trader/staker com observabilidade clara.
- [x] Impedir `DISTRIBUTED` em semana com falha de funding/distribution on-chain de staker.

## Phase 6 — Validation

- [x] Adicionar testes para depreciação de `/social/vaults/*`.
- [x] Adicionar testes de reconciliação com cenários de PnL.
- [x] Adicionar testes de reward distribution por tipo.
- [x] Adicionar smoke de `agent trade -> copytrade signal -> activity`.
- [x] Harden de API key challenge com persistência em Redis + fallback.
- [x] Enforçar gate de qualidade no CI (`ESLint` + `ts-prune` + `depcheck` + `Prettier`) para módulos impactados.
- [x] Rodar build do `spot-api`.
- [x] Rodar build do `lunes-dex-main`.
- [x] Consolidar follow-ups restantes.

## Priority Order

- `P0`: eliminar duplicidade entre `social` e `copytrade`.
- `P0`: impedir que o reconciliador destrua PnL legítimo.
- `P0`: corrigir o desacoplamento entre rewards reais e staking real.
- `P1`: formalizar e corrigir o contrato de `signal`.
- `P1`: alinhar frontend e SDK com o backend de rewards.
- `P2`: revisar pesos/ranking e UX de analytics.

## Risks / Follow-ups

- A remoção de `/social/vaults/*` pode quebrar integrações antigas se não houver rollout.
- A correção de rewards pode exigir ajuste no SDK e em telas legadas.
- A adoção de execução real agregada pode depender de infraestrutura adicional de settlement e routing.
- A execução server-side em rota `ASYMMETRIC` segue dependente de capacidade on-chain para execução sem assinatura wallet interativa do líder.
