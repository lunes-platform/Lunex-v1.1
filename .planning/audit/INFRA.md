# Infrastructure & Deployment Production Readiness Audit

**Date:** 2026-05-21
**Scope:** Secrets, deployment, observability, recovery, CI/CD, networking
**Method:** TESTS BEFORE CODE — specs derived from `PRODUCTION-READINESS.md` (2026-04-28) + `.planning/codebase/*` (2026-05-21), then verified against infra files.
**Sources:** read-only; no code or config modified.

---

## Inventory

### Docker Compose variants

| File | Role | Path |
|---|---|---|
| `docker-compose.dev.yml` | Local dev (all-in-one) | `/Users/lucas/Documents/Projetos_DEV/Lunex/docker-compose.dev.yml` |
| `docker/docker-compose.prod.yml` | Production reference stack (~15 KB, 20+ services) | `/Users/lucas/Documents/Projetos_DEV/Lunex/docker/docker-compose.prod.yml` |
| `docker/docker-compose.testnet.yml` | Testnet overlay | `/Users/lucas/Documents/Projetos_DEV/Lunex/docker/docker-compose.testnet.yml` |
| `docker/docker-compose.sandbox.yml` | Sandbox overlay (`sandbox-api` :4010, `sandbox-frontend`) | `/Users/lucas/Documents/Projetos_DEV/Lunex/docker/docker-compose.sandbox.yml` |
| `docker/docker-compose.doppler.yml` | Doppler-injected variant | `/Users/lucas/Documents/Projetos_DEV/Lunex/docker/docker-compose.doppler.yml` |

### Dockerfiles
- `docker/Dockerfile.api` — `node:20-alpine`, multi-stage, non-root `lunex:1001`, runs `prisma migrate deploy` on boot, internal HEALTHCHECK.
- `docker/Dockerfile.frontend` — Vite build → nginx serve.
- `docker/Dockerfile.admin` — Next.js standalone.
- `faucet/Dockerfile` — 208B, minimal.

### PM2 services (`/Users/lucas/Documents/Projetos_DEV/Lunex/ecosystem.config.js`)
- **One app**: `lunex-api` (`dist/index.js`, cwd `/opt/lunex/spot-api`, fork mode, 1 instance, `max_memory_restart: 512M`, `restart_delay: 5000`, `max_restarts: 10`, `min_uptime: 10s`).
- **No PM2 entry** for admin, frontend, faucet, subquery-node, subquery-query — those run only via Docker.
- Logs `/var/log/lunex/api-{error,out}.log`.

### GitHub Actions workflows (`/Users/lucas/Documents/Projetos_DEV/Lunex/.github/workflows/`)
- `ci.yml` (15 KB) — validate, build-ts, test-api (Jest+pg+redis), validate-subquery, build-contracts (matrix x9), test-contracts (`cargo test --workspace --exclude fuzz`), smoke-test, ci-status gate.
- `pr-check.yml` (8 KB) — paths-filter; typecheck + `npm run quality` per changed module + `cargo clippy -D warnings`. PR-gate aggregator.
- `pr-checks.yaml` (1.6 KB) — likely older duplicate; presence of two PR check workflows is a drift smell.
- `deploy.yml` (17 KB) — security (gitleaks + npm audit high) → lint → test-api → build (GHCR push, SBOM, provenance) → Trivy scan → deploy-dev (sandbox SSH) / deploy-prod (main, SSH, health-gated, auto-rollback to previous SHA) / manual `rollback` job.
- `release.yml` (12 KB) — RC versioning, GitHub Release with artifacts + Docker images.
- `gitleaks.yml` — push + PR + nightly 02:00 UTC cron, full history depth.
- `contracts.yml` — rustfmt, clippy `-D warnings`, `cargo test --workspace --exclude fuzz`, compile matrix x12, `cargo audit`.
- `fuzz.yml` — push/PR (paths-filtered) + **nightly 02:00 UTC** matrix on `pair_invariant`, `copy_vault_accounting`, `spot_settlement_replay` (60s default), + property tests job.
- `manual-fuzz-security.yml` — manual long-form fuzz runner.
- `security-audit.yml` (1.2 KB) — short security audit job.
- `prelaunch-security.yml` — manual workflow with approval-doc gate, gitleaks, `npm audit --audit-level=high` for 5 packages, targeted Jest suites, Rust `property_security_invariants` tests.

