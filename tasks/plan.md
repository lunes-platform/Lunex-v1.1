# Plano de Implementação — Lunex DEX Produção
**Criado:** 2026-04-28  
**Baseado em:** PATHFINDER-2026-04-28/PRODUCAO-RELATORIO.md  
**Total de tarefas:** 42 (excluindo os 3 stubs de contratos que são sprints separados)

---

## Visão Geral

Corrigir todos os 60 itens identificados pela auditoria de 5 especialistas. Organizados em 5 fases pela ordem de dependência:

```
Fase 1: Emergência de Segurança (secrets, config crítica)
    │
    ├── Fase 2: Estabilidade do Processo (backend guards, health)
    │       │
    │       ├── Fase 3: Integridade de Dados (transações DB, race conditions)
    │       │       │
    │       │       ├── Fase 4: Frontend e Infra (config prod, devops)
    │       │       │       │
    │       │       │       └── Fase 5: Contratos (stubs — sprints longos)
```

---

## Decisões de Arquitetura

- **Não remover .env.docker** — substituir valores sensíveis por placeholders documentados
- **Redis persistence** — habilitar `appendonly yes` (nonces são estado crítico, não cache puro)
- **synchronous_commit** — remover `off` sem substituição (performance padrão do PostgreSQL é aceitável)
- **Cancel rate limiter** — mover para Redis usando sliding window com ZADD (mesmo padrão dos nonces)
- **Fuzz targets** — implementar via ink! test context (não alterar a API do contrato)

---

## Fase 1 — Emergência de Segurança

> Resolver ANTES de qualquer outra mudança. Sem esses fixes, o repositório representa risco imediato.

### Tarefa 1: Remover secrets comprometidos do repositório
**Descrição:** Substituir `RELAYER_SEED=//Alice` por placeholder e adicionar `.next/standalone` ao `.gitignore`. Rotacionar `AUTH_SECRET`.

**Critérios de aceitação:**
- [ ] `docker/.env.docker` não contém `//Alice`, `//Bob`, ou qualquer seed dev
- [ ] `lunex-admin/.next/` está no `.gitignore`
- [ ] `lunex-admin/.next/standalone/` removido do working tree
- [ ] `AUTH_SECRET` no `.env` do admin é `REPLACE_WITH_GENERATED_SECRET`

**Verificação:** `grep -r "//Alice\|//Bob\|Admin@Lunex2026" . --include="*.ts" --include="*.js" --include="*.env*"` retorna vazio

**Dependências:** Nenhuma  
**Arquivos:** `docker/.env.docker`, `lunex-admin/.env`, `lunex-admin/.gitignore` (ou raiz)  
**Tamanho:** XS

---

### Tarefa 2: Remover senha hardcoded do script de admin
**Descrição:** `create-admin.ts` usa `Admin@Lunex2026` como fallback. Remover o fallback e falhar se `ADMIN_PASSWORD` não estiver definido.

**Critérios de aceitação:**
- [ ] `create-admin.ts` não contém a string `Admin@Lunex2026`
- [ ] Script faz `process.exit(1)` com mensagem clara se `ADMIN_PASSWORD` não estiver definido
- [ ] Mínimo de senha: 16 caracteres (validação adicionada)

**Verificação:** Rodar script sem `ADMIN_PASSWORD` → deve exitir com erro claro  
**Dependências:** Nenhuma  
**Arquivos:** `lunex-admin/scripts/create-admin.ts`, `lunex-admin/src/app/(admin)/team/actions.ts`  
**Tamanho:** XS

---

### Tarefa 3: Corrigir configuração crítica do PostgreSQL e Redis
**Descrição:** Remover `synchronous_commit=off` e habilitar AOF no Redis.

**Critérios de aceitação:**
- [ ] `docker/docker-compose.prod.yml` sem `synchronous_commit=off`
- [ ] Redis com `--appendonly yes --appendfsync everysec` no compose de produção
- [ ] Sem `--save ""` no Redis de produção

**Verificação:** `grep "synchronous_commit\|save \"\"\|appendonly" docker/docker-compose.prod.yml`  
**Dependências:** Nenhuma  
**Arquivos:** `docker/docker-compose.prod.yml`  
**Tamanho:** XS

