# Agent Smart Router MCP V1 TASKS

**Owner:** Core Protocol / AI Trading  
**SPEC:** [`./SPEC.md`](./SPEC.md)  
**Status:** in-progress

## Definition of Done

- O MCP expõe quote e execução do Smart Router.
- O escopo do MCP e a documentação não contradizem mais o backend.
- O fluxo `wallet-assisted` de `ASYMMETRIC` fica explicitado, não implícito.
- O pacote SDD da feature registra o contrato, o rollout e os gaps restantes.

## Phase 1 — SDD Baseline

- [x] Criar `PRD.md` da feature.
- [x] Criar `SPEC.md` da feature.
- [x] Criar `TASKS.md` da feature.

## Phase 2 — MCP Capability

- [x] Adicionar `smart-router` ao escopo suportado do MCP.
- [x] Criar tool `get_router_quote`.
- [x] Criar tool `agent_router_swap`.
- [x] Fazer o tool de execução distinguir `server-side` de `wallet-assisted`.
- [x] Atualizar mensagens de scope/refusal para o novo contrato.

## Phase 3 — Documentation

- [x] Atualizar `mcp/lunex-agent-mcp/README.md`.
- [x] Atualizar `mcp/lunex-agent-mcp/OPENCLAW_SESSION_EXAMPLE.md`.
- [x] Atualizar a página [`/docs`](../../../lunes-dex-main/src/pages/docs/index.tsx).
- [x] Garantir que `docs/API.md` continue consistente com o fluxo do router.

## Phase 4 — Validation

- [x] Adicionar teste E2E de contrato para `GET /api/v1/route/quote`.
- [x] Adicionar teste E2E de contrato para `POST /api/v1/route/swap`, incluindo caso `wallet-assisted`.
- [x] Adicionar teste automatizado no MCP para `get_router_quote`.
- [x] Adicionar teste automatizado no MCP para `agent_router_swap`, incluindo tradução `wallet-assisted`.
- [x] Adicionar smoke script `MCP -> spot-api` para Smart Router no pacote MCP.
- [x] Ajustar quote de `ORDERBOOK` para cálculo por profundidade (evitar estimativa por melhor nível único).
- [x] Validar piso de saída (`amountOutMin`) também no pós-execução do swap via router.
- [x] Corrigir parsing booleano do MCP para `isBuySide` sem coerção implícita insegura.
- [x] Enforçar gate de qualidade no CI (`ESLint` + `ts-prune` + `depcheck` + `Prettier`) para `spot-api`, `mcp`, `sdk` e `frontend`.
- [x] Rodar build do MCP.
- [x] Rodar build do `spot-api`.
- [x] Rodar build do `lunes-dex-main`.
- [x] Registrar follow-ups restantes, se houver.

## Risks / Follow-ups

- `ASYMMETRIC` continua exigindo wallet do usuário no último passo.
- O router ainda depende do mapeamento correto entre `Pair` e `AsymmetricStrategy`.
- Uma futura fase pode adicionar signer bridge ou execução assistida mais integrada, mas isso fica fora deste ciclo.
- Ainda vale uma validação manual end-to-end com liquidez real, mesmo com o smoke automatizado presente.
