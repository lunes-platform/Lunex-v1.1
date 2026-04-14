# Asymmetric Liquidity V1 SPEC

**Status:** in-progress  
**Owner:** Core Protocol / Trading  
**PRD:** [`./PRD.md`](./PRD.md)  
**Related docs:** [`../../specs/PROJECT_SPEC.md`](../../specs/PROJECT_SPEC.md), [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md)

## Summary

Esta feature consolida a liquidez assimétrica como capability real do Lunex, cobrindo:

- deploy do `AsymmetricPair`;
- registro e leitura de estratégia;
- atualização manual ou por agente com escopo restrito;
- rebalanceamento automático orientado por eventos;
- integração mínima com quote de roteamento.

Como o projeto já é brownfield, esta SPEC também serve para registrar o estado atual, os gaps objetivos e o contrato alvo entre as camadas.

## Current Implementation Snapshot

### Já existe

- Contrato `AsymmetricPair` com owner, manager e guardrails.
- Página `/pool/asymmetric` com templates, builder e painel de delegação.
- Hook de deploy no frontend.
- Rotas backend para criação, leitura, update e logs.
- Modelos `AsymmetricStrategy` e `AsymmetricRebalanceLog`.
- `AsymmetricClient` no frontend/SDK local.
- `rebalancerService` e menção a suporte no `routerService`.

### Gaps observados no código atual

1. **Payload inconsistente entre frontend e backend**
   - O hook [`useAsymmetricDeploy.ts`](../../../lunes-dex-main/src/hooks/useAsymmetricDeploy.ts) envia `contractAddress`, `ownerAddress`, `buyCurve` e `sellCurve`.
   - A rota [`spot-api/src/routes/asymmetric.ts`](../../../spot-api/src/routes/asymmetric.ts) espera `userAddress`, `pairAddress`, `buyK`, `buyGamma`, `buyMaxCapacity`, `sellGamma`, `sellMaxCapacity`.

2. **Autenticação ainda frouxa nas rotas de usuário**
   - As rotas `POST /strategies`, `PATCH /strategies/:id/auto` e `PATCH /strategies/:id/curve` aceitam `address` no body, sem middleware explícito de assinatura.

3. **Endpoints de agente não mostram proteção explícita por `agentAuth(['MANAGE_ASYMMETRIC'])`**
   - A permissão existe no schema, mas o contrato do endpoint precisa ficar inequívoco.

4. **Indexação de eventos assimétricos está incompleta**
   - `socialIndexerService` declara tipos para `ASYMMETRIC_SWAP`, mas não registra `asymmetric_pair` em `loadKnownContracts` nem aciona `rebalancerService.handleCurveExecution`.

5. **Roteador usa shape de dados incompatível com o schema real**
   - [`routerService.ts`](../../../spot-api/src/services/routerService.ts) procura `baseToken`, `quoteToken`, `buyCurve` e `sellCurve`, campos que não existem no modelo Prisma atual.

6. **Escala numérica provavelmente divergente no relayer**
   - O contrato usa `PLANCK = 1e12`, mas o `rebalancerService` monta `newCapacity` com `1e8`.

7. **Persistência não representa estado vivo completo da curva**
   - O banco guarda configuração e automação, mas não espelha integralmente o estado on-chain de ambas as curvas.

8. **Delegação por agente ainda não fecha o loop on-chain**
   - [`AgentDelegationPanel.tsx`](../../../lunes-dex-main/src/components/asymmetric/AgentDelegationPanel.tsx) coleta `guardrails`, `strategyId` e `pairAddress`, mas o fluxo atual gera apenas a API key.
   - O painel não chama `setManager(...)` no contrato, então `manager` e guardrails podem não ser aplicados on-chain.

9. **Endpoints de agente ainda dependem de identidade enviada no body**
   - [`spot-api/src/routes/asymmetric.ts`](../../../spot-api/src/routes/asymmetric.ts) usa `agentId` e `userAddress` vindos do payload.
   - O contrato alvo deve derivar contexto do agente autenticado em `req.agent`, não confiar nesses campos como fonte principal.