### Doppler scope (`/Users/lucas/Documents/Projetos_DEV/Lunex/.doppler.yaml`)
- Project `lunex-dex`, config `production` — **single** environment binding at repo root.
- Bootstrap script `scripts/setup-doppler.sh` (6.3 KB); compose overlay `docker/docker-compose.doppler.yml`.

### Observability stack
- **Prometheus** `docker/prometheus.yml` (3.1 KB) — jobs: `lunex_api` (api:4000/metrics), self, `node_exporter` (host:9100), `postgres_exporter`, `redis_exporter`, `nginx` via nginx-exporter, `ssl_expiry` + `http_probe` via blackbox-exporter for `lunex.lunes.io` + `lunex-sandbox.lunes.io`. 30d TSDB retention.
- **Alert rules** `docker/alert-rules.yml` (9.6 KB) — 6 groups, ~22 rules; details in matrix below.
- **Alertmanager** `docker/alertmanager.yml` — 3 receivers (ops, critical-pager+PagerDuty, security), Slack + email + PagerDuty wired via env.
- **Grafana** `docker/grafana/provisioning/` — datasources (`prometheus.yml`, `datasources.yml`) and one dashboard `dashboards/lunex-overview.json`. **No Loki datasource file detected** under provisioning (Loki ships logs but dashboards/datasources may need a separate entry).
- **Loki** `docker/loki-config.yml` (1.8 KB) — 30d retention, filesystem store, single-node.
- **Promtail** — inline config in `docker-compose.prod.yml`, scrapes Docker socket + `/var/log`.
- **Blackbox exporter** `docker/blackbox-exporter.yml` — `tcp_connect_tls`, `http_2xx`, `icmp`.
- **NOT version-controlled**: any Grafana dashboards other than `lunex-overview.json` (only one provisioned).

---

## Verification Matrix

### Secrets

| SPEC | Status | Evidence |
|---|---|---|
| SPEC-SEC-001 — prod secrets in Doppler, no .env in repo/images | **PARTIAL** | `.doppler.yaml` binds prod; `ecosystem.config.js` documents `doppler run -- pm2 start`. But `docker-compose.prod.yml` reads `${VAR:?…}` env (Doppler shim required); `docker/.env.prod.example`, `.env.sandbox.example`, `.env.testnet.example` exist (templates, not committed `.env`). **DRIFTED**: `lunex-admin/.next/standalone/lunex-admin/.env` contains a weak dev `AUTH_SECRET` per `.planning/codebase/CONCERNS.md` — ships inside any image built from that tree. `.env.example` (root) ships the well-known "horn horn horn" test mnemonic. |
| SPEC-SEC-002 — gitleaks catches private_key/mnemonic/seed/api_key | **COVERED** | `.gitleaks.toml` uses default rules + 2 custom rules (`lunes-wallet-key`, `substrate-seed-phrase` for 12–24-word mnemonics). |
| SPEC-SEC-003 — gitleaks runs on every PR | **COVERED** | `gitleaks.yml` triggers on push + PR + nightly cron; `deploy.yml` re-runs in `security` job; `prelaunch-security.yml` runs at release gate. |
| Bonus — gitleaks allowlist gaps | **DRIFTED** | `.gitleaks.toml` allowlists `.env.example` and `test/`. Combined with root `.env.example` shipping a known test mnemonic, leak detection can never flag the footgun. (Tracked in `CONCERNS.md` "Root `.env.example` ships well-known mnemonic".) |
| Bonus — dev seed fallback to `//Alice` | **MISSING (Tier 0)** | `spot-api/src/services/assetBridgeService.ts:466` — `process.env.BRIDGE_ADMIN_SEED \|\| '//Alice'` not blocked by `productionGuards.ts`. |

