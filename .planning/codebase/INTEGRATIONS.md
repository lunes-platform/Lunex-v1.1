# External Integrations

**Analysis Date:** 2026-05-21

## APIs & External Services

**Blockchain (Lunes Substrate node):**
- Lunes Network RPC over WebSocket - core integration for all on-chain interactions
  - SDK/Client: `@polkadot/api` + `@polkadot/api-contract`
  - Endpoint env: `LUNES_WS_URL` (default `ws://127.0.0.1:9944`, `spot-api/src/config.ts:54`)
  - Frontend env: `REACT_APP_RPC_TESTNET` / `REACT_APP_RPC_MAINNET` (`lunes-dex-main/vite.config.ts` + `docker-compose.dev.yml:78`)
  - Signing: relayer mnemonic via `RELAYER_SEED` for off-chain → on-chain settlement
  - Connect points: `spot-api/src/services/settlementService.ts`, `factoryService.ts`, `rebalancerService.ts`, `assetBridgeService.ts`; `lunes-dex-main/src/services/contractService.ts`
- Lunes pallet discovery scripts - `scripts/explore-lunes-pallets.js`, `explore-lunes-rpc.js`, `list-lunes-methods.js` (introspection helpers, not runtime)

**ink! Smart Contracts (on-chain integrations):**
- Factory contract - pair existence / source of truth (`FACTORY_CONTRACT_ADDRESS`, ABI `spot-api/abis/Factory.json` and `lunes-dex-main/src/abis/Factory.json`)
- Spot Settlement contract (`SPOT_CONTRACT_ADDRESS`, ABI `Spot.json` referenced by `SPOT_CONTRACT_METADATA_PATH`)
- Router contract (ABI `Router.json`)
- Pair / AsymmetricPair contracts (`Pair.json`, `AsymmetricPair.json`)
- Staking contract (`STAKING_CONTRACT_ADDRESS`, `Staking.json`)
- Rewards contract (referenced by rewardScheduler)
- WNative wrapper (`WNative.json`)
- CopyVault contract (`CopyVault.json`)
- Listing Manager + Liquidity Lock (deploy via `scripts/deploy-listing-contracts.ts`)
- All ABIs duplicated in `spot-api/abis/` and `lunes-dex-main/src/abis/` (8 JSON metadata files each)

**Indexer:**
- SubQuery GraphQL endpoint - secondary on-chain data source
  - Client: `spot-api/src/services/subqueryClient.ts` (uses native `fetch`)
  - Env: `SUBQUERY_ENDPOINT`, gated by `SUBQUERY_ENABLED` (`config.ts:135-142`)
  - Consumed by: `socialIndexerService.ts`, `socialAnalyticsService.ts`
  - Backed by `subquery-node/` container (`subquerynetwork/subql-node-substrate:v6.4.0`) + `subql-query:v2.13.1` GraphQL gateway (`docker-compose.dev.yml:128-183`)
  - Indexed entities defined in `subquery-node/schema.graphql` (6.2KB)

**Internal HTTP APIs (frontend ↔ backend):**
- DEX frontend → spot-api: `REACT_APP_SPOT_API_URL` consumed by `lunes-dex-main/src/services/spotService.ts`, `agentService.ts`, `marginService.ts`, `rewardsService.ts`, `socialService.ts`, `strategyService.ts` (all use native `fetch`)
- SDK → spot-api: axios + socket.io-client (`sdk/src/http-client.ts`, `sdk/src/websocket-client.ts`)
- Admin → spot-api: `NEXT_PUBLIC_API_URL=http://api:4000` (`docker-compose.dev.yml:115`)
- MCP server → spot-api: Smart Router quote/swap surface (`mcp/lunex-agent-mcp/src/routerTools.ts`)

## Data Storage

