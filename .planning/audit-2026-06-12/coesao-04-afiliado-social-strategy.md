# Coesão 04 — Afiliado + Social + Strategy Marketplace

**Validador:** 4/6 (somente leitura)
**Data:** 2026-06-12
**Fluxo:** Camada de crescimento/social conectada ao trading (afiliado, feed social, reputação de estratégia, copy-trade).

---

## VEREDITO

**TESE: PARCIAL (com 1 quebra material na cláusula de afiliado e 2 bugs latentes de integridade de dados).**

A tese tem três cláusulas. Avaliação por cláusula:

| # | Cláusula | Status | Razão |
|---|----------|--------|-------|
| A | "Comissões de afiliado são creditadas por trade real e pagas em lote corretamente" | **REFUTADA (timing) / PARCIAL (lote)** | Comissão creditada no trade **PENDING** (casado), antes da settlement on-chain confirmar. Lote tem race de idempotência. |
| B | "Feed social e reputação refletem dados reais de trading (não fabricados)" | **PARCIAL** | Caminho do indexer é real; mas há fallback para colunas denormalizadas do `Leader` (potencialmente seedadas) e bug que impede persistência de métricas no `Agent`. |
| C | "Marketplace conecta leaders ao copy-trade de forma coerente" | **VALIDADA (com drift)** | Fonte de verdade única = `LeaderAnalyticsSnapshot`. Drift por sync on-demand, não automático. |

---

## CADEIA DE HANDOFFS

```
[contrato/chain] → socialIndexerService → SocialIndexedEvent (sem @@unique!)
                                              ↓
                   socialAnalyticsService.recomputeLeaderAnalytics()
                        ├→ LeaderAnalyticsSnapshot  (FONTE DE VERDADE — real)
                        ├→ Leader.{roi30d,sharpe,winRate,...} (denormalizado — fallback)
                        └→ Agent.{roi,sharpe,maxDrawdown}  ✗ BUG: campos inexistentes
                                              ↓
              socialService (feed/leaders) ──┘   strategyService.syncPerformanceFromLeader (on-demand)
                                                       ↓
                                                  Strategy.reputationScore / Agent.reputationScore

[trade casado] tradeService.executeTrade → trade.create(settlementStatus:PENDING)
                        ↓ (mesma função, imediatamente)
              affiliateService.distributeCommissions(fee, trade.id)  ← ANTES da settlement
                        ↓
              AffiliateCommission(isPaid:false)
                        ↓ (cron 7d)
              affiliateService.processPayoutBatch → isPaid:true
              ↑ tradeSettlementService.processNewTradeSettlements (ASSÍNCRONO, pode → FAILED)
```

---

## ACHADOS POR PERGUNTA

### 1. Comissão de afiliado: trade settled ou só casado? Lote idempotente?

**Creditada no trade CASADO (PENDING), NÃO no settled. QUEBRA MATERIAL.**

- `tradeService.ts:147` — trade criado com `settlementStatus: 'PENDING'`.
- `tradeService.ts:212-222` — `tradeSettlementService.processNewTradeSettlements()` é **agendado** (assíncrono; comentário explícito "trades remain retryable").
- `tradeService.ts:225-251` — **imediatamente depois, no mesmo `executeTrade`**, chama `affiliateService.distributeCommissions(takerFee/makerFee, trade.id)`.
- A settlement on-chain roda depois e pode terminar `FAILED` (`tradeSettlementService.ts:174+` distingue SETTLED/SKIPPED/FAILED).
- **Não há nenhum caminho que estorne / cancele a `AffiliateCommission` se a settlement falhar.** A comissão fica `isPaid:false` e será paga no próximo `processPayoutBatch`.
- **Consequência:** comissões geradas sobre fees de trades que nunca liquidaram on-chain. A cláusula "por trade real [finalizado]" é falsa — é "por trade casado".
- Copy-trade (`copytradeService.ts:1112-1119`) é mais coerente: a comissão sai do *performance fee* já cobrado após `onChainConfirmation`. (`sourceType: COPYTRADE`).

**Idempotência do lote — PARCIAL:**
- `affiliateService.ts:326-387` `processPayoutBatch`: cria `AffiliatePayoutBatch(status:PROCESSING)`, lê `findMany({isPaid:false, createdAt:{lte:periodEnd}})`, marca `isPaid:true, batchId` num `$transaction`.
- **Race:** a seleção dos `unpaid` e a criação do batch **não estão na mesma transação** e não há lock. Duas execuções concorrentes do cron (ou retry após timeout) selecionam o mesmo conjunto `isPaid:false` e criam **dois batches pagando as mesmas comissões**. Não há `@@unique` de período em `AffiliatePayoutBatch` nem guard de "batch PROCESSING já existe".
- A marcação `isPaid:true` é atômica por comissão, mas isso só protege contra a *segunda passada ler o mesmo registro depois* — não contra duas passadas **simultâneas**.
- `AffiliateCommission` não tem `@@unique` em `(sourceTradeId, beneficiaryAddr, level)` → se `distributeCommissions` for chamado duas vezes para o mesmo trade (ex.: retry de `executeTrade`), gera comissões duplicadas.

