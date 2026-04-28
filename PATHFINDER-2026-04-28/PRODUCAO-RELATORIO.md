# Lunex DEX — Relatório de Prontidão para Produção
**Data:** 2026-04-28  
**Análise:** 5 especialistas paralelos — Segurança, Backend, Frontend, DevOps, Smart Contracts  
**Veredito:** ❌ NÃO PRONTO PARA MAINNET

---

## Resumo Executivo

O projeto tem base técnica sólida e features funcionalmente completas na camada de frontend e API. Porém **3 contratos ink! têm funcionalidade crítica marcada como stub/TODO de produção**, há **2 vulnerabilidades de segurança críticas** (assinatura on-chain é no-op + chave de dev no repo), e vários **bloqueadores de dados e infraestrutura**.

**Estimativa de esforço total antes de mainnet: 3–4 meses**

---

## Matriz Go/No-Go por Tier

### TIER 0 — BLOQUEADORES ABSOLUTOS (não lançar sem resolver)

| # | Área | Problema | Arquivo | Esforço |
|---|------|---------|---------|---------|
| 1 | 🔐 Segurança | `verify_order_signature()` aceita qualquer assinatura não-zero — no-op on-chain | `contracts/spot_settlement/lib.rs:1052` | Depende da Lunes chain suportar `seal_sr25519_verify` |
| 2 | 🔐 Segurança | `RELAYER_SEED=//Alice` commitado no `.env.docker` — chave dev pública como relayer | `docker/.env.docker:24` | 2h (rotacionar, remoção do histórico git) |
| 3 | 🔐 Segurança | Senha hardcoded `Admin@Lunex2026` no script de criação de admin | `lunex-admin/scripts/create-admin.ts:16` | 30min |
| 4 | 🔐 Segurança | `.next/standalone/.env` com `AUTH_SECRET` commitado no repo | `lunex-admin/.next/standalone/` | 2h (git filter-repo + rotação) |
| 5 | ⛓️ Contratos | `copy_vault::execute_trade` é **stub** — copy trading não executa swaps reais on-chain | `contracts/copy_vault/lib.rs:667` | 2–3 semanas |
| 6 | ⛓️ Contratos | `liquidity_lock::withdraw()` **não transfere LP tokens** — ficam presos permanentemente | `contracts/liquidity_lock/lib.rs:211` | 1 semana |
| 7 | ⛓️ Contratos | `staking::execute_proposal` **não faz transferências reais de LUNES** | `contracts/staking/lib.rs:1100` | 1 semana |
| 8 | ⛓️ Contratos | `staking::claim_rewards` — CEI invertido: estado zerado antes do `transfer`, sem rollback | `contracts/staking/lib.rs:850` | 4h |
| 9 | ⛓️ SubQuery | `chainId` aponta para devnet local (`ws://host.docker.internal:9944`) | `subquery-node/project.yaml` | 2h |
| 10 | ⛓️ SubQuery | Sem handlers para eventos de `spot_settlement` e `staking` | `subquery-node/project.yaml` | 1 semana |
| 11 | 🖥️ Frontend | `.env` do DEX aponta para `localhost:4000` e `NETWORK=testnet` | `lunes-dex-main/.env` | 2h |
| 12 | 🖥️ Frontend | Emergency Controls do admin é **UI placeholder** — sem implementação real | `lunex-admin/src/app/(admin)/emergency/page.tsx:24` | 1–2 dias |
| 13 | 🗄️ DevOps | `synchronous_commit=off` no PostgreSQL — trades confirmados podem se perder em crash | `docker/docker-compose.prod.yml:21` | 15min |
| 14 | 🗄️ DevOps | Redis sem persistência (`--save ""`) com nonces de transação | `docker/docker-compose.prod.yml` | 30min |
| 15 | 🔧 Backend | `rewardDistributionService` sem `$transaction` — distribuição pode pagar 0 ou duplo | `spot-api/src/services/rewardDistributionService.ts:535` | 8h |
| 16 | 🔧 Backend | `rewardSplitValid` nunca validado — servidor sobe com split >100% | `spot-api/src/config.ts` + `productionGuards.ts` | 30min |
| 17 | 🔧 Backend | `liquidatePosition` sem row lock — double-liquidation possível | `spot-api/src/services/marginService.ts:1062` | 4h |
| 18 | 🔧 Backend | Sem `unhandledRejection` handler — crash silencioso sem log | `spot-api/src/index.ts` | 30min |