**Databases:**
- PostgreSQL 15 - primary RDBMS
  - Connection: `DATABASE_URL` (Prisma format)
  - Client: Prisma 5.10 (`@prisma/client`)
  - Schemas:
    - `spot-api/prisma/schema.prisma` (39.9KB) - orders, trades, candles, social, copytrade, margin, rewards, vaults, agents, strategies, affiliate, listings, governance, token registry, favorites
    - `lunex-admin/prisma/schema.prisma` (22.0KB) - admin users, admin-side mirror tables
  - Both subprojects connect to the same database (`lunex_spot`); admin uses `public` schema, indexer uses `subquery` schema (`--db-schema=subquery` in compose line 149)
  - Seeded via `spot-api/prisma/seed.ts` (26.8KB)

**Caching / In-memory:**
- Redis - critical infrastructure
  - Client: ioredis 5.10 (`spot-api/src/utils/redis.ts`)
  - Env: `REDIS_URL` (default `redis://127.0.0.1:6379`)
  - Uses:
    - Nonce replay protection TTL (`NONCE_TTL_SECONDS` default 300s)
    - Matching engine distributed locks (`spot-api/src/services/matchingLockService.ts`, `MATCHING_LOCK_TTL_MS` 30s, `MATCHING_LOCK_WAIT_MS` 2s)
    - Rate limit backend (`spot-api/src/utils/redisRateLimit.ts`)
  - Health: `redisHealthy()` checked at `/health`; instance refuses 200 if Redis is down (`spot-api/src/index.ts:338`)

**File Storage:**
- Local filesystem - token logos served from `spot-api/public/tokens/` via static middleware (`/tokens` route, `index.ts:212-218`, 7d immutable cache)
- multer 2.1 disk uploads for listing application logos (`spot-api/src/routes/listing.ts`)
- No S3/GCS/Azure Blob SDK in any package.json

**Object Storage / CDN:**
- Not detected. nginx serves static admin/frontend bundles directly (`docker/nginx.prod.conf` 23.8KB)

## Authentication & Identity

**Admin auth (lunex-admin):**
- NextAuth v5 beta with Credentials provider only (`lunex-admin/src/auth.ts`)
- Password storage: bcryptjs hashes in Prisma `adminUser` table
- Session: JWT with `role` claim
- Env: `NEXTAUTH_SECRET`, `NEXTAUTH_URL`

**Trading auth (spot-api):**
- Custom Substrate-signature scheme - users sign payloads with their Polkadot wallet; verified via `@polkadot/util-crypto`
- Nonce + timestamp + signature query params on strict-CORS routes (`spot-api/src/index.ts:183-188`)
- API key support: `x-api-key` header for server-to-server / MCP / CLI traffic
- MCP trust marker: `x-lunex-client: mcp` header bypasses no-origin block in strict CORS list
- Admin / internal protected via `ADMIN_SECRET` (`spot-api/src/middleware/adminGuard.ts`, env `ADMIN_SECRET`)

**Wallet integration (frontend):**
- `@polkadot/extension-dapp` - injects browser wallets (polkadot.js extension, SubWallet, Talisman, Nova compatible)
- Signing flow: `web3FromAddress` returns injector that signs extrinsics client-side (`lunes-dex-main/src/services/contractService.ts`)

**Third-party auth providers:**
- None (no OAuth, no SSO, no SAML detected)

## Monitoring & Observability

**Metrics:**
- Prometheus client (prom-client 15) - exposes `/metrics` on spot-api (admin-guarded, `spot-api/src/index.ts:349`)
- Custom gauges/histograms in `spot-api/src/utils/metrics.ts`:
  - `lunex_http_request_duration_seconds` (Histogram)
  - `redis_healthy`, `db_healthy`, `blockchain_connected` (Gauges)
  - `vault_total_equity`, `copytrade_wallet_continuations_pending` (Gauges)
  - `pending_settlements`, `ws_connections` (Gauges)
  - `copytrade_wallet_continuations_expired_total` (Counter)
