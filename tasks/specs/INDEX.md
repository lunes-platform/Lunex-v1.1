# Índice de Specs — Lunex DEX Produção
**Data:** 2026-04-28

---

## Fase 1 — Emergência de Segurança

| Spec | Título | Prioridade | Esforço |
|------|--------|-----------|---------|
| [T01](T01-remover-secrets.md) | Remover secrets comprometidos do repositório | BLOQUEADOR CRÍTICO | XS ~2h |
| [T02](T02-remover-senha-hardcoded.md) | Remover senha hardcoded Admin@Lunex2026 | BLOQUEADOR CRÍTICO | XS ~30min |
| [T03](T03-postgresql-redis-config.md) | Corrigir PostgreSQL (synchronous_commit) e Redis (AOF) | BLOQUEADOR CRÍTICO | XS ~30min |

## Fase 2 — Estabilidade do Processo

| Spec | Título | Prioridade | Esforço |
|------|--------|-----------|---------|
| [T04](T04-unhandled-rejection.md) | Handlers de processo (unhandledRejection + uncaughtException) | BLOQUEADOR | XS ~30min |
| [T05](T05-production-guards.md) | Production guards (rewardSplitValid + NODE_ENV) | BLOQUEADOR | S ~1h |
| [T06](T06-health-check-redis.md) | Health check — Redis como crítico (503) | ALTA | XS ~15min |
| [T07](T07-admin-rate-limiting.md) | Rate limiting no admin login (5 req/15min) | ALTA | S ~4h |
| T08* | Guard NATIVE_TOKEN_ADDRESS no startup | ALTA | S ~1h |

## Fase 3 — Integridade de Dados

| Spec | Título | Prioridade | Esforço |
|------|--------|-----------|---------|
| [T09](T09-reward-distribution-transaction.md) | rewardDistributionService: $transaction + idempotência + Redis lock | BLOQUEADOR | L ~8h |
| [T10](T10-liquidate-race-condition.md) | liquidatePosition: race condition com check-and-set atômico | BLOQUEADOR | M ~4h |
| T11* | applySettlementResults: envolver em $transaction | ALTA | S ~3h |
| T12* | Cancel rate limiter: memória → Redis sliding window | ALTA | M ~4h |
| [T13](T13-sdk-retry-backoff.md) | SDK HTTP client: retry com backoff exponencial | ALTA | S ~4h |

## Fase 4 — Frontend e Infraestrutura

| Spec | Título | Prioridade | Esforço |
|------|--------|-----------|---------|
| T14* | Templates .env.production + .env.example | BLOQUEADOR | S ~2h |
| [T15](T15-frontend-404-code-splitting.md) | Rota 404 + code splitting Vite (@polkadot chunk) | ALTA | S ~2h |
| T16* | Emergency Controls — endpoint real + UI | BLOQUEADOR | L ~1-2 dias |
| T17* | SubQuery chainId para mainnet (via env vars) | BLOQUEADOR | S ~2h |
| T18* | Handlers SubQuery para spot_settlement e staking | BLOQUEADOR | L ~1 semana |
| T19* | Grafana dashboards + blackbox exporter SSL | ALTA | M ~3-4h |
| T20* | Backup PostgreSQL com S3 obrigatório e cron | ALTA | S ~2h |

## Fase 5 — Smart Contracts (Sprints)

| Spec | Título | Prioridade | Esforço |
|------|--------|-----------|---------|
| [T21](T21-staking-claim-rewards-cei.md) | staking::claim_rewards — corrigir CEI | BLOQUEADOR | S ~4h |
| [T22](T22-spot-settlement-reentrancy.md) | spot_settlement — reentrancy guard | ALTA | S ~4h |
| T23* | liquidity_lock::withdraw — PSP22 transfer real | BLOQUEADOR | M ~1 semana |
| T24* | staking::execute_proposal — transferências reais | BLOQUEADOR | M ~1 semana |
| [T25](T25-copy-vault-execute-trade.md) | copy_vault::execute_trade — cross-contract call real | BLOQUEADOR | XL ~3 semanas |
| T26* | isInBlock → isFinalized nos services críticos | ALTA | S ~4h |

---

*Specs marcadas com `*` ainda não geradas como arquivo separado — conteúdo completo no [plan.md](../plan.md).*

---

## Resumo de Esforço Total

| Fase | Total estimado |
|------|---------------|
| Fase 1 | ~3h |
| Fase 2 | ~7h |
| Fase 3 | ~23h (~3 dias) |
| Fase 4 | ~1,5 semanas |
| Fase 5 | ~6 semanas |
| **Total** | **~3 meses** |