---

### Checkpoint Fase 1
- [ ] `grep -r "//Alice"` retorna vazio em todos os arquivos rastreados pelo git
- [ ] `docker/docker-compose.prod.yml` sem synchronous_commit=off
- [ ] Redis com AOF habilitado

---

## Fase 2 — Estabilidade do Processo

### Tarefa 4: Adicionar handlers de processo críticos no servidor
**Descrição:** `spot-api/src/index.ts` não tem `unhandledRejection` nem `uncaughtException`. Schedulers podem crashar silenciosamente.

**Critérios de aceitação:**
- [ ] `process.on('unhandledRejection')` loga com contexto e chama `process.exit(1)`
- [ ] `process.on('uncaughtException')` loga com contexto e chama `process.exit(1)`
- [ ] Ambos os handlers são adicionados ANTES da chamada `main()`

**Verificação:** Leitura do arquivo confirma presença dos handlers antes de `main()`  
**Dependências:** Nenhuma  
**Arquivos:** `spot-api/src/index.ts`  
**Tamanho:** XS

---

### Tarefa 5: Corrigir guards de produção (rewardSplitValid + Redis obrigatório)
**Descrição:** `productionGuards.ts` não valida `rewardSplitValid` nem que `NODE_ENV=production` está explicitamente setado.

**Critérios de aceitação:**
- [ ] Guard verifica `config.rewards.rewardSplitValid` e falha com `process.exit(1)` se falso
- [ ] Guard verifica `NODE_ENV === 'production'` explicitamente (não só `!== 'development'`)
- [ ] Mensagem de erro lista os percentuais específicos que não somam 100

**Verificação:** Setar split inválido em `.env.test` e rodar guard — deve falhar  
**Dependências:** Tarefa 4  
**Arquivos:** `spot-api/src/utils/productionGuards.ts`, `spot-api/src/config.ts`  
**Tamanho:** S

---

### Tarefa 6: Corrigir health check para incluir Redis como crítico
**Descrição:** `/health` retorna 200 com Redis down. Matching engine requer Redis — deve retornar 503.

**Critérios de aceitação:**
- [ ] `overallOk = dbOk && redisOk` (não apenas `dbOk`)
- [ ] Resposta do health check inclui status individual de Redis
- [ ] Redis down → HTTP 503

**Verificação:** Parar Redis localmente → `curl /health` retorna 503  
**Dependências:** Nenhuma  
**Arquivos:** `spot-api/src/index.ts` (rota `/health`)  
**Tamanho:** XS

---

### Tarefa 7: Adicionar rate limiting no admin login (Next.js)
**Descrição:** `/api/auth/callback/credentials` sem proteção de brute-force.

**Critérios de aceitação:**
- [ ] Máximo 5 tentativas por IP em 15 minutos
- [ ] Resposta 429 após limite atingido com `Retry-After` header
- [ ] Log estruturado de tentativas falhas com IP

**Verificação:** 6 requests consecutivos ao endpoint → 6ª retorna 429  
**Dependências:** Tarefa 1  
**Arquivos:** `lunex-admin/middleware.ts` ou novo `lunex-admin/src/middleware/rateLimiter.ts`  
**Tamanho:** S

---

### Tarefa 8: Adicionar guarda de NATIVE_TOKEN_ADDRESS no startup
**Descrição:** `settlementService.ts` faz fallback silencioso para `AccountId` zero se variável ausente.

**Critérios de aceitação:**
- [ ] `productionGuards.ts` falha hard se `NATIVE_TOKEN_ADDRESS` não configurado em produção
- [ ] Mensagem de erro clara indicando qual variável está faltando
- [ ] `settlementService.ts` remove o fallback e usa o valor validado

**Verificação:** Rodar sem `NATIVE_TOKEN_ADDRESS` em `NODE_ENV=production` → processo não sobe  
**Dependências:** Tarefa 5  
**Arquivos:** `spot-api/src/utils/productionGuards.ts`, `spot-api/src/services/settlementService.ts`  
**Tamanho:** S