- Prometheus server config: `docker/prometheus.yml` (3.1KB)
- Alertmanager rules: `docker/alert-rules.yml` (9.6KB), `alertmanager.yml` (3.1KB)
- Blackbox exporter: `docker/blackbox-exporter.yml`

**Logs:**
- pino 10 structured JSON logs (`spot-api/src/utils/logger.ts`)
- pino-pretty 13 for dev
- Loki shipping configured: `docker/loki-config.yml` (1.8KB)
- Console drops removed in prod builds for frontend (`lunes-dex-main/vite.config.ts:72`)

**Dashboards:**
- Grafana provisioning at `deployment/grafana/`

**Error tracking:**
- No Sentry, DataDog, NewRelic, Bugsnag, or Rollbar SDK detected in any package.json
- `unhandledRejection` / `uncaughtException` handlers crash the process with structured pino log (`spot-api/src/index.ts:69-77`), relying on orchestrator restart

**Tracing:**
- Not detected (no OpenTelemetry, Jaeger, or Zipkin SDK)

## CI/CD & Deployment

**Hosting:**
- Self-hosted VPS via PM2 (`ecosystem.config.js` 1.2KB, `scripts/provision-vps.sh` 20.8KB, `scripts/setup-vps.sh` 14.3KB)
- Docker Compose stacks: `docker/docker-compose.prod.yml`, `docker-compose.testnet.yml`, `docker-compose.sandbox.yml`, `docker-compose.doppler.yml`
- nginx reverse proxy fronts API, admin, frontend on single port (`docker/nginx.prod.conf` 23.8KB, `nginx.testnet.conf` 4.6KB)

**Containers (`docker/`):**
- `Dockerfile.api` 1.1KB - spot-api
- `Dockerfile.admin` 862B - Next.js admin
- `Dockerfile.frontend` 1.9KB - Vite DEX
- `faucet/Dockerfile` 208B - faucet

**CI Pipeline:**
- `.github/` directory present (workflows not enumerated here; check `.github/workflows/`)

**Deploy Scripts:**
- On-chain contract deploys: `scripts/deploy-lunes.ts` (21.4KB), `deploy-listing-contracts.ts` (14.5KB), `deploy-remaining-contracts.ts` (14.2KB), `deploy-asset-wrappers.ts` (6.7KB), `deploy.sh` (8.9KB)
- Pinned testnet deployment outputs: `deployment-testnet-1773537062184.json`, `deployment/listing-deploy-*.json`, `deployment/remaining-deploy-*.json`
- Verification: `scripts/verify-deployment.ts` (15.1KB)

**Secret management:**
- Doppler - bound to `lunex-dex` project, `production` config (`.doppler.yaml`)
- Doppler bootstrap script: `scripts/setup-doppler.sh` (6.3KB)
- Local secret gen helper: `scripts/gen-secrets.sh` (3.8KB)
- gitleaks scanning enabled (`.gitleaks.toml` 1.1KB)

**Backup:**
- `docker/backup.sh` (2.8KB) - DB backup automation

## Environment Configuration

**Required env vars (spot-api, condensed from `spot-api/src/config.ts` and `spot-api/.env.example`):**
- `DATABASE_URL` - Postgres connection
- `REDIS_URL` - Redis instance
- `LUNES_WS_URL` - Substrate node WS endpoint
- `RELAYER_SEED` - off-chain trade settlement signer (private key material)
- `SPOT_CONTRACT_ADDRESS`, `SPOT_CONTRACT_METADATA_PATH`
- `FACTORY_CONTRACT_ADDRESS`, `FACTORY_CONTRACT_METADATA_PATH`
- `STAKING_CONTRACT_ADDRESS`, `STAKING_CONTRACT_METADATA_PATH`
- `NATIVE_TOKEN_ADDRESS` - sentinel AccountId for native LUNES
- `TREASURY_ADDRESS`
- `ADMIN_SECRET` - admin route auth
- `CORS_ALLOWED_ORIGINS`, `ALLOWED_WS_ORIGINS`
- `TRUST_PROXY`
- `SUBQUERY_ENDPOINT`, `SUBQUERY_ENABLED`
- `REWARDS_ENABLED`, `REWARD_POOL_PCT`, `LEADER_POOL_PCT`, `TRADER_POOL_PCT`, `STAKER_POOL_PCT`
- `SOCIAL_ANALYTICS_*` (multiple)
- `MARGIN_*` (multiple risk-control thresholds)
- `COPYTRADE_*` (scheduler & TTL knobs)
- Rate-limit knobs: `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS`, `ORDER_RATE_LIMIT_MAX`, `NONCE_TTL_SECONDS`

