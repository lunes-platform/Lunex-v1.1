# 02 — Consolidação de Definições de Tipos (Agente 2/8)

Data: 2026-06-11 · Fase A (somente leitura) · Escopo: spot-api, lunes-dex-main, lunex-admin, sdk, mcp/lunex-agent-mcp, subquery-node, scripts/, types/shared

## Contexto estrutural (fatos verificados)

- **Não há workspaces nem dependências locais entre pacotes.** `package.json` raiz (`lunex-platform`) não declara `workspaces`; nenhum pacote depende de `@lunex/sdk` via `file:`/`workspace:`. Cada pacote redeclara seus tipos do zero.
- **`lunes-dex-main` NÃO usa o SDK.** As únicas ocorrências de `@lunex/sdk` no dex-ui são strings de exemplo na página de docs (`lunes-dex-main/src/pages/docs/index.tsx:1811,1853,2377`). Toda a camada de serviços do UI redeclara os tipos do SDK à mão.
- **`mcp/lunex-agent-mcp` também não usa o SDK** — refaz o client HTTP com `JsonObject = Record<string, unknown>` (3 declarações internas).
- **`types/shared` não é um pacote de tipos.** Contém apenas `types/shared/utils.ts` — helpers de decode de eventos typechain (`decodeEvents`, `getTypeDescription`). **Zero tipos de domínio. Nada ali está disponível para consolidação; o nome engana.**
- **Varredura:** 51 nomes de tipo declarados em ≥2 pacotes (excluindo node_modules, dist, .d.ts, testes, tipos gerados).

---

## 1. Recomendações ALTA confiança

### A1. UI deve consumir tipos do `@lunex/sdk` — 16 tipos com campos IDÊNTICOS duplicados à mão
**Fonte de verdade: `sdk/src/spot-types.ts` e `sdk/src/modules/*`** (o SDK é o contrato público com consumidores externos — backward compat manda; o UI deve aderir a ele, nunca o contrário).

Duplicações byte-a-byte (campos idênticos) verificadas:

| Tipo | Cópia no UI | Fonte de verdade (SDK) |
|---|---|---|
| SpotTicker | lunes-dex-main/src/services/spotService.ts:63 | sdk/src/spot-types.ts:68 |
| OrderbookLevel | lunes-dex-main/src/services/spotService.ts:77 | sdk/src/spot-types.ts:82 |
| MarginPriceHealthSummary | lunes-dex-main/src/services/marginService.ts:35 | sdk/src/spot-types.ts:14 |
| MarginPriceHealthPairState | lunes-dex-main/src/services/marginService.ts:44 | sdk/src/spot-types.ts:23 |
| MarginPriceHealthSnapshot | lunes-dex-main/src/services/marginService.ts:60 | sdk/src/spot-types.ts:39 |
| Strategy | lunes-dex-main/src/services/strategyService.ts:18 | sdk/src/modules/strategy.ts:13 |
| StrategyType / StrategyRiskLevel | strategyService.ts:8,15 | sdk/src/modules/strategy.ts:3,10 |
| StrategyPerformancePoint | strategyService.ts:59 | sdk/src/modules/strategy.ts:52 |
| SocialStats | lunes-dex-main/src/services/socialService.ts:101 | sdk/src/spot-types.ts:206 |
| RewardLeaderRankingEntry | lunes-dex-main/src/services/rewardsService.ts:38 | sdk/src/types.ts:329 |
| RewardTraderRankingEntry | rewardsService.ts:56 | sdk/src/types.ts:347 |
| RewardRankingsResponse | rewardsService.ts:63 | sdk/src/types.ts:354 |
| StrategyDelegationStatus | lunes-dex-main/src/sdk/AsymmetricClient.ts:66 | sdk/src/modules/asymmetric/types.ts:92 |
| TradingTier | lunes-dex-main/src/pages/rewards/index.tsx:7 | sdk/src/types.ts:137 |
| CopytradeDepositResult / CopytradeWithdrawResult | socialService.ts:211,220 | sdk/src/spot-types.ts:398,413 |