### Deployment

| SPEC | Status | Evidence |
|---|---|---|
| SPEC-DEPLOY-001 — reproducible from git SHA | **PARTIAL** | `deploy.yml` builds GHCR images tagged `type=sha,prefix=,format=short`; `latest` tag also pushed on main. Deploy step exports `IMAGE_TAG=${{ needs.build.outputs.image_tag }}` (short SHA) into compose. But `docker-compose.prod.yml` defaults to `${IMAGE_TAG:-latest}` — if the SSH `export` is dropped, deploy silently pulls `latest`, breaking reproducibility. |
| SPEC-DEPLOY-002 — PM2 restarts on crash | **COVERED** | `ecosystem.config.js`: `restart_delay: 5000`, `max_restarts: 10`, `min_uptime: '10s'`, `max_memory_restart: 512M`. |
| SPEC-DEPLOY-003 — docker-compose.prod.yml pins image SHAs | **DRIFTED** | Third-party images **pinned by version**: `postgres:15-alpine`, `redis:7-alpine`, `prom/prometheus:v2.51.0`, `prom/alertmanager:v0.27.0`, `grafana/grafana:10.4.0`, `grafana/loki:3.0.0`, `grafana/promtail:3.0.0`, `subquerynetwork/subql-node-substrate:v6.4.0`, `prom/blackbox-exporter:v0.25.0`, `prometheuscommunity/postgres-exporter:v0.15.0`, `oliver006/redis_exporter:v1.63.0`, `nginx/nginx-prometheus-exporter:1.1.0`, `nginx:1.25-alpine`. **No `@sha256:` digest pinning** anywhere — supply-chain attack via tag re-publish is possible. Lunex images use a mutable `IMAGE_TAG:-latest`. |
| SPEC-DEPLOY-004 — healthchecks defined for every service | **PARTIAL** | Healthchecks present: `postgres`, `redis`, `api`, `admin`, `subquery-node`, `blackbox-exporter`, `loki`. **MISSING**: `frontend`, `subquery-query`, `nginx`, `prometheus`, `grafana`, `alertmanager`, `promtail`, `db-backup`, `certbot`, `postgres-exporter`, `redis-exporter`, `nginx-exporter` — restart policy only. |
| Bonus — resource limits | **MISSING** | No `deploy.resources` / `mem_limit` / `cpus:` anywhere. Confirms `CONCERNS.md` "No container resource limits". |
| Bonus — DB connection pool | **MISSING** | `DATABASE_URL` in compose has no `?connection_limit=` param. Confirms `CONCERNS.md` finding. |
| Bonus — `prisma migrate deploy` on every boot | **DRIFTED** | `docker/Dockerfile.api:35` runs `npx prisma migrate deploy` on every container start; **and** `deploy.yml` runs it again in a one-shot container. Double migration is idempotent but ambiguous; concurrent boots can race on a fresh schema. |

### Observability