---

### Checkpoint Fase 2
- [ ] Servidor não sobe com configuração inválida (split, NODE_ENV, NATIVE_TOKEN_ADDRESS)
- [ ] Health check retorna 503 quando Redis offline
- [ ] Admin login tem proteção de brute-force
- [ ] `unhandledRejection` capturado e logado

---

## Fase 3 — Integridade de Dados

### Tarefa 9: Wrap rewardDistributionService em $transaction com idempotência
**Descrição:** `runWeeklyDistribution` executa 15+ DB writes sequenciais sem transação. Em crash, estado fica inconsistente.

**Critérios de aceitação:**
- [ ] Toda a lógica de DB de `runWeeklyDistribution` está dentro de `prisma.$transaction`
- [ ] A call on-chain (off-chain da tx) acontece APÓS a tx DB confirmar o plano, com `txHash` salvo antes dos `userReward.create`
- [ ] Retry da distribuição verifica `txHash` existente antes de re-executar (idempotência)
- [ ] Redis distributed lock (TTL 5min) previne execução concorrente

**Verificação:** Simular crash no meio da distribuição → restart → estado consistente (sem duplicatas)  
**Dependências:** Tarefas 4, 5  
**Arquivos:** `spot-api/src/services/rewardDistributionService.ts`  
**Tamanho:** L

---

### Tarefa 10: Corrigir race condition em liquidatePosition
**Descrição:** Duas threads podem liquidar a mesma posição simultaneamente (READ COMMITTED padrão).

**Critérios de aceitação:**
- [ ] Dentro da transação, `updateMany({ where: { id, status: 'OPEN' }, data: { status: 'LIQUIDATING' } })` como check-and-set atômico
- [ ] Se `count === 0`, rejeita silenciosamente (já liquidada)
- [ ] Nenhum `collateralLocked` pode ficar negativo

**Verificação:** Teste com dois processos concorrentes tentando liquidar a mesma posição → apenas um sucede  
**Dependências:** Nenhuma  
**Arquivos:** `spot-api/src/services/marginService.ts`  
**Tamanho:** M

---

### Tarefa 11: Envolver applySettlementResults em $transaction
**Descrição:** Loop de updates de trades sem transação — crash parcial deixa trades inconsistentes.

**Critérios de aceitação:**
- [ ] Loop de updates em `applySettlementResults` dentro de `prisma.$transaction`
- [ ] Cast `prismaAny = prisma as any` removido
- [ ] Tipos gerados pelo Prisma usados corretamente

**Verificação:** Código compila sem erros de tipo; sem `as any` no arquivo  
**Dependências:** Nenhuma  
**Arquivos:** `spot-api/src/services/tradeSettlementService.ts`  
**Tamanho:** S

---

### Tarefa 12: Mover cancel rate limiter para Redis
**Descrição:** Rate limiter de cancelamento de ordens usa `Map<string, number[]>` em memória — não sobrevive restart.

**Critérios de aceitação:**
- [ ] Sliding window implementada com Redis: `ZADD cancel:{address} {now} {uuid}` + `ZREMRANGEBYSCORE` + `ZCOUNT`
- [ ] Mesmo comportamento lógico: N cancelamentos por janela de tempo
- [ ] Sem dependência de estado em memória

**Verificação:** Restart do processo não reseta contadores de cancelamento  
**Dependências:** Tarefa 3 (Redis funcional)  
**Arquivos:** `spot-api/src/routes/orders.ts`  
**Tamanho:** M

---

### Tarefa 13: Adicionar retry com jitter no SDK HTTP client
**Descrição:** SDK falha imediatamente em 429/502/503 sem retry.

**Critérios de aceitação:**
- [ ] Retry automático para status 429, 502, 503, 504 e `ECONNABORTED`
- [ ] Máximo 3 retries com exponential backoff + jitter (±20%)
- [ ] Headers `Retry-After` são respeitados para 429
- [ ] Não retry em 4xx client errors (400, 401, 403, 404)

**Verificação:** Mock de 503 → SDK tenta 3 vezes com delay crescente  
**Dependências:** Nenhuma  
**Arquivos:** `sdk/src/http-client.ts`  
**Tamanho:** S

