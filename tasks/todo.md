# Todo — Lunex DEX Produção
**Última atualização:** 2026-04-28

---

## Fase 1 — Emergência de Segurança ✅

- [x] **T01** — Remover secrets comprometidos do repositório (RELAYER_SEED, AUTH_SECRET, .next/standalone) `XS`
- [x] **T02** — Remover senha hardcoded Admin@Lunex2026 do script de admin `XS`
- [x] **T03** — Corrigir PostgreSQL (synchronous_commit) e Redis (AOF) `XS`

**Checkpoint 1** ✅ — secrets limpos, DB seguro

---

## Fase 2 — Estabilidade do Processo ✅

- [x] **T04** — Adicionar unhandledRejection + uncaughtException handlers `XS`
- [x] **T05** — Corrigir productionGuards (rewardSplitValid + NODE_ENV) `S`
- [x] **T06** — Corrigir health check (Redis como crítico → 503) `XS`
- [x] **T07** — Rate limiting no admin login (5 req/15min) `S`
- [x] **T08** — Guard de NATIVE_TOKEN_ADDRESS no startup `S`

**Checkpoint 2** ✅ — servidor não sobe com config inválida

---

## Fase 3 — Integridade de Dados

- [x] **T09** — rewardDistributionService — Redis lock + idempotência per-recipient `L` (escopo reduzido — schema migration evitada)
- [x] **T10** — Corrigir race condition em liquidatePosition (check-and-set atômico via updateMany) `M`
- [x] **T11** — Envolver applySettlementResults em $transaction (remover prismaAny) `S`
- [x] **T12** — Mover cancel rate limiter de memória para Redis `M`
- [x] **T13** — Adicionar retry + backoff no SDK HTTP client `S`

**Checkpoint 3** — dados financeiros consistentes (aguardando suite verde)

---

## Fase 4 — Frontend e Infraestrutura ✅

- [x] **T14** — Criar .env.production.example para DEX e admin `S`
- [x] **T15** — Rota 404 + code splitting Vite (@polkadot chunk separado) `S`
- [x] **T16** — Implementar Emergency Controls real (endpoint + UI) `L`
- [x] **T17** — Corrigir SubQuery chainId via env vars (template + entrypoint) `S`
- [x] **T18** — Adicionar handlers SubQuery para spot_settlement e staking `L`
- [x] **T19** — Grafana dashboards + blackbox exporter SSL `M`
- [x] **T20** — Backup PostgreSQL com S3 obrigatório e cron `S`

**Checkpoint 4** ✅ — infra e frontend prontos para mainnet

---

## Fase 5 — Smart Contracts ✅

- [x] **T21** — Corrigir CEI em staking::claim_rewards `S`
- [x] **T22** — Reentrancy guard no spot_settlement `S`
- [x] **T23** — liquidity_lock::withdraw com PSP22 transfer real `M`
- [x] **T24** — staking::execute_proposal com transferências reais `M`
- [x] **T25** — copy_vault: swap_through_router com cross-contract call real `XL`
- [x] **T26** — Mudar isInBlock → isFinalized nos services críticos `S`

**Checkpoint 5** ✅ — contratos com PSP22/Router calls reais; testes Rust passando (69/69)

---

## Tier 2 — Hardening ✅

- [x] Senha admin mínimo 16 chars (T02 — feito)
- [x] requireAdminOrInternal — defesa contra X-Forwarded-For spoofing
- [x] express.json limit: 5MB → 100KB global (2MB apenas em /listing)
- [x] copytradeService scheduler — try/catch (já existia em runSweep)
- [x] matching lock — NODE_ENV verificado em productionGuards
- [x] transfer_ownership two-step no spot_settlement
- [x] asymmetric_pair reentrancy guard
- [x] Node.js version padronizado (api → Node 20)
- [x] Nginx exporter wired (compose + prometheus + nginx stub_status)
- [x] Fix `|| true` no typecheck do CI

## Tier 2 — pós-deploy (CSP)

- [ ] CSP Nginx (remover unsafe-inline/unsafe-eval) — requer audit do frontend para identificar inlines
- [ ] CSP Next.js admin — requer audit do React tree
- [ ] reset_reentrancy_guard — verificar exposição na ABI do rewards (auditoria externa cobre)

## Tier 3 — Cleanup ✅

- [x] factory constructor: panic → Result<Self, FactoryError>
- [x] arquivo mock.ts removido
- [x] ErrorBoundary duplicado consolidado
- [x] TODO filtro de pools do usuário (My Pools tab removida pendente integração)

## Tier 3 — pós-lançamento

- [ ] Script unificado de deploy de contratos
- [ ] socialIndexerService análise de polling/backoff
- [ ] SDK publicação npm verificada
- [ ] i18n (esforço de larga escala)
- [ ] Acessibilidade (aria-labels) — incremental
- [ ] Auditoria externa ink!/Substrate (4-8 semanas externas)