**Como:** adicionar `@lunex/sdk` como dependência local (workspaces npm ou `file:../sdk`) e trocar declarações por `import type`. Imports type-only = zero impacto de bundle/runtime.
**Risco: BAIXO-MÉDIO** — o risco é de build/tooling (configurar workspace), não de tipo: os campos são idênticos hoje. Sem mexer na API pública do SDK (constraint de backward compat respeitada).

### A2. Drift silencioso UI ↔ SDK — mesmos endpoints, shapes divergentes (ligado ao achado P1 da auditoria de SDK)
Cada par abaixo descreve a MESMA resposta de API com campos diferentes — bugs latentes:

1. **SpotOrder** — UI (`spotService.ts:91`) sem `signature`/`updatedAt`; usa `string` onde o SDK usa `NumericValue = string | number` (`sdk/src/spot-types.ts:137`). Risco: baixo (campos extras ignorados), mas o `NumericValue` do SDK admite `number` que o UI não trata.
2. **SpotCandle** — UI (`spotService.ts:150`) sem `id`/`pairId`/`timeframe` (`sdk/src/spot-types.ts:123`).
3. **SpotPair** — UI (`spotService.ts:50`) sem `baseToken`/`quoteToken`/`isActive`/`createdAt` (`sdk/src/spot-types.ts:51`).
4. **CopytradeExecution** — UI (`socialService.ts:251`) sem `positionEffect`/`realizedPnl`; `side: 'BUY'|'SELL'` vs `string` no SDK; `slippageBps: number` vs `number | null` (`sdk/src/spot-types.ts:431`).
5. **AgentProfile** — **bug latente real:** UI (`lunes-dex-main/src/services/agentService.ts:17`) espera `roi`/`sharpe`/`maxDrawdown`, mas a rota `spot-api/src/routes/agents.ts` não retorna esses campos (grep negativo; resposta tem `isBanned`/`stakedAmount`/`tradingLimits`, como no SDK `sdk/src/modules/agents.ts:32`). O `normalizeAgentProfile` (agentService.ts:66-68) faz `agent.sharpe ?? 0` — **Sharpe e maxDrawdown exibidos sempre 0 sem erro de compilação.**
6. **SignedReadAuth** — 5 declarações com semânticas diferentes sob o mesmo nome: UI exige `nonce/timestamp/signature` obrigatórios (`AsymmetricClient.ts:136`, `marginService.ts:4`); SDK os declara opcionais + callback `signMessage` (`sdk/src/modules/agents.ts:13`, `copytrade.ts:25`, `orders.ts:44`).

**Fonte de verdade: SDK** (contrato público), exceto onde o SDK divergir da rota real — nesse caso corrigir o SDK primeiro (ver A4) e o UI herda via A1.
**Risco: MÉDIO** — consolidar revela usos do UI que dependiam do shape antigo; é exatamente o objetivo (transformar drift silencioso em erro de compilação).

### A3. Eliminar o fork vendored `lunes-dex-main/src/sdk/AsymmetricClient.ts`
O UI mantém um fork completo do módulo asymmetric do SDK, já divergente:
- `CurveParameters` UI (`AsymmetricClient.ts:21` = `{gamma, maxCapacity, feeTargetBps, profitTargetBps, baseLiquidity?}`) corresponde ao **status de saída** da API (`spot-api/src/services/asymmetricService.ts:52-63`), enquanto `CurveParameters` do SDK (`sdk/src/modules/asymmetric/types.ts:7` = `{k, leverageL, allocationC, maxCapacityX0, gamma, feeTargetBps}`) são os **parâmetros de criação**. Dois conceitos diferentes sob o mesmo nome — o equivalente correto no SDK é `StrategyCurveStatus` (`asymmetric/types.ts:47`), que bate com o UI.
- `UpdateCurveInput`: API espera `newMaxCapacity` (`spot-api/src/routes/asymmetric.ts:82`); SDK expõe `newMaxCapacityX0` e mapeia no client (`sdk/src/modules/asymmetric/AsymmetricClient.ts:252,264`); UI manda `newMaxCapacity` direto (`AsymmetricClient.ts:121`). Funciona hoje, mas três nomes para o mesmo campo é fragilidade pura.
- `StrategyStatus`/`StrategyPersistedConfig`/`StrategyLiveState`: divergem do SDK só em union inline vs alias nomeado (`StrategyHealthState`) e `string` vs `string | Date`.