### 2. Métricas sociais/estratégia são reais e finalizadas? Onde há números fabricados?

**Caminho primário é REAL; há dois vetores de fabricação/inconsistência.**

- **Real (bom):** `socialAnalyticsService.ts:239-289` deriva `roi30d/roi90d/sharpe/winRate/maxDrawdown/realizedPnl/tradedVolume` de `SocialIndexedEvent` reais (`buildEquityPoints`, `computeTradePnls`, `getSequentialReturns`) e grava em `LeaderAnalyticsSnapshot` (`sourceMode: 'INDEXER'`).
- **Vetor 1 — fallback para colunas denormalizadas do Leader:** `socialService.ts:172-192` — quando **não existe snapshot**, retorna `leader.roi30d / leader.sharpe / leader.winRate / leader.pnlHistory`. Esses campos do modelo `Leader` (schema l.~395-410) têm `@default(0)` e podem ter sido **seedados** com valores fictícios. O feed exibe esses valores como reais sem marcador de origem → **números potencialmente fabricados exibidos como reais**. (Confirma a tese de risco do achado da sessão.)
- **Vetor 2 — bug Agent (CONFIRMADO LATENTE + reachable):** `socialAnalyticsService.ts:368-373` faz `db.agent.update({ data: { roi, sharpe, maxDrawdown, ... }})`. O modelo `Agent` (schema l.814-853) **não possui** `roi`, `sharpe` nem `maxDrawdown` — só `reputationScore`, `totalTrades`, `totalVolume`, `lastActiveAt`. O `const db = prisma as any` (l.47) **suprime o typecheck**, então compila e roda; Prisma lança `Unknown argument 'roi'` em runtime. O erro é engolido pelo `catch {}` (l.380, "best-effort"). **Resultado:** `Agent` nunca recebe métricas; `totalTrades/totalVolume/lastActiveAt` (que *existem*) também nunca persistem porque a `update` inteira falha antes de aplicar. TODO em l.44-46 documenta. Não derruba o pipeline, mas as métricas do Agent ficam permanentemente em `@default(0)`.

### 3. strategyService (reputação) e copy-trade concordam sobre leader e performance?

**Concordam na FONTE; há drift temporal.**

- `strategyService.ts:376-426` `syncPerformanceFromLeader`: lê `LeaderAnalyticsSnapshot` (mesma fonte de verdade do feed social) via `leaderId_sourceChain`, e computa `reputationScore` com pesos `roi30d 0.35 / sharpe 0.25 / winRate 0.2 / drawdownInverse 0.1` (l.50-86). Boa coerência — não inventa números.
- **Drift:** o sync é **on-demand** (chamado por `syncPerformanceFromLeader(strategyId)`), não disparado automaticamente quando o snapshot é recomputado. Então `Strategy.reputationScore` / `Agent.reputationScore` podem ficar atrás do `LeaderAnalyticsSnapshot` por tempo indefinido. O feed (socialService) lê o snapshot fresco; o marketplace lê o `reputationScore` cacheado → **dois consumidores, defasagem possível** entre o que o feed mostra e o ranking do marketplace.
- Quem é "leader": ambos resolvem por `Leader.id` / `strategy.leaderId` → consistente. `Strategy` exige `leaderId` válido na criação (`strategyService.ts:101-105`).

### 4. socialAnalyticsPipeline: backfill/indexer consistente com finality? Reprocessa ou duplica?

**DUPLICA. Sem finality buffer. Risco de double-count.**