| SPEC | Status | Evidence |
|---|---|---|
| SPEC-OBS-001 — `/metrics` exposed on every TS service | **PARTIAL** | `spot-api/src/utils/metrics.ts` exists + Prometheus job `lunex_api`. **MISSING**: no `/metrics` job for `admin` (Next.js) or `frontend` — only blackbox HTTP probes. Subquery-node has no Prometheus scrape job. Faucet has no metrics. |
| SPEC-OBS-002 — Loki collects stdout/stderr from PM2 + Docker | **PARTIAL** | Promtail wired to `/var/lib/docker/containers` + Docker socket SD. **No PM2-specific scrape config** — relevant only if any service is run under PM2 on the same host (per `ecosystem.config.js`, `lunex-api` may run via PM2 instead of Docker on `/opt/lunex`). If both deploys coexist, PM2 stdout in `/var/log/lunex/api-*.log` would need an explicit Promtail static_config; it's not present. |
| SPEC-OBS-003 — Alertmanager rules for: down service, high error rate, finality lag, indexer fall-behind, low bridge balance | **PARTIAL** | **COVERED**: `APIDown`, `APIHighErrorRate`, `APIHighLatency`, `BlockchainNodeUnreachable`, `OrderSettlementBacklog`, `PostgreSQLDown`, `RedisDown`, `SSLCertificateExpiringSoon/Critical`, `MultipleFailedAuthAttempts`, `SuspiciousOrderVolume`, `DatabaseBackupFailed`. **MISSING**: finality lag (no metric for `isFinalized` lag despite settlement awaiting finality), SubQuery indexer fall-behind (no `subquery-node` scrape, no `indexer_last_block` gauge), bridge admin balance, copy-vault TVL drop, relayer key rotation reminder, reward distribution lock contention, Promtail/Loki down, Alertmanager self-monitor. |
| SPEC-OBS-004 — Grafana dashboards version-controlled | **PARTIAL** | One dashboard committed: `docker/grafana/provisioning/dashboards/lunex-overview.json`. PRODUCTION-READINESS claims "health, p99 latency, error rate, SSL days-to-expiry, vault equity, pending settlements". **No** finality-lag, indexer-lag, reward-distribution, or copy-vault dashboards. |

### Recovery

| SPEC | Status | Evidence |
|---|---|---|
| SPEC-REC-001 — Postgres backup automated (frequency, retention) | **COVERED with caveat** | `docker/backup.sh`: daily 01:00 UTC, gzip pg_dump, S3 upload mandatory (`BACKUP_S3_BUCKET:?` in compose), local retention 7d, S3 retention 30d, `STANDARD_IA` storage class. Caveat: AWS CLI is `apk add`'d at runtime on first run — first-ever container start has a single-point-of-failure window if PyPI/Alpine repos are down. |
| SPEC-REC-002 — SubQuery indexer resync from chain | **PARTIAL** | `subquery-node/entrypoint.sh` renders `project.yaml` from template with `LUNES_START_BLOCK` at startup. Resync mechanism exists in principle (clear `subquery` schema, restart) but no documented runbook for the operation. |
| SPEC-REC-003 — Documented runbook for: chain halt, bridge desync, indexer lag, DB restore | **MISSING** | `grep -r runbook` finds **only URL stubs** in `alert-rules.yml` (`https://github.com/your-org/lunex/blob/main/docs/runbooks/...` — placeholder org). No `docs/runbooks/` dir exists. No incident or operations docs found. `docs/DEPLOYMENT.md` (14 KB) and `docs/LOCAL_TESTNET_DEPLOY.md` (13 KB) cover deploy but not incident response. |
| Bonus — backup restore test | **MISSING** | `backup.sh` writes but never verifies; no `restore.sh` script; no CI job to test restore against a scratch DB. |
| Bonus — rollback path | **PARTIAL** | `deploy.yml` has an inline auto-rollback on health-check fail (resolves previous SHA via `docker images | sed -n '2p'`) and a manual `rollback` workflow_dispatch. Both depend on the previous image still being present on the VPS — `docker system prune -f --filter "until=24h"` runs at end of deploy, so a deploy at hour 25 could prune the rollback target before the next deploy. Database rollback is **not** addressed (Prisma migrations are forward-only). |

### CI/CD

