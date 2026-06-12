# Auditoria de Produção — Especialista 3 (Backend)

**Escopo:** `spot-api/`, `sdk/`, `mcp/lunex-agent-mcp/`, `subquery-node/`, types compartilhados
**Data:** 2026-06-11
**Auditor:** Painel de Mainnet-Readiness — Backend

---

## Veredito: APROVADO COM RESSALVAS

O backend está em estado significativamente melhor do que a média de pré-mainnet: finality discipline nos fund paths está implementada e protegida por teste de regressão (`fundFinalityRegression.test.ts`), settlement tem claim otimista idempotente com re-claim de registros SETTLING órfãos, a conversão para plancks usa BigInt a partir de strings (sem float na fronteira on-chain), e a suíte completa passa: **44 suites / 341 testes, 0 falhas (125.5s, rodada nesta auditoria)**.

As ressalvas que impedem aprovação plena: (1) o SDK publicado tem 6 módulos apontando para endpoints que **não existem** no spot-api — qualquer consumidor externo desses módulos recebe 404; (2) todo o caminho monetário interno (matching engine, reconciliação de vault, indexação social) opera em `number`/float IEEE-754 antes de chegar à fronteira BigInt.

Nada aqui é P0 (não encontrei caminho de perda direta de fundos), mas os P1 devem fechar antes do anúncio de mainnet.

---

## Resultado real da suíte de testes

```
cd spot-api && npx jest --silent --ci
Test Suites: 44 passed, 44 total
Tests:       341 passed, 341 total
Time:        125.562 s
Exit code:   0
```

Nota: `PRODUCTION-READINESS.md:28` afirma "323/323 passed (40 suites)" — desatualizado (na direção boa). Item de truth-up da Fase 0.

---

## Achados

### P0 — nenhum

### P1

#### P1-1 — SDK aponta para 6 famílias de endpoints inexistentes no spot-api
**Evidência:**
- SDK chama paths sem prefixo `/api/v1` e sem rota correspondente: `sdk/src/modules/auth.ts` (`/auth/nonce`), `factory.ts` (`/factory/pair|pairs|stats`), `router.ts` (`/router/quote`, `/router/swap-exact-in|out`, `/router/add-liquidity`, `/router/remove-liquidity`), `staking.ts` (`/staking/*` — 8 endpoints), `tokens.ts` (`/tokens/wrap|unwrap`, `/public/tokens|prices|native-assets`), `wnative.ts` (`/wnative/*`).
- Mounts reais do spot-api (`spot-api/src/index.ts:293-314`): apenas `/api/v1/{pairs,orders,trades,candles,orderbook,social,copytrade,margin,affiliate,agents,strategies,execution,trade,asymmetric,route,listing,governance,tokens,user,markets,rewards,admin}`. Não existe `/auth`, `/factory`, `/router`, `/staking`, `/wnative`, `/public`.
- Detalhe: SDK usa `/router/*` enquanto a API monta `/api/v1/route` (singular) — o MCP (`mcp/lunex-agent-mcp/src/routerTools.ts:112`) usa corretamente `/api/v1/route/swap`.

**Impacto:** consumidor externo do SDK (audiência declarada do milestone) recebe 404 em staking, factory, router, wrap/unwrap e auth. A constraint de backwards-compat do CLAUDE.md ("External SDK consumers may already be in the wild") torna isso bloqueante de anúncio.
**Fix:** é exatamente a Fase 3 do roadmap (API/SDK Contract Reconciliation) — esta auditoria **confirma o escopo com evidência**: gerar OpenAPI a partir das rotas montadas, regenerar os 6 módulos do SDK, e adicionar teste de contrato no CI que falhe quando um path do SDK não existir na app Express (é trivial: importar `app`, enumerar paths do SDK, `supertest` esperando != 404).
**Status:** APROVO implementação imediata (não esperar fase formal — o teste de contrato pode entrar hoje).

#### P1-2 — Caminho monetário interno inteiro em float (IEEE-754) antes da fronteira BigInt
**Evidência:**
- `spot-api/src/utils/orderbook.ts:6-12` — `OrderbookEntry.price/amount/remainingAmount: number`; `fillAmount = Math.min(remaining, bestAsk.remainingAmount)` em float.
- `spot-api/src/services/orderService.ts:216,235` — `parseFloat(order.price)`, `executionPrice * parseFloat(order.amount)` (estimativa de quote em float).
- `spot-api/src/services/orderbookBootstrapService.ts:20-22` — rehydrate via `decimalToNumber` (Decimal → float → book).
- `spot-api/src/services/socialIndexerService.ts:588-793,1130-1234` — `Number(payload.amount_*)`, `parseFloat(...)/1e12` em valores de equity/PnL.
- Contraste: a fronteira on-chain está correta — `settlementService.ts:110-112` e `rewardPayoutService.ts:52-63` parseiam string decimal → BigInt sem passar por float.