---

### TIER 1 — ALTA PRIORIDADE (resolver antes do go-live)

| # | Área | Problema | Arquivo | Esforço |
|---|------|---------|---------|---------|
| 19 | 🔐 Segurança | Admin login sem rate limiting ou lockout — brute-force possível | `lunex-admin/middleware.ts` | 4h |
| 20 | 🔐 Segurança | Cancel rate limiter em memória — não sobrevive restart/escala horizontal | `spot-api/src/routes/orders.ts:82` | 4h |
| 21 | 🔐 Segurança | `AUTH_SECRET` string fraca e conhecida — JWTs admin são forjáveis | `lunex-admin/.env:4` | 1h |
| 22 | ⛓️ Contratos | `spot_settlement` sem reentrancy guard — PSP22 malicioso pode reentrar | `contracts/spot_settlement/lib.rs` | 4h |
| 23 | ⛓️ Contratos | Backend aceita `isInBlock` ao invés de `isFinalized` para operações que movem fundos | `copyVaultService.ts:159`, `settlementService.ts:524` | 4h |
| 24 | ⛓️ Contratos | Relayer centralizado — single point of failure para todo o orderbook | `settlementService.ts` | 1 semana (KMS/multisig) |
| 25 | ⛓️ Contratos | Fuzz targets de `copy_vault` e `asymmetric_pair` são **stubs vazios** | `contracts/*/fuzz/` | 2 semanas |
| 26 | 🔧 Backend | `tradeSettlementService::applySettlementResults` sem transação DB | `spot-api/src/services/tradeSettlementService.ts:164` | 3h |
| 27 | 🔧 Backend | SDK sem retry/backoff — falha em erros transientes 429/503 | `sdk/src/http-client.ts:62` | 4h |
| 28 | 🔧 Backend | Health check retorna 200 com Redis down — matching engine depende de Redis | `spot-api/src/index.ts` | 15min |
| 29 | 🔧 Backend | `NATIVE_TOKEN_ADDRESS` ausente = fallback zero silencioso | `settlementService.ts` | 1h |
| 30 | 🖥️ Frontend | Sem rota 404 catch-all — URLs inválidas mostram tela em branco | `lunes-dex-main/src/routers/index.tsx` | 30min |
| 31 | 🖥️ Frontend | Code splitting ausente — bundle `@polkadot/api` monolítico (~2-3MB) | `lunes-dex-main/vite.config.ts` | 2h |
| 32 | 🗄️ DevOps | Blackbox exporter desabilitado — alerta de SSL nunca dispara | `docker/prometheus.yml` | 1h |
| 33 | 🗄️ DevOps | Grafana sem dashboards — time de ops opera sem visibilidade | `docker/grafana/provisioning/` | 3–4h |
| 34 | 🗄️ DevOps | Backup PostgreSQL apenas local, sem S3 configurado, sem cron | `docker/backup.sh` | 2h |

---

### TIER 2 — MÉDIA PRIORIDADE (resolver na semana do lançamento)

