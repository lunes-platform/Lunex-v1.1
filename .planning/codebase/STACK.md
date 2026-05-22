# Technology Stack

**Analysis Date:** 2026-05-21

## Languages

**Primary:**
- Rust 2021 edition - ink! smart contracts (`Lunex/contracts/*`), simulation tests (`src/`, `tests/`), fuzzing harnesses (`fuzz/`)
- TypeScript ~5.3-5.7 - Spot API (`spot-api/`), admin (`lunex-admin/`), DEX frontend (`lunes-dex-main/`), SDK (`sdk/`), MCP server (`mcp/lunex-agent-mcp/`), SubQuery indexer (`subquery-node/`), deploy/relayer scripts (`scripts/`)

**Secondary:**
- JavaScript (CJS/ESM) - faucet (`faucet/index.js`), eslint configs, blockchain exploration helpers (`scripts/explore-lunes-*.js`, `list-lunes-methods.js`), ecosystem (`ecosystem.config.js`)
- WebAssembly (wasm32-unknown-unknown) - target for compiled ink! contracts (`rust-toolchain.toml`)
- GraphQL schema - SubQuery indexer (`subquery-node/schema.graphql`)
- Prisma DSL - DB schemas (`spot-api/prisma/schema.prisma`, `lunex-admin/prisma/schema.prisma`)

## Runtime

**Environment:**
- Node.js >=20 for MCP server (`mcp/lunex-agent-mcp/package.json` engines), >=16 for SDK (`sdk/package.json` engines)
- Rust 1.85.0 toolchain pinned via `rust-toolchain.toml` (components: rustfmt, clippy; target: wasm32-unknown-unknown; profile: minimal)
- PostgreSQL 15-alpine (Docker — `docker-compose.dev.yml` line 29)
- Redis (ioredis client in `spot-api/package.json`; default `redis://127.0.0.1:6379` in `spot-api/src/config.ts:145`)
- Substrate-based Lunes node (external; reached over WS `LUNES_WS_URL`)
- Nginx 1.25-alpine reverse proxy (`docker-compose.dev.yml` line 187)

**Package Manager:**
- Yarn at root (`yarn.lock` 210KB; root `package.json`)
- npm in every subproject (each has its own `package-lock.json`: `spot-api/`, `lunex-admin/`, `lunes-dex-main/`, `sdk/`, `mcp/lunex-agent-mcp/`, `subquery-node/`, `faucet/`)
- Cargo workspace at root (`Cargo.toml` lists 13 ink! contracts as members + root `lunex-sim-tests` package)

## Frameworks

**Smart Contracts / Blockchain:**
- ink! 4.2.1 / 4.3.0 - WASM smart-contract DSL on Substrate (`Lunex/contracts/factory/Cargo.toml:8`, `spot_settlement/Cargo.toml:8`)
- parity-scale-codec 3.x (`scale`) + scale-info 2.x - SCALE encoding for ink! storage and messages
- `@727-ventures/typechain-compiler` 0.5.10 + `@727-ventures/typechain-types` 0.0.21 - generate TS bindings for ink! contracts (root `package.json:6-7`, `compile` script)
- `@polkadot/api` 16.5.3 + `@polkadot/api-contract` 16.5.3 - chain/contract client in `spot-api/` and `lunes-dex-main/`; older 10.x in `faucet/`
- `@polkadot/extension-dapp` + `extension-inject` 0.62.6 - browser wallet injection (`lunes-dex-main/package.json:22-23`)
- `@polkadot/keyring`, `@polkadot/util`, `@polkadot/util-crypto` 13.5.9 - signing & crypto utilities
- subxt + sp-core/sp-runtime crates (transitive via Cargo.lock) - Rust-side Substrate client

**Backend (`spot-api/`):**
- Express 4.21 - HTTP server (`spot-api/src/index.ts:1`)
- ws 8.16 - native WebSocket server (`spot-api/src/websocket/server.ts`, `wsPort` default 4001)
- helmet 7, cors 2.8, express-rate-limit 7 - security middleware
- pino 10 + pino-pretty 13 - structured logging (`spot-api/src/utils/logger.ts`)
- prom-client 15 - Prometheus metrics (`spot-api/src/utils/metrics.ts`)
- zod 3.22 - request validation schemas
- ioredis 5.10 - Redis client (rate limit, nonce replay protection, matching engine locks)
- multer 2.1 - file uploads (listing logos)

**Admin (`lunex-admin/`):**
- Next.js 16.1.6 (App Router) - SSR/SSG (`lunex-admin/package.json:18`)
- React 19.2.3 + React DOM 19.2.3
- NextAuth v5 (beta.30) - admin authentication (`lunex-admin/src/auth.ts`)
- TailwindCSS v4 + `@tailwindcss/postcss` - styling
- shadcn 4 + `@base-ui/react` 1.2 + lucide-react - component primitives
- bcryptjs 3 - password hashing for credentials provider

**DEX Frontend (`lunes-dex-main/`):**
- React 18.2 + React Router 6.2 + react-helmet-async 2
- Vite 6.3.5 + `@vitejs/plugin-react` 4 - build/dev server (`lunes-dex-main/vite.config.ts`)
- styled-components 5.3 - CSS-in-JS
- lightweight-charts 5.1 + recharts 3.8 - charting (manual chunked in vite config)
- lucide-react 0.556 - icons

**Indexer (`subquery-node/`):**
- `@subql/node` (substrate v6.4.0 docker image) - SubQuery indexer node
- `@subql/types` 3.15, `@subql/cli` 6.6.2
- `@subql/query` v2.13.1 docker image - GraphQL API surface

**SDK (`sdk/`):**
- axios 1.6 - REST client
- socket.io-client 4.6 - real-time client
- eventemitter3 5 - typed event bus