**Impacto:** fills tipo 0.1+0.2 produzem dust drift entre o book em memória e as colunas `Decimal` do Postgres; a reconciliação de vault usa threshold de 0.01 (`vaultReconciliationService.ts:23`) justamente para mascarar esse ruído. Em pares com preços muito pequenos ou amounts grandes, o erro relativo cresce. Não é perda direta de fundos (o settle final re-deriva de strings), mas é fonte sistêmica de discrepâncias contábeis.
**Fix concreto (incremental, sem reescrever o engine):**
1. Quantizar o book em ticks/lots inteiros: armazenar `priceTicks: bigint`/`amountLots: bigint` por par (tickSize/lotSize já caberiam em `Pair`); matching em inteiros, conversão para Decimal só na borda HTTP.
2. Curto prazo (antes da mainnet): após cada match, re-quantizar `fillAmount` com `toFixed(decimals do par)` antes de persistir, e adicionar asserção de invariante (`sum(fills) <= amount`) no `tradeService`.
**Status:** APROVO o item 2 para implementação imediata; item 1 vira fase própria.

### P2

#### P2-1 — Shutdown gracioso incompleto
**Evidência:** `spot-api/src/index.ts:453-473` — `shutdown()` para `rewardScheduler`, `vaultReconciliationService` e `copytradeWalletContinuationScheduler`, mas:
- não chama `socialAnalyticsPipeline.stop()` (o método existe: `socialAnalyticsPipeline.ts:48`);
- não limpa os dois `setInterval` anônimos de `index.ts:416` (retry de settlement) e `index.ts:434` (strategy sync);
- não fecha o WebSocketServer criado em `index.ts:450` (`createWebSocketServer` retorna `wss`, mas o retorno é descartado);
- `httpServer.close()` não é aguardado e `process.exit(0)` dispara imediatamente — um ciclo de settlement em voo morre no meio (tx já transmitida, resultado não aplicado → trade fica `SETTLING` até o re-claim stale; a idempotência por nonce do contrato evita double-spend, mas gera gas desperdiçado e janela de estado inconsistente).

**Fix:** capturar `const wss = createWebSocketServer(...)` e os handles dos intervals; em `shutdown()`: parar intervals → `wss.close()` → aguardar `tradeSettlementService` drenar ciclo em andamento (flag `running` + await) → `await new Promise(r => httpServer.close(r))` → disconnects → `exit(0)`. PM2 envia SIGINT com kill_timeout; hoje o exit imediato anula o benefício.
**Status:** APROVO implementação imediata (mudança pequena e contida em `index.ts`).

#### P2-2 — Reconciliação de vault: auto-repair silencioso, em float, com fallback que não olha a chain
**Evidência:** `spot-api/src/services/vaultReconciliationService.ts:1-23` — `DRIFT_THRESHOLD = 0.01` (float), pipeline soma depósitos/saques/PnL como `number`; o próprio header documenta que sem ABI on-chain o serviço "falls back to pure DB-side consistency checks" — ou seja, em produção sem ABI ele reconcilia o DB contra o próprio DB e ainda assim **repara** `totalEquity` automaticamente.
**Impacto:** um bug no journaling de `realizedPnlPct` (`copyTradeSignal`) vira "verdade" — o repair propaga o erro para `totalEquity` sem intervenção humana.
**Fix:** (1) repair automático só até um teto (ex.: drift < 0.1% do equity); acima disso, marcar vault como `RECONCILIATION_HOLD` + alerta Prometheus (já existe prom-client); (2) quando ABI indisponível, **não reparar** — apenas reportar; (3) migrar a aritmética para `Prisma.Decimal`/decimal.js.
**Status:** APROVO (1) e (2) para implementação imediata.