| SPEC | Status | Evidence |
|---|---|---|
| SPEC-CI-001 — every PR runs unit + integration + lint + typecheck + gitleaks | **COVERED** | `pr-check.yml` (typecheck + `npm run quality` per changed module + `cargo clippy -D warnings`), `ci.yml` (test-api + smoke-test on push), `gitleaks.yml` (PR + push), `deploy.yml security` job (gitleaks + npm audit high). Subquery validation runs on subquery-touching PRs. |
| SPEC-CI-002 — nightly fuzz runs scheduled | **COVERED** | `fuzz.yml` cron `0 2 * * *` runs `pair_invariant`, `copy_vault_accounting`, `spot_settlement_replay`. Default duration 60s/target (low — production-readiness would push 600s+ nightly). Note: `CONCERNS.md` flags `copy_vault` fuzz at `Lunex/contracts/copy_vault/fuzz/fuzz_targets/fuzz_vault.rs` is **comment-only stub** — the root-level `copy_vault_accounting` is a parallel `VaultModel` not the actual contract. |
| SPEC-CI-003 — coverage reported | **PARTIAL** | `ci.yml test-api` uploads `coverage/` artifact when present but runs `--no-coverage` for speed. No coverage gate. No coverage badge or codecov integration. |
| SPEC-CI-004 — release pipeline tagged & traceable | **COVERED** | `release.yml`: derives `vX.Y.Z` or `vX.Y.Z-rcN`, tags via bot, creates GH Release with `release-notes.md`, attaches `release-artifacts/*` tarballs, builds & pushes `lunex-api` + `lunex-frontend` to GHCR with version + sha tags. |
| Bonus — duplicate PR workflow | **DRIFTED** | Both `pr-check.yml` (8 KB, comprehensive) and `pr-checks.yaml` (1.6 KB, older) live in `.github/workflows/`. Risk of conflicting status checks. |
| Bonus — Node version skew in deploy.yml | **DRIFTED** | `deploy.yml env.NODE_VERSION: '18'` while `ci.yml`, `pr-check.yml`, `release.yml` use `'20'`. Per `PRODUCTION-READINESS.md`, `Dockerfile.api` was standardised on Node 20; deploy CI is still on 18. |
| Bonus — Trivy non-blocking | **DRIFTED** | `deploy.yml scan-images` job sets `exit-code: '0'` (report-only). Critical/High CVEs in built images do not block production deploy. |
| Bonus — CI uses `npm install`, not `npm ci` | **DRIFTED** | All workflows run `npm install` rather than `npm ci`. Lockfile drift is silently fixed during CI, undermining deterministic builds. |

### Networking

| SPEC | Status | Evidence |
|---|---|---|
| SPEC-NET-001 — nginx terminates TLS with auto-renew | **COVERED** | `nginx.prod.conf` :443 with `ssl_certificate /etc/letsencrypt/live/lunex.lunes.io/fullchain.pem`. `docker-compose.prod.yml` `certbot` service in 12h renew loop. nginx command line does 6h reload loop. TLSv1.2+1.3, OCSP stapling, HSTS preload (`max-age=63072000; includeSubDomains; preload`). |
| SPEC-NET-002 — Rate limits at edge | **COVERED** | nginx zones: `api_global` 60r/m, `api_orders` 10r/s, `api_auth` 5r/m, `frontend` 200r/m, `rpc_limit` 30r/s, `limit_conn 20`. Edge-side rate limit; app-side Redis sliding window in `spot-api/src/utils/redisRateLimit.ts`. |
| SPEC-NET-003 — WS endpoints secured | **COVERED** | `nginx.prod.conf:201,408,551` proxy `/ws` to `ws_backend` / `sandbox_ws_backend`. CSP `connect-src` allowlists `wss://lunex.lunes.io wss://ws.lunes.io`. App-side `ALLOWED_WS_ORIGINS:?Set` required. |
| Bonus — CSP allows `unsafe-inline` + `unsafe-eval` | **DRIFTED** | `nginx.prod.conf:128,336` — `script-src 'self' 'unsafe-inline' 'unsafe-eval'`. Per PRODUCTION-READINESS Pre-Mainnet checklist "Non-blocking polish": still open. XSS containment weakened. |
| Bonus — `stub_status` ACL | **COVERED** | nginx :8888 only allows `172.16.0.0/12`, `10.0.0.0/8`, `127.0.0.1`. |
| Bonus — admin internal not exposed | **PARTIAL** | `internal_network` is `internal: true` (no egress), `public_network` only has nginx + blackbox-exporter. Confirms isolation. |

---

## Critical Production Blockers

1. **[CRITICAL] No runbooks exist.** Alert-rule annotations reference `https://github.com/your-org/lunex/blob/main/docs/runbooks/...` — `your-org` is the placeholder. No `docs/runbooks/` directory. Operators receive a PagerDuty alert for `BlockchainNodeUnreachable` or `APIDown` with no documented response. **Cannot operate production without this.**

