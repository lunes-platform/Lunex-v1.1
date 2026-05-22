<!-- refreshed: 2026-05-21 -->
# Architecture

**Analysis Date:** 2026-05-21

## System Overview

Lunex is a hybrid on-chain / off-chain DEX protocol built on the Lunes Network (Substrate/Polkadot). Trading lifecycle is split: order intake, matching and rewards orchestration happen off-chain in `spot-api/`; custody, liquidity, listing fees and final settlement are anchored on-chain via ink! contracts under `Lunex/contracts/`. Two read planes coexist — REST + WebSocket from `spot-api` (authoritative for orderbook/social state) and a SubQuery GraphQL endpoint over indexed chain events.

```text
┌───────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                  │
├──────────────────┬──────────────────┬──────────────────┬──────────────────┤
│  lunes-dex-main  │  lunex-admin     │  @lunex/sdk      │  AI Agents / MCP │
│  React + Vite    │  Next.js 16      │  TypeScript      │  lunex-agent-mcp │
│  `lunes-dex-main`│  `lunex-admin`   │  `sdk`           │  `mcp`           │
│  :3000           │  :3001           │  npm package     │  stdio / HTTP    │
└────────┬─────────┴────────┬─────────┴────────┬─────────┴────────┬─────────┘
         │ HTTP + WS        │ HTTP             │ HTTP             │ X-API-Key
         │                  │                  │                  │
         ▼                  ▼                  ▼                  ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                       API LAYER — spot-api :4000                           │
│                                                                            │
│  REST  `spot-api/src/routes/*.ts`        WS  `spot-api/src/websocket/`     │
│  Auth  `spot-api/src/middleware/auth.ts` (sr25519 / Bearer / API-Key)     │
│  24 services  `spot-api/src/services/*.ts`                                 │
│  In-memory orderbook  `spot-api/src/utils/orderbook.ts`                    │
└──────────┬────────────────────────────────┬───────────────────────────────┘
           │ Prisma                         │ Polkadot.js / api-contract
           ▼                                ▼
┌─────────────────────────────┐  ┌──────────────────────────────────────────┐
│      PERSISTENCE            │  │      BLOCKCHAIN — Lunes Network          │
│  PostgreSQL 15  (Prisma)    │  │  Substrate node, WS :9944, RPC :9933    │
│  Redis 7  (nonces, rate)    │  │  ink! 4.2.1 contracts under              │
│  `spot-api/prisma/`         │  │  `Lunex/contracts/`                      │
└─────────────────────────────┘  └────────────────┬─────────────────────────┘
           ▲                                       │ events
           │ tables (--db-schema=subquery)         ▼
           │                          ┌──────────────────────────────────────┐
           └──────────────────────────┤  INDEXER — subquery-node             │
                                      │  subql-node-substrate :3010          │
                                      │  subql-query GraphQL :3011           │
                                      │  `subquery-node/`                    │
                                      └──────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File / Directory |
|-----------|----------------|------------------|
| `lunes-dex-main` | End-user trading UI, wallet signing flow, social feed, copy/asymmetric LP UX | `lunes-dex-main/src/` |
| `lunex-admin` | Internal operations console: listings approval, treasury, audit, emergency switches, payouts | `lunex-admin/src/app/(admin)/` |
| `spot-api` | REST + WebSocket gateway, sr25519 auth, off-chain matching, settlement orchestration, schedulers, Prisma+Redis persistence | `spot-api/src/` |
| `sdk` (`@lunex/sdk`) | TypeScript HTTP + WebSocket client, signing helpers, public type surface | `sdk/src/index.ts` |
| `mcp/lunex-agent-mcp` | Model Context Protocol server exposing spot-api tools (trade, social, copytrade) to AI agents | `mcp/lunex-agent-mcp/src/index.ts` |
| `Lunex/contracts/` (ink!) | On-chain AMM, settlement, custody, staking, rewards, listing fee, vault, PSP22 | `Lunex/contracts/*/lib.rs` |
| `subquery-node` | Substrate event indexer; emits GraphQL view of swaps, liquidity, vaults, trades | `subquery-node/src/mappings/` |
| `faucet` | Testnet token faucet (separate Express service) | `faucet/index.js` |
| `lunex-sim-tests` (root crate) | Integration simulation tests over decimal utils and native asset bridging | `src/lib.rs`, `src/decimal_utils.rs`, `src/native_assets_integration.rs` |
| Smart-contract artifacts | Pre-built `.contract` / metadata `.json` consumed by deploy scripts | `artifacts/`, `spot-api/abis/`, `lunes-dex-main/src/abis/` |

## Pattern Overview

**Overall:** Hybrid layered DEX — off-chain matching with on-chain settlement.

**Key Characteristics:**
- Off-chain authoritative orderbook (`spot-api/src/utils/orderbook.ts`) backed by PostgreSQL for durability and Redis for nonces/rate limits.
- All wallet-driven writes carry sr25519 signatures verified server-side (`spot-api/src/middleware/auth.ts`); nonces are single-use, TTL-bound in Redis.
- ink! 4.2.1 contracts hold custody, liquidity, fee distribution and listing escrow. Settlement is initiated by a `RELAYER_SEED` keypair from `spot-api/src/services/settlementService.ts`.
- Three independent authentication classes coexist: user sr25519 signed messages, admin Bearer (`ADMIN_SECRET`), and agent API keys (`X-API-Key: lnx_*`).
- Read path is split: spot-api owns operational state (orders, trades, social); SubQuery owns historical chain events queried via GraphQL by `spot-api/src/services/subqueryClient.ts`.
- Scheduler-driven background work (`rewardScheduler`, `copytradeWalletContinuationScheduler`, `socialAnalyticsPipeline`, `vaultReconciliationService`, `tradeSettlementService`) runs inside the spot-api process.

## Layers

**Client (UI / SDK / MCP):**
- Purpose: User experience, programmatic clients, agent integrations
- Location: `lunes-dex-main/`, `lunex-admin/`, `sdk/`, `mcp/lunex-agent-mcp/`
- Contains: React components, Next.js admin routes, TS client, MCP tool registrations
- Depends on: `spot-api` REST + WS, wallet extensions (polkadot.js), chain RPC (for read-only contract queries)
- Constraint (AGENTS.md): UI must never be the source of truth for financial rules, authz, matching, rewards, listing or settlement.

**API (off-chain core):**
- Purpose: Authenticate, validate, match, persist, broadcast and orchestrate on-chain settlement
- Location: `spot-api/src/`
- Contains: Express routers (`routes/`), domain services (`services/`), middleware (`middleware/`), in-memory orderbook (`utils/orderbook.ts`), WebSocket server (`websocket/server.ts`)
- Depends on: PostgreSQL via Prisma (`spot-api/prisma/schema.prisma`), Redis via `ioredis`, Lunes node via `@polkadot/api` + `@polkadot/api-contract`, SubQuery GraphQL
- Used by: Frontend, admin, SDK, MCP server, deploy scripts

**Persistence:**
- PostgreSQL 15 — single database `lunex_spot`; `spot-api` uses `public` schema, SubQuery uses `subquery` schema in the same DB (per `docker-compose.dev.yml`).
- Redis 7 — nonces, rate-limit counters, ephemeral matching locks (`matchingLockService.ts`).
- ORM: Prisma 5.10 (`spot-api/prisma/schema.prisma`, ~40 KB; `lunex-admin/prisma/schema.prisma`, ~22 KB — see *Architectural Constraints* on dual-schema sync).

**Indexer:**
- Purpose: Block-by-block ingestion of ink! contract events into PostgreSQL, exposing GraphQL.
- Location: `subquery-node/src/mappings/`, `subquery-node/schema.graphql`
- Runtime images: `subquerynetwork/subql-node-substrate:v6.4.0` (indexer) + `subquerynetwork/subql-query:v2.13.1` (GraphQL).
- Consumed by: `spot-api/src/services/subqueryClient.ts` for historical lookups.

**On-chain (Lunes / ink!):**
- Purpose: Custody, AMM math, listing escrow, staking, rewards, vault accounting.
- Location: `Lunex/contracts/*/lib.rs`
- Stack: ink! 4.2.1, scale codec 3, scale-info 2, wasm32-unknown-unknown.
- Grouped by responsibility:
  - AMM core — `Lunex/contracts/factory/`, `Lunex/contracts/pair/`, `Lunex/contracts/router/`, `Lunex/contracts/wnative/`
  - Spot orderbook settlement — `Lunex/contracts/spot_settlement/`
  - Liquidity products — `Lunex/contracts/asymmetric_pair/`, `Lunex/contracts/copy_vault/`
  - Incentives — `Lunex/contracts/staking/`, `Lunex/contracts/rewards/`
  - Listing pipeline — `Lunex/contracts/listing_manager/`, `Lunex/contracts/liquidity_lock/`
  - Token primitives & bridges — `Lunex/contracts/psp22/`, `Lunex/contracts/asset_wrapper/`

## Data Flow

### Primary Request Path — Order Placement

1. Wallet builds order payload + sr25519 signature; frontend POSTs to `POST /api/v1/orders` (`spot-api/src/routes/orders.ts`).
2. `auth.ts` middleware verifies signature and consumes a Redis nonce (`spot-api/src/middleware/auth.ts`).
3. `orderService.createOrder()` validates pair / balance / decimals and persists `Order` row (`spot-api/src/services/orderService.ts`).
4. Order is pushed into in-memory `Orderbook` with price-time FIFO (`spot-api/src/utils/orderbook.ts`).
5. Matching produces `MatchResult`s; `tradeService` writes `Trade` rows; orderbook is mutated under `matchingLockService.ts`.
6. `settlementService.ts` builds a contract call to the AMM/pair settlement and signs with `RELAYER_SEED` via `withTxTimeout` (`spot-api/src/utils/txWithTimeout.ts`).
7. WebSocket server broadcasts orderbook delta + per-user trade event (`spot-api/src/websocket/server.ts`, allow-listed channels `orderbook:`, `trades:`, `ticker:`).

### Smart Router / Swap Path

1. Client requests a quote: `GET /api/v1/route?...` (`spot-api/src/routes/router.ts`).
2. `routerService.ts` compares Orderbook depth vs AMM (`factoryService.ts` / on-chain `router` contract query) vs Asymmetric Pair (`asymmetricService.ts`).
3. Best-source decision returned to client; client signs and submits either an order (orderbook) or a contract tx (AMM/asymmetric) directly or via `executionLayerService.ts`.

### Copy Trade Path

1. Leader (API-key auth) signals via `POST /api/v1/copytrade/vaults/:leaderId/signals` (`spot-api/src/routes/copytrade.ts`).
2. `copytradeService.ts` enumerates active follower vault positions and computes proportional sizing.
3. Mirrored orders fan out through `orderService.createOrder()` per follower; `copytradeWalletContinuationScheduler.ts` retries follower fills that didn't complete in the same tick.

### Listing / Rewards / Affiliate Flows

- Listing fee escrow + treasury split happens on-chain in `Lunex/contracts/listing_manager/` and `liquidity_lock/`; off-chain mirror lives in `spot-api/src/services/listingService.ts` and `lunex-admin/src/app/(admin)/listings/`.
- Affiliate commissions are persisted per trade by `affiliateService.ts` and paid in batches (cron-style call to `processPayoutBatch`).
- Reward distribution + payout split between `rewardDistributionService.ts` (computation) and `rewardPayoutService.ts` (chain payout), scheduled by `rewardScheduler.ts`.

### State Management

- Authoritative trading state: PostgreSQL (Prisma).
- Hot path: in-memory orderbook per pair, rebuilt at boot by `orderbookBootstrapService.ts` (`rehydrateOrderbooks` in `spot-api/src/index.ts`).
- Replay protection / dedup: Redis (`spot-api/src/utils/redis.ts`, `redisRateLimit.ts`).
- Chain historical: SubQuery (`subquery-node/schema.graphql`, queried via `subqueryClient.ts`).

## Key Abstractions

**Signed Action / Nonce:**
- Purpose: Authenticates a wallet-initiated action while preventing replay.
- Examples: `spot-api/src/middleware/auth.ts` (`SIGNED_ACTION_TTL_MS`, `consumeNonce`).
- Pattern: Build canonical message (e.g. `buildSpotOrderMessage`), verify via `signatureVerify` from `@polkadot/util-crypto`, atomically `SET ... NX EX` the nonce key in Redis with an in-memory fallback to keep replay protection working through Redis outages.

**Orderbook (in-memory):**
- Purpose: Hot path for matching engine.
- Examples: `spot-api/src/utils/orderbook.ts` (`Orderbook`, `MatchResult`).
- Pattern: Sorted-array price-time priority; rehydrated from DB at startup; mutations guarded by `matchingLockService`.

**Service modules:**
- Purpose: Singleton domain services exposed as named exports.
- Examples: `settlementService`, `marginService`, `copytradeService`, `socialIndexerService` under `spot-api/src/services/`.
- Pattern: Each service owns one bounded domain, instantiates its own Polkadot.js connection where needed, and exposes async methods consumed by routers + schedulers.

**Routers (Express):**
- Purpose: Per-domain HTTP surface, Zod-validated, wired in `spot-api/src/index.ts`.
- Examples: `spot-api/src/routes/orders.ts`, `routes/copytrade.ts`, `routes/admin.ts`.
- Pattern: Thin controller → service → DB; admin paths gated by `requireAdminOrInternal` (`middleware/adminGuard.ts`); agent paths gated by `middleware/agentAuth.ts`.

**ink! contract pattern:**
- Purpose: One Cargo crate per contract, each producing `cdylib + rlib` and a metadata JSON consumed off-chain.
- Examples: `Lunex/contracts/pair/Cargo.toml`, `Lunex/contracts/factory/lib.rs`.
- Pattern: `#![cfg_attr(not(feature = "std"), no_std)]`, `ink::contract` macro, scale codec, optional `ink-as-dependency` feature so a contract can be cross-imported (e.g. `factory` depends on `pair_contract` with `ink-as-dependency`).

## Entry Points

**Backend HTTP/WS:**
- Location: `spot-api/src/index.ts`
- Triggers: `npm run dev` (`ts-node src/index.ts`) or PM2 `lunex-api` app (`ecosystem.config.js`, `dist/index.js`).
- Responsibilities: Boot Express, mount routers, install middlewares (`helmet`, `cors`, rate limit, `securityShield`, `responseSanitizer`), start WebSocket server, rehydrate orderbooks, kick off schedulers, expose `/metrics` Prometheus endpoint, register `unhandledRejection` / `uncaughtException` fatal handlers.

**Frontend:**
- Location: `lunes-dex-main/src/index.tsx` → `App.tsx`; build via `lunes-dex-main/vite.config.ts`.
- Triggers: `npm run dev` (Vite dev server) or `docker/Dockerfile.frontend` producing static bundle served by nginx.

**Admin:**
- Location: `lunex-admin/src/app/layout.tsx` (App Router), `middleware.ts` at repo of `lunex-admin/` for NextAuth gating.
- Triggers: `next dev` or `next start` (`lunex-admin/package.json`), `docker/Dockerfile.admin`.

**SDK:**
- Location: `sdk/src/index.ts` (re-exports `http-client.ts`, `websocket-client.ts`, types/utils).

**MCP server:**
- Location: `mcp/lunex-agent-mcp/src/index.ts` (~112 KB single-file MCP tool registry), `routerTools.ts`, `smokeRouter.ts`.
- Triggers: `npm run dev` (`tsx src/index.ts`) — communicates over MCP transport to spot-api.

**Indexer:**
- Location: `subquery-node/src/index.ts`, mappings under `subquery-node/src/mappings/`, schema in `subquery-node/schema.graphql`.
- Triggers: Docker images `subql-node-substrate` + `subql-query` (see `docker-compose.dev.yml`); `subquery-node/entrypoint.sh` regenerates `project.yaml` from `project.template.yaml` at container start.

**Faucet:**
- Location: `faucet/index.js`.
- Triggers: `node index.js` on testnet host, exposes `POST /faucet`, `GET /faucet`, `GET /faucet/status`, `GET /health`.

**Smart-contract build:**
- Triggers: `npm run compile:all` or per-contract `cargo contract build --release --manifest-path Lunex/contracts/<name>/Cargo.toml`.
- Output: `.contract` + metadata JSON in `artifacts/` and per-contract `target/ink/`.

## Architectural Constraints

- **Single-process event loop (spot-api):** All routers, the WebSocket server, the in-memory orderbook and the schedulers (`rewardScheduler`, `copytradeWalletContinuationScheduler`, `socialAnalyticsPipeline`, `vaultReconciliationService.start()`) share one Node.js event loop. PM2 runs `instances: 1, exec_mode: 'fork'` (`ecosystem.config.js`) — horizontal scale would require externalizing the orderbook and locks.
- **Relayer keypair is a privileged secret:** `RELAYER_SEED` (Substrate mnemonic/raw seed) signs on-chain settlement and reward payouts; required to be injected by Doppler / secret manager in production (see `assertProductionSecrets()` in `spot-api/src/index.ts`).
- **Two Prisma schemas, one database:** `spot-api/prisma/schema.prisma` (~40 KB) is the source of truth; `lunex-admin/prisma/schema.prisma` (~22 KB) is a subset consumed by the admin app. Per `AGENTS.md`, any change touching shared models must update both schemas and pass typecheck/build on both sides. `lunex-admin/` is intentionally excluded from the root TypeScript build.
- **Schema isolation in PostgreSQL:** spot-api uses `public`; SubQuery indexer uses `--db-schema=subquery` against the same `lunex_spot` DB (`docker-compose.dev.yml`).
- **Nonce store dual-layer:** Redis is primary, in-memory `fallbackNonces` is consulted first to remain replay-safe across Redis outages (`spot-api/src/middleware/auth.ts`).
- **WebSocket hard limits:** 1000 total clients, 20 per IP, 1 KB max payload, 50 subscriptions per client, channel allow-list (`orderbook:`, `trades:`, `ticker:`) (`spot-api/src/websocket/server.ts`).
- **Frontend is non-authoritative:** Per `AGENTS.md` ownership table, frontend is forbidden from owning matching, settlement, fees, rewards, listing activation, authorization or risk decisions.
- **ink! toolchain pinning:** ink! 4.2.1 (PSP22 v2 / ink! 5 explicitly avoided — see comments in `Lunex/contracts/pair/Cargo.toml`); `rust-toolchain.toml` at repo root pins the workspace toolchain; `cargo-contract@4.1.1` is required.
- **Build/deploy pipeline pinned to specific docker images:** `subquery-node:v6.4.0`, `subql-query:v2.13.1`, `postgres:15-alpine`, `nginx:1.25-alpine`.

## Anti-Patterns

### Putting financial rules in the frontend

**What happens:** Computing final fees, reward splits, comissions or matching outcomes inside `lunes-dex-main/src/services/`.
**Why it's wrong:** Violates `AGENTS.md` ownership rules; user-controlled code becomes the source of truth for money flow.
**Do this instead:** Frontend computes previews only; the authoritative value comes from `spot-api/src/services/*Service.ts` (and ultimately the ink! contract). Mirror the calculation on the server before persisting or settling.

### Reading directly from chain when SubQuery covers it

**What happens:** New service issues many `api.query.contracts.contractInfoOf` reads in a hot path.
**Why it's wrong:** Slow, hits node rate limits, doesn't survive node restarts; SubQuery already has block-by-block coverage of swaps/liquidity/vault/trade events (`subquery-node/schema.graphql`).
**Do this instead:** Use `spot-api/src/services/subqueryClient.ts` for historical event queries, reserve direct chain reads for live state that the indexer doesn't materialize.

### Bypassing the nonce/signature middleware

**What happens:** A new route reads `req.body.address` and trusts it without going through `verifyAddressSignature`.
**Why it's wrong:** Lets any caller impersonate any address (including the relayer).
**Do this instead:** Every wallet-initiated mutation must go through `spot-api/src/middleware/auth.ts` (signature verify + Redis nonce consume) — see `routes/orders.ts` for the canonical pattern.

### Drifting Prisma schemas between spot-api and admin

**What happens:** A model is added/changed only in `spot-api/prisma/schema.prisma`.
**Why it's wrong:** `lunex-admin` queries the same database via its own Prisma client; type drift leads to silent runtime failures in admin pages.
**Do this instead:** Treat `spot-api/prisma/schema.prisma` as the source of truth and explicitly sync `lunex-admin/prisma/schema.prisma` (or remove the model from admin) in the same task — per `AGENTS.md` "Admin e Schema Prisma".

### Tight coupling of router handlers to chain calls

**What happens:** An Express route awaits a chain extrinsic inline before responding.
**Why it's wrong:** Substrate finality can take seconds; the HTTP request times out and the client cannot tell whether the action succeeded.
**Do this instead:** Persist the intent (DB row, status `PENDING`), enqueue settlement via `settlementService` / `tradeSettlementService`, return immediately, and notify the client over WebSocket when the on-chain status changes. `withTxTimeout` (`spot-api/src/utils/txWithTimeout.ts`) bounds the worst case.

## Error Handling

**Strategy:** Centralized error middleware + fatal crash handlers.

**Patterns:**
- `spot-api/src/middleware/errors.ts` is the last `app.use(errorHandler)` — converts thrown errors into JSON responses with safe messages.
- `responseSanitizer` (`middleware/responseSanitizer.ts`) strips sensitive fields before serialization.
- `unhandledRejection` and `uncaughtException` in `spot-api/src/index.ts` log via Pino (`utils/logger.ts`) and `process.exit(1)` so the supervisor (Docker / PM2) restarts the process.
- Production secret validation happens at boot via `collectProductionConfigErrors` (`utils/productionGuards.ts`); missing secrets abort startup.
- Long-running chain calls are bounded by `withTxTimeout` (`utils/txWithTimeout.ts`).
- ink! contracts use `Result<T, Error>` with custom error enums per contract; revert reasons surface back to the relayer via Polkadot.js.

## Cross-Cutting Concerns

**Logging:** Pino (`spot-api/src/utils/logger.ts`); JSON in production, `pino-pretty` in dev.
**Metrics:** `prom-client` registry in `spot-api/src/utils/metrics.ts` exposing `httpRequestDuration`, `redisHealthy`, `dbHealthy`, `pendingSettlements`, `blockchainConnected`, `vaultTotalEquity`, `copytradeWalletContinuationsPending`, etc. Scraped by Prometheus (`docker/prometheus.yml`) and visualized via Grafana (`config/grafana/`).
**Validation:** Zod schemas inside each router; `middleware/validation.ts` for shared validators.
**Authentication:**
- Wallet writes — sr25519 signature + Redis nonce (`middleware/auth.ts`).
- Admin operations — `Authorization: Bearer <ADMIN_SECRET>` via `middleware/adminGuard.ts`.
- AI agents — `X-API-Key: lnx_*` validated via `middleware/agentAuth.ts` + `services/agentService.ts`, with staking tiers gating limits.
**Rate limiting:** `express-rate-limit` per route + Redis-backed counters in `utils/redisRateLimit.ts`; nginx adds a second-layer limit (`docker/nginx.prod.conf`).
**Security:** `helmet`, `securityShield` middleware (`middleware/securityShield.ts`), allow-listed WS origins, `app.disable('x-powered-by')`, `gitleaks` scanning via `.gitleaks.toml`.

## Deployment Topology

**Local / dev (`docker-compose.dev.yml`):**

| Service | Image / build | Host ports | Depends on |
|---------|---------------|-----------|-----------|
| `postgres` | `postgres:15-alpine` | 5433 → 5432 | — |
| `api` | `docker/Dockerfile.api` over `spot-api/` | 4000, 4001 | `postgres` (healthy) |
| `frontend` | `docker/Dockerfile.frontend` over `lunes-dex-main/` | 3000 → 80 | `api` |
| `admin` | `docker/Dockerfile.admin` over `lunex-admin/` | 3001 | `postgres`, `api` |
| `subquery-node` | `subquerynetwork/subql-node-substrate:v6.4.0` | 3010 → 3000 | `postgres` |
| `subquery-query` | `subquerynetwork/subql-query:v2.13.1` | 3011 → 3000 | `subquery-node` |
| `nginx` | `nginx:1.25-alpine` | 8080 → 80 | api, frontend, admin |

The Lunes node itself runs in a separate Docker network (`lunes-nightly`) referenced via `LUNES_WS_URL` (default `ws://host.docker.internal:9944`).

**Staging / production:**
- `docker/docker-compose.prod.yml`, `docker/docker-compose.testnet.yml`, `docker/docker-compose.sandbox.yml`, `docker/docker-compose.doppler.yml` provide environment-specific stacks; secrets injected by Doppler.
- `ecosystem.config.js` declares a PM2 app `lunex-api` (`cwd: /opt/lunex/spot-api`, `dist/index.js`, fork mode, single instance, max 512 MB, restart with 5 s back-off).
- VPS bootstrap and provisioning live in `scripts/provision-vps.sh`, `scripts/setup-vps.sh`, `scripts/setup-doppler.sh`, `scripts/gen-secrets.sh`.
- Observability stack: Prometheus (`docker/prometheus.yml`), Alertmanager (`docker/alertmanager.yml`, `alert-rules.yml`), Blackbox exporter (`blackbox-exporter.yml`), Loki (`loki-config.yml`), Grafana dashboards (`config/grafana/`).
- Reverse proxy in prod: `docker/nginx.prod.conf` and `docker/nginx.testnet.conf` (TLS, rate-limit, routing of `/api`, `/ws`, `/admin`).
- Backups: `docker/backup.sh`.

**Smart-contract deployment:**
- TypeScript scripts in `scripts/` orchestrate contract deploy via Polkadot.js: `deploy.ts`, `deploy-lunes.ts`, `deploy-listing-contracts.ts`, `deploy-asset-wrappers.ts`, `deploy-remaining-contracts.ts`.
- Outputs deployment manifests like `deployment-testnet-1773537062184.json` (root) and `deployment/listing-deploy-*.json`.
- `verify-deployment.ts` (`scripts/`) sanity-checks deployed addresses against the manifest.
- Pre-built artifacts that ship with the repo live in `artifacts/` (committed `.contract` + metadata JSON).

---

*Architecture analysis: 2026-05-21*