**Fonte de verdade: `sdk/src/modules/asymmetric/`**. Substituir o fork pelo módulo do SDK (depende de A1).
**Risco: MÉDIO** — o fork tem assinatura de chamadas com auth embutido (`nonce/timestamp/signature` em inputs); requer adaptação dos call-sites, não só troca de import.

### A4. spot-api deve tipar as respostas das rotas com os tipos de contrato (fecha o loop do P1)
Hoje a API monta respostas ad-hoc e o contrato formal não existe em lugar nenhum do lado servidor:
- **OrderbookSnapshot**: o tipo interno da API (`spot-api/src/utils/orderbook.ts:15`) tem só `bids/asks` com `number`; a rota adiciona `spread/bestBid/bestAsk` na mão (`spot-api/src/routes/orderbook.ts:16-21`). O shape verdadeiro da resposta só está declarado... no UI (`spotService.ts:83`). Nenhum tipo no SDK cobre isso.
- Recomendação: spot-api importar (type-only) os tipos de resposta do SDK — ou de um pacote interno `@lunex/contracts` — e anotar `res.json<T>()`/retornos de service com eles. Qualquer mudança de rota passa a quebrar compilação no mesmo PR.

**Fonte de verdade: SDK. Risco: BAIXO** (anotações type-only no servidor; sem mudança de runtime).

---

## 2. Recomendações MÉDIA confiança

### M1. Colisões de nome (conceitos distintos sob o mesmo identificador) — renomear, NÃO consolidar
- **CreateStrategyInput** (4 declarações, 2 conceitos): strategy de marketplace (`spot-api/src/services/strategyService.ts:11`, `sdk/src/modules/strategy.ts:63`) vs curva asymmetric (`spot-api/src/services/asymmetricService.ts:19`, `lunes-dex-main/src/sdk/AsymmetricClient.ts:98`). Sugerir `CreateAsymmetricStrategyInput` para o segundo grupo (no spot-api e no fork do UI; no SDK público manter nome atual por backward compat e só documentar).
- **ApiKeyChallenge**: registro interno do servidor `{leaderId, leaderAddress, expiresAt: number}` (`spot-api/src/services/copytradeService.ts:72`) vs resposta HTTP `{challengeId, expiresAt: string}` (`lunes-dex-main/src/services/socialService.ts:266`). Renomear o interno para `ApiKeyChallengeRecord`.
- **Pagination**: input de query `{page, limit, skip}` (`spot-api/src/middleware/pagination.ts:11`) vs metadados de resposta `{page, limit, total, totalPages}` (`sdk/src/types.ts:21`). Renomear o do spot-api para `PaginationInput`.
- **StakingTier**: interface no spot-api (`spot-api/src/services/agentService.ts:13`) vs alias no SDK (`sdk/src/types.ts:138`) — tipos estruturalmente diferentes com o mesmo nome.

**Risco: BAIXO** (renomes internos, sem mudança de shape). Confiança MÉDIA porque exige confirmar cada call-site.

### M2. Tipos do `SDKContext` do UI divergem do SDK on-chain
- **Quote**: UI tem `executionPrice`, `route: string[]` (`lunes-dex-main/src/context/SDKContext.tsx:15`); SDK tem `amountIn`, `path`, `fee`, `route: RouteStep[]` (`sdk/src/types.ts:71`).
- **Token**: `icon` (UI, 3 declarações: `useLiquidity.tsx:4`, `useSwap.tsx:4`, `chooseToken/mock.ts:13`) vs `logoURI` (`sdk/src/types.ts:46`).
- **LiquidityParams**: UI sem `gasLimit` (`SDKContext.tsx:31` vs `sdk/src/types.ts:96`).
- **Proposal**: UI `votesYes/votesNo` (`lunes-dex-main/src/pages/governance/index.tsx:12`) vs SDK `votesFor/votesAgainst/feeRefunded/createdAt` (`sdk/src/types.ts:154`).