#### P2-3 — Disponibilidade acoplada à chain no boot
**Evidência:** `spot-api/src/index.ts:404-405` — `await settlementService.ensureReady()` e `rebalancerService.ensureReady()` antes de `app.listen` (`:439`); `settlementService.ts:215-217` cria `WsProvider` + `await ApiPromise.create` + `await api.isReady`. Se o nó Lunes estiver fora no deploy, o processo trava no boot (WsProvider retenta para sempre) e a API inteira — incluindo rotas read-only que não dependem da chain — fica fora do ar. PM2 com 1 instância e sem timeout de boot agrava.
**Fix:** timeout no `ensureReady` (ex.: 30s) → seguir para `app.listen` em modo degradado com `settlementService.isEnabled() = false` temporário + `/health` reportando `chain: down` (Prometheus alerta); reconectar em background.
**Status:** APROVO para implementação imediata.

#### P2-4 — WS: `authenticated` é código morto e identificação por IP é forjável
**Evidência:** `spot-api/src/websocket/server.ts:118` — todo client nasce `authenticated: false` e **nenhum** caminho seta `true` (grep completo no arquivo); a constante `AUTHENTICATED_ORDERBOOK_DEPTH` (`:16`) e o branch em `:188` são inalcançáveis. Além disso, `getIp()` (`:57-60`) confia em `x-forwarded-for` sem validação de proxy confiável — o WS escuta em porta própria (4001); se exposto diretamente, o limite `MAX_CLIENTS_PER_IP=20` é trivialmente contornável forjando o header.
**Fix:** ou implementar a action `auth` (assinatura sr25519 igual ao fluxo REST) ou remover o campo e as constantes mortas; usar `req.socket.remoteAddress` a menos que `TRUST_PROXY=true` explícito.
**Status:** APROVO remoção do código morto + fix do IP imediatamente; auth via WS pode esperar.

#### P2-5 — Drift entre os dois schemas Prisma segue real e crescendo
**Evidência:** `diff` dos `model` entre `spot-api/prisma/schema.prisma` (45 models, 92 índices) e `lunex-admin/prisma/schema.prisma` (31 models): admin não conhece `AgentApiKey`, `AsymmetricStrategy`, `AsymmetricRebalanceLog`, `CopyTradeWalletContinuation`, `ExecutionLog`, `Favorite`, `GovernanceVote`, `LeaderAnalyticsSnapshot`, `LiquidityLock`, `SocialAnalyticsCursor`, `SocialIndexedEvent`, `Strategy*` (3), `TokenListing`, `TokenRegistry`; e tem `AdminUser`/`AdminAuditLog` exclusivos. Ambos apontam para o mesmo Postgres — uma `prisma migrate` rodada do lado errado pode dropar tabelas que só o outro schema conhece.
**Nota:** anti-pattern já reconhecido no CLAUDE.md e endereçado na Fase 6 (dedupe Prisma migrate). Não re-reporto como novo; registro que o gap **aumentou** (16 models de distância) e que o guard mínimo — admin nunca rodar `migrate deploy`, só `db pull`/client — deveria entrar antes da Fase 6.
**Status:** APROVO o guard mínimo (CI check: admin não contém diretório `migrations/` ativo ou script de migrate) imediatamente.

### P3

#### P3-1 — SubQuery: todos os handlers escutam todo `contracts.ContractEmitted` sem filtro
**Evidência:** `subquery-node/project.template.yaml` — ~15 handlers, todos com `filter: {module: contracts, method: ContractEmitted}` e discriminação por address/selector em runtime (documentado no comentário do arquivo). Cada evento de contrato na chain invoca todos os handlers.
**Impacto:** lag de indexação cresce linearmente com atividade de contratos de terceiros na chain. Finality está OK: sem `--unfinalized-blocks`, o @subql/node indexa apenas blocos finalizados (default seguro — consistente com a disciplina da Fase 1).
**Fix:** quando o @subql/node suportar filtro por contract address para ink! (specVersion atual já aceita `filter.contractAddress` em datasources wasm), migrar para datasource `substrate/Wasm` com address por contrato. Não-bloqueante.

#### P3-2 — Validação zod ausente em 4 routers (todos GET/admin, risco baixo)
**Evidência:** `routes/pairs.ts` (7 rotas, 0 refs zod — o `POST /register` em `:108` tem `requireAdmin` + validação manual, mas sem range check de `makerFeeBps`/`takerFeeBps`/`decimals`: admin pode registrar fee negativa), `routes/orderbook.ts` (validação manual ok), `routes/marketInfo.ts`, `routes/candles.ts`.
**Fix:** schema zod para o body do `POST /pairs/register` com `int().min(0).max(10_000)` nos bps e `int().min(0).max(18)` nos decimals. Resto é cosmético.
**Status:** APROVO o schema do `/register` imediatamente.

