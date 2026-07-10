# Auditoria Mainnet — Especialista 5: DevOps/Infra + QA/Testes

**Data:** 2026-06-12
**Escopo:** `docker/`, `.github/workflows/`, `scripts/`, `ecosystem.config.js`, mapa completo de testes do monorepo
**Auditor:** Painel de produção — Especialista 5

---

## VEREDITO: APROVADO COM RESSALVAS

A infraestrutura está **bem acima da média** para um projeto deste porte: CI com gates reais (sem `|| true` nos workflows ativos), gitleaks + cargo-audit + trivy + fuzz nightly, compose prod com healthchecks e secrets fail-fast (`:?Set X`), stack completa Prometheus/Alertmanager/Loki/Grafana/blackbox, backup S3 obrigatório com retenção, 15 runbooks. Os itens do PRODUCTION-READINESS.md (backups S3, blackbox-exporter, lunex-overview.json, redis appendonly) **estão todos presentes**.

Porém há **1 bloqueador P0** (pipeline de alertas inoperante — para um DEX com fundos em custódia, alerta que não dispara é o mesmo que não ter monitoração) e **camadas inteiras sem nenhum teste** (SDK, frontend, admin, subquery), além de **zero E2E real contra chain** — o "integration_e2e.rs" é 100% mock. O Mainnet Dress Rehearsal (Fase 10) não tem base executável hoje.

**Contagem:** P0: 1 | P1: 8 | P2: 7 | P3: 4

---

## 1. ACHADOS

### P0 — Bloqueadores de mainnet

#### P0-1: Alertmanager nunca entrega notificações — config usa `${ENV}` que o Alertmanager não expande
- **Evidência:** `docker/alertmanager.yml:58` (`api_url: '${SLACK_WEBHOOK_OPS}'`), `:63` (`to: '${ALERT_EMAIL_OPS}'`), `:70` (`${SLACK_WEBHOOK_CRITICAL}`), `:76` (`${PAGERDUTY_ROUTING_KEY}`), `:84` (`${SLACK_WEBHOOK_SECURITY}`), e `global.smtp_*` (`:4-6`). O compose injeta as env vars no container (`docker/docker-compose.prod.yml:434-443`), mas o entrypoint é o default (`:428-431` só passa `--config.file`). **Alertmanager v0.27 não faz expansão de variáveis de ambiente em config** — o `api_url` literal `${SLACK_WEBHOOK_OPS}` é uma URL inválida; o Alertmanager rejeita o config no load ou descarta as notificações.
- **Impacto:** `ListingRelayerDown`, `BlockchainNodeUnreachable`, `OrderSettlementBacklog`, `APIDown` — todos os alertas de caminho de fundos disparam no Prometheus e **morrem em silêncio**. O time acredita ter paging e não tem.
- **Fix concreto:** trocar o serviço para um entrypoint com envsubst:
  ```yaml
  entrypoint: ["/bin/sh","-c","apk add --no-cache gettext 2>/dev/null; envsubst < /etc/alertmanager/alertmanager.yml.tmpl > /tmp/alertmanager.yml && exec /bin/alertmanager --config.file=/tmp/alertmanager.yml --storage.path=/alertmanager"]
  ```
  (ou usar imagem com `prometheus-config-reloader`, ou gerar o config no deploy via Doppler). **Validar com `amtool check-config` no CI** e disparar um alerta de teste no dress rehearsal.

### P1 — Corrigir antes do mainnet

#### P1-1: lunex-admin está fora de TODOS os gates de CI
- **Evidência:** matriz `validate`/`build-ts` do `.github/workflows/ci.yml:41-50` e `:84-97` cobre spot-api, frontend, sdk, mcp — **admin ausente**. `pr-check.yml:30-51` (dorny/paths-filter) tem filtros `spot_api/frontend/sdk/mcp/subquery/contracts` — **sem filtro admin**. O lint do admin é `"lint": "eslint"` sem argumentos e sem `--max-warnings=0` (`lunex-admin/package.json`), enquanto todos os outros pacotes usam `--max-warnings=0`.
- **Nota Fase 0:** o `|| true` histórico foi removido — mas o resultado atual é pior: o admin **nem sequer roda** typecheck/lint/build em PR. Só é compilado no build Docker do deploy (tarde demais).
- **Fix:** adicionar `{project: admin, dir: lunex-admin}` às matrizes do ci.yml; adicionar filtro `admin` no pr-check.yml com jobs typecheck/quality; mudar script para `eslint . --max-warnings=0` e adicionar `next lint`/tsc.

