# Agent Smart Router MCP V1 SPEC

**Status:** in-progress  
**Owner:** Core Protocol / AI Trading  
**PRD:** [`./PRD.md`](./PRD.md)  
**Related docs:** [`../../specs/PROJECT_SPEC.md`](../../specs/PROJECT_SPEC.md), [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md), [`../../API.md`](../../API.md)

## Summary

Esta feature adiciona Smart Router como capability oficial do MCP de agentes, sem quebrar os limites de segurança já existentes no backend.

O objetivo é cobrir dois fluxos:

- **quote pública:** comparar `AMM_V1`, `ORDERBOOK` e `ASYMMETRIC`;
- **execução por agente:** chamar `POST /api/v1/route/swap` com `X-API-Key`.

Quando o backend escolher `ASYMMETRIC` como melhor rota, o MCP não tentará “fingir” execução completa. Em vez disso, vai devolver o resultado do backend com um contrato explícito de continuação wallet-assisted.

## Current Implementation Snapshot

### Já existe

- `GET /api/v1/route/quote` e `POST /api/v1/route/swap` em [`spot-api/src/routes/router.ts`](../../../spot-api/src/routes/router.ts).
- `routerService.getQuote(...)` e `routerService.executeViaRouter(...)` em [`spot-api/src/services/routerService.ts`](../../../spot-api/src/services/routerService.ts).
- Execução híbrida já modelada no backend via `requiresWalletSignature` + `contractCallIntent`.

### Gaps observados

1. O MCP ainda declara `router` como fora de escopo em [`mcp/lunex-agent-mcp/src/index.ts`](../../../mcp/lunex-agent-mcp/src/index.ts).
2. Não existe tool MCP para quote do roteador.
3. Não existe tool MCP para execução via roteador com API key de agente.
4. A documentação pública do MCP e da página `/docs` ainda afirma que router não faz parte da superfície oficial.
5. Não há um artefato SDD específico para este gap de AI-first trading.

### Atualização aplicada (2026-04-14)

- O quote de `ORDERBOOK` no backend deixou de usar só `bestBid/bestAsk`; agora usa profundidade agregada para estimar `amountOut`, `effectivePrice` e `priceImpactBps`.
- A execução via router passou a validar `actualAmountOut` pós-execução contra `amountOutMin` e contra o mínimo protegido por slippage.
- O MCP passou a usar parsing booleano estrito para `isBuySide` (evitando coerção incorreta de strings como `"false"`).
- O tráfego MCP→API agora inclui `x-lunex-client: mcp` e suporte opcional a `Origin` configurável (`LUNEX_MCP_ORIGIN`) para melhorar compatibilidade com CORS estrito em produção.

## Scope

- Adicionar tools MCP para quote e execução do Smart Router.
- Atualizar `supportedScopes` e prompts do MCP.
- Representar claramente o fluxo híbrido `wallet-assisted`.
- Atualizar docs do MCP, exemplo OpenClaw e página `/docs`.
- Registrar a iniciativa em um pacote SDD dedicado.

## Out of Scope

- Reescrever o algoritmo do `routerService`.
- Adicionar execução totalmente autônoma para `ASYMMETRIC`.
- Expor tools MCP de staking/farming.
- Criar signer bridge ou custódia delegada.

## Impacted Modules

| Módulo | Arquivos principais | Papel |
|---|---|---|
| MCP server | [`mcp/lunex-agent-mcp/src/index.ts`](../../../mcp/lunex-agent-mcp/src/index.ts) | Novos tools, escopo e contratos de resposta |
| MCP docs | [`mcp/lunex-agent-mcp/README.md`](../../../mcp/lunex-agent-mcp/README.md), [`mcp/lunex-agent-mcp/OPENCLAW_SESSION_EXAMPLE.md`](../../../mcp/lunex-agent-mcp/OPENCLAW_SESSION_EXAMPLE.md), [`mcp/lunex-agent-mcp/openclaw.mcp.json`](../../../mcp/lunex-agent-mcp/openclaw.mcp.json) | DX e configuração |
| Frontend docs | [`lunes-dex-main/src/pages/docs/index.tsx`](../../../lunes-dex-main/src/pages/docs/index.tsx) | Documentação do produto para integradores |
| API docs | [`docs/API.md`](../../API.md) | Contrato canônico de referência |
| Backend router | [`spot-api/src/routes/router.ts`](../../../spot-api/src/routes/router.ts), [`spot-api/src/services/routerService.ts`](../../../spot-api/src/services/routerService.ts) | Fonte de verdade do contrato e execução |

## Design

### 1. MCP Scope Model

O MCP passa a suportar explicitamente:

- `smart-router`
- `spot-market-data`
- `authenticated-spot-trading`
- `agent-authenticated-trading`
- `social-trading`
- `copytrade`
- `strategy-layer`
- `execution-layer`
- `asymmetric-liquidity`

Continuam fora de escopo:

- ações diretas de AMM fora do router;
- staking;
- farming.

### 2. MCP Tools

#### `get_router_quote`

- Entrada:
  - `pairSymbol`
  - `side`
  - `amountIn`
- Implementação:
  - `GET /api/v1/route/quote`
- Resultado:
  - repassa o objeto `SmartQuote` do backend.

#### `agent_router_swap`

- Entrada:
  - `pairSymbol`
  - `side`
  - `amountIn`
  - `maxSlippageBps?`
  - `apiKey?`
- Implementação:
  - `POST /api/v1/route/swap`
  - autenticação com `LUNEX_AGENT_API_KEY` ou `apiKey` explícito.

### 3. Execution Modes

O tool `agent_router_swap` deve distinguir dois modos:

#### Server-side executable

Quando `executedVia` for `AMM_V1` ou `ORDERBOOK`, o resultado é finalizado no backend e devolvido normalmente.

#### Wallet-assisted

Quando `executedVia` for `ASYMMETRIC`, o resultado contém:

- `requiresWalletSignature: true`
- `contractCallIntent`
- `message`

O MCP deve:

- preservar o payload do backend;
- adicionar uma nota textual curta indicando que a continuação depende da wallet do usuário;
- não tratar esse caso como erro.

### 4. Documentation Contract

Os docs passam a refletir:

- router como capability oficial do MCP;
- diferença entre execução autônoma por API key e continuação wallet-assisted;
- ausência de custódia no MCP;
- uso correto de `LUNEX_AGENT_API_KEY`.

## Interfaces and Contracts

### MCP Tools

- `get_router_quote`
- `agent_router_swap`

### Backend API

- `GET /api/v1/route/quote`
- `POST /api/v1/route/swap`

### Response Contract

#### Quote

```json
{
  "pairSymbol": "LUNES/LUSDT",
  "side": "BUY",
  "amountIn": 1000,
  "bestRoute": "ORDERBOOK",
  "bestAmountOut": 241.5,
  "routes": []
}
```

#### Execution

Server-side:

```json
{
  "quote": {},
  "executedVia": "ORDERBOOK",
  "success": true,
  "order": {}
}
```

Wallet-assisted:

```json
{
  "quote": {},
  "executedVia": "ASYMMETRIC",
  "success": true,
  "requiresWalletSignature": true,
  "contractCallIntent": {},
  "message": "Route selected: ASYMMETRIC pool..."
}
```

## Security and Failure Modes

- `get_router_quote` continua público e read-only.
- `agent_router_swap` continua exigindo `TRADE_SPOT`.
- O MCP nunca gera assinatura nem executa a parte wallet-assisted sozinho.
- Se o backend rejeitar por slippage, ausência de liquidez ou auth, o MCP deve propagar erro claro.
- Se a melhor rota exigir wallet do usuário, a resposta deve ser tratada como continuação híbrida, não como sucesso autônomo completo.

## Rollout and Migration

- Sem migration de banco.
- Sem mudança de contrato backend.
- Mudança compatível para quem já usa os tools atuais do MCP.
- Atualização documental obrigatória junto do código.

## Test Plan

- **E2E contract:** adicionar cobertura para `GET /api/v1/route/quote` e `POST /api/v1/route/swap` em `spot-api/src/__tests__/e2e/router.e2e.test.ts`.
- **MCP contract:** adicionar testes automatizados do pacote `mcp/lunex-agent-mcp` para `get_router_quote` e `agent_router_swap`, incluindo tradução para `wallet-assisted`.
- **Smoke:** adicionar `npm run smoke:router` no pacote MCP para validar o servidor `stdio` contra um `spot-api` local.
- **Unit/build:** `npm run build` em `mcp/lunex-agent-mcp`.
- **Integration/build:** `npm run build` em `spot-api` e `lunes-dex-main`.
- **Manual:** validar `get_router_quote` e `agent_router_swap` contra backend local.
- **Docs:** revisar README do MCP, exemplo OpenClaw e `/docs`.

## Acceptance Criteria

- O MCP expõe `get_router_quote` e `agent_router_swap`.
- O `scope` do MCP deixa de marcar Smart Router como fora de escopo.
- `agent_router_swap` usa `TRADE_SPOT` e repassa corretamente respostas `wallet-assisted`.
- Os docs deixam claro que `ASYMMETRIC` ainda depende da wallet do usuário.
- O pacote SDD desta feature fica criado e atualizado no repositório.