**MCP (`mcp/lunex-agent-mcp/`):**
- `@modelcontextprotocol/sdk` 1.27.1 - MCP server protocol
- tsx 4.20 - dev runner

**Faucet (`faucet/`):**
- Express 4.18 + express-rate-limit 7
- `@polkadot/api` 10.11, keyring 12.6, util-crypto 12.6 (older pinned versions vs main API)

**Testing:**
- Jest 29 + ts-jest 29 - root TypeChain specs (`Lunex/Dex.spec.ts`), `spot-api/__tests__/`, `sdk/`, `lunes-dex-main/` (none configured yet)
- supertest 7 - HTTP route tests in `spot-api/`
- `cargo test` - Rust integration/e2e/security/stress suites (root `package.json` test:* scripts; files in `tests/`)
- `ink_e2e` (Cargo.lock) - on-chain ink! end-to-end tests
- `tsx --test` - MCP unit tests (`mcp/lunex-agent-mcp/src/routerTools.test.ts`)

**Build/Dev:**
- `cargo contract` (cargo-contract) - ink! WASM compilation; installed via `npm run setup:dev` (`package.json:54`)
- typechain-compiler with nightly Rust toolchain (`package.json:24`)
- TypeScript Compiler 5.x - all TS subprojects
- Vite 6 - frontend bundler
- Next.js compiler - admin bundler
- patch-package 6.5 - dependency patching (`patches/`, `postinstall` hook)
- ts-node 10.8 / tsx 4 - script runners
- depcheck 1.4 + ts-prune 0.10 - dead-code/dep gates in `quality` scripts of each subproject

## Key Dependencies

**Critical:**
- `ink` 4.2.1/4.3.0 - core DSL for all on-chain contracts; mixing 4.2.1 (pair, factory) and 4.3.0 (spot_settlement) under same workspace
- `@polkadot/api` family - sole transport to the chain (off-chain settlement, faucet, frontend wallet)
- `@prisma/client` 5.10 - shared between `spot-api/` and `lunex-admin/`; both target same PostgreSQL DB
- `ioredis` 5.10 - critical path for orderbook matching locks (`matchingLockService.ts`), nonce TTL (replay protection), rate limiting
- `prom-client` 15 - production observability surface (`/metrics` endpoint, scraped by Prometheus)

**Infrastructure:**
- Doppler - secret management (`.doppler.yaml`, `docker/docker-compose.doppler.yml`, `scripts/setup-doppler.sh`)
- Prometheus + Grafana + Loki + Alertmanager + blackbox-exporter - observability stack (`docker/prometheus.yml`, `alert-rules.yml`, `loki-config.yml`)
- gitleaks 1.1 toolconfig (`.gitleaks.toml`) - secret scanning
- pm2 ecosystem (`ecosystem.config.js`) - process management for VPS deploy

## Configuration

**Environment:**
- Root `.env.example` (72B placeholder), no committed `.env`
- `spot-api/.env.example` 2.8KB - DB, blockchain, Redis, CORS, settlement, rewards, social analytics, margin
- `lunex-admin/.env.example` 1.8KB + `.env.production.example` 1.7KB
- `lunes-dex-main/.env.example` 1.5KB + `.env.production.example` 3.1KB (REACT_APP_* prefix; Vite reads via `loadEnv(mode, cwd(), 'REACT_APP_')`)
- `docker/.env.docker.example` 2.2KB, `.env.prod.example` 4.5KB, `.env.sandbox.example` 4.3KB, `.env.testnet.example` 2.6KB
- Doppler `production` config bound at `.doppler.yaml`
- `RELAYER_SEED` is the off-chain trade signer mnemonic (treated as private key in `spot-api/src/index.ts:80-91`)

**Build:**
- Root `tsconfig.json` - scripts only; `module: commonjs`, `target: ES2020`, `baseUrl: ./types`
- Each subproject has its own `tsconfig.json` (e.g. `spot-api/tsconfig.json`, `lunex-admin/tsconfig.json`, `lunes-dex-main/tsconfig.json` 535B)
- `lunes-dex-main/vite.config.ts` - manual chunking for polkadot/charts/vendor, drops console in prod build
- `lunex-admin/next.config.ts` - Next.js config (129B)
- `Cargo.toml` workspace with `[profile.release]` set to `panic = "abort"`, `lto = true`, `opt-level = "z"`, `codegen-units = 1` for minimal WASM size
- `.rustfmt.toml` 1.6KB, `.prettierrc` 171B, `.eslintrc.js` 1.8KB at root

## Platform Requirements

**Development:**
- Rust 1.85.0 + wasm32-unknown-unknown target (auto via `rust-toolchain.toml`)
- `cargo-contract` (installed by `npm run setup:dev` → `rustup target add wasm32-unknown-unknown && cargo install cargo-contract --force --locked`)
- Node >=20 (MCP) or >=16 (SDK)
- Yarn at root, npm in subprojects
- Docker + docker-compose for full stack dev (`docker-compose.dev.yml`)
- nightly Rust toolchain for typechain-compiler (`compile` script)

**Production:**
- VPS deploy via `scripts/provision-vps.sh` and `scripts/setup-vps.sh` (PM2 + nginx)
- Docker Compose alternative (`docker/docker-compose.prod.yml` 15.3KB, `docker-compose.testnet.yml`, `docker-compose.sandbox.yml`)
- External Lunes Substrate node (not packaged; reached via `LUNES_WS_URL`)
- PostgreSQL 15+ and Redis instances
- Doppler secrets injection (`docker/docker-compose.doppler.yml`)
- Prometheus + Grafana + Loki for monitoring

---

*Stack analysis: 2026-05-21*