#### P1-2: Suite E2E do spot-api (17 arquivos — settlement, orderbook, copytrade, auth-attack) não roda em nenhum gate automático
- **Evidência:** `ci.yml:184` roda `npx jest --testPathIgnorePatterns="e2e"`. Os 17 arquivos em `spot-api/src/__tests__/e2e/` (orderbook, orders, trades, margin, copytrade, asymmetric, router, rewards, auth-attack-simulation, admin-wallet-risk, etc.) só rodam **manualmente** e em subset (`prelaunch-security.yml:132` — apenas copytrade.e2e, social.e2e + 2 unit).
- **Impacto:** regressão em caminho de fundos (settlement/orderbook) passa no CI de PR.
- **Fix:** novo job `test-api-e2e` no ci.yml reutilizando os services postgres+redis já definidos (`ci.yml:136-159`) com `npm run test:e2e`. São testes supertest+DB real — não exigem chain.

#### P1-3: SDK, frontend, admin e subquery têm ZERO testes
- **Evidência:** `sdk/`: 0 arquivos de teste (jest.config.js define `coverageThreshold` 80% — aspiracional, nunca exercido; `prepublishOnly: npm run build && npm test` **falha** com "No tests found"). `lunes-dex-main/`: 0 testes. `lunex-admin/`: 0 testes. `subquery-node/`: 0 testes (CI valida só `subql codegen && subql build`, `ci.yml:222-228`).
- **Impacto:** o SDK monta transações de fundos para terceiros; o frontend assina swaps; os mappings do subquery alimentam proofs de listagem. Tudo isso sem uma única asserção.
- **Fix:** mínimo viável pré-mainnet: (a) SDK — testes de unidade para cálculo de amounts/slippage/decimals (o changelog SDK_DECIMALS indica histórico de bug aqui); (b) frontend — vitest para hooks de swap/approve + `contract:check` já existente como gate; (c) subquery — testes de mapping handlers com mocks de eventos.

#### P1-4: Nenhum teste E2E real contra chain em todo o monorepo
- **Evidência:** `tests/integration_e2e.rs:13-45` — "E2E" usa `MockFactory`/HashMap, sem chain. `Lunex/contracts/asymmetric_pair/Cargo.toml:25` declara `ink_e2e = "4.3"` mas há **0** `#[ink_e2e::test]` no contrato. Testes que referenciam `9944` (`spot-api/src/__tests__/assetBridgeService.test.ts`, `productionGuards.test.ts`, `tests/globalSetup.ts`) usam mocks/guards.
- **Impacto:** Fase 10 (Dress Rehearsal "full E2E from clean clone → testnet flow") não tem nenhum artefato executável. O fluxo UI→API→chain→indexer nunca foi exercitado de forma automatizada.
- **Fix:** (a) implementar 3-5 `#[ink_e2e::test]` nos caminhos de fundos (add_liquidity→swap→remove via router; settlement replay; copy_vault deposit/withdraw) usando `substrate-contracts-node` no CI; (b) script de smoke testnet (deploy → list → swap → verify no subquery) versionado como `scripts/dress-rehearsal.sh`.

