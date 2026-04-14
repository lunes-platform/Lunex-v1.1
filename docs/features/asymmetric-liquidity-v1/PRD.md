# Asymmetric Liquidity V1 PRD

**Status:** in-progress  
**Owner:** Core Protocol / Trading  
**Date:** 2026-04-13  
**Related docs:** [`../../prd/PROJECT_PRD.md`](../../prd/PROJECT_PRD.md), [`../../requisitonovo.md`](../../requisitonovo.md), [`../../SPOT_ORDERBOOK_ARCHITECTURE.md`](../../SPOT_ORDERBOOK_ARCHITECTURE.md)

## Context

O Lunex já possui uma base importante para liquidez assimétrica:

- contrato `AsymmetricPair` em [`Lunex/contracts/asymmetric_pair/lib.rs`](../../../Lunex/contracts/asymmetric_pair/lib.rs);
- experiência frontend em [`lunes-dex-main/src/pages/pool/asymmetric/index.tsx`](../../../lunes-dex-main/src/pages/pool/asymmetric/index.tsx);
- serviços backend em [`spot-api/src/routes/asymmetric.ts`](../../../spot-api/src/routes/asymmetric.ts) e [`spot-api/src/services/asymmetricService.ts`](../../../spot-api/src/services/asymmetricService.ts);
- suporte de automação por agente em [`lunes-dex-main/src/components/asymmetric/AgentDelegationPanel.tsx`](../../../lunes-dex-main/src/components/asymmetric/AgentDelegationPanel.tsx);
- modelo de persistência em [`spot-api/prisma/schema.prisma`](../../../spot-api/prisma/schema.prisma).

O problema é que a feature ainda não está fechada ponta a ponta como um produto utilizável e seguro. Parte do fluxo já existe, parte está só esboçada e parte está divergente entre frontend, backend, SDK, banco e indexação.

## Problem

LPs avançados e operadores de bots ainda não têm um fluxo confiável para:

- criar uma estratégia assimétrica a partir da UI;
- registrar e consultar a estratégia de forma consistente;
- delegar um agente com escopo restrito para ajustar curva sem custodiar fundos;
- receber rebalanceamento automático seguro após execução on-chain;
- usar a fonte de liquidez assimétrica como parte real do roteamento do protocolo.

Hoje, a feature sofre com três classes de problema:

- **fragmentação de contrato entre camadas:** payloads e modelos não estão alinhados;
- **lacunas operacionais:** indexação, rebalanceamento e quote ainda não estão integrados até o fim;
- **lacunas de segurança:** rotas e permissões precisam fechar o contrato de autenticação e escopo.

## Users / Stakeholders

- **LP Pro:** cria e ajusta curvas paramétricas manualmente.
- **Builder de bot / agente:** usa API keys ou agentes para ajustar parâmetros dentro de guardrails.
- **Operação / backend:** mantém Sentinel, relayer, indexação e observabilidade.
- **Frontend / SDK consumers:** precisam de contratos estáveis para deploy, consulta e gerenciamento.

## Goals

- Entregar um fluxo v1 utilizável de liquidez assimétrica do deploy ao gerenciamento.
- Garantir que apenas contratos oficiais do `AsymmetricPair` sejam registrados e manipulados.
- Permitir ajuste manual e por agente apenas de parâmetros autorizados de curva.
- Ativar rebalanceamento automático do lado vendedor com safety checks claros.
- Tornar a liquidez assimétrica uma fonte válida de quote dentro do roteador do protocolo.

## Non-Goals

- Não entregar nesta fase um editor visual completo drag-and-drop com modelagem avançada.
- Não fechar nesta fase a modelagem econômica completa de alavancagem/margin dentro da curva.
- Não incluir neste ciclo automação cross-chain, copy-trading de curvas ou otimização algorítmica avançada.
- Não reescrever toda a documentação legada; o objetivo é consolidar uma feature real no fluxo SDD.

## User Outcomes

- O usuário conecta a carteira, escolhe um template, instancia o contrato e registra a estratégia sem inserir endereço manualmente.
- O usuário consegue consultar status, logs e parâmetros da estratégia a partir de uma representação consistente.
- O usuário pode delegar um agente com escopo `MANAGE_ASYMMETRIC` sem conceder saque de fundos.
- Quando a curva de compra acumula posição e os guardrails do Sentinel permitem, a curva de venda é rebalanceada automaticamente.
- O protocolo consegue comparar liquidez assimétrica com outras rotas sem usar dados inconsistentes.

## Functional Requirements

- **FR1:** A UI deve instanciar o `AsymmetricPair` oficial e registrar a estratégia no backend com payload canônico.
- **FR2:** O backend deve validar autoria, código do contrato e integridade do request antes de criar ou alterar estratégias.
- **FR3:** O usuário deve poder atualizar parâmetros da curva manualmente respeitando ownership e guardrails.
- **FR4:** Um agente autenticado com `MANAGE_ASYMMETRIC` deve poder ajustar somente parâmetros permitidos da curva.
- **FR5:** O indexador deve reconhecer eventos do `AsymmetricPair` necessários para acionar o rebalanceamento automático.
- **FR6:** O rebalancer deve aplicar cooldown, filtro de economicidade, health checks e retry policy antes de enviar transação.
- **FR7:** O roteador deve tratar liquidez assimétrica como fonte de quote usando estado canônico.
- **FR8:** A feature deve expor status operacional mínimo: strategy status, auto-rebalance state e logs de execução.

## Success Metrics

- Estratégia assimétrica pode ser criada e consultada ponta a ponta em ambiente local/testnet.
- Atualizações manuais e por agente falham quando fora de escopo e passam quando assinadas/autorizadas corretamente.
- O rebalanceamento não dispara para poeira, estado inválido ou contrato não verificado.
- O quote do roteador não depende de campos inexistentes ou snapshots incoerentes.

## Risks and Open Questions

- O estado persistido hoje não espelha todo o estado on-chain da curva.
- Há divergência de payload entre o hook de deploy, o backend e o SDK.
- A integração do indexador com eventos assimétricos ainda parece incompleta.
- O fluxo de delegação por agente ainda não fecha guardrails e `manager` on-chain ponta a ponta.
- Escala decimal/planck precisa ser uniforme entre frontend, backend, contrato e relayer.
- A fronteira entre configuração persistida e estado vivo da curva ainda precisa ser explicitada.

## Acceptance Signals

- Uma estratégia criada via `/pool/asymmetric` aparece corretamente no backend e no SDK.
- Atualizar curva exige prova de identidade adequada ou API key com permissão específica.
- Um evento `AsymmetricSwapExecuted` relevante pode resultar em `AsymmetricRebalanceLog` consistente.
- O pacote documental desta feature serve de exemplo real do workflow SDD no projeto.