---

### Checkpoint Fase 3
- [ ] `rewardDistributionService` tem transação + idempotência
- [ ] `liquidatePosition` é atômico (sem double-liquidation)
- [ ] `applySettlementResults` tem transação
- [ ] Cancel rate limiter persiste no Redis
- [ ] SDK tem retry com backoff

---

## Fase 4 — Frontend e Infraestrutura

### Tarefa 14: Criar templates de ambiente de produção
**Descrição:** Frontend e admin apontam para localhost. Criar arquivos `.env.production` e `.env.example`.

**Critérios de aceitação:**
- [ ] `lunes-dex-main/.env.production` com `REACT_APP_SPOT_API_URL`, `REACT_APP_RPC_MAINNET`, `REACT_APP_NETWORK=mainnet`, todos os endereços de contrato
- [ ] `lunex-admin/.env.production` com `AUTH_SECRET`, `DATABASE_URL`, `SPOT_API_URL` para produção
- [ ] `.env.example` em cada pasta com todas as variáveis e comentários
- [ ] Ambos os `.env.production` no `.gitignore`

**Verificação:** `grep "localhost" lunes-dex-main/.env.production` retorna vazio  
**Dependências:** Tarefa 1  
**Arquivos:** `lunes-dex-main/.env.production`, `lunex-admin/.env.production`, `*/.env.example`  
**Tamanho:** S

---

### Tarefa 15: Adicionar rota 404 e code splitting no frontend
**Descrição:** URLs inválidas mostram tela em branco. Bundle monolítico de 2-3MB.

**Critérios de aceitação:**
- [ ] `<Route path="*" element={<NotFoundPage />} />` ao final do `<Routes>`
- [ ] `NotFoundPage` com link para home
- [ ] `vite.config.ts` com `manualChunks`: `polkadot`, `charts`, `vendor`
- [ ] Bundle de produção: chunk `@polkadot/api` separado

**Verificação:** Navegar para URL inválida → página 404 exibida; `npm run build` gera chunks separados  
**Dependências:** Nenhuma  
**Arquivos:** `lunes-dex-main/src/routers/index.tsx`, `lunes-dex-main/vite.config.ts`, `lunes-dex-main/src/pages/NotFound.tsx`  
**Tamanho:** S

---

### Tarefa 16: Implementar Emergency Controls real no admin
**Descrição:** A página `/emergency` é UI placeholder. Precisa chamar endpoints reais da API para pausar contratos.

**Critérios de aceitação:**
- [ ] Admin endpoint `POST /api/v1/admin/emergency/pause` criado no spot-api
- [ ] Endpoint chama `pause()` via polkadot.js nos contratos críticos (spot_settlement, copy_vault, staking)
- [ ] UI conecta ao endpoint real com loading state e confirmação
- [ ] Ação registrada no audit log

**Verificação:** Clicar "Pause All" no admin → request real enviado → resposta exibida  
**Dependências:** Tarefas 7, 14  
**Arquivos:** `lunex-admin/src/app/(admin)/emergency/page.tsx`, `spot-api/src/routes/admin.ts` (novo endpoint)  
**Tamanho:** L

---

### Tarefa 17: Corrigir SubQuery — chainId e endpoint de produção
**Descrição:** SubQuery aponta para devnet local. Sem indexação de mainnet, histórico é inválido.

**Critérios de aceitação:**
- [ ] `subquery-node/project.yaml` tem `chainId` e `endpoint` parametrizados via variáveis de ambiente
- [ ] `docker-compose.prod.yml` injeta `SUBQUERY_ENDPOINT` e `SUBQUERY_CHAIN_ID`
- [ ] `.env.production` documenta os valores de mainnet

**Verificação:** `grep "host.docker.internal\|9944" subquery-node/project.yaml` retorna vazio  
**Dependências:** Tarefa 14  
**Arquivos:** `subquery-node/project.yaml`, `docker/docker-compose.prod.yml`  
**Tamanho:** S

---

### Tarefa 18: Adicionar handlers SubQuery para spot_settlement e staking
**Descrição:** Eventos de spot orderbook e staking não são indexados — UI sem dados on-chain.