| # | Área | Problema | Esforço |
|---|------|---------|---------|
| 35 | 🔐 Segurança | CSP com `unsafe-inline`/`unsafe-eval` no Nginx | 2h |
| 36 | 🔐 Segurança | Senha mínima admin: 8 chars (muito fraca para conta privilegiada) | 30min |
| 37 | 🔐 Segurança | `requireAdminOrInternal` confia em `req.ip` (spoofável via X-Forwarded-For) | 2h |
| 38 | 🔐 Segurança | Sem CSP no admin Next.js | 2h |
| 39 | ⛓️ Contratos | Admin único sem timelock em `copy_vault` — pause imediato sem delay | 1 semana |
| 40 | ⛓️ Contratos | `reset_reentrancy_guard` público na ABI do `rewards` — verificar exposição | 2h |
| 41 | ⛓️ Contratos | `asymmetric_pair` sem reentrancy guard | 4h |
| 42 | ⛓️ Contratos | `transfer_ownership` em `spot_settlement` sem two-step confirmation | 4h |
| 43 | 🔧 Backend | `rewardDistributionService` sem Redis lock — duas instâncias podem distribuir simultaneamente | 3h |
| 44 | 🔧 Backend | `copytradeService` — métodos chamados por scheduler sem try/catch | 4h |
| 45 | 🔧 Backend | express.json limit 5MB global antes de auth — amplificação de DoS | 1h |
| 46 | 🔧 Backend | `matching lock` usa lock local se `NODE_ENV` não for `production` | 2h |
| 47 | 🗄️ DevOps | SubQuery bind mount para código fonte local — frágil em produção | 2h |
| 48 | 🗄️ DevOps | Sem `connection_limit` no DATABASE_URL — possível `too many connections` | 30min |
| 49 | 🗄️ DevOps | Node.js version mismatch: API usa Node 18, frontend/admin usam Node 20 | 30min |
| 50 | 🖥️ Frontend | TODO: filtro de pools do usuário não implementado | 4h |

---

### TIER 3 — BAIXA PRIORIDADE (pós-lançamento)

| # | Área | Problema | Esforço |
|---|------|---------|---------|
| 51 | ⛓️ Contratos | `factory` constructor usa panic ao invés de `Result<Self, Error>` | 2h |
| 52 | ⛓️ Contratos | Sem script unificado de deploy de contratos | 1 dia |
| 53 | 🔧 Backend | `prismaAny = prisma as any` suprime type-safety em tradeSettlementService | 2h |
| 54 | 🔧 Backend | `socialIndexerService.ts` (42KB) não analisado — risco de polling sem backoff | 4h análise |
| 55 | 🖥️ Frontend | Sem i18n — UI hardcoded em inglês | Semanas |
| 56 | 🖥️ Frontend | Acessibilidade mínima — aria-labels ausentes em botões críticos | 1 dia |
| 57 | 🗄️ DevOps | Sem memory/CPU limits nos containers | 1h |
| 58 | 🗄️ DevOps | Nginx exporter comentado no Prometheus | 1h |
| 59 | 🔐 Segurança | `sanitizeInput` é dead code — pode confundir futuros devs | 30min |
| 60 | 🔐 Segurança | `buildSpotCancelMessage` sem timestamp embutido | 1h |

---

## O que está PRONTO e BEM implementado