#### P1-5: Builds não reproduzíveis — `npm install` em vez de `npm ci`, e Dockerfile.api sem lockfile
- **Evidência:** lockfiles existem em todos os 6 pacotes, mas `ci.yml:61` (`npm install`, repetido em validate/build-ts/test-api/smoke), `release.yml:84-110` (idem) e principalmente `docker/Dockerfile.api:5-6` — `COPY package.json ./` (sem `package-lock.json`) + `RUN npm install` → a imagem de produção da API resolve dependências na hora do build. `Dockerfile.frontend:44` e `Dockerfile.admin:5` usam `npm ci` corretamente.
- **Fix:** `COPY package.json package-lock.json ./` + `RUN npm ci` no Dockerfile.api; trocar todos os `npm install` por `npm ci` nos workflows. (Alinha com Fase 6 "single-SHA reproducibility, pin image digests".)

#### P1-6: Gate final `ci-status` não inclui os jobs de contratos
- **Evidência:** `ci.yml:418-439` — `needs: [build-ts, test-api, validate-subquery, smoke-test]` e o check de resultado (`:430-436`) ignora `build-contracts` (`:239`) e `test-contracts` (`:298`). Um `cargo test` quebrado não derruba o status que serve de gate para RC.
- **Fix:** adicionar `build-contracts` e `test-contracts` ao `needs` e ao bloco de verificação.

#### P1-7: Alertas mortos — métricas referenciadas que nenhum serviço exporta + sem alerta de lag do indexer
- **Evidência:** spot-api exporta apenas 9 métricas (`spot-api/src/utils/metrics.ts`): `lunex_blockchain_connected, lunex_db_healthy, lunex_redis_healthy, lunex_pending_settlements, lunex_http_request_duration_seconds, lunex_ws_connections, lunex_vault_total_equity, lunex_copytrade_*`. Mortos: **DatabaseBackupFailed** (`docker/alert-rules.yml:250` — `lunex_last_backup_age_seconds` não existe em lugar nenhum; o guard `count(...)>0` faz o alerta nunca disparar), **DatabaseConnectionPoolExhausted** (`:261` — `lunex_db_connections_waiting` inexistente), **APIRateLimitHigh** (`:46` — métrica de rate-limit não encontrada). Além disso, o indexer só tem probe de `/ready` (`prometheus.yml:110` + `alert-rules.yml:158-174`) — **não há alerta de lag em blocos** (`lunex_listing_relayer_last_finalized_block` existe no relayer mas não é comparado ao head da chain). Runbook `docs/runbooks/indexer-lag.md` existe sem alerta correspondente.
- **Positivo:** todas as 5 métricas do listing-relayer usadas nos alertas existem em `scripts/listing-relayer.ts` ✓; alertas de segurança usam `lunex_http_request_duration_seconds_count` ✓.
- **Fix:** exportar `lunex_last_backup_age_seconds` (sidecar ou backup.sh → pushgateway/arquivo node_exporter textfile), `lunex_db_connections_waiting` (Prisma metrics), métrica de rate-limit; criar `IndexerLagHigh: chain_head - lunex_listing_relayer_last_finalized_block > N`. (= Fase 8 do roadmap.)

#### P1-8: DR nunca ensaiado e fuzz abaixo da meta da Fase 10
- **Evidência:** `docs/runbooks/database.md:29-33` — "Before public mainnet, run and record a scratch restore... Measure RTO and document RPO" — **pendente, RTO/RPO indefinidos**. `fuzz.yml:68` — `DURATION=${{ github.event.inputs.fuzz_duration || '60' }}` → o nightly (cron `:18`) roda só **60s** por target; meta da Fase 10 é **600s+ verde por 7 runs**. Sem corpus persistente entre runs (cache só de build, `fuzz.yml:52-58`).
- **Fix:** (a) executar e gravar o restore-from-S3 drill (script + resultado em `docs/runbooks/database.md`); (b) `DURATION=${{ github.event_name == 'schedule' && '600' || github.event.inputs.fuzz_duration || '60' }}`; (c) persistir corpus via actions/cache em `fuzz/corpus/`.

### P2 — Endurecer logo após (ou junto com) o mainnet