**Critérios de aceitação:**
- [ ] Handlers para: `SpotDeposit`, `SpotWithdraw`, `SpotSettle` do `spot_settlement`
- [ ] Handlers para: `StakeCreated`, `StakeWithdrawn`, `RewardClaimed` do `staking`
- [ ] Entidades GraphQL correspondentes no schema
- [ ] Todos os handlers compilam sem erro

**Verificação:** `subql build` sem erros; eventos aparecem nas queries GraphQL  
**Dependências:** Tarefa 17  
**Arquivos:** `subquery-node/src/mappings/`, `subquery-node/schema.graphql`  
**Tamanho:** L

---

### Tarefa 19: Configurar monitoramento — Grafana dashboards e blackbox exporter
**Descrição:** Grafana sem dashboards. Blackbox exporter comentado (alerta SSL nunca dispara).

**Critérios de aceitação:**
- [ ] Blackbox exporter adicionado ao compose e job SSL descomentado no prometheus.yml
- [ ] Dashboard Node Exporter (ID 1860) provisionado como JSON
- [ ] Dashboard PostgreSQL (ID 9628) provisionado
- [ ] Dashboard Redis (ID 11835) provisionado
- [ ] Dashboard custom Lunex: trades/hora, volume, orderbook depth, latência p99

**Verificação:** Grafana abre com 4 dashboards; `curl /metrics` do blackbox retorna probe metrics  
**Dependências:** Tarefa 3  
**Arquivos:** `docker/prometheus.yml`, `docker/docker-compose.prod.yml`, `docker/grafana/provisioning/dashboards/`  
**Tamanho:** M

---

### Tarefa 20: Configurar backup PostgreSQL com S3 obrigatório
**Descrição:** Backup apenas local sem S3. Sem cron automático.

**Critérios de aceitação:**
- [ ] `S3_BUCKET` obrigatório em produção (guard no script)
- [ ] Container `db-backup` com cron diário (1h UTC)
- [ ] Retenção: 7 dias local, 30 dias S3
- [ ] Teste de restore documentado no README

**Verificação:** `S3_BUCKET` vazio → script falha com mensagem clara  
**Dependências:** Tarefa 3  
**Arquivos:** `docker/backup.sh`, `docker/docker-compose.prod.yml`  
**Tamanho:** S

---

### Checkpoint Fase 4
- [ ] Frontend aponta para produção (sem localhost)
- [ ] SubQuery indexa mainnet
- [ ] Emergency Controls funciona
- [ ] Grafana tem dashboards e alertas de SSL
- [ ] Backup automático com S3

---

## Fase 5 — Smart Contracts (Sprints Longos)

> Estas tarefas são sprints de 1–3 semanas cada. Requerem dev Rust/ink! dedicado.

### Tarefa 21: Corrigir CEI em staking::claim_rewards [Sprint — 4h]
**Descrição:** Estado zerado antes do transfer — rewards perdidos se transfer falhar.

**Critérios de aceitação:**
- [ ] `stakes.insert` (com `pending_rewards = 0`) ocorre APÓS `transfer` bem-sucedido
- [ ] Em falha do `transfer`, estado original é preservado
- [ ] Teste unitário cobrindo o caso de falha de transfer

**Verificação:** Teste ink! simula transfer falhando → rewards ainda disponíveis para claim  
**Arquivos:** `Lunex/contracts/staking/lib.rs`  
**Tamanho:** S

---

### Tarefa 22: Adicionar reentrancy guard ao spot_settlement [Sprint — 4h]
**Descrição:** `spot_settlement` sem guard — PSP22 malicioso pode reentrar em `deposit_psp22`.

**Critérios de aceitação:**
- [ ] `reentrancy_lock: bool` adicionado ao storage
- [ ] Guard aplicado em `deposit_psp22` e `withdraw_psp22`
- [ ] Padrão idêntico ao `copy_vault` (`VaultError::Reentrancy`)
- [ ] Teste cobrindo tentativa de reentrância

**Arquivos:** `Lunex/contracts/spot_settlement/lib.rs`  
**Tamanho:** S

