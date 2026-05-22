<!-- GSD:project-start source:PROJECT.md -->
## Project

**Lunex**

Lunex is a decentralized exchange (DEX) built on the **Lunes** Substrate-based blockchain. The system spans **13 ink! smart contracts** (factory, pairs, router, settlement, copy-trading vaults, staking, rewards, liquidity locks, bridge), a **TypeScript orchestration backend** (`spot-api`), a **Next.js admin panel** (`lunex-admin`), an **end-user trading UI** (`lunes-dex-main`), a **client SDK**, an **MCP server** exposing trading tools to AI agents, a **SubQuery indexer**, and a **faucet**. Production deployment uses PM2 + nginx on a VPS, with Docker Compose variants for dev/testnet/sandbox. Secrets are managed via Doppler; observability runs on Prometheus + Grafana + Loki + Alertmanager.

**Core Value:** **Custody-grade correctness at every fund-moving step.** A DEX that loses, double-spends, or finalizes-then-reverts user funds is finished — every other concern (performance, UX polish, feature scope) is downstream of this.

### Constraints

- **Tech stack — frozen for this milestone:** ink! contracts on Lunes Substrate, TypeScript backend, Next.js 16 admin, Vite/React 18 DEX UI. No framework migrations during stabilization push.
- **Security — non-negotiable:** No code touching fund movement ships without `isFinalized` gating + reproducible tests covering the signed paths. No `//Alice` keys reachable in any production codepath.
- **Backwards compatibility — API contract:** External SDK consumers may already be in the wild; endpoint renames require deprecation window even if existing docs are wrong (verify ownership first).
- **Timeline — sequenced, not parallel-only:** Tier 0 must precede mainnet announcement. Tier 1 should land within 30 days of Tier 0. Tier 2/3 can extend post-launch hotfix cycle.
- **External dependency — `verify_order_signature`:** Requires Lunes pallet-contracts to expose `seal_sr25519_verify`. If chain team is blocked, plan alternative (off-chain attestation + on-chain check) before assuming this lands.
- **External dependency — security audit firm:** Engagement and remediation cycle is on the critical path; Tier 0 code-side fixes must precede audit handoff.
- **Resources — small team:** Plan parallel phases only where they touch disjoint files/services.
- **Compliance — Brazilian regulatory landscape:** DEX legal posture varies; user-facing claims and KYC posture must be reviewed before launch announcement.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- Rust 2021 edition - ink! smart contracts (`Lunex/contracts/*`), simulation tests (`src/`, `tests/`), fuzzing harnesses (`fuzz/`)
- TypeScript ~5.3-5.7 - Spot API (`spot-api/`), admin (`lunex-admin/`), DEX frontend (`lunes-dex-main/`), SDK (`sdk/`), MCP server (`mcp/lunex-agent-mcp/`), SubQuery indexer (`subquery-node/`), deploy/relayer scripts (`scripts/`)
- JavaScript (CJS/ESM) - faucet (`faucet/index.js`), eslint configs, blockchain exploration helpers (`scripts/explore-lunes-*.js`, `list-lunes-methods.js`), ecosystem (`ecosystem.config.js`)
- WebAssembly (wasm32-unknown-unknown) - target for compiled ink! contracts (`rust-toolchain.toml`)
- GraphQL schema - SubQuery indexer (`subquery-node/schema.graphql`)
- Prisma DSL - DB schemas (`spot-api/prisma/schema.prisma`, `lunex-admin/prisma/schema.prisma`)
## Runtime
- Node.js >=20 for MCP server (`mcp/lunex-agent-mcp/package.json` engines), >=16 for SDK (`sdk/package.json` engines)
- Rust 1.85.0 toolchain pinned via `rust-toolchain.toml` (components: rustfmt, clippy; target: wasm32-unknown-unknown; profile: minimal)
- PostgreSQL 15-alpine (Docker — `docker-compose.dev.yml` line 29)
- Redis (ioredis client in `spot-api/package.json`; default `redis://127.0.0.1:6379` in `spot-api/src/config.ts:145`)
- Substrate-based Lunes node (external; reached over WS `LUNES_WS_URL`)
- Nginx 1.25-alpine reverse proxy (`docker-compose.dev.yml` line 187)
- Yarn at root (`yarn.lock` 210KB; root `package.json`)
- npm in every subproject (each has its own `package-lock.json`: `spot-api/`, `lunex-admin/`, `lunes-dex-main/`, `sdk/`, `mcp/lunex-agent-mcp/`, `subquery-node/`, `faucet/`)
- Cargo workspace at root (`Cargo.toml` lists 13 ink! contracts as members + root `lunex-sim-tests` package)
## Frameworks
- ink! 4.2.1 / 4.3.0 - WASM smart-contract DSL on Substrate (`Lunex/contracts/factory/Cargo.toml:8`, `spot_settlement/Cargo.toml:8`)
- parity-scale-codec 3.x (`scale`) + scale-info 2.x - SCALE encoding for ink! storage and messages
- `@727-ventures/typechain-compiler` 0.5.10 + `@727-ventures/typechain-types` 0.0.21 - generate TS bindings for ink! contracts (root `package.json:6-7`, `compile` script)
- `@polkadot/api` 16.5.3 + `@polkadot/api-contract` 16.5.3 - chain/contract client in `spot-api/` and `lunes-dex-main/`; older 10.x in `faucet/`
- `@polkadot/extension-dapp` + `extension-inject` 0.62.6 - browser wallet injection (`lunes-dex-main/package.json:22-23`)
- `@polkadot/keyring`, `@polkadot/util`, `@polkadot/util-crypto` 13.5.9 - signing & crypto utilities
- subxt + sp-core/sp-runtime crates (transitive via Cargo.lock) - Rust-side Substrate client
- Express 4.21 - HTTP server (`spot-api/src/index.ts:1`)
- ws 8.16 - native WebSocket server (`spot-api/src/websocket/server.ts`, `wsPort` default 4001)
- helmet 7, cors 2.8, express-rate-limit 7 - security middleware
- pino 10 + pino-pretty 13 - structured logging (`spot-api/src/utils/logger.ts`)
- prom-client 15 - Prometheus metrics (`spot-api/src/utils/metrics.ts`)
- zod 3.22 - request validation schemas
- ioredis 5.10 - Redis client (rate limit, nonce replay protection, matching engine locks)
- multer 2.1 - file uploads (listing logos)
- Next.js 16.1.6 (App Router) - SSR/SSG (`lunex-admin/package.json:18`)
- React 19.2.3 + React DOM 19.2.3
- NextAuth v5 (beta.30) - admin authentication (`lunex-admin/src/auth.ts`)
- TailwindCSS v4 + `@tailwindcss/postcss` - styling
- shadcn 4 + `@base-ui/react` 1.2 + lucide-react - component primitives
- bcryptjs 3 - password hashing for credentials provider
- React 18.2 + React Router 6.2 + react-helmet-async 2
- Vite 6.3.5 + `@vitejs/plugin-react` 4 - build/dev server (`lunes-dex-main/vite.config.ts`)
- styled-components 5.3 - CSS-in-JS
- lightweight-charts 5.1 + recharts 3.8 - charting (manual chunked in vite config)
- lucide-react 0.556 - icons
- `@subql/node` (substrate v6.4.0 docker image) - SubQuery indexer node
- `@subql/types` 3.15, `@subql/cli` 6.6.2
- `@subql/query` v2.13.1 docker image - GraphQL API surface
- axios 1.6 - REST client
- socket.io-client 4.6 - real-time client
- eventemitter3 5 - typed event bus
- `@modelcontextprotocol/sdk` 1.27.1 - MCP server protocol
- tsx 4.20 - dev runner
- Express 4.18 + express-rate-limit 7
- `@polkadot/api` 10.11, keyring 12.6, util-crypto 12.6 (older pinned versions vs main API)
- Jest 29 + ts-jest 29 - root TypeChain specs (`Lunex/Dex.spec.ts`), `spot-api/__tests__/`, `sdk/`, `lunes-dex-main/` (none configured yet)
- supertest 7 - HTTP route tests in `spot-api/`
- `cargo test` - Rust integration/e2e/security/stress suites (root `package.json` test:* scripts; files in `tests/`)
- `ink_e2e` (Cargo.lock) - on-chain ink! end-to-end tests
- `tsx --test` - MCP unit tests (`mcp/lunex-agent-mcp/src/routerTools.test.ts`)
- `cargo contract` (cargo-contract) - ink! WASM compilation; installed via `npm run setup:dev` (`package.json:54`)
- typechain-compiler with nightly Rust toolchain (`package.json:24`)
- TypeScript Compiler 5.x - all TS subprojects
- Vite 6 - frontend bundler
- Next.js compiler - admin bundler
- patch-package 6.5 - dependency patching (`patches/`, `postinstall` hook)
- ts-node 10.8 / tsx 4 - script runners
- depcheck 1.4 + ts-prune 0.10 - dead-code/dep gates in `quality` scripts of each subproject
## Key Dependencies
- `ink` 4.2.1/4.3.0 - core DSL for all on-chain contracts; mixing 4.2.1 (pair, factory) and 4.3.0 (spot_settlement) under same workspace
- `@polkadot/api` family - sole transport to the chain (off-chain settlement, faucet, frontend wallet)
- `@prisma/client` 5.10 - shared between `spot-api/` and `lunex-admin/`; both target same PostgreSQL DB
- `ioredis` 5.10 - critical path for orderbook matching locks (`matchingLockService.ts`), nonce TTL (replay protection), rate limiting
- `prom-client` 15 - production observability surface (`/metrics` endpoint, scraped by Prometheus)
- Doppler - secret management (`.doppler.yaml`, `docker/docker-compose.doppler.yml`, `scripts/setup-doppler.sh`)
- Prometheus + Grafana + Loki + Alertmanager + blackbox-exporter - observability stack (`docker/prometheus.yml`, `alert-rules.yml`, `loki-config.yml`)
- gitleaks 1.1 toolconfig (`.gitleaks.toml`) - secret scanning
- pm2 ecosystem (`ecosystem.config.js`) - process management for VPS deploy
## Configuration
- Root `.env.example` (72B placeholder), no committed `.env`
- `spot-api/.env.example` 2.8KB - DB, blockchain, Redis, CORS, settlement, rewards, social analytics, margin
- `lunex-admin/.env.example` 1.8KB + `.env.production.example` 1.7KB
- `lunes-dex-main/.env.example` 1.5KB + `.env.production.example` 3.1KB (REACT_APP_* prefix; Vite reads via `loadEnv(mode, cwd(), 'REACT_APP_')`)
- `docker/.env.docker.example` 2.2KB, `.env.prod.example` 4.5KB, `.env.sandbox.example` 4.3KB, `.env.testnet.example` 2.6KB
- Doppler `production` config bound at `.doppler.yaml`
- `RELAYER_SEED` is the off-chain trade signer mnemonic (treated as private key in `spot-api/src/index.ts:80-91`)
- Root `tsconfig.json` - scripts only; `module: commonjs`, `target: ES2020`, `baseUrl: ./types`
- Each subproject has its own `tsconfig.json` (e.g. `spot-api/tsconfig.json`, `lunex-admin/tsconfig.json`, `lunes-dex-main/tsconfig.json` 535B)
- `lunes-dex-main/vite.config.ts` - manual chunking for polkadot/charts/vendor, drops console in prod build
- `lunex-admin/next.config.ts` - Next.js config (129B)
- `Cargo.toml` workspace with `[profile.release]` set to `panic = "abort"`, `lto = true`, `opt-level = "z"`, `codegen-units = 1` for minimal WASM size
- `.rustfmt.toml` 1.6KB, `.prettierrc` 171B, `.eslintrc.js` 1.8KB at root
## Platform Requirements
- Rust 1.85.0 + wasm32-unknown-unknown target (auto via `rust-toolchain.toml`)
- `cargo-contract` (installed by `npm run setup:dev` → `rustup target add wasm32-unknown-unknown && cargo install cargo-contract --force --locked`)
- Node >=20 (MCP) or >=16 (SDK)
- Yarn at root, npm in subprojects
- Docker + docker-compose for full stack dev (`docker-compose.dev.yml`)
- nightly Rust toolchain for typechain-compiler (`compile` script)
- VPS deploy via `scripts/provision-vps.sh` and `scripts/setup-vps.sh` (PM2 + nginx)
- Docker Compose alternative (`docker/docker-compose.prod.yml` 15.3KB, `docker-compose.testnet.yml`, `docker-compose.sandbox.yml`)
- External Lunes Substrate node (not packaged; reached via `LUNES_WS_URL`)
- PostgreSQL 15+ and Redis instances
- Doppler secrets injection (`docker/docker-compose.doppler.yml`)
- Prometheus + Grafana + Loki for monitoring
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Overview
- **Root TypeScript** (typechain integration tests, deploy scripts): strict, governed by `/.eslintrc.js` (TS-strict).
- **Per-package TypeScript** (`spot-api`, frontend, sdk, mcp): permissive, each owns a local `.eslintrc.cjs`.
- **Rust** (workspace + ink! contracts): governed by `.rustfmt.toml` and `rust-toolchain.toml` (channel `1.85.0`).
- **Tooling**: Prettier (TS) and `cargo fmt` (Rust), Conventional Commits, SDD docs flow.
## Linting & Formatting
### Prettier (root `.prettierrc`)
- 80-column hard wrap.
- Semicolons required.
- Single quotes for strings; consistent quoting for object keys.
- Trailing comma everywhere (`"all"`).
- Always parenthesize arrow params: `(x) => ...`.
### ESLint — Root (`/.eslintrc.js`) — strict mode
- Extends: `eslint:recommended`, `plugin:@typescript-eslint/recommended`, `plugin:prettier/recommended`, `plugin:jest/recommended`.
- Parser project: `./tsconfig.json` (type-aware linting).
- **Naming convention enforced via `@typescript-eslint/naming-convention`:**
- **Hard rules:**
- `@typescript-eslint/ban-ts-comment`: off (test helpers may suppress).
### ESLint — Per-package (`*/.eslintrc.cjs`) — permissive mode
- Extends `eslint:recommended` only (no `@typescript-eslint/recommended`).
- `@typescript-eslint/no-explicit-any`: **off** (relaxed for product code).
- `@typescript-eslint/no-unused-vars`: error, with `argsIgnorePattern: '^_'` / `varsIgnorePattern: '^_'`.
- No naming-convention enforcement at package level (relies on Prettier + reviewer discipline).
- `lunes-dex-main` also loads `react-hooks` plugin and `env: { browser: true }`.
- Code in `tests/*.spec.ts`, `scripts/*.ts`: write to root strict ruleset (camelCase, no `any`, explicit return types).
- Code in `spot-api/src/**`, frontend, sdk, mcp: still write strict by hand — root ESLint will NOT lint these files, but CONTRIBUTING.md requires "no `any` except documented exceptions" and TypeScript strict mode.
### Rustfmt (`.rustfmt.toml`) — uses unstable features
- `max_width = 100`, `comment_width = 80`, `tab_spaces = 4`, block indent.
- `imports_layout = "Vertical"`, `imports_granularity = "Crate"` — one import per line, grouped by crate root.
- `reorder_imports = true`, `reorder_modules = true`.
- `trailing_comma = "Vertical"`, `trailing_semicolon = false`, `match_block_trailing_comma = false`.
- `combine_control_expr = false`, `force_multiline_blocks = true`, `control_brace_style = "AlwaysSameLine"`.
- `use_try_shorthand = true`, `use_field_init_shorthand = true`, `merge_derives = true`.
- `format_strings = false`, `format_code_in_doc_comments = false`, `wrap_comments = false`.
- `format_macro_bodies = true`, `format_macro_matchers = false`.
- `blank_lines_upper_bound = 1`, `force_explicit_abi = true`.
### Lint commands
## Naming Conventions
### TypeScript
- **Files:** `camelCase.ts` for modules (`tradeService.ts`, `walletRiskService.ts`); `PascalCase.tsx` for React components in `lunes-dex-main`.
- **Test files:** `*.test.ts` (unit, co-located in `src/__tests__/`) and `*.e2e.test.ts` (top-level `__tests__/` in `spot-api`); root typechain integration uses `*.spec.ts`.
- **Variables / functions / methods / properties:** `strictCamelCase` (root rule). Examples: `orderbookBootstrapService`, `processNewTradeSettlements`.
- **Module-level constants:** `UPPER_CASE` (e.g. `MINIMUM_LIQUIDITY`, `MOCK_API_KEY`).
- **Types / interfaces / classes / enums / type parameters:** `StrictPascalCase` — `OrderStatus`, `PairModel`, `WalletRiskService`.
- **Enum members:** `StrictPascalCase` (NOT `UPPER_CASE`).
- **Unused params:** prefix with `_` (`_req`, `_ctx`).
- **Imports:** use generated Prisma types and typechain types directly — never cast DB results to `any` (CONTRIBUTING.md).
### Rust (ink! contracts + simulation crates)
- **Crate names:** snake_case matching directory (`asymmetric_pair`, `copy_vault`, `liquidity_lock`, `listing_manager`, `spot_settlement`, `wnative`). Listed in root `Cargo.toml [workspace] members`.
- **Modules / functions / variables:** `snake_case` — `swap_token_1_for_token_0`, `price_0_cumulative_last`, `get_amount_out`.
- **Types / enums / traits:** `PascalCase` — `PairContract`, `PairModel`, `PSP22Error`.
- **Constants / statics:** `SCREAMING_SNAKE_CASE`.
- **Test modules:** `mod tests { ... }` inside `#[cfg(test)]` blocks at the bottom of each `lib.rs`.
- **Fuzz target binaries:** `snake_case` matching `fuzz/fuzz_targets/<name>.rs` (`pair_invariant`, `copy_vault_accounting`, `spot_settlement_replay`).
### Directory & file organization
- Contracts: `Lunex/contracts/<contract-name>/lib.rs` plus `Cargo.toml`. One `lib.rs` per contract (some exceed 60KB — e.g. pair `lib.rs` is ~70KB).
- TS service layer: `spot-api/src/services/<thing>Service.ts`.
- TS routes: `spot-api/src/routes/<resource>.ts` (singular file, plural route nouns).
- TS middleware: `spot-api/src/middleware/<name>.ts`.
- Generated typechain types in `types/` (gitignored from lint).
- Build artifacts in `target/`, `dist/`, `build/`, `artifacts/` (all ignored by linters/formatters).
## Import Organization
### TypeScript
### Rust
- `imports_granularity = "Crate"` — collapse multiple uses from same crate root.
- `imports_layout = "Vertical"` — one item per line.
- `reorder_imports = true` — sorted alphabetically within each block.
- `reorder_modules = true`.
## Code Comments & Documentation
### TypeScript
- JSDoc block above exported services / public functions (observed in `spot-api/__tests__/tradeApi.e2e.test.ts`, etc.):
- Inline `//` comments allowed but kept short.
- Section banners with `// =====` blocks used in Rust; less common in TS.
- Comment language is **mixed** (English + Portuguese) — Rust contracts frequently use Portuguese banners (e.g. `// TESTES DE INICIALIZAÇÃO`, `// PSP22 ERROR TYPE (DEFINIDO LOCALMENTE)`); TS code is mostly English.
### Rust
- `///` doc comments on public items (functions, enums, structs).
- `//!` module-level docs at top of `lib.rs`.
- `// ========================================` ASCII banners delimit logical sections (init / swaps / LP / access control / tests). See `Lunex/contracts/pair/lib.rs:1515-1565`.
- `wrap_comments = false`, `format_code_in_doc_comments = false`, `normalize_comments = true` — keep comments raw and let the author wrap.
- Crate-level lint attributes belong at the very top of `lib.rs`:
## Error Handling Conventions
### Backend (Express)
- Always use `next(err)` in catch blocks; never return inline 500 JSON.
- `catch (err: unknown)` (not `any`).
- Standard error response shape: `{ error, code, details? }`.
### Frontend
### Validation
### Database (Prisma)
- Use `Prisma.<Model>WhereInput` types; never `any`.
- Avoid N+1: batch with `groupBy` / `findMany({ where: { in: [...] } })`.
### Rust
- Custom error enums (e.g. `PSP22Error`) decorated with `#[derive(scale::Encode, scale::Decode)]` and `#[cfg_attr(feature = "std", derive(scale_info::TypeInfo))]`.
- Functions return `Result<T, ContractError>` — `use_try_shorthand = true` so `?` propagation is preferred over `match`.
- Use `#[warn(clippy::arithmetic_side_effects)]` on contracts that do balance math; favour `checked_*` operations.
## Logging Conventions
- **`spot-api`**: structured logging via `pino` exported from `src/utils/logger.ts`.
- Bracketed module tag prefix (`[Order]`, `[Trade]`) as the message; structured fields as the first argument.
- Dev-only `console.log` guarded with `if (process.env.NODE_ENV !== 'production')`.
- Frontend: `console.*` allowed (no enforcement).
## API Design Rules (from CONTRIBUTING.md §"API Design Rules")
## Function & Module Design
- Functions: explicit return types required (root strict ESLint); per-package code follows convention by inference.
- Modules: prefer per-feature service files (`src/services/<thing>Service.ts`) over multi-export barrels.
- Prefer `type` over `interface` for plain data shapes (CONTRIBUTING.md).
- Use `unknown` instead of `any` in catch blocks.
## Git Workflow
### Branch naming
### Commit message convention — Conventional Commits
### PR gate (CONTRIBUTING.md §"Before Opening a PR")
- [ ] `yarn typecheck` → 0 errors
- [ ] `yarn lint` → 0 warnings on changed files
- [ ] `yarn test` → all pass
- [ ] Admin endpoints have `requireAdmin`
- [ ] All catch blocks use `next(err)`
- [ ] New env vars added to `.env.example`
- [ ] `docs/API.md` updated when routes change
## SDD Workflow (feature documentation)
## Authentication Conventions Matrix
| Operation               | Auth                 | Pattern                               |
|-------------------------|----------------------|---------------------------------------|
| Read public data        | None                 | —                                     |
| Wallet-signed mutations | sr25519 sig + nonce  | `verifyWalletActionSignature()`       |
| Admin ops               | Bearer token         | `requireAdmin` middleware             |
| AI agent trades         | API key              | `agentAuth(['TRADE_SPOT'])`           |
## Where Strict vs. Permissive Applies (quick lookup)
| Location                                   | ESLint config                          | `no-explicit-any` |
|--------------------------------------------|----------------------------------------|-------------------|
| `tests/**/*.spec.ts`, root `scripts/`      | `/.eslintrc.js` (strict)              | `error`           |
| `spot-api/src/**`                          | `spot-api/.eslintrc.cjs`              | off               |
| `lunes-dex-main/src/**`                    | `lunes-dex-main/.eslintrc.cjs`        | off               |
| `sdk/src/**`                               | `sdk/.eslintrc.cjs`                   | off               |
| `mcp/lunex-agent-mcp/src/**`               | `mcp/lunex-agent-mcp/.eslintrc.cjs`   | off               |
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## System Overview
```text
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
- Off-chain authoritative orderbook (`spot-api/src/utils/orderbook.ts`) backed by PostgreSQL for durability and Redis for nonces/rate limits.
- All wallet-driven writes carry sr25519 signatures verified server-side (`spot-api/src/middleware/auth.ts`); nonces are single-use, TTL-bound in Redis.
- ink! 4.2.1 contracts hold custody, liquidity, fee distribution and listing escrow. Settlement is initiated by a `RELAYER_SEED` keypair from `spot-api/src/services/settlementService.ts`.
- Three independent authentication classes coexist: user sr25519 signed messages, admin Bearer (`ADMIN_SECRET`), and agent API keys (`X-API-Key: lnx_*`).
- Read path is split: spot-api owns operational state (orders, trades, social); SubQuery owns historical chain events queried via GraphQL by `spot-api/src/services/subqueryClient.ts`.
- Scheduler-driven background work (`rewardScheduler`, `copytradeWalletContinuationScheduler`, `socialAnalyticsPipeline`, `vaultReconciliationService`, `tradeSettlementService`) runs inside the spot-api process.
## Layers
- Purpose: User experience, programmatic clients, agent integrations
- Location: `lunes-dex-main/`, `lunex-admin/`, `sdk/`, `mcp/lunex-agent-mcp/`
- Contains: React components, Next.js admin routes, TS client, MCP tool registrations
- Depends on: `spot-api` REST + WS, wallet extensions (polkadot.js), chain RPC (for read-only contract queries)
- Constraint (AGENTS.md): UI must never be the source of truth for financial rules, authz, matching, rewards, listing or settlement.
- Purpose: Authenticate, validate, match, persist, broadcast and orchestrate on-chain settlement
- Location: `spot-api/src/`
- Contains: Express routers (`routes/`), domain services (`services/`), middleware (`middleware/`), in-memory orderbook (`utils/orderbook.ts`), WebSocket server (`websocket/server.ts`)
- Depends on: PostgreSQL via Prisma (`spot-api/prisma/schema.prisma`), Redis via `ioredis`, Lunes node via `@polkadot/api` + `@polkadot/api-contract`, SubQuery GraphQL
- Used by: Frontend, admin, SDK, MCP server, deploy scripts
- PostgreSQL 15 — single database `lunex_spot`; `spot-api` uses `public` schema, SubQuery uses `subquery` schema in the same DB (per `docker-compose.dev.yml`).
- Redis 7 — nonces, rate-limit counters, ephemeral matching locks (`matchingLockService.ts`).
- ORM: Prisma 5.10 (`spot-api/prisma/schema.prisma`, ~40 KB; `lunex-admin/prisma/schema.prisma`, ~22 KB — see *Architectural Constraints* on dual-schema sync).
- Purpose: Block-by-block ingestion of ink! contract events into PostgreSQL, exposing GraphQL.
- Location: `subquery-node/src/mappings/`, `subquery-node/schema.graphql`
- Runtime images: `subquerynetwork/subql-node-substrate:v6.4.0` (indexer) + `subquerynetwork/subql-query:v2.13.1` (GraphQL).
- Consumed by: `spot-api/src/services/subqueryClient.ts` for historical lookups.
- Purpose: Custody, AMM math, listing escrow, staking, rewards, vault accounting.
- Location: `Lunex/contracts/*/lib.rs`
- Stack: ink! 4.2.1, scale codec 3, scale-info 2, wasm32-unknown-unknown.
- Grouped by responsibility:
## Data Flow
### Primary Request Path — Order Placement
### Smart Router / Swap Path
### Copy Trade Path
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
- Purpose: Authenticates a wallet-initiated action while preventing replay.
- Examples: `spot-api/src/middleware/auth.ts` (`SIGNED_ACTION_TTL_MS`, `consumeNonce`).
- Pattern: Build canonical message (e.g. `buildSpotOrderMessage`), verify via `signatureVerify` from `@polkadot/util-crypto`, atomically `SET ... NX EX` the nonce key in Redis with an in-memory fallback to keep replay protection working through Redis outages.
- Purpose: Hot path for matching engine.
- Examples: `spot-api/src/utils/orderbook.ts` (`Orderbook`, `MatchResult`).
- Pattern: Sorted-array price-time priority; rehydrated from DB at startup; mutations guarded by `matchingLockService`.
- Purpose: Singleton domain services exposed as named exports.
- Examples: `settlementService`, `marginService`, `copytradeService`, `socialIndexerService` under `spot-api/src/services/`.
- Pattern: Each service owns one bounded domain, instantiates its own Polkadot.js connection where needed, and exposes async methods consumed by routers + schedulers.
- Purpose: Per-domain HTTP surface, Zod-validated, wired in `spot-api/src/index.ts`.
- Examples: `spot-api/src/routes/orders.ts`, `routes/copytrade.ts`, `routes/admin.ts`.
- Pattern: Thin controller → service → DB; admin paths gated by `requireAdminOrInternal` (`middleware/adminGuard.ts`); agent paths gated by `middleware/agentAuth.ts`.
- Purpose: One Cargo crate per contract, each producing `cdylib + rlib` and a metadata JSON consumed off-chain.
- Examples: `Lunex/contracts/pair/Cargo.toml`, `Lunex/contracts/factory/lib.rs`.
- Pattern: `#![cfg_attr(not(feature = "std"), no_std)]`, `ink::contract` macro, scale codec, optional `ink-as-dependency` feature so a contract can be cross-imported (e.g. `factory` depends on `pair_contract` with `ink-as-dependency`).
## Entry Points
- Location: `spot-api/src/index.ts`
- Triggers: `npm run dev` (`ts-node src/index.ts`) or PM2 `lunex-api` app (`ecosystem.config.js`, `dist/index.js`).
- Responsibilities: Boot Express, mount routers, install middlewares (`helmet`, `cors`, rate limit, `securityShield`, `responseSanitizer`), start WebSocket server, rehydrate orderbooks, kick off schedulers, expose `/metrics` Prometheus endpoint, register `unhandledRejection` / `uncaughtException` fatal handlers.
- Location: `lunes-dex-main/src/index.tsx` → `App.tsx`; build via `lunes-dex-main/vite.config.ts`.
- Triggers: `npm run dev` (Vite dev server) or `docker/Dockerfile.frontend` producing static bundle served by nginx.
- Location: `lunex-admin/src/app/layout.tsx` (App Router), `middleware.ts` at repo of `lunex-admin/` for NextAuth gating.
- Triggers: `next dev` or `next start` (`lunex-admin/package.json`), `docker/Dockerfile.admin`.
- Location: `sdk/src/index.ts` (re-exports `http-client.ts`, `websocket-client.ts`, types/utils).
- Location: `mcp/lunex-agent-mcp/src/index.ts` (~112 KB single-file MCP tool registry), `routerTools.ts`, `smokeRouter.ts`.
- Triggers: `npm run dev` (`tsx src/index.ts`) — communicates over MCP transport to spot-api.
- Location: `subquery-node/src/index.ts`, mappings under `subquery-node/src/mappings/`, schema in `subquery-node/schema.graphql`.
- Triggers: Docker images `subql-node-substrate` + `subql-query` (see `docker-compose.dev.yml`); `subquery-node/entrypoint.sh` regenerates `project.yaml` from `project.template.yaml` at container start.
- Location: `faucet/index.js`.
- Triggers: `node index.js` on testnet host, exposes `POST /faucet`, `GET /faucet`, `GET /faucet/status`, `GET /health`.
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
### Reading directly from chain when SubQuery covers it
### Bypassing the nonce/signature middleware
### Drifting Prisma schemas between spot-api and admin
### Tight coupling of router handlers to chain calls
## Error Handling
- `spot-api/src/middleware/errors.ts` is the last `app.use(errorHandler)` — converts thrown errors into JSON responses with safe messages.
- `responseSanitizer` (`middleware/responseSanitizer.ts`) strips sensitive fields before serialization.
- `unhandledRejection` and `uncaughtException` in `spot-api/src/index.ts` log via Pino (`utils/logger.ts`) and `process.exit(1)` so the supervisor (Docker / PM2) restarts the process.
- Production secret validation happens at boot via `collectProductionConfigErrors` (`utils/productionGuards.ts`); missing secrets abort startup.
- Long-running chain calls are bounded by `withTxTimeout` (`utils/txWithTimeout.ts`).
- ink! contracts use `Result<T, Error>` with custom error enums per contract; revert reasons surface back to the relayer via Polkadot.js.
## Cross-Cutting Concerns
- Wallet writes — sr25519 signature + Redis nonce (`middleware/auth.ts`).
- Admin operations — `Authorization: Bearer <ADMIN_SECRET>` via `middleware/adminGuard.ts`.
- AI agents — `X-API-Key: lnx_*` validated via `middleware/agentAuth.ts` + `services/agentService.ts`, with staking tiers gating limits.
## Deployment Topology
| Service | Image / build | Host ports | Depends on |
|---------|---------------|-----------|-----------|
| `postgres` | `postgres:15-alpine` | 5433 → 5432 | — |
| `api` | `docker/Dockerfile.api` over `spot-api/` | 4000, 4001 | `postgres` (healthy) |
| `frontend` | `docker/Dockerfile.frontend` over `lunes-dex-main/` | 3000 → 80 | `api` |
| `admin` | `docker/Dockerfile.admin` over `lunex-admin/` | 3001 | `postgres`, `api` |
| `subquery-node` | `subquerynetwork/subql-node-substrate:v6.4.0` | 3010 → 3000 | `postgres` |
| `subquery-query` | `subquerynetwork/subql-query:v2.13.1` | 3011 → 3000 | `subquery-node` |
| `nginx` | `nginx:1.25-alpine` | 8080 → 80 | api, frontend, admin |
- `docker/docker-compose.prod.yml`, `docker/docker-compose.testnet.yml`, `docker/docker-compose.sandbox.yml`, `docker/docker-compose.doppler.yml` provide environment-specific stacks; secrets injected by Doppler.
- `ecosystem.config.js` declares a PM2 app `lunex-api` (`cwd: /opt/lunex/spot-api`, `dist/index.js`, fork mode, single instance, max 512 MB, restart with 5 s back-off).
- VPS bootstrap and provisioning live in `scripts/provision-vps.sh`, `scripts/setup-vps.sh`, `scripts/setup-doppler.sh`, `scripts/gen-secrets.sh`.
- Observability stack: Prometheus (`docker/prometheus.yml`), Alertmanager (`docker/alertmanager.yml`, `alert-rules.yml`), Blackbox exporter (`blackbox-exporter.yml`), Loki (`loki-config.yml`), Grafana dashboards (`config/grafana/`).
- Reverse proxy in prod: `docker/nginx.prod.conf` and `docker/nginx.testnet.conf` (TLS, rate-limit, routing of `/api`, `/ws`, `/admin`).
- Backups: `docker/backup.sh`.
- TypeScript scripts in `scripts/` orchestrate contract deploy via Polkadot.js: `deploy.ts`, `deploy-lunes.ts`, `deploy-listing-contracts.ts`, `deploy-asset-wrappers.ts`, `deploy-remaining-contracts.ts`.
- Outputs deployment manifests like `deployment-testnet-1773537062184.json` (root) and `deployment/listing-deploy-*.json`.
- `verify-deployment.ts` (`scripts/`) sanity-checks deployed addresses against the manifest.
- Pre-built artifacts that ship with the repo live in `artifacts/` (committed `.contract` + metadata JSON).
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