| # | Achado | Evidência | Fix |
|---|--------|-----------|-----|
| P2-1 | `aquasecurity/trivy-action@master` — action de segurança não pinada; demais actions pinadas por tag mutável, não SHA | `deploy.yml` (job scan-images); inventário geral de `uses:` | Pinar trivy em `@0.x`/SHA; pinar por SHA as actions com acesso a secrets (ssh-action, login-action) |
| P2-2 | Zero resource limits em todos os ~20 serviços de prod (subquery-node é notoriamente faminto; OOM derruba vizinho) | `docker/docker-compose.prod.yml` — 0 ocorrências de `mem_limit`/`cpus`/`resources` | `mem_limit`+`cpus` por serviço; começar por subquery-node, postgres, api (= Fase 7) |
| P2-3 | `frontend` e `nginx` sem healthcheck no prod; rolling update do deploy sobe frontend sem verificação | `docker-compose.prod.yml:85-113` (frontend), `:234-256` (nginx) vs api/admin/subquery que têm | Adicionar healthcheck `wget -qO- http://localhost:80/` em ambos |
| P2-4 | `node_exporter` aponta para `host.docker.internal:9100` — não resolve em Linux sem `extra_hosts` → HighCPU/HighMemory/DiskSpace* mortos em prod | `docker/prometheus.yml:36` | Adicionar `extra_hosts: ["host.docker.internal:host-gateway"]` ao serviço prometheus, ou network_mode host no node_exporter |
| P2-5 | Workflow legado `pr-checks.yaml` ainda ativo: actions@v3, `continue-on-error: true` (`:38`), `cargo test` duplicado — ruído e falso sinal verde | `.github/workflows/pr-checks.yaml:13,38,53` | Deletar (ci.yml + pr-check.yml + contracts.yml já cobrem tudo) |
| P2-6 | Datasource "Prometheus" provisionado em DOIS arquivos — conflito de provisioning do Grafana | `docker/grafana/provisioning/datasources/datasources.yml:5` e `prometheus.yml:4` | Deletar `datasources/prometheus.yml` (datasources.yml já tem Prometheus+Loki) |
| P2-7 | Testes do mcp (5 testes, `node --test`) não rodam em nenhum workflow; `quality-mcp` do pr-check roda lint mas não test | `mcp/lunex-agent-mcp/package.json` (`"test"`), ausência de `npm test` em `ci.yml`/`pr-check.yml` | Adicionar step `npm test` ao job validate (mcp) do ci.yml |

### P3 — Higiene

| # | Achado | Evidência | Fix |
|---|--------|-----------|-----|
| P3-1 | `certbot/certbot` sem tag (latest implícito) | `docker-compose.prod.yml:412` | Pinar `certbot/certbot:v2.x` |
| P3-2 | `lunes-nightly:latest` no sandbox | `docker-compose.sandbox.yml:108` | Pinar digest do node testnet |
| P3-3 | `sdk` `prepublishOnly` quebrado — `npm test` falha com "No tests found" (bloqueia publish até P1-3 ser resolvido; hoje é um tropeço silencioso) | `sdk/package.json` | Resolver junto com P1-3 (ou `--passWithNoTests` temporário, NÃO recomendado) |
| P3-4 | Rota "Silence DB backup failures on weekends (example)" copiada de template no alertmanager — backup failure com repeat de 24h é frouxo | `docker/alertmanager.yml:40-44` | Remover rota exemplo; backup failure → ops-team com repeat 4h |

**Positivos confirmados (spot-check PRODUCTION-READINESS.md):** db-backup S3 obrigatório com `:?Set AWS_SECRET_ACCESS_KEY` (`docker-compose.prod.yml:386` + `backup.sh` com fail-fast S3, retenção local 7d/S3 30d) ✓ · blackbox-exporter v0.25.0 com módulos tcp_tls/http_2xx (`:319-330`, `prometheus.yml:67-122`) ✓ · `lunex-overview.json` válido, 12 painéis + `listing-relayer-indexer.json` 9 painéis ✓ · redis `--appendonly yes` appendfsync everysec (`:263`) ✓ · Loki 3.0 + promtail + datasource wired, retenção 30d ✓ · secrets de runtime via env com fail-fast, seeds NUNCA em build args (build args só REACT_APP_* públicos, `:90-107`) ✓ · `docker/.env.docker` NÃO está comitado (git ls-files vazio; conteúdo é placeholder) ✓ · Dockerfiles api/admin com USER non-root ✓ · deploy prod gated por trivy scan + environment `production` + health check pós-deploy + rollback manual para tag imutável anterior ✓ · 15 runbooks em `docs/runbooks/` ✓.

