# Social Copytrade V1 PRD

**Status:** completed  
**Owner:** Core Protocol / Social Trading  
**Date:** 2026-04-13  
**Related docs:** [`../../prd/PROJECT_PRD.md`](../../prd/PROJECT_PRD.md), [`../../specs/PROJECT_SPEC.md`](../../specs/PROJECT_SPEC.md), [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md), [`../../spot/copytrade-arquitetura.md`](../../spot/copytrade-arquitetura.md)

## Context

O produto Lunex já expõe uma superfície relevante de social trading:

- perfis de líderes, follow, ideias, comentários e leaderboard;
- vaults de copytrade com depósito, saque e histórico;
- sinais de trading emitidos por líderes humanos e agentes IA;
- distribuição de performance fee e comissões de afiliados;
- analytics e rewards semanais.

Mas o runtime atual está híbrido:

- parte do domínio vive em `socialService`;
- parte crítica vive em `copytradeService`;
- ainda existem rotas legadas em `/social/vaults/*`;
- sinais de copytrade não representam execução real ponta a ponta dos seguidores;
- rewards, analytics e frontend não compartilham a mesma fonte de verdade.

## Problem

Hoje o produto promete um modelo vault-based de social copytrade, mas a implementação real ainda não fecha todos os ciclos operacionais e econômicos:

- o leader pode emitir sinal, mas isso não necessariamente gera execução agregada real do vault;
- o reconciliador de vault ignora PnL e pode tratar lucro legítimo como drift;
- a distribuição de rewards mistura conceitos de staker, trader e follower;
- o frontend, o SDK e o backend descrevem contratos diferentes para rewards;
- coexistem dois caminhos de vault (`/social/vaults` e `/copytrade/vaults`).

Isso afeta confiança de produto, previsibilidade operacional e segurança econômica.

## Users / Stakeholders

- **Follower:** quer depositar, acompanhar posição, pagar fee justa e sacar corretamente.
- **Leader humano:** quer operar um vault, acumular seguidores e receber performance fee correta.
- **Agente IA:** quer operar como leader via API key ou fluxo web3 com regras claras.
- **Ops / risk / finance:** precisa reconciliar vault, rewards e payouts sem drift.
- **Frontend / SDK / MCP:** precisa de um contrato canônico estável.

## Goals

- Canonicalizar `copytrade` como a única camada operacional de vault.
- Separar claramente `social graph` de `copytrade execution`.
- Fazer vault accounting, HWM fee, follower activity e analytics refletirem o estado real.
- Alinhar reward distribution entre backend, frontend, SDK e contrato de staking.
- Criar um backlog SDD executável para migrar o módulo do estado híbrido para um estado canônico.

## Non-Goals

- Não redesenhar o produto social inteiro nesta fase.
- Não mudar o modelo econômico base de performance fee + affiliate + rewards sem decisão posterior.
- Não prometer custódia ou execução autônoma adicional fora do escopo atual.
- Não substituir agora todo o frontend de social/copytrade.

## User Outcomes

- O follower entende o que significa seguir, depositar e copiar um leader.
- O leader recebe fee de performance de forma previsível e auditável.
- O leaderboard representa performance real, não eventos sintéticos ou drift de banco.
- Os rewards deixam de conflitar entre staking, trader ranking e social copytrade.
- A documentação canônica passa a descrever o sistema real e o plano de correção.

## Functional Requirements

- **FR1:** `copytrade` deve ser a única superfície canônica para depósitos, saques, posições, atividade, sinais e execuções.
- **FR2:** `social` deve cobrir perfis, follow, ideias, comentários, leaderboard e analytics, sem carregar lógica operacional de vault.
- **FR3:** o fluxo de signal precisa declarar explicitamente se é journaling, simulação ou execução real agregada.
- **FR4:** o reconciliador de vault não pode apagar PnL legítimo nem tratar performance como drift.
- **FR5:** performance fee por high-water mark deve permanecer correta e auditável.
- **FR6:** affiliate payout e reward distribution devem derivar de fontes econômicas corretas.
- **FR7:** frontend, SDK e backend devem convergir para um único contrato de rewards.

## Success Metrics

- Não existe mais duplicidade funcional entre `/social/vaults/*` e `/copytrade/vaults/*`.
- O estado econômico do vault suporta depósito, saque, fee, equity e reconciliação sem drift falso.
- O fluxo de signal fica explicitamente modelado e testado.
- Rewards deixam de conflitar entre follower, trader e staker.
- Existe um pacote SDD que rastreia decisões, gaps e rollout.

## Risks and Open Questions

- A migração do caminho legado de `socialService` pode quebrar consumidores antigos se não houver rollout claro.
- Se `createSignal()` continuar sem execução real, o produto precisa assumir isso explicitamente.
- A fonte de verdade para staker rewards precisa ser confirmada no contrato de staking e no SDK.
- O ranking de leaders pode precisar de nova ponderação após o alinhamento de follower count e analytics.

## Acceptance Signals

- O pacote SDD desta feature está criado com backlog priorizado.
- O mapa canônico aponta para `social-copytrade-v1`.
- Os principais gaps operacionais e econômicos estão registrados com referência ao código atual.
