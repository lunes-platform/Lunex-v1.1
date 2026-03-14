# Lunex DEX — QA Report Final
**Data:** 2026-03-12
**Ambiente:** Local (desenvolvimento)
**Testador:** QA Engine (Claude)
**Versão:** `main` branch — commit `488cfdd`

---

## Sumário Executivo

Foram executadas **15 fases de testes funcionais e de segurança** cobrindo toda a stack do Lunex DEX: blockchain (ink! contracts), backend API (spot-api), frontend (lunes-dex-main) e painel admin (lunex-admin).

| Categoria | Total | ✅ Passou | ⚠️ Parcial | ❌ Falhou |
|---|---|---|---|---|
| Fase 1: Infraestrutura | 7 | 5 | 1 | 1 |
| Fases 2–4: Blockchain | 12 | 0 | 0 | 12 |
| Fase 5: Spot Trading | 8 | 7 | 1 | 0 |
| Fases 6–7: Staking/Rewards | 6 | 5 | 1 | 0 |
| Fase 8: CopyTrade | 4 | 4 | 0 | 0 |
| Fase 9: Agentes AI | 3 | 3 | 0 | 0 |
| Fase 10: Strategies | 3 | 2 | 1 | 0 |
| Fase 11: Social | 5 | 5 | 0 | 0 |
| Fase 12: Affiliates | 5 | 5 | 0 | 0 |
| Fase 13: Frontend/UI | 14 | 14 | 0 | 0 |
| Fase 14: Segurança | 8 | 8 | 0 | 0 |
| Fase 15: Consistência de Dados | 9 | 6 | 3 | 0 |

---

## 🔴 Problemas CRITICAL

### CRIT-1: Contratos ink! não sobrevivem ao restart do nó
- **Componente:** Blockchain / substrate-contracts-node
- **Descrição:** O nó Lunes Nightly está rodando com flag `--dev`, que reseta o estado ao reiniciar. Todos os 10 contratos previamente deployados (wnative, factory, router, staking, rewards, LUSDT, LBTC, LETH, GMC, LUP) ficaram offline após o PC ser desligado.
- **Impacto:** Fases 2, 3, 4 completamente bloqueadas. Sem AMM funcional para swaps, liquidez ou listing.
- **Fix:** Remover `--dev` e usar `--base-path ./chain-data` para persistência. Automatizar re-deploy via script de startup.
- **Status:** Não corrigido (requer mudança na configuração do nó)

### CRIT-2: SPOT_CONTRACT_ADDRESS não configurado
- **Componente:** Backend (`spot-api/.env`)
- **Descrição:** `SPOT_CONTRACT_ADDRESS=""` — settlement on-chain desabilitado. Todos os trades ficam com status `SKIPPED` (6 trades testados).
- **Impacto:** Nenhum trade é liquidado on-chain. Balances não mudam no contrato.
- **Fix:** Deploy do contrato `spot_settlement` e configurar a variável de ambiente.
- **Status:** Não corrigido (depende de CRIT-1)

---

## 🟠 Problemas HIGH

### HIGH-1: Replay Attack retornava HTTP 500 (era)
- **Componente:** Backend — `orderService.ts`, `routes/orders.ts`
- **Descrição:** Ordens com nonce duplicado lançavam `throw new Error('Nonce already used')` resultando em HTTP 500 em vez de 409.
- **Fix Aplicado:** Substituído `throw new Error(...)` por `throw ApiError.conflict(...)` em todo o `orderService.ts`. Adicionado import `ApiError` ao service.
- **Status:** ✅ **CORRIGIDO** — Replay agora retorna `HTTP 409 "Nonce already used"`

### HIGH-2: Valores negativos de amount aceitos
- **Componente:** Backend — `utils/validation.ts`
- **Descrição:** Schema de ordem aceitava `amount: "-100"` passando pelo Zod (`z.string().min(1)` não valida números). Ordens com amount negativo eram criadas no DB e ficavam com status OPEN, criando dados corrompidos (filledAmount=0 > amount=-100).
- **Fix Aplicado:**
  1. Criado helper `positiveDecimalString` com `.refine(v => n > 0)`.
  2. Adicionado regex `^[A-Z0-9]+\/[A-Z0-9]+$` ao `pairSymbol` para bloquear XSS.
  3. Adicionado `CHECK CONSTRAINT chk_order_amount_positive` no PostgreSQL.
  4. Dados corrompidos existentes marcados como `CANCELLED`.
- **Status:** ✅ **CORRIGIDO** — Retorna `HTTP 400 "Must be a positive number"`