---

### Tarefa 23: Implementar liquidity_lock::withdraw com PSP22 transfer real [Sprint — 1 semana]
**Descrição:** `withdraw()` não devolve LP tokens — ficam presos permanentemente.

**Critérios de aceitação:**
- [ ] `create_lock` transfere LP tokens do caller para o contrato (custódia real)
- [ ] `withdraw` transfere LP tokens de volta ao dono (PSP22 cross-contract call)
- [ ] Eventos emitidos para ambas as operações
- [ ] Testes cobrindo ciclo completo: lock → withdraw

**Arquivos:** `Lunex/contracts/liquidity_lock/lib.rs`  
**Tamanho:** M

---

### Tarefa 24: Implementar staking::execute_proposal com transferências reais [Sprint — 1 semana]
**Descrição:** Governance executa mas LUNES não se move. Fee refund não ocorre.

**Critérios de aceitação:**
- [ ] Fee refund ao proponente via `transfer` real após aprovação
- [ ] Fee distribuído a stakers via `transfer` real
- [ ] Treasury proposals executam transferência de LUNES para destino
- [ ] Testes cobrindo os 3 tipos de proposta

**Arquivos:** `Lunex/contracts/staking/lib.rs`  
**Tamanho:** M

---

### Tarefa 25: Implementar copy_vault::execute_trade com cross-contract call real [Sprint — 3 semanas]
**Descrição:** Copy trading não executa swaps on-chain — apenas registra intenção. Este é o maior gap funcional.

**Critérios de aceitação:**
- [ ] `execute_trade` faz cross-contract call ao Router (`router::swap()`)
- [ ] `update_equity` removido ou protegido — equity deriva do estado on-chain real
- [ ] Followers estão protegidos: se swap falhar, rollback do estado do vault
- [ ] Performance fee calculada sobre resultado real do swap, não over intenção
- [ ] Fuzz tests implementados verificando invariante: `total_shares * share_price ≈ vault_equity`
- [ ] Testes de integração cobrindo: deposit → trade → withdraw → fees

**Arquivos:** `Lunex/contracts/copy_vault/lib.rs`, `Lunex/contracts/copy_vault/fuzz/`  
**Tamanho:** XL (quebrar em sub-tasks durante o sprint)

---

### Tarefa 26: Mudar isInBlock para isFinalized nas operações críticas [Sprint — 4h]
**Descrição:** Backend confirma operações antes da finality — risco de fork reverter o estado.

**Critérios de aceitação:**
- [ ] `copyVaultService.ts` aguarda `isFinalized` para deposit/withdraw
- [ ] `settlementService.ts` aguarda `isFinalized` para `settle_trade`
- [ ] Timeout configurável (default: 60s para finality)
- [ ] Log de warning se isInBlock recebido mas finality demorar mais que 10 blocos

**Arquivos:** `spot-api/src/services/copyVaultService.ts`, `spot-api/src/services/settlementService.ts`  
**Tamanho:** S

---

## Riscos e Mitigações

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Lunes chain não suporta `seal_sr25519_verify` | Alto | Documento público de trust model + relayer multisig |
| copy_vault rewrite quebra lógica existente de shares | Alto | Manter testnet paralela durante desenvolvimento |
| Redis AOF aumenta latência de write | Médio | `appendfsync everysec` (balance entre durabilidade e performance) |
| SubQuery reindexação demora horas | Médio | Manter indexer testnet rodando enquanto migra para mainnet |
| Emergency Controls requer deploy de contrato | Médio | Implementar via backend admin key primeiro, migrar para on-chain depois |

---

## Perguntas em Aberto

1. **Mainnet chainId do Lunes** — qual é o genesis hash oficial da mainnet?
2. **Endereços dos contratos** — onde estão os endereços deployados na testnet Lunes?
3. **Relayer multisig** — quantos signatários e qual threshold (ex: 2-of-3)?
4. **Finality timeout** — qual é o tempo médio de finality na Lunes (estimado: 2-4 blocos)?
5. **S3 bucket** — qual provider? (AWS, GCP, Cloudflare R2?)