---

## 2. MAPA COMPLETO DE TESTES

| Pacote | Qtde | O que cobre | O que NÃO cobre | CI? | Precisa node :9944? |
|---|---|---|---|---|---|
| **Contratos ink! (unit inline, 13 contratos)** | ~211 testes: spot_settlement 42, router 35, asset_wrapper 29, pair 18, wnative 14, rewards 13, staking 12, copy_vault 11, factory 10, listing_manager 9, asymmetric_pair 7, psp22 6, liquidity_lock 5 | Lógica de cada contrato isolado (mint/burn/swap math, permissões, replay) | Interação real entre contratos on-chain; gas; storage migration | ✓ `cargo test --workspace --exclude fuzz` (ci.yml:316, contracts.yml:51, fmt+clippy -D warnings) | Não |
| **Workspace `tests/` (integração/sec/stress)** | 10 arquivos, ~61 testes (security 13, integration_e2e 10, stress 8, openzeppelin 8, staking_integration 6, usability 5, e2e_flow 3, property_invariants 3, complete_staking 3, lunex_complete 2) + `src/` 17 (decimal_utils 13, native_assets 4) | Invariantes k=xy, propriedades de segurança, fluxos simulados | **Tudo é mock** (`integration_e2e.rs:13` usa MockFactory) — zero chain real | ✓ ci.yml + property-tests no fuzz.yml | Não (globalSetup referencia 9944 mas mocka) |
| **Fuzz** | 3 targets: pair_invariant, copy_vault_accounting, spot_settlement_replay | Invariantes AMM, contabilidade do vault, replay de settlement | Router, staking, listing_manager, asset_wrapper sem fuzz; 60s/run; sem corpus persistente | ✓ push/PR/nightly 60s (fuzz.yml) | Não |
| **spot-api (jest)** | 49 arquivos, ~376 it/test: 26 unit + 17 E2E API-level (orderbook, orders, trades, margin, copytrade, asymmetric, router, rewards, auth-attack, admin-wallet-risk, affiliate, social, candles, pairs, health) | Serviços, settlement, auth, rotas com Postgres+Redis reais (supertest) | Integração com chain viva; WS sob carga; falha de chain durante settlement | Unit ✓ (ci.yml:184 exclui e2e); **E2E ✗** (subset manual em prelaunch-security.yml:132) | Não (mocka polkadot-js) |
| **sdk** | **0** (jest configurado com threshold 80%, zero arquivos) | Nada | Tudo — montagem de tx, decimals, slippage | ✗ (lint/build apenas) | — |
| **lunes-dex-main (frontend)** | **0** | Nada (apenas guards estáticos: contract:check, frontend:guard, lint --max-warnings=0 ✓ CI) | Hooks de swap/approve/assinatura, render | guards ✓ / testes ✗ | — |
| **lunex-admin** | **0** | Nada | Painel de pause/emergency, NextAuth | **✗ — fora de TODA o CI** | — |
| **mcp/lunex-agent-mcp** | 1 arquivo, 5 testes (node --test) | Roteamento básico | Resto do servidor MCP | **✗** (lint ✓, test não roda) | — |
| **subquery-node** | **0** | Nada (CI só codegen+build) | Mapping handlers (proofs de listagem!) | build ✓ / testes ✗ | — |
| **TOTAL** | **~670 testes** | Concentrados em contratos (~289) e spot-api (~376) | — | — | — |

### Top 10 gaps de cobertura para um DEX (caminhos de fundos)