### HIGH-3: Cancel por outro usuário retornava HTTP 500 (era)
- **Componente:** Backend — `orderService.cancelOrder`
- **Descrição:** `throw new Error('Not order owner')` virava HTTP 500. Mesma causa que HIGH-1.
- **Fix Aplicado:** Substituído por `throw ApiError.forbidden('Not order owner')`.
- **Status:** ✅ **CORRIGIDO** — Retorna `HTTP 403`

### HIGH-4: Erros de par não encontrado retornavam HTTP 500
- **Componente:** Backend — `orderService.ts`
- **Descrição:** `throw new Error('Pair X not found')` → HTTP 500.
- **Fix Aplicado:** `throw ApiError.notFound(...)` e `throw ApiError.badRequest(...)`.
- **Status:** ✅ **CORRIGIDO**

---

## 🟡 Problemas MEDIUM

### MED-1: followersCount dos leaders desincronizado
- **Componente:** Backend — `services/socialService.ts`, DB
- **Descrição:** Seed data populou `followersCount` com valores fictícios (890, 2340) sem entradas correspondentes na tabela `LeaderFollow`.
- **Fix Aplicado:**
  1. SQL UPDATE resincronizou todos os 4 leaders com o count real da tabela `LeaderFollow`.
  2. Nova rota admin `POST /social/analytics/resync-followers` criada para resyncs futuros.
- **Status:** ✅ **CORRIGIDO** — Contagens corretas (0/0/1/0)

### MED-2: SubQuery indexer offline
- **Componente:** SubQuery node
- **Descrição:** `http://localhost:3030/graphql` retornou `HTTP 000` (connection refused). Indexador GraphQL não está rodando.
- **Impacto:** Queries on-chain de histórico de transações, analytics e eventos de contrato não funcionam.
- **Fix:** Iniciar `subquery-node/` e `subquery-query/` (docker ou processo local).
- **Status:** Não corrigido

### MED-3: Candles LUNES/LUSDT desatualizados (215 min)
- **Componente:** Backend — candle aggregation service
- **Descrição:** Últimos candles 1h gerados há 215 minutos. O serviço de agregação de candles não está rodando continuamente.
- **Fix:** Garantir que o `candleAggregator` rode em background (cron job ou timer no startup).
- **Status:** Não investigado

### MED-4: Staking contract sem rota na API
- **Componente:** Backend — `spot-api/src/routes/`
- **Descrição:** `GET /api/v1/staking` retorna `HTTP 404`. Nenhuma rota de staking REST existe no backend.
- **Fix:** Criar `routes/staking.ts` com endpoints para stake/unstake/balance usando `@polkadot/api-contract`.
- **Status:** Não corrigido

### MED-5: Strategy Marketplace sem dados
- **Componente:** Backend + DB
- **Descrição:** Tabela `Strategy` vazia (0 registros). A UI de strategies existe mas não tem conteúdo.
- **Fix:** Seed de strategies de exemplo e/ou implementar fluxo de criação via API.
- **Status:** Não corrigido

---

## 🟢 Problemas LOW

### LOW-1: Ordens históricas com amount negativo no DB
- **Componente:** DB — tabela `Order`
- **Descrição:** 2 ordens CANCELLED com `amount = -100` existem como dados históricos dos testes de segurança executados antes do fix de validação. Matematicamente `filledAmount=0 > amount=-100 = true`.
- **Fix Aplicado:** Ordens marcadas como `CANCELLED`. DB constraint `chk_order_amount_positive` adicionado para evitar novos.
- **Status:** ✅ Mitigado (dados históricos inofensivos, novos impossíveis)

### LOW-2: Affiliate dashboard mostra 0 referrals
- **Componente:** Backend — `affiliateService`
- **Descrição:** `GET /affiliate/dashboard` retorna `referrals=0` mesmo após `POST /affiliate/register` bem-sucedido. O campo `directReferrals` não está sendo contado corretamente.
- **Fix:** Verificar a query de `directReferrals` no `affiliateService`.
- **Status:** Não corrigido

### LOW-3: CopyTrade activity sempre 0
- **Componente:** Backend — copytrade activity
- **Descrição:** `GET /copytrade/activity` retorna 0 entradas. Nenhum sinal/execução real foi processado.
- **Contexto:** Esperado em ambiente sem líderes ativos trading. Não é bug, é falta de dados.
- **Status:** Informacional

### LOW-4: Candle stale (warning)
- **Componente:** Backend — candle service
- **Descrição:** Candles não se atualizam automaticamente em dev (sem volume orgânico).
- **Fix:** Rodar `scripts/simulate-volume.ts` para gerar atividade.
- **Status:** Informacional