### Segurança
- ✅ Nonce + sr25519 com Redis `SET NX EX` — proteção de replay correta
- ✅ `adminGuard.ts` usa `crypto.timingSafeEqual` — sem timing attacks
- ✅ `productionGuards.ts` — startup valida seeds dev (//Alice, //Bob), CORS wildcards, Redis localhost
- ✅ API keys armazenadas como SHA-256, nunca raw
- ✅ Prisma ORM — SQL injection impossível
- ✅ CORS por tier (trading vs server-to-server)
- ✅ Audit log com roles (`SUPER_ADMIN` vs `ADMIN`)
- ✅ Helmet + rate limiting por rota

### Backend
- ✅ `matchingLockService` com Lua atomic release, TTL auto-renewal
- ✅ `settlementService` — try/catch por trade, sem propagação individual
- ✅ 123 índices no schema Prisma (44 models, hot paths cobertos)
- ✅ Graceful shutdown (SIGTERM/SIGINT → para schedulers → desconecta DB+Redis)
- ✅ Error handler esconde detalhes internos em produção

### Smart Contracts
- ✅ Checked arithmetic everywhere (`checked_add`, `checked_sub`, `checked_mul`)
- ✅ Emergency pause em todos os contratos críticos
- ✅ Self-trade prevention no `spot_settlement`
- ✅ Fee caps implementados
- ✅ Reentrancy guard no `copy_vault` (`VaultError::Reentrancy`)
- ✅ CEI correto no `spot_settlement::deposit_psp22`/`withdraw_psp22`

### Frontend
- ✅ Todas as features core completas: swap, order book, margin, copy trading, social, staking, rewards, agents
- ✅ Admin completo: treasury, dashboard, listings, users, team, audit, emergency (UI)
- ✅ NextAuth com bcrypt + JWT + roles
- ✅ ErrorBoundary implementado
- ✅ Vite remove console.* em produção (`esbuild.drop`)
- ✅ Conexão com 3 carteiras Polkadot (polkadot-js, SubWallet, Talisman)

### DevOps
- ✅ Multi-stage Dockerfiles + Alpine base images
- ✅ Nginx TLS 1.2/1.3, OCSP Stapling, HSTS, headers de segurança completos
- ✅ Rate limiting por zona no Nginx
- ✅ Prometheus + AlertManager (Slack + PagerDuty + email)
- ✅ CI/CD com lint, typecheck, build, tests, deploy automatizado
- ✅ Faucet AUSENTE do compose de produção
- ✅ Rede interna Docker separada da pública
- ✅ Non-root user nos containers

---

## Plano de Ação Priorizado

### Semana 1 (Imediato — Segurança Crítica)
- [ ] Remover `RELAYER_SEED=//Alice` do repo + `git filter-repo` para limpar histórico
- [ ] Remover `.next/standalone/` do repo + rotacionar `AUTH_SECRET`
- [ ] Remover senha hardcoded `Admin@Lunex2026` do script
- [ ] Criar `.env.production` para DEX (mainnet URLs, RPC, contratos)
- [ ] Configurar `AUTH_SECRET` real no admin via secrets manager
- [ ] Configurar `DATABASE_URL` e `SPOT_API_URL` do admin para produção
- [ ] Corrigir `synchronous_commit=off` no PostgreSQL
- [ ] Definir estratégia para Redis (AOF ou documentar como cache puro)
- [ ] Adicionar `unhandledRejection` handler no `index.ts`
- [ ] Corrigir `rewardSplitValid` no `productionGuards.ts`
- [ ] Corrigir health check Redis

### Semanas 2–3 (Backend Crítico)
- [ ] Envolver `runWeeklyDistribution` em `$transaction` com idempotência
- [ ] Corrigir race condition em `liquidatePosition` (SELECT FOR UPDATE ou Serializable)
- [ ] Corrigir `tradeSettlementService` sem transação
- [ ] Mover cancel rate limiter para Redis
- [ ] Corrigir CEI em `staking::claim_rewards`
- [ ] Adicionar admin login rate limiting
- [ ] Adicionar retry/backoff no SDK
- [ ] Implementar Emergency Controls real no admin
- [ ] Atualizar SubQuery chainId para mainnet

### Meses 1–2 (Smart Contracts — Core)
- [ ] Implementar `copy_vault::execute_trade` com cross-contract call real ao Router
- [ ] Implementar PSP22 transfer real no `liquidity_lock::withdraw()`
- [ ] Implementar transferências LUNES em `staking::execute_proposal`
- [ ] Adicionar reentrancy guard ao `spot_settlement`
- [ ] Implementar relayer multisig ou KMS
- [ ] Mudar `isInBlock` para `isFinalized` nas operações críticas
- [ ] Adicionar handlers SubQuery para `spot_settlement` e `staking`

### Meses 2–3 (Auditoria + Hardening)
- [ ] Implementar fuzz tests reais para `copy_vault` e `asymmetric_pair`
- [ ] Auditoria externa por firma especializada em ink!/Substrate
- [ ] Configurar Grafana dashboards
- [ ] Implementar backups S3
- [ ] Deploy e teste completo em testnet Lunes com mainnet config

---

## Recomendação Final

**Não lançar na mainnet até resolver os 18 bloqueadores do Tier 0.**

Os 3 mais críticos que sozinhos impedem o lançamento:
1. **Contratos com stubs** — copy trading e liquidity lock não funcionam on-chain
2. **Assinatura on-chain é no-op** — relayer pode manipular qualquer trade
3. **Chave de dev comprometida no repo** — risco de dreno total do settlement

Com foco nos contratos (maior esforço), estimativa realista de **3 meses** para lançamento seguro.
