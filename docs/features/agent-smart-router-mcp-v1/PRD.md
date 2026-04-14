# Agent Smart Router MCP V1 PRD

**Status:** in-progress  
**Owner:** Core Protocol / AI Trading  
**Date:** 2026-04-13  
**Related docs:** [`../../prd/PROJECT_PRD.md`](../../prd/PROJECT_PRD.md), [`../../specs/PROJECT_SPEC.md`](../../specs/PROJECT_SPEC.md), [`../../API.md`](../../API.md)

## Context

O Lunex já possui um Smart Router funcional no backend:

- quote público em [`spot-api/src/routes/router.ts`](../../../spot-api/src/routes/router.ts);
- motor de decisão em [`spot-api/src/services/routerService.ts`](../../../spot-api/src/services/routerService.ts);
- execução autenticada por agente em `POST /api/v1/route/swap`.

Ao mesmo tempo, o MCP oficial de agentes já cobre:

- spot com assinatura externa;
- spot com API key de agente;
- social/copytrade;
- execution layer;
- strategies;
- assimétrica por agente.

O gap é que o MCP ainda não expõe o Smart Router, apesar de ele já existir no backend e ser uma capability central para execução inteligente.

## Problem

Hoje um agente IA que opera via MCP não consegue:

- pedir uma cotação comparativa entre `ORDERBOOK`, `AMM_V1` e `ASYMMETRIC`;
- executar a melhor rota via a interface oficial do MCP;
- entender, de forma estruturada, quando a melhor rota exige assistência da wallet do usuário.

Isso gera uma contradição no posicionamento de produto “AI-first”: parte relevante da superfície de trading existe no backend, mas não chega à camada de integração usada pelos agentes.

## Users / Stakeholders

- **Builder de agente IA:** quer operar via MCP sem integração ad hoc com a API.
- **Usuário assistido por IA:** quer receber a melhor rota possível, inclusive quando a execução exigir confirmação de wallet.
- **Backend / operação:** precisa manter contratos de execução claros e seguros.
- **Documentação / DX:** precisa evitar prometer autonomia total quando a rota ainda depende de assinatura on-chain do usuário.

## Goals

- Expor Smart Router quote no MCP.
- Expor Smart Router execution por agente no MCP.
- Representar corretamente o ramo híbrido `wallet-assisted` quando a melhor rota for `ASYMMETRIC`.
- Atualizar a documentação canônica para refletir o contrato real.
- Usar esta iniciativa como exemplo real de SDD aplicado a AI-first trading.

## Non-Goals

- Não expor chamadas diretas ao contrato AMM V1 no MCP.
- Não tornar `ASYMMETRIC` totalmente autônoma sem assinatura do usuário.
- Não redesenhar o algoritmo do roteador nesta fase.
- Não reescrever toda a documentação legada do projeto.

## User Outcomes

- O agente consegue pedir uma quote multi-rota com um único tool MCP.
- O agente consegue executar a melhor rota com API key quando a execução for server-side.
- Quando a melhor rota exigir wallet do usuário, o MCP devolve um contrato explícito de continuação, em vez de mascarar a limitação.
- A documentação deixa claro o que é autônomo e o que é wallet-assisted.

## Functional Requirements

- **FR1:** O MCP deve expor um tool de quote para `GET /api/v1/route/quote`.
- **FR2:** O MCP deve expor um tool autenticado para `POST /api/v1/route/swap`.
- **FR3:** O tool de execução deve preservar `requiresWalletSignature` e `contractCallIntent` quando a melhor rota for `ASYMMETRIC`.
- **FR4:** O escopo do MCP deve ser atualizado para incluir Smart Router.
- **FR5:** A documentação do MCP e da página `/docs` deve refletir o fluxo híbrido real.
- **FR6:** O MCP não pode sugerir que possui custódia nem pode tentar assinar em nome do usuário.

## Success Metrics

- Um agente consegue obter quote do router via MCP em ambiente local.
- Um agente autenticado consegue executar `route/swap` via MCP quando a melhor rota for server-side.
- Quando a melhor rota for `ASYMMETRIC`, o MCP devolve instruções estruturadas para continuação wallet-assisted.
- O pacote SDD desta feature documenta claramente a diferença entre autonomia por API key e execução assistida por wallet.
- Existe um smoke script repetível no repositório para validar o fluxo `MCP -> spot-api` do Smart Router.

## Risks and Open Questions

- `ASYMMETRIC` continua sendo parcialmente assistida; isso precisa estar explícito para não gerar falsa promessa de autonomia.
- O router depende de `Pair.pairAddress` e da estratégia assimétrica estar corretamente mapeada.
- Quotes podem falhar por ausência de liquidez real em qualquer uma das três fontes.
- O produto ainda precisa decidir, em outro ciclo, se quer um signer bridge seguro para fechar o último passo da execução híbrida.

## Acceptance Signals

- O MCP lista o Smart Router como capability suportada.
- `get_router_quote` e `agent_router_swap` funcionam com o backend atual.
- A resposta do MCP diferencia corretamente `server-side execution` de `wallet-assisted execution`.
- A feature fica registrada em `PRD.md`, `SPEC.md` e `TASKS.md` com status coerente com o código.