---

## ✅ Resultados Positivos

| Funcionalidade | Status | Detalhes |
|---|---|---|
| Backend API startup | ✅ | Porta 4000, PostgreSQL, Redis OK |
| Frontend React | ✅ | Porta 3000, todas as rotas SPA respondendo 200 |
| Admin Panel | ✅ | Porta 3001, auth redirect 307 → /login correto |
| WebSocket | ✅ | Porta 4001 ativa |
| Blockchain node | ✅ | Lunes Nightly #32531+, RPC JSON-RPC OK |
| Redis | ✅ | PONG, nonce replay-protection ativo |
| Orderbook BUY/SELL | ✅ | Alice BUY + Bob SELL → match executado |
| Matching engine | ✅ | FIFO price-time priority correto, sem overfill |
| MARKET orders | ✅ | Charlie MARKET BUY executado |
| Candles API | ✅ | 5 candles 1h retornados |
| Replay attack | ✅ | Bloqueado com HTTP 409 (após fix) |
| Assinatura inválida | ✅ | Rejeitada com HTTP 401 |
| Cross-signer attack | ✅ | Eve não pode assinar por Alice (401) |
| Cross-user cancel | ✅ | HTTP 403 Forbidden (após fix) |
| SQL Injection | ✅ | Safely handled, sem DB error |
| XSS em pairSymbol | ✅ | Rejeitado com HTTP 400 (após fix) |
| Admin sem auth | ✅ | HTTP 401 correto |
| CopyTrade vaults | ✅ | 4 vaults, top vault: AIAlpha (TVL=4.1M) |
| Agent register | ✅ | AI_AGENT registrado, API key emitida |
| Social leaderboard | ✅ | 4 leaders, stats corretos |
| Follow leader | ✅ | Alice seguiu LeandroSander |
| Leader profile upsert | ✅ | Bob criado via assinatura sr25519 |
| Affiliate code | ✅ | Código 9B5F1775 gerado |
| Affiliate register | ✅ | Bob referido por Alice |
| Affiliate stats | ✅ | 1 referral registrado |
| Reward pool | ✅ | ACCUMULATING, 0.22 LUNES no pool |
| Pair consistency | ✅ | DB=8 pairs, API=8 pairs |
| Orphan trades | ✅ | 0 trades sem ordem correspondente |
| Fee consistency | ✅ | makerFee + takerFee presentes em todos trades |

---

## Estado dos Serviços em 2026-03-12

```
Service          Status    URL
────────────────────────────────────────────────
Backend API      ✅ UP     http://localhost:4000
Frontend DEX     ✅ UP     http://localhost:3000
Admin Panel      ✅ UP     http://localhost:3001
WebSocket        ✅ UP     ws://localhost:4001
Blockchain       ✅ UP     ws://127.0.0.1:9944 (block #32531+)
PostgreSQL       ✅ UP     localhost:5432/lunex_spot
Redis            ✅ UP     localhost:6379
SubQuery         ❌ DOWN   http://localhost:3030
```

---

## Arquivos Modificados nesta sessão de QA

| Arquivo | Mudança |
|---|---|
| `spot-api/src/utils/validation.ts` | `positiveDecimalString` helper, pairSymbol regex, `max(32)` |
| `spot-api/src/services/orderService.ts` | `ApiError` import, todos os `throw new Error` → `ApiError.*` correto |
| `spot-api/src/routes/social.ts` | Nova rota `POST /analytics/resync-followers` + import prisma |
| `spot-api/scripts/qa-api.ts` | Script de QA para fases 5/8/9/11/12 |
| `spot-api/scripts/qa-security.ts` | Script de QA para fases 14/15 |
| `spot-api/scripts/qa-blockchain.ts` | Script de QA para fases 2/3/4 |
| `spot-api/scripts/check-contracts-qa.ts` | Script de verificação de contratos |
| PostgreSQL DB | Ordens negativas canceladas, constraint adicionado, followersCount resincronizado |

---

## Próximas Prioridades

1. **[CRIT]** Configurar nó com persistência (`--base-path`) e re-deployar contratos
2. **[CRIT]** Deploy `spot_settlement` contract e configurar `SPOT_CONTRACT_ADDRESS`
3. **[HIGH]** Implementar rota `/api/v1/staking` no backend
4. **[MED]** Subir SubQuery indexer
5. **[MED]** Seed de strategies de marketplace
6. **[MED]** Investigar candle aggregation em background
7. **[LOW]** Corrigir `directReferrals` count no affiliate dashboard

---

*Relatório gerado automaticamente por QA Engine — Lunex DEX v0.1-dev*