**Required env vars (lunex-admin):**
- `DATABASE_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `NEXT_PUBLIC_API_URL`

**Required env vars (lunes-dex-main, REACT_APP_* prefix):**
- `REACT_APP_NETWORK`, `REACT_APP_RPC_TESTNET`/`MAINNET`
- `REACT_APP_SPOT_API_URL`
- `REACT_APP_FACTORY_CONTRACT`, `ROUTER_CONTRACT`, `STAKING_CONTRACT`, `REWARDS_CONTRACT`
- Token addresses: `REACT_APP_TOKEN_WLUNES`, `LUSDT`, `LBTC`, `LETH`, `GMC`, `LUP`
- Feature flags: `REACT_APP_ENABLE_STAKING`, `REACT_APP_ENABLE_REWARDS`, `REACT_APP_DEV_MODE`

**Secrets location:**
- Production: Doppler (`lunex-dex` project, `production` config)
- Local dev: `.env` files generated from `.env.example` templates per subproject
- Docker: env_file pointers in compose stacks (`docker/.env.docker`, `.env.prod`, `.env.sandbox`, `.env.testnet`)
- `.gitleaks.toml` enforces secret-free commits

## Webhooks & Callbacks

**Incoming:**
- None detected (no payment webhook handler, no Stripe/PayPal route, no GitHub webhook receiver)

**Outgoing:**
- None detected (no webhook dispatch to third-party URLs; the closest is the listing relayer `scripts/listing-relayer.ts` which posts settlement transactions to the chain, not external HTTP webhooks)

## MCP Server Integration

- `mcp/lunex-agent-mcp/` - Lunex Spot Social Copytrade MCP server
  - Protocol: `@modelcontextprotocol/sdk` 1.27.1
  - Transport: stdio (`StdioServerTransport` in `mcp/lunex-agent-mcp/src/index.ts:2`)
  - Surface: Lunex spot market data, Smart Router quote/execution, externally-signed wallet flows, agent-authenticated spot trading, social trading, copytrade, strategy tooling, execution telemetry, asymmetric liquidity agent management
  - Not supported: direct AMM contract operations, staking, farming
  - Tools defined: `agentRouterSwapTool`, `getRouterQuoteTool` (`routerTools.ts` 3.6KB) plus a large set inlined in `index.ts` (112KB)
  - Talks to spot-api over HTTP with `x-lunex-client: mcp` marker

## External Network Dependencies (summary)

| Dependency | Direction | Protocol | Required |
|------------|-----------|----------|----------|
| Lunes Substrate node | outbound | WS | Yes (all components) |
| PostgreSQL | outbound | TCP/5432 | Yes (spot-api, admin, subquery-node) |
| Redis | outbound | TCP/6379 | Yes (spot-api) |
| SubQuery GraphQL | outbound | HTTPS | Optional (gated by `SUBQUERY_ENABLED`) |
| Doppler | outbound | HTTPS | Production only |
| Prometheus scraper | inbound | HTTP (/metrics) | Production only |
| Loki | outbound | HTTP | Optional |
| Polkadot.js browser extension | client-side | postMessage | Frontend wallet flow |

---

*Integration audit: 2026-05-21*