1. **Zero E2E real UI→API→chain→indexer** — o Dress Rehearsal da Fase 10 não tem artefato; `ink_e2e` declarado e nunca usado.
2. **E2E do spot-api (settlement/orderbook) fora do CI** — regressão em caminho de fundos passa em PR.
3. **SDK sem testes** — biblioteca pública que constrói transações de fundos (decimals já tiveram bug — CHANGELOG_SDK_DECIMALS.md).
4. **lunex-admin sem testes e fora do CI** — controla emergency-pause; um typo quebra o botão de pânico sem ninguém saber.
5. **SubQuery mappings sem testes** — indexer alimenta verificação de proofs de listagem; mapping errado = listagem fraudada passa.
6. **Frontend sem testes de hooks de swap/approve** — assinatura de transações de usuário.
7. **Fuzz 60s vs meta 600s+/7 runs; 4 contratos críticos sem target** (router, staking, asset_wrapper, listing_manager).
8. **Restore-from-S3 drill nunca executado; RTO/RPO não medidos** — backup não testado = backup que não existe.
9. **Sem chaos/failure-injection** — comportamento do settlement/relayer quando a chain cai no meio do fluxo nunca foi testado (alerta BlockchainNodeUnreachable existe; recuperação, não).
10. **WS e matching engine sem teste de carga/concorrência** — locks Redis do matching nunca exercitados sob corrida.

---

## 3. E2E E O QUE FALTA PARA O DRESS REHEARSAL (FASE 10)

**Hoje:** não existe suíte E2E de verdade. O que mais se aproxima: 17 testes "e2e" do spot-api (API+DB, sem chain, fora do CI) e o smoke-test do ci.yml (4 GETs em endpoints read-only, `ci.yml:393-414`).

**Checklist mínimo para a Fase 10:**
1. `scripts/dress-rehearsal.sh`: clean clone → build → deploy testnet → list token → add liquidity → swap → settle → verificar no subquery — com asserções e exit code.
2. 3-5 `#[ink_e2e::test]` contra `substrate-contracts-node` no CI (caminhos de fundos).
3. Smoke Playwright no frontend (conectar wallet mock → quote → assinar swap em sandbox).
4. Chaos: derrubar lunes-node/postgres durante settlement e verificar recuperação + alerta (depende do P0-1 corrigido).
5. Restore-from-S3 drill gravado com RTO medido (P1-8).
6. Fuzz 600s × 7 runs verdes (P1-8).
7. Disparo de alerta de teste ponta-a-ponta: Prometheus → Alertmanager → Slack/PagerDuty (prova do P0-1).

---

## 4. MELHORIAS QUE APROVO PARA IMPLEMENTAÇÃO IMEDIATA

Baixo risco, alto retorno — podem ser feitas hoje sem depender de decisão de produto:

1. **Fix do Alertmanager** (P0-1): entrypoint envsubst + `amtool check-config` como step no ci.yml.
2. **Admin no CI** (P1-1): 2 entradas de matriz + 1 filtro de paths + `--max-warnings=0`.
3. **Job `test-api-e2e` no ci.yml** (P1-2): reaproveita services postgres/redis existentes; incluir no `ci-status`.
4. **`ci-status` ganha build-contracts/test-contracts** (P1-6): 4 linhas.
5. **`npm ci` everywhere + lockfile no Dockerfile.api** (P1-5).
6. **Fuzz nightly 600s + cache de corpus** (P1-8): 3 linhas no fuzz.yml.
7. **Deletar `pr-checks.yaml` e `datasources/prometheus.yml` duplicado** (P2-5, P2-6).
8. **Pinar trivy-action e certbot; `extra_hosts` no prometheus** (P2-1, P2-4, P3-1).
9. **Métrica `lunex_last_backup_age_seconds`** via textfile collector no backup.sh + node_exporter (P1-7 parcial).
10. **`mem_limit` em subquery-node/postgres/api** (P2-2, começo conservador).

Itens que exigem esforço de engenharia planejado (não "imediato", mas bloqueantes da Fase 10): suíte ink_e2e, testes do SDK/subquery, dress-rehearsal.sh, restore drill, chaos test.

---
*Relatório gerado pelo Especialista 5 (DevOps/Infra + QA) — auditoria de prontidão mainnet Lunex DEX.*