### Atualização aplicada (2026-04-14)

- `POST /api/v1/asymmetric/strategies`, `PATCH /strategies/:id/auto` e `PATCH /strategies/:id/curve` permanecem com assinatura wallet obrigatória e validação de nonce/timestamp.
- Endpoints de agente já operam com identidade derivada de `req.agent`, e `agent/create-strategy` passou a respeitar `isAutoRebalance` enviado no payload (sem hardcode).
- A validação de contrato oficial foi endurecida:
  - em produção, ausência de `ASYMMETRIC_PAIR_CODE_HASH` bloqueia criação (`503`);
  - ausência de `codeHash` on-chain para o `pairAddress` bloqueia (`403`);
  - indisponibilidade do nó em produção bloqueia (`503`) em vez de bypass silencioso.
- O `rebalancerService.handleCurveExecution(...)` deixou de usar fallback para “última strategy do par”; agora rebalance só ocorre quando `pairAddress + userAddress` batem com uma strategy válida.
- Erros de domínio do módulo assimétrico passaram a ser mapeados explicitamente para `4xx` (`400/403/404/409`) no roteador, evitando `500` falso-positivo em cenários de autorização e conflito.
- `GET /api/v1/asymmetric/strategies/:id` e `GET /api/v1/asymmetric/agent/strategy-status/:id` passaram a expor status canônico aditivo:
  - `persistedConfig` (configuração/estado operacional persistido),
  - `liveState` (estado vivo on-chain + disponibilidade),
  - `delegation` (manager, relayer, escopo e estado de delegação).
- O payload legado de status foi mantido por compatibilidade de transição; clientes devem migrar para as chaves canônicas aditivas.

## Scope

- Fechar o contrato canônico de criação e leitura de estratégia.
- Proteger rotas de usuário e de agente com o mecanismo de autenticação correto.
- Tornar o `AsymmetricPair` observável pelo indexador.
- Ligar eventos on-chain ao Sentinel de rebalanceamento.
- Padronizar conversão de unidades/plancks.
- Corrigir a integração de quote no roteador para usar estado canônico.

## Out of Scope

- UX avançada de desenho livre de curva.
- Estratégias algorítmicas nativas além de templates e guardrails.
- Leverage econômico completo dentro do contrato.
- Cross-chain, market making externo ou analytics avançado desta feature.

## Impacted Modules

| Módulo | Arquivos principais | Papel |
|---|---|---|
| Frontend pool | [`lunes-dex-main/src/pages/pool/asymmetric/index.tsx`](../../../lunes-dex-main/src/pages/pool/asymmetric/index.tsx), [`lunes-dex-main/src/hooks/useAsymmetricDeploy.ts`](../../../lunes-dex-main/src/hooks/useAsymmetricDeploy.ts) | Deploy, edição, fluxo do usuário |
| Delegação de agente | [`lunes-dex-main/src/components/asymmetric/AgentDelegationPanel.tsx`](../../../lunes-dex-main/src/components/asymmetric/AgentDelegationPanel.tsx) | Registro e API key restrita |
| Serviço on-chain | [`lunes-dex-main/src/services/asymmetricContractService.ts`](../../../lunes-dex-main/src/services/asymmetricContractService.ts) | Instantiate, deploy, query e txs |
| Backend API | [`spot-api/src/routes/asymmetric.ts`](../../../spot-api/src/routes/asymmetric.ts), [`spot-api/src/services/asymmetricService.ts`](../../../spot-api/src/services/asymmetricService.ts) | CRUD, regras de domínio e status |
| Rebalance | [`spot-api/src/services/rebalancerService.ts`](../../../spot-api/src/services/rebalancerService.ts) | Safety pipeline e relayer |
| Indexação | [`spot-api/src/services/socialIndexerService.ts`](../../../spot-api/src/services/socialIndexerService.ts) | Eventos on-chain → backend |
| Roteador | [`spot-api/src/services/routerService.ts`](../../../spot-api/src/services/routerService.ts) | Quote multi-fonte |
| Persistência | [`spot-api/prisma/schema.prisma`](../../../spot-api/prisma/schema.prisma) | Estratégia, logs, permissões |
| Contrato | [`Lunex/contracts/asymmetric_pair/lib.rs`](../../../Lunex/contracts/asymmetric_pair/lib.rs) | Regra on-chain de curva e papéis |