#### P3-3 — `PRODUCTION-READINESS.md` com contagem de testes desatualizada
**Evidência:** `:28` diz "323/323 (40 suites)"; real medido: 341/341 (44 suites). Atualizar no truth-up da Fase 0.

#### P3-4 — `copytradeWalletContinuationScheduler.runSweep` sem guard de overlap
**Evidência:** `services/copytradeWalletContinuationScheduler.ts:19-23,34` — sem flag `running` (contraste: `vaultReconciliationService.ts:70-73` e `socialAnalyticsPipeline.ts:15` têm). O sweep é um expire idempotente (updateMany por cutoff), então overlap é inócuo hoje — mas é inconsistência de padrão que vira bug se o sweep ganhar side effects.
**Fix:** copiar o guard `running` dos vizinhos (3 linhas).

#### P3-5 — Maps em memória do `botSandbox` sem eviction de agentes inativos
**Evidência:** `services/botSandbox.ts:51-71,119` — `hourBuckets`, `minuteBuckets`, `crossAgentRegistry`, `pendingLargeOrders`, `recentTrades` keyed por agentId/par. Entradas internas são filtradas por janela de tempo na leitura (`:132,147,160`), mas as **chaves** de agentes que pararam de operar nunca são removidas. Bounded pelo nº de agentes registrados — crescimento lento, não é leak agudo no fork de 512MB, mas em meses acumula.
**Fix:** sweep periódico removendo chaves cujo conteúdo filtrado é vazio, ou trocar por Redis com TTL (padrão já existente em `redisRateLimit.ts`).

---

## O que está bem feito (registrado para o painel)

- **Finality discipline:** `fundFinalityRegression.test.ts` faz grep dos sources e falha se `isInBlock` reaparecer em fund path — exatamente o lock de regressão que a Fase 1 pede; `finalizedTx.test.ts` cobre o utilitário.
- **Settlement idempotente:** claim otimista via `updateMany` condicionado a `PENDING/FAILED/SETTLING-stale` (`tradeSettlementService.ts:109-140`) + resultados aplicados em `$transaction` (`:172`) + recovery no boot (`index.ts:407`). Desenho correto para crash-recovery.
- **Fronteira BigInt limpa:** `settlementService.ts:110-112,163-166` e `rewardPayoutService.ts:52-63` nunca passam valores on-chain por float; clamp de u64 explícito.
- **Matching lock:** Redis lock com token + Lua para release/extend e fila local serializada por par (`matchingLockService.ts`) — correto para o modelo single-process e já preparado para multi-process.
- **WS server:** limites de payload/conexões/subscriptions, whitelist de canais, heartbeat com terminate — acima da média.
- **SDK http-client:** retry com backoff exponencial + jitter + respeito a `Retry-After` (`http-client.ts`) — bom; o problema do SDK é contrato, não transporte.
- **Idempotência do reward scheduler:** janela horária + `rewardWeek.findUnique` + lock distribuído Redis (per PRODUCTION-READINESS) — tripla proteção.

## Melhorias que APROVO para implementação imediata

| # | Item | Esforço |
|---|------|---------|
| 1 | Teste de contrato SDK↔API no CI (falha em 404) — P1-1 | ~2h |
| 2 | Quantização pós-match + invariante de fills — P1-2 (curto prazo) | ~3h |
| 3 | Shutdown completo em `index.ts` — P2-1 | ~1h |
| 4 | Reconciliação: teto de repair + sem repair em fallback DB-only + alerta — P2-2 | ~2h |
| 5 | Boot degradado com timeout no `ensureReady` — P2-3 | ~2h |
| 6 | WS: remover `authenticated` morto + IP confiável — P2-4 | ~1h |
| 7 | CI guard contra migrate no lunex-admin — P2-5 | ~1h |
| 8 | Zod no `POST /pairs/register` — P3-2 | ~30min |
| 9 | Guard `running` no continuation scheduler — P3-4 | ~15min |

---

## Contagem por severidade

| Severidade | Qtde |
|------------|------|
| P0 | 0 |
| P1 | 2 |
| P2 | 5 |
| P3 | 5 |

**Veredito final: APROVADO COM RESSALVAS** — condicionado ao fechamento dos 2 P1 (e idealmente P2-1/P2-2/P2-3) antes do anúncio de mainnet.