2. **[CRITICAL] Backup restore is untested.** `backup.sh` writes to S3 but no `restore.sh`, no CI job exercises a restore, no documented restore time objective (RTO). Per industry standard: a backup that has not been restored is a hope, not a backup.

3. **[CRITICAL] No SubQuery indexer Prometheus scrape, no indexer-lag alert.** SubQuery falling behind silently breaks social/historical features and any service consuming `subqueryClient.ts`. No `indexer_last_block` gauge, no alert. Operators learn from users.

4. **[CRITICAL] Image tags are mutable.** `docker-compose.prod.yml` uses `${IMAGE_TAG:-latest}` and all third-party images are tag-pinned not digest-pinned. A registry push by an attacker (or maintainer error) silently replaces production images on next pull. SBOM + provenance are emitted by `deploy.yml` but unused for verification at pull time.

5. **[CRITICAL] `BRIDGE_ADMIN_SEED` falls back to `//Alice`** at `spot-api/src/services/assetBridgeService.ts:466`. `productionGuards.ts` does not deny this. If env is misspelled in production Doppler config, asset-bridge signs as a publicly-known dev key. Tier 0 equivalent (also flagged in `CONCERNS.md`).

6. **[CRITICAL] No finality-lag alerts.** PRODUCTION-READINESS notes `settlementService` waits for `isFinalized`, but **(a)** the wait duration is unbounded and unmonitored (no `lunex_finality_wait_seconds` histogram), **(b)** per `CONCERNS.md`, `rewardPayoutService.ts` and `rebalancerService.ts` still confirm on `isInBlock`. A chain reorg between in-block and finality silently desyncs DB from chain.

7. **[CRITICAL] Trivy results are advisory only.** `deploy.yml scan-images` runs with `exit-code: '0'`. Critical/High CVE images deploy to production. Reports go to GitHub Security tab but no human review gate.

8. **[CRITICAL] `prisma migrate deploy` runs both in entrypoint and in deploy.yml.** On a rolling restart of multiple API replicas (if ever scaled), concurrent migration attempts can deadlock or partially apply. Today the PM2 ecosystem runs 1 replica, but the docker-compose has no `replicas: 1` guard either; the Dockerfile is unsafe for any scaled deployment.

9. **[HIGH] Healthchecks missing on 12 of 20 compose services.** Frontend, subquery-query, nginx, prometheus, grafana, alertmanager, promtail, db-backup, certbot, and all three -exporters lack healthchecks. Compose `depends_on: condition: service_healthy` cannot enforce ordering on services without one. Failed Grafana or Alertmanager goes unnoticed until an operator opens the dashboard.

10. **[HIGH] Doppler is described but Doppler-availability is single-point.** `.doppler.yaml` is the only secret source for `ecosystem.config.js`. No fallback documented (e.g. encrypted SOPS file) if Doppler is unreachable during a deploy. `docker-compose.doppler.yml` exists but compose `prod` reads env from shell, requiring `doppler run` to be live. Disaster scenario: Doppler outage + container restart = production stays down.

11. **[HIGH] Two PR-check workflows coexist** (`pr-check.yml` + `pr-checks.yaml`). Drift risk; one will be neglected on schema changes.

12. **[HIGH] `npm install` (not `npm ci`) across every CI job** — lockfile drift silently fixed. Combined with `package-lock.json` per subproject, builds are not byte-deterministic.

13. **[HIGH] CSP retains `unsafe-inline` + `unsafe-eval`** for `script-src` (lines 128, 336 of `nginx.prod.conf`). XSS containment essentially absent.

14. **[HIGH] Docker auto-rollback target may be pruned.** `deploy.yml` final step runs `docker system prune -f --filter "until=24h"`. If a deploy runs 25h after the previous one, the rollback's "second-most-recent SHA" tag is gone, and rollback fails silently into "no previous tag".

---