Consolidar exige reconciliar os call-sites (renomear campos no UI ou adicionar adaptadores). **Fonte de verdade: SDK. Risco: MÉDIO.** Confiança MÉDIA porque parte dessas páginas do UI opera sobre mocks (ex.: governance) — confirmar antes se o dado real virá do SDK.

### M3. `DailySummary` — UI parcial
`lunes-dex-main/src/pages/agent/index.tsx:677` sem `date/failed/rejectionReasons` vs `sdk/src/modules/execution.ts:50`. Mesma família do A2; consolidar junto com A1. **Risco: BAIXO.**

### M4. `RiskCheck` idêntico entre spot-api e SDK
`spot-api/src/services/executionLayerService.ts:8` ≡ `sdk/src/modules/execution.ts:7`. Candidato direto ao A4 (servidor importar do contrato). **Risco: BAIXO.**

### M5. `UpsertLeaderProfileInput`
Zod infer no spot-api (`spot-api/src/utils/validation.ts:202`) vs interface manual no UI (`lunes-dex-main/src/services/socialService.ts:148`). O schema Zod é a fonte de verdade natural (validação em runtime); exportar `z.infer` via contrato. **Risco: BAIXO.**

---

## 3. Recomendações BAIXA confiança

### B1. `RateLimitOptions`/`RateLimitResult` — spot-api vs lunex-admin
`spot-api/src/utils/redisRateLimit.ts:20,26` vs `lunex-admin/src/lib/rateLimit.ts:17,24`. Shapes diferentes (`limit/key` vs `max`; `retryAfterMs` vs `retryAfterSeconds/resetAtMs`) e implementações independentes (Redis vs lib local do admin). Duplicação de conceito, não de contrato. Só consolidar se nascer um pacote `@lunex/server-utils`; isoladamente não compensa. **Risco: BAIXO, ganho baixo.**

### B2. `ContractApi` — 6 declarações em scripts/ + spot-api
`spot-api/src/services/assetBridgeService.ts:54` + `scripts/{verify-deployment,deploy-lunes,list-token,admin-list-token,deploy-asset-wrappers}.ts`. Interface mínima local imitando `ContractPromise` do `@polkadot/api-contract`. Usar o tipo real do polkadot ou um util compartilhado em scripts/. **Risco: BAIXO.**

### B3. `TokenInfo` (3 declarações no UI/scripts) e `JsonObject` (3 no mcp + 1 no spot-api)
Duplicações utilitárias de baixo impacto. `JsonObject` no mcp poderia ser um único util do pacote. **Risco: BAIXO.**

### B4. `types/shared` — renomear/realocar
Como só contém helpers typechain (consumidos por código gerado), o diretório deveria chamar-se algo como `types/typechain-utils` — ou ser movido para perto dos artefatos gerados — para liberar o nome `types/shared` para um eventual pacote real de contratos. **Não criar dependências novas nele no estado atual.**

### Falsos positivos descartados
- `Props` (10 declarações) — padrão React local por componente; correto como está.
- Tipos Prisma/typechain — gerados, fora de escopo (constraint).
- subquery-node — entidades GraphQL próprias, sem colisão com os demais pacotes.

---

## 4. Estratégia sugerida (ordem de ataque)

1. **A4 primeiro** (type-only no servidor, risco mínimo, trava o contrato).
2. **A1** (workspace + imports type-only no UI para os 16 idênticos — mecânico).
3. **A2/A3/M3** (reconciliar drifts; cada divergência vira decisão explícita: corrigir UI ou corrigir SDK — lembrando que mudanças no SDK público precisam ser aditivas por backward compat).
4. **M1/M5** (renomes de colisões).
5. **B*** oportunisticamente.

## 5. Contagem

- **ALTA: 4 recomendações** (A1–A4), cobrindo 16 tipos idênticos + 6 drifts confirmados + 1 fork vendored.
- **MÉDIA: 5 recomendações** (M1–M5).
- **BAIXA: 4 recomendações** (B1–B4).