## Design

### 1. Source of Truth

- **Contrato on-chain:** fonte de verdade para estado vivo da curva.
- **Banco de dados:** fonte de verdade para configuração, ownership lógico, status operacional, pendências e logs.
- **UI/SDK:** nunca devem assumir que um snapshot local substitui o estado on-chain.

### 2. Canonical Create Strategy Contract

O fluxo canônico de criação fica em duas etapas:

1. O frontend instancia o `AsymmetricPair` oficial e executa `deploy_liquidity`.
2. O frontend registra a estratégia no backend com payload alinhado ao contrato público da API.

Payload canônico proposto para registro:

```json
{
  "userAddress": "wallet",
  "pairAddress": "contract-address",
  "isAutoRebalance": true,
  "buyK": "1000",
  "buyGamma": 3,
  "buyMaxCapacity": "10000",
  "buyFeeTargetBps": 30,
  "sellGamma": 2,
  "sellMaxCapacity": "8000",
  "sellFeeTargetBps": 30,
  "sellProfitTargetBps": 500,
  "leverageL": "0",
  "allocationC": 0.5
}
```

O frontend/hook deve convergir para isso. Campos de conveniência de UI podem existir internamente, mas não como contrato público.

### 3. Authentication Model

#### Rotas de usuário

As mutações de usuário devem usar `verifyWalletActionSignature` com ação explícita, nonce e timestamp.

Cobertura mínima:

- criar estratégia;
- alternar auto-rebalance;
- atualizar curva manualmente.

#### Rotas de agente

As rotas de agente devem usar `agentAuth(['MANAGE_ASYMMETRIC'])` e operar sobre `req.agent`.

O agente nunca deve:

- sacar fundos;
- alterar owner;
- burlar guardrails definidos pelo owner/contrato.

#### Delegação frontend → contrato

O fluxo de delegação só é considerado completo quando:

1. a UI gera a API key restrita;
2. a UI ou backend orquestrado aplica `set_manager` no `AsymmetricPair`;
3. os guardrails escolhidos no painel passam a existir também no contrato on-chain.

Sem isso, a delegação fica apenas documentada no backend/autorização, mas não no enforcement do contrato.

### 4. Event → Sentinel Flow

Fluxo alvo:

1. `socialIndexerService` registra `asymmetric_pair` como contrato conhecido.
2. Ao decodificar `AsymmetricSwapExecuted`, normaliza `pairAddress`, `caller` e `liquidity_out`.
3. O indexador chama `rebalancerService.handleCurveExecution(pairAddress, userAddress, acquiredAmount)`.
4. O Sentinel aplica cooldown, filtro de economicidade e health check.
5. Se elegível, o relayer envia `update_curve_parameters` no lado correto e grava `AsymmetricRebalanceLog`.

### 5. Quote Integration

O roteador não deve depender de campos inexistentes no banco.

Abordagem v1:

- usar dados configuracionais do banco para localizar a estratégia ativa;
- consultar estado vivo da curva via contrato ou adaptar o serviço para materializar shape compatível;
- retornar rota `ASYMMETRIC` apenas quando houver capacidade real e cálculo coerente.

### 6. Observability

Mínimos obrigatórios:

- logs estruturados por `strategyId`, `pairAddress`, `userAddress`;
- status da estratégia com `status`, `pendingAmount`, `retryCount`, `lastError`;
- logs de rebalance com trigger, side, amount, txHash e status.
- visibilidade explícita do estado de delegação: `manager` configurado, guardrails aplicados e origem da última alteração.

## Interfaces and Contracts

### API

- `GET /api/v1/asymmetric/contract-bundle`
- `GET /api/v1/asymmetric/strategies`
- `POST /api/v1/asymmetric/strategies`
- `GET /api/v1/asymmetric/strategies/:id`
- `PATCH /api/v1/asymmetric/strategies/:id/auto`
- `PATCH /api/v1/asymmetric/strategies/:id/curve`
- `GET /api/v1/asymmetric/strategies/:id/logs`
- `POST /api/v1/asymmetric/agent/create-strategy`
- `POST /api/v1/asymmetric/agent/update-curve`
- `GET /api/v1/asymmetric/agent/strategy-status/:id`

Observação:

- O contrato desejado é que endpoints de agente leiam identidade e permissões do middleware de auth, não do body.

### Database

Modelos centrais:

- `AsymmetricStrategy`
- `AsymmetricRebalanceLog`
- `AgentApiKeyPermission.MANAGE_ASYMMETRIC`

### Contract

Mensagens/ações centrais:

- `new`
- `deploy_liquidity`
- `set_manager` (inclui `guardrails`)
- `update_curve_parameters`
- `asymmetric_swap`
- `get_owner`
- `get_buy_curve`
- `get_sell_curve`

## Security and Failure Modes

- Estratégia não pode ser registrada para contrato arbitrário quando `ASYMMETRIC_PAIR_CODE_HASH` estiver configurado.
- Updates de curva não podem depender só de `address` enviado no payload.
- Agente sem permissão `MANAGE_ASYMMETRIC` deve falhar com `403`.
- Guardrails selecionados na UI não podem existir apenas visualmente; precisam ser aplicados também no contrato.
- Event decoding incompleto deve degradar para “sem rebalance” e não para update incorreto.
- Escala inválida de unidades deve falhar antes de enviar tx.
- Em falhas repetidas de rebalance, a estratégia deve ir para `SUSPENDED_ERROR`.
- A rota `ASYMMETRIC` no smart router só pode ficar disponível quando houver estado vivo de curva (`getCurveState`) para capacidade real calculável.

## Rollout and Migration

- Padronizar env vars de bundle/hash oficial do contrato.
- Se necessário, criar migration para guardar metadados adicionais que faltem ao fluxo.
- Manter backward compatibility apenas quando não comprometer segurança; payloads legados inseguros não devem ser preservados por conveniência.

## Test Plan

- **Unit:** `asymmetricService`, cálculos do roteador, normalização de unidades, guardrails do rebalancer.
- **Integration:** rotas `POST /strategies`, `PATCH /curve`, endpoints de agente com auth real.
- **Contract tests:** deploy, owner/manager, guardrails, swap e update.
- **E2E/manual:** deploy via `/pool/asymmetric`, registro backend, delegação de agente com `set_manager`, simulação de evento e log de rebalance.

## Acceptance Criteria

- O hook/frontend e o backend usam o mesmo payload canônico para criar estratégia.
- Mutações de usuário falham sem assinatura válida.
- Endpoints de agente falham sem `X-API-Key` válida com `MANAGE_ASYMMETRIC`.
- Guardrails escolhidos no painel de delegação chegam ao `AsymmetricPair` via `set_manager`.
- `socialIndexerService` reconhece `AsymmetricSwapExecuted` e pode acionar o Sentinel.
- `routerService` deixa de consultar campos inexistentes para montar a rota `ASYMMETRIC`.
- `routerService` só marca `ASYMMETRIC` como disponível quando existe curva viva consultável; sem isso, responde indisponível (`LIVE_CURVE_UNAVAILABLE`).
- Conversão de unidades é uniforme entre frontend, backend e contrato.