## Missing Runbooks

The following alert annotations promise a runbook URL that does not exist:

- `docs/runbooks/api-down.md` — referenced by `APIDown`
- `docs/runbooks/blockchain-down.md` — referenced by `BlockchainNodeUnreachable`

Runbooks needed for production (none of these exist):

- `chain-halt.md` — when Lunes WS is unreachable for >5 minutes
- `bridge-desync.md` — when `lunex_blockchain_connected==0` while users have pending wraps
- `indexer-lag.md` — when SubQuery falls >100 blocks behind tip
- `db-restore.md` — restore from `backup.sh` artifact (target RTO, S3 fetch, verification)
- `redis-failure.md` — when Redis loses AOF (matching locks, nonce store, rate limits — all critical)
- `relayer-key-rotation.md` — when `RELAYER_SEED` must be rotated (currently single-key)
- `bridge-admin-rotation.md` — `BRIDGE_ADMIN_SEED` rotation (NEW — see Tier 0 above)
- `settlement-backlog.md` — `OrderSettlementBacklog >100` (>10m, lunex_pending_settlements)
- `ssl-renewal-failure.md` — certbot renew failed; manual cert install path
- `deploy-rollback.md` — manual rollback when auto-rollback fails
- `incident-comms-template.md` — user-facing status page comms
- `oncall-rotation.md` — paging escalation table
- `copy-vault-emergency.md` — pause via raw signer (currently no admin emergency wire for `copy_vault` per `CONCERNS.md`)

---

## Missing Alert Rules

Mapped against `docker/alert-rules.yml` content:

1. **SubQuery indexer lag** — no metric, no scrape job, no alert. `indexer_last_block - chain_head > 100` should fire.
2. **Finality lag** — no metric for time between `isInBlock` → `isFinalized`. Critical for the relayer-driven settlement path.
3. **Pending finality queue** — distinct from `lunex_pending_settlements` (which tracks DB rows). A counter for transactions awaiting finality should fire if growing.
4. **Reward distribution lock not released** — `runWeeklyDistribution` uses a 30-min Redis lock. A hung lock should fire.
5. **Bridge admin balance low** — `BRIDGE_ADMIN_SEED`-derived account needs LUNES for fees; running dry halts all wraps/unwraps silently.
6. **Relayer balance low** — same for `RELAYER_SEED` account.
7. **Copy-vault TVL anomaly** — large drops in `vault_total_equity` (already a gauge) should alert; no rule exists.
8. **Margin liquidation rate spike** — no rule, despite production margin service.
9. **Prisma migration failure on deploy** — no rule (would manifest as API failing healthcheck but worth a distinct alert).
10. **Loki / Promtail / Alertmanager self-monitor** — current rules don't cover the observability plane itself; if Loki dies, log shipping fails silently.
11. **Doppler unavailability** — no probe.
12. **Backup last-success age metric missing in source.** `DatabaseBackupFailed` alert expects `lunex_last_backup_age_seconds`, but a quick check of `spot-api/src/utils/metrics.ts` does not show that metric defined. Alert will never fire — false sense of safety.
13. **Blackbox HTTP probe failure alert** — `http_probe` scrape exists but no `probe_success == 0` alert. SSL alert is present, but the simpler "site is down" probe alert is not.
14. **WebSocket reconnect-storm** — drop-to-zero exists; reconnect rate (oscillation) does not.
15. **`429 spike` is present** but `5xx ratio` alert (`APIHighErrorRate`) doesn't distinguish chain-related 5xx from app bugs.

---

## Backup / Recovery Gaps