- `socialAnalyticsPipeline.ts:14-42` é orquestrador fino: `runOnce` = `socialIndexerService.syncOnce()` → `socialAnalyticsService.recompute()`. Guard `this.running` evita concorrência **na mesma instância** (não entre processos).
- **Sem dedup no indexer:** `socialIndexerService.ts` persiste com **`db.socialIndexedEvent.create()`** puro (l.1036 caminho live; l.1119/1170/1219 caminho SubQuery backfill) — **não** `upsert` nem `createMany({skipDuplicates})`.
- **`SocialIndexedEvent` não tem `@@unique`** (schema confirmado: só `@@index([asOfBlock])` etc. no snapshot; o evento não tem chave natural única tipo `(chain, blockNumber, eventIndex)`).
- **Consequência:** se o range de blocos for reprocessado — live indexer re-scaneando após restart, **ou o backfill SubQuery sobrepondo o range já indexado pelo live** (os dois caminhos escrevem na mesma tabela; backfill usa `blockHash: null`, l.93 comentário) — os mesmos eventos são **inseridos de novo**. `computeTradePnls`/`tradedVolume` então **double-count** PnL e volume → roi/sharpe/winRate inflados.
- **Sem finality:** `processBlock` indexa até `endBlock` (head da cadeia) sem profundidade de confirmação. Reorg invalida blocos já indexados, sem caminho de remoção/correção. Comentário de finality existe em `settlementService.ts:527` (settlement respeita finality), mas o **indexer social não**.

### 5. Coerência de tipos leader/agent/strategy entre subsistemas

- **Drift conhecido AgentProfile UI↔API:** o backend nunca persiste `roi/sharpe/maxDrawdown` no `Agent` (achado #2). O frontend BotRegistry (fix de hoje: `roi/sharpe/maxDrawdown` → `null`→"—") está **correto em exibir "—"**, porque o backend de fato nunca popula esses campos. O fix de UI mascara o bug de backend em vez de corrigi-lo — a UI agora é honesta, mas o dado continua ausente na origem.
- `Leader` ↔ `LeaderAnalyticsSnapshot`: dois lugares guardam as mesmas métricas (`Leader.roi30d` denormalizado vs `snapshot.roi30d`). socialService prefere snapshot mas faz fallback ao Leader → dois tipos de verdade para o mesmo campo.
- `Strategy`/`Agent`/`Leader`: ligados por FK (`Strategy.leaderId`, `Agent.leaderId @unique`, `Agent.strategies[]`). Estrutura coerente; o problema é de *frescor*, não de tipo.

---

## TABELA DE LACUNAS

| Sev | Lacuna | Local | Impacto |
|-----|--------|-------|---------|
| **ALTA** | Comissão creditada no trade PENDING, sem estorno se settlement falhar | tradeService.ts:225-251 + tradeSettlementService.ts:174 | Comissões pagas sobre trades não liquidados |
| **ALTA** | `SocialIndexedEvent` sem `@@unique` + `create()` puro → duplicação | socialIndexerService.ts:1036/1119/1170/1219; schema SocialIndexedEvent | Double-count de PnL/volume → métricas infladas |
| **ALTA** | `processPayoutBatch` sem lock/transação englobando seleção+batch | affiliateService.ts:326-340 | Pagamento duplo em execução concorrente do cron |
| **MÉDIA** | `db.agent.update` escreve campos inexistentes (roi/sharpe/maxDrawdown), engolido por catch | socialAnalyticsService.ts:368-373 | Métricas do Agent nunca persistem (silencioso) |
| **MÉDIA** | Indexer social sem finality/confirmation depth | socialIndexerService.ts:925-943 | Reorg corrompe métricas, sem correção |
| **MÉDIA** | Fallback para `Leader.*` denormalizado (possivelmente seedado) exibido como real | socialService.ts:172-192 | Feed mostra números fabricados sem marcador |
| **BAIXA** | `reputationScore` sincronizado on-demand → drift vs snapshot | strategyService.ts:376 | Marketplace defasado do feed |
| **BAIXA** | `AffiliateCommission` sem `@@unique(sourceTradeId,beneficiaryAddr,level)` | schema + distributeCommissions | Comissão duplicada em retry de executeTrade |

---

## ARQUIVOS EXAMINADOS

- `spot-api/src/services/affiliateService.ts` (389 linhas, completo)
- `spot-api/src/services/tradeService.ts` (l.120-260)
- `spot-api/src/services/tradeSettlementService.ts` (l.160-290)
- `spot-api/src/services/copytradeService.ts` (l.1085-1125)
- `spot-api/src/services/socialAnalyticsService.ts` (l.40-55, 230-385)
- `spot-api/src/services/socialService.ts` (l.40-356)
- `spot-api/src/services/socialIndexerService.ts` (l.90-1225)
- `spot-api/src/services/socialAnalyticsPipeline.ts` (completo)
- `spot-api/src/services/strategyService.ts` (l.17-426)
- `spot-api/prisma/schema.prisma` (models Leader, LeaderTrade, LeaderFollow, LeaderAnalyticsSnapshot, SocialIndexedEvent, AffiliateCommission, AffiliatePayoutBatch, Agent, Referral)