- **No restore tested.** `docker/backup.sh` writes gzip dumps to S3 STANDARD_IA. Nothing has restored one.
- **No PITR (point-in-time-recovery).** `pg_dump` is logical only; no WAL archiving. Lost transactions between last 01:00 UTC dump and an incident are unrecoverable.
- **Single S3 bucket, no cross-region replication assumed.** `AWS_DEFAULT_REGION:-us-east-1` — if `us-east-1` has an outage during an incident, the backup is unreachable.
- **No backup integrity test.** No `gzip -t` or `pg_restore --list` verification step in `backup.sh`. A corrupt dump uploads successfully.
- **No backup of Redis AOF**, despite Redis holding matching locks, nonce store, rate-limit state. Per `docker-compose.prod.yml:228-231` AOF is enabled (`appendonly yes`, `appendfsync everysec`) and the `redisdata` volume is durable, but no off-host snapshot of `appendonly.aof`. Host loss = full Redis state loss + nonce replay window.
- **No backup of Loki chunks, Prometheus TSDB, Grafana DB.** All on local volumes (`lokidata`, `prometheusdata`, `grafanadata`). Host loss = full observability history loss.
- **No backup of `lunex-admin/.next/standalone/`** — but since `lunex-admin/` is gitignored AND has its own git repo (per `CONCERNS.md`), recovery depends on whichever box still has the source.
- **DB rollback unaddressed.** Prisma migrations are forward-only; a deploy that introduces a destructive migration cannot be rolled back by `deploy.yml`'s SHA-based image rollback alone.
- **`lunex-admin` source not in parent repo.** Per `.gitignore` + observed `lunex-admin/.git`. Parent rollback to prior SHA does not roll admin back. Reproducibility from a single git SHA is broken.

---

## Recommendations (priority order, mirroring `CONCERNS.md`)

1. **Write runbooks** for the 11 items listed above; replace `your-org` placeholder in alert annotations.
2. **Patch `BRIDGE_ADMIN_SEED` Tier 0**: add to `productionGuards.ts` denylist; fail-fast in `NODE_ENV=production`.
3. **Add `lunex_last_backup_age_seconds` metric**, OR remove the `DatabaseBackupFailed` alert (current state is misleading).
4. **Add SubQuery indexer scrape + lag alert**; expose `indexer_last_block` from subquery-node.
5. **Pin Docker images to `@sha256:` digests** in `docker-compose.prod.yml`; pin Lunex images to immutable git-SHA tag (drop `latest` fallback).
6. **Enforce Trivy gate** (`exit-code: '1'`) on Critical CVEs in production deploy. Use a sandboxed allowlist for known-acceptable findings.
7. **Test backup restore in CI nightly** (spin up empty Postgres, `aws s3 cp` newest dump, `pg_restore`, count rows).
8. **Drop `prisma migrate deploy` from `Dockerfile.api` CMD** — keep only the explicit `deploy.yml` step inside a single-shot container. Prevents migration race on scaled deploys.
9. **Resolve duplicate PR workflows** (`pr-check.yml` vs `pr-checks.yaml`).
10. **Standardise CI on `npm ci`**, not `npm install`.
11. **Standardise `NODE_VERSION` to `'20'` in `deploy.yml`**.
12. **Add healthchecks** to nginx, prometheus, grafana, alertmanager, frontend, db-backup, certbot, and all -exporters.
13. **Add `deploy.resources.limits`** per container, especially Postgres + Redis + API.
14. **Add `?connection_limit=10` to production `DATABASE_URL`.**
15. **Pull `lunex-admin/` into parent repo or wire as submodule with pinned SHA** so a single rollback rolls back everything.
16. **Add Loki datasource provisioning** under `docker/grafana/provisioning/datasources/` (currently only Prometheus).
17. **Replace CSP `unsafe-inline`/`unsafe-eval`** with nonce/hash strategy (per PRODUCTION-READINESS Pre-Mainnet polish).
18. **Increase nightly fuzz duration** from 60s to 600s+ per target; port `copy_vault` fuzz to a contract-binding driver (per `CONCERNS.md`).
19. **Add Prometheus PITR**: snapshot TSDB nightly to S3, OR set up Mimir/Thanos.
20. **Document doppler outage fallback** — encrypted SOPS-style emergency-only fallback secret bundle.

---

*Audit: 2026-05-21 — supplements `PRODUCTION-READINESS.md` (2026-04-28) and `.planning/codebase/CONCERNS.md` (2026-05-21).*
