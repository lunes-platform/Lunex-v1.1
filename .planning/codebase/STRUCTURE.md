# Codebase Structure

**Analysis Date:** 2026-05-21

## Directory Layout

```text
Lunex/                                  # repo root (workspace + npm root)
├── Cargo.toml                          # Rust workspace manifest (13 ink! crates + root sim crate)
├── package.json                        # npm root: typechain compiler, contract build orchestration, deploy scripts
├── tsconfig.json                       # root TS config (for deploy scripts under scripts/)
├── jest.config.js                      # root Jest (typechain spec tests)
├── docker-compose.dev.yml              # full dev stack (postgres, api, frontend, admin, subquery, nginx)
├── ecosystem.config.js                 # PM2 process definition for spot-api in prod
├── rust-toolchain.toml                 # workspace-pinned Rust toolchain
├── .rustfmt.toml / .prettierrc / .eslintrc.js   # formatter + linter configs
├── .gitleaks.toml                      # secret scanning rules
├── .doppler.yaml                       # Doppler project config (secrets)
├── README.md                           # full setup + arch overview (61 KB)
├── AGENTS.md                           # ownership matrix + SDD workflow rules
├── llms.txt                            # LLM-oriented project digest
├── CHANGELOG.md / CONTRIBUTING.md / LICENSE.md / NOTICE.md / PRODUCTION-READINESS.md
├── src/                                # root crate `lunex-sim-tests` (integration sim tests)
│   ├── lib.rs
│   ├── decimal_utils.rs                # shared decimal math used by sim tests
│   └── native_assets_integration.rs    # tests for Lunes native asset bridging
│
├── Lunex/                              # ink! smart-contract sources (13 crates)
│   └── contracts/
│       ├── factory/                    # AMM factory (creates Pair instances)
│       ├── pair/                       # AMM constant-product pair
│       ├── router/                     # Swap router across pairs
│       ├── wnative/                    # Wrapped native (WLUNES)
│       ├── psp22/                      # Local PSP22 token primitive
│       ├── spot_settlement/            # On-chain settlement for off-chain matched trades
│       ├── asymmetric_pair/            # Concentrated/asymmetric liquidity pair
│       ├── copy_vault/                 # Copy-trading vault custody
│       ├── staking/                    # LUNES staking with tiered rewards
│       ├── rewards/                    # Trading-rewards distribution
│       ├── listing_manager/            # Permissioned token listing escrow
│       ├── liquidity_lock/             # Locked LP tokens for listings
│       └── asset_wrapper/              # Wrap native pallet-assets ↔ PSP22
│
├── spot-api/                           # Express + TypeScript backend
│   ├── package.json                    # name: lunex-spot-api
│   ├── prisma/
│   │   ├── schema.prisma               # canonical DB schema (~40 KB, 41+ models)
│   │   ├── migrations/                 # Prisma migration history
│   │   └── seed.ts                     # `prisma db seed`
│   ├── abis/                           # ink! contract metadata JSON consumed at runtime
│   │   ├── Factory.json / Pair.json / Router.json / Staking.json / Rewards.json …
│   │   └── shared/
│   ├── src/
│   │   ├── index.ts                    # Express boot, scheduler wiring, secrets validation
│   │   ├── config.ts                   # env-driven typed config
│   │   ├── db.ts                       # Prisma client singleton
│   │   ├── routes/                     # 23 Express routers (one file per domain)
│   │   ├── services/                   # 30+ domain services
│   │   ├── middleware/                 # auth, adminGuard, agentAuth, errors, validation, securityShield, responseSanitizer, pagination
│   │   ├── websocket/server.ts         # WS server (allow-listed channels, origin, heartbeat)
│   │   └── utils/                      # logger, metrics, redis, redisRateLimit, orderbook, productionGuards, txWithTimeout, validation, copytrade, helpers
│   ├── __tests__/                      # Jest tests (unit + e2e, see `npm run test:e2e`)
│   └── scripts/                        # check-ts-prune.cjs, check-depcheck.cjs, deploy helpers
│
├── lunes-dex-main/                     # End-user frontend (React 18 + Vite 6)
│   ├── package.json                    # name: lunes-dex
│   ├── vite.config.ts / tsconfig.json
│   ├── nginx.spa.conf                  # SPA fallback config used in Docker image
│   ├── public/                         # static assets
│   ├── src/
│   │   ├── App.tsx / index.tsx
│   │   ├── pages/                      # affiliates, agent(s), copytrade, docs, governance, header, home, landing, listing, notFound, pool(s), protocolStats, rewards, social, spot, staking, strategies
│   │   ├── components/                 # ErrorBoundary, FooterTag, LunexLogo, TokenIcon, asymmetric, bases, common, devices, feedback, layout, modal, spot, tradeSubNav, ui, wallet
│   │   ├── hooks/                      # useSwap, usePools, useLiquidity, useAsymmetricDeploy, useFavorites, useWebMCP, useAnimatedCounter, useSelectOptions
│   │   ├── services/                   # contractService, agentService, asymmetricContractService, marginService, rewardsService, socialService, spotService, strategyService
│   │   ├── routers/                    # client-side route tree
│   │   ├── context/                    # React context providers
│   │   ├── sdk/                        # local SDK shim (wraps `@lunex/sdk` + custom helpers)
│   │   ├── abis/                       # Factory.json / Staking.json (subset re-shipped for client-side calls)
│   │   ├── config/ / theme/ / styles/ / types/ / utils/
│   └── (test-debug.js, test.js, test-radius.js — scratch dev files)
│
├── lunex-admin/                        # Admin console (Next.js 16, App Router)
│   ├── package.json                    # name: lunex-admin
│   ├── middleware.ts                   # NextAuth gating at edge
│   ├── auth.ts                         # NextAuth config (next-auth 5 beta)
│   ├── next.config.ts / postcss.config.mjs
│   ├── components.json                 # shadcn registry
│   ├── prisma/schema.prisma            # subset schema (~22 KB) — MUST be kept in sync with spot-api
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx / globals.css
│   │   │   ├── login/                  # auth flow
│   │   │   ├── ui/                     # design system playground
│   │   │   ├── api/auth/               # NextAuth route handlers
│   │   │   └── (admin)/                # protected route group: affiliates, agents, audit, copytrade, dex-users, emergency, listings, margin, rewards, team, treasury, users, volume
│   │   ├── components/app-sidebar.tsx + shadcn-derived primitives
│   │   ├── lib/                        # prisma, queries, session, rateLimit, audit, utils
│   │   ├── hooks/ / types/
│
├── sdk/                                # `@lunex/sdk` public TypeScript SDK
│   ├── package.json                    # name: @lunex/sdk, v1.0.0
│   ├── README.md
│   ├── src/
│   │   ├── index.ts                    # public surface
│   │   ├── http-client.ts              # REST client
│   │   ├── websocket-client.ts         # WS client
│   │   ├── types.ts / spot-types.ts    # public types
│   │   └── utils.ts / spot-utils.ts    # signing + helpers
│   └── examples/                       # consumer examples
│
├── mcp/                                # Model Context Protocol servers for AI agents
│   └── lunex-agent-mcp/
│       ├── package.json                # @lunex/spot-social-copytrade-mcp
│       ├── README.md / OPENCLAW_SESSION_EXAMPLE.md / openclaw.mcp.json
│       └── src/
│           ├── index.ts                # MCP tool registry (~112 KB single file)
│           ├── routerTools.ts          # smart-router-as-MCP-tool
│           ├── routerTools.test.ts
│           └── smokeRouter.ts          # CLI smoke runner
│
├── subquery-node/                      # SubQuery indexer for ink! events
│   ├── package.json
│   ├── project.template.yaml           # template — runtime regenerates `project.yaml` at container start
│   ├── project.yaml                    # generated, committed for IDE tooling
│   ├── schema.graphql                  # SwapEvent, LiquidityEvent, VaultEvent, TradeEvent, WalletSummary, PairStats, DailyProtocolStats, …
│   ├── entrypoint.sh                   # regenerates project.yaml from template + envs
│   └── src/
│       ├── index.ts
│       ├── mappings/                   # handler functions per event
│       └── types/                      # codegen output (globals.d.ts)
│
├── faucet/                             # Standalone testnet faucet (Express + polkadot.js)
│   ├── index.js                        # POST /faucet, GET /faucet, /faucet/status, /health
│   ├── package.json
│   └── Dockerfile
│
├── fuzz/                               # Cargo-fuzz harnesses (excluded from cargo --workspace gates)
│   ├── Cargo.toml
│   ├── fuzz_targets/                   # individual fuzz binaries
│   └── corpus/                         # seed corpora
│
├── tests/                              # Cross-cutting Rust + TS integration / e2e / security / stress tests
│   ├── Dex.spec.ts                     # TS contract integration (Jest)
│   ├── integration_e2e.rs              # Rust e2e flows
│   ├── e2e_flow_simulation.rs
│   ├── lunex_complete_integration_test.rs
│   ├── security_tests.rs               # `cargo test --test security_tests`
│   ├── stress_tests.rs                 # `cargo test --test stress_tests`
│   ├── staking_integration_tests.rs
│   ├── complete_staking_rewards_integration.rs
│   ├── openzeppelin_security_validation.rs
│   ├── property_security_invariants.rs
│   ├── usability_native_psp22_tests.rs
│   ├── testHelpers.ts / globalSetup.ts / globalTeardown.ts
│
├── types/                              # Shared TS types & token registry JSONs
│   ├── admin-tokens.json
│   ├── decimal-utilities-example.ts
│   ├── lunes-ecosystem-tokens.json
│   └── token-listing-config.json
│
├── examples/                           # Reusable JSON examples (e.g. deploy targets)
│   └── testnet.json.example
│
├── docs/                               # Canonical documentation tree
│   ├── README.md                       # Docs map
│   ├── prd/                            # PROJECT_PRD.md + feature PRDs
│   ├── specs/                          # PROJECT_SPEC.md + LOCAL_PROJECT_BOOTSTRAP_SPEC.md
│   ├── sdd/                            # SDD workflow rules
│   ├── features/                       # one folder per feature (asymmetric-liquidity-v1, agent-smart-router-mcp-v1, social-copytrade-v1, production-readiness-v1, …)
│   ├── api/                            # OpenAPI JSON + descriptors
│   ├── guides/ / reports/ / spot/ / shared/
│   ├── API.md / API_SPECIFICATION.md / ARCHITECTURE.md / DEPLOYMENT.md
│   ├── FRONTEND_IMPLEMENTATION_GUIDE.md / SPOT_ORDERBOOK_ARCHITECTURE.md
│   ├── PUBLIC_API_SPECIFICATION.md / REFACTORING_PLAN.md
│   ├── LISTING_POLICY.md / SISTEMA_GOVERNANCA_TAXAS.md / SISTEMA_PREMIACAO_STAKING.md
│   ├── PRD_LUNES_NATIVE_ASSETS.md / WLUNES_REQUIREMENTS.md
│   └── dex-requisitos.md / requisitonovo.md / RESUMO_*.md
│
├── deployment/                         # Deployment manifests + monitoring assets
│   ├── grafana/                        # dashboards
│   ├── security/
│   ├── listing-deploy-1773152769150.json
│   ├── remaining-deploy-1773552883202.json
│   └── testnet.json.example
│
├── docker/                             # Dockerfiles, nginx confs, env templates, compose stacks
│   ├── Dockerfile.api / Dockerfile.frontend / Dockerfile.admin
│   ├── docker-compose.prod.yml / docker-compose.testnet.yml / docker-compose.sandbox.yml / docker-compose.doppler.yml
│   ├── nginx.dev.conf / nginx.prod.conf / nginx.testnet.conf / nginx.spa.conf
│   ├── prometheus.yml / alert-rules.yml / alertmanager.yml / blackbox-exporter.yml / loki-config.yml
│   ├── .env.docker / .env.docker.example / .env.prod.example / .env.sandbox.example / .env.testnet.example
│   └── backup.sh
│
├── scripts/                            # Deploy + ops TS/JS/bash scripts
│   ├── deploy.ts / deploy.sh / deploy-lunes.ts
│   ├── deploy-listing-contracts.ts / deploy-asset-wrappers.ts / deploy-remaining-contracts.ts
│   ├── listing-relayer.ts / list-token.ts / admin-list-token.ts
│   ├── verify-deployment.ts / debug_contracts.ts / debug_token.ts
│   ├── check_balances.ts / check_balances2.ts / check_contracts.ts
│   ├── discover_tokens.ts / explore-lunes-pallets.js / explore-lunes-rpc.js / list-lunes-methods.js
│   ├── fund_tester.ts / send_tokens.ts
│   ├── provision-vps.sh / setup-vps.sh / setup-doppler.sh / gen-secrets.sh
│
├── config/                             # Runtime config bundles
│   ├── grafana/ / security/
│   └── lunes-network.toml
│
├── artifacts/                          # Pre-built ink! `.contract` + metadata JSON (committed)
│   ├── factory_contract.contract / .json
│   ├── pair_contract.contract / .json
│   ├── router_contract.contract / .json
│   ├── staking_contract.contract / .json
│   ├── trading_rewards_contract.contract / .json
│   └── wnative_contract.contract / .json
│
├── tasks/                              # SDD implementation logs (dated)
│   ├── plan.md
│   ├── todo.md
│   ├── IMPLEMENTACAO-100.md / IMPLEMENTACAO-2026-04-28.md / IMPLEMENTACAO-FASES-4-5.md / IMPLEMENTACAO-TIER2-3.md
│   └── specs/                          # task-level specs
│
├── PATHFINDER-2026-04-28/              # Dated implementation snapshot (historical)
│   ├── 00-features.md
│   └── PRODUCAO-RELATORIO.md
│
├── .agent/                             # Agent toolkit (skills, agents, workflows, MCP config)
│   ├── ARCHITECTURE.md
│   ├── mcp_config.json
│   ├── agents/                         # 20+ specialist agents (backend-specialist, frontend-specialist, security-auditor, …)
│   ├── skills/                         # per-skill SKILL.md + rules/*.md (api-patterns, app-builder, architecture, rust-pro, tdd-workflow, …)
│   ├── workflows/                      # brainstorm, debug, deploy, orchestrate, plan, test, ui-ux-pro-max
│   ├── rules/ / scripts/ / .shared/
│
├── .planning/codebase/                 # GSD codebase maps (this document lives here)
├── .cargo/                             # cargo registry / config overrides
├── .windsurf/                          # Windsurf IDE config
├── .github/                            # CI workflows
├── .gitignore / .eslintignore / .prettierignore / .env.example
├── target/                             # Cargo build outputs (gitignored)
├── node_modules/                       # npm install output (gitignored)
└── patches/                            # patch-package overrides (postinstall)
```

## Directory Purposes

**`Lunex/contracts/` (ink! smart contracts):**
- Purpose: On-chain authoritative logic — custody, AMM math, staking, rewards, listing escrow, vault accounting.
- Contains: 13 Cargo crates, one per contract. Each has `Cargo.toml` + `lib.rs` (or `src/`) and produces a `cdylib + rlib` plus a metadata JSON via `cargo contract build`.
- Key files: `factory/lib.rs`, `pair/lib.rs`, `router/lib.rs`, `staking/lib.rs`, `rewards/lib.rs`, `listing_manager/lib.rs`, `spot_settlement/lib.rs`, `wnative/lib.rs`, `psp22/lib.rs`, `asset_wrapper/lib.rs`, `asymmetric_pair/lib.rs`, `copy_vault/lib.rs`, `liquidity_lock/lib.rs`.

**`spot-api/`:**
- Purpose: Off-chain authoritative API (REST + WebSocket), matching engine, settlement orchestration, persistence.
- Contains: TypeScript Express app, Prisma schema + migrations, ink! ABI JSONs, Jest tests, deploy/QA scripts.
- Key files: `spot-api/src/index.ts`, `spot-api/src/config.ts`, `spot-api/prisma/schema.prisma`, `spot-api/src/utils/orderbook.ts`, `spot-api/src/services/settlementService.ts`.

**`lunes-dex-main/`:**
- Purpose: Public end-user web app for trading, liquidity, social, governance and staking.
- Contains: React 18 + Vite 6 SPA; routes under `src/pages/`, design system + components under `src/components/`, network code under `src/services/`.
- Key files: `lunes-dex-main/src/App.tsx`, `lunes-dex-main/vite.config.ts`, `lunes-dex-main/src/services/contractService.ts`.

**`lunex-admin/`:**
- Purpose: Internal admin/operations console for listings, treasury, audit, payouts, emergency controls.
- Contains: Next.js 16 App Router, NextAuth, shadcn UI, **its own Prisma schema** (must be synced with spot-api).
- Key files: `lunex-admin/src/app/(admin)/`, `lunex-admin/middleware.ts`, `lunex-admin/auth.ts`, `lunex-admin/prisma/schema.prisma`.

**`sdk/`:**
- Purpose: Public TypeScript SDK (`@lunex/sdk`) for external integrators.
- Contains: HTTP + WebSocket clients, public types, signing helpers, examples.
- Key files: `sdk/src/index.ts`, `sdk/src/http-client.ts`, `sdk/src/websocket-client.ts`.

**`mcp/lunex-agent-mcp/`:**
- Purpose: Expose spot-api tools (orders, social, copytrade, smart router) to AI agents via Model Context Protocol.
- Contains: Single MCP server with a large tool registry; smoke test runner.
- Key files: `mcp/lunex-agent-mcp/src/index.ts`, `mcp/lunex-agent-mcp/src/routerTools.ts`, `mcp/lunex-agent-mcp/src/smokeRouter.ts`.

**`subquery-node/`:**
- Purpose: Block-by-block indexer of ink! contract events (Swap, Liquidity, Vault, Trade) into Postgres, exposed via GraphQL.
- Contains: SubQuery project + mappings; runtime image regenerates `project.yaml` from `project.template.yaml`.
- Key files: `subquery-node/schema.graphql`, `subquery-node/project.template.yaml`, `subquery-node/src/mappings/`, `subquery-node/entrypoint.sh`.

**`faucet/`:**
- Purpose: Testnet token faucet — standalone, not part of the main API.
- Contains: Single Express app + polkadot.js + rate-limiter.
- Key files: `faucet/index.js`.

**`src/` (root crate):**
- Purpose: Workspace member `lunex-sim-tests` — Rust integration/simulation tests that need to live at workspace root.
- Contains: `lib.rs`, `decimal_utils.rs`, `native_assets_integration.rs`.
- Note: NOT the spot-api or contract source; it is a sibling sim-tests crate referenced in the root `Cargo.toml` `members = ["."]` entry.

**`tests/`:**
- Purpose: Cross-cutting Rust + TypeScript integration / e2e / security / stress tests outside any single workspace crate.
- Contains: `.rs` files run via `cargo test --test <name>` and `Dex.spec.ts` (Jest, from root `jest.config.js`).
- Key files: `tests/integration_e2e.rs`, `tests/security_tests.rs`, `tests/stress_tests.rs`, `tests/Dex.spec.ts`.

**`fuzz/`:**
- Purpose: cargo-fuzz harnesses; explicitly excluded from default workspace test runs (`cargo test --workspace --exclude fuzz`).

**`scripts/`:**
- Purpose: Deploy, ops and exploratory tooling — TypeScript (via ts-node), JavaScript, and bash.
- Highlights: `deploy-lunes.ts`, `deploy-listing-contracts.ts`, `verify-deployment.ts`, `listing-relayer.ts`, `provision-vps.sh`, `setup-doppler.sh`, `gen-secrets.sh`.

**`docker/`:**
- Purpose: Container build + orchestration assets and env templates for every environment.
- Contains: Dockerfiles per service, multiple `docker-compose.*.yml`, nginx confs, observability configs.

**`deployment/`:**
- Purpose: Committed deploy manifests (per-network address books) + Grafana dashboards + security tooling.

**`config/`:**
- Purpose: Runtime config bundles (Grafana, security, `lunes-network.toml`).

**`artifacts/`:**
- Purpose: Pre-built ink! contract artifacts (`.contract` + metadata `.json`) committed for deploy reproducibility.
- Note: Mirrors of these JSONs also live under `spot-api/abis/` and `lunes-dex-main/src/abis/` for runtime use.

**`types/`:**
- Purpose: Shared TypeScript-adjacent data (token registries) and decimal utility examples.

**`examples/`:**
- Purpose: Example payloads (e.g. `testnet.json.example`) referenced by deploy scripts.

**`docs/`:**
- Purpose: Canonical SDD documentation tree. `docs/prd/PROJECT_PRD.md` + `docs/specs/PROJECT_SPEC.md` are the umbrella docs; per-feature work lives under `docs/features/<slug>/`.

**`tasks/`:**
- Purpose: Implementation logs and dated execution diaries (kept for traceability).
- Note: `tasks/plan.md` is the most recent active plan; older `IMPLEMENTACAO-*.md` files are dated snapshots.

**`PATHFINDER-2026-04-28/`:**
- Purpose: Dated implementation snapshot (April 2026) preserved for historical reference; not a canonical workflow location.
- Contains: `00-features.md`, `PRODUCAO-RELATORIO.md`.

**`.agent/`:**
- Purpose: Project-local agent toolkit consumed by Claude Code / SDD workflows.
- Contains: `ARCHITECTURE.md`, `mcp_config.json`, plus subdirectories `agents/` (20+ specialist personas), `skills/` (SKILL.md + rules), `workflows/`, `rules/`, `scripts/`, `.shared/`.
- Note: Read `.agent/skills/<skill>/SKILL.md` before relying on a skill; do NOT load full `AGENTS.md` files inside subdirs.

**`.planning/codebase/`:**
- Purpose: GSD-generated codebase maps (this file, plus future TECH/QUALITY/CONCERNS docs).

**`target/`, `node_modules/`, `patches/`:**
- Purpose: Build/dep outputs (`target/`, `node_modules/` — gitignored) and `patch-package` overrides applied via `postinstall`.

## Key File Locations

**Entry Points:**
- `spot-api/src/index.ts` — Express + WS boot, scheduler wiring, secrets validation
- `lunes-dex-main/src/index.tsx` → `lunes-dex-main/src/App.tsx` — React app root
- `lunex-admin/src/app/layout.tsx` + `lunex-admin/middleware.ts` — Next.js admin
- `sdk/src/index.ts` — SDK public surface
- `mcp/lunex-agent-mcp/src/index.ts` — MCP server
- `subquery-node/src/index.ts` (handlers under `subquery-node/src/mappings/`)
- `faucet/index.js` — faucet service

**Configuration:**
- Workspace: `Cargo.toml`, `rust-toolchain.toml`, `.cargo/`
- Root npm: `package.json`, `tsconfig.json`, `jest.config.js`, `.eslintrc.js`, `.prettierrc`, `.rustfmt.toml`
- Per-app: `spot-api/{package.json,tsconfig.json,prisma.config.ts}`, `lunes-dex-main/{package.json,vite.config.ts}`, `lunex-admin/{package.json,next.config.ts}`, `sdk/package.json`, `mcp/lunex-agent-mcp/package.json`
- Env templates: `.env.example` (root), `spot-api/.env.example`, `lunes-dex-main/.env.example`, `lunes-dex-main/.env.production.example`, `lunex-admin/.env.example`, `mcp/lunex-agent-mcp/.env.example`, `docker/.env.*.example`
- Secrets governance: `.doppler.yaml`, `.gitleaks.toml`, `scripts/gen-secrets.sh`, `scripts/setup-doppler.sh`
- Process supervisor: `ecosystem.config.js` (PM2)

**Core Logic:**
- Off-chain matching: `spot-api/src/utils/orderbook.ts`
- Auth (signature + nonce): `spot-api/src/middleware/auth.ts`
- On-chain settlement: `spot-api/src/services/settlementService.ts`, `spot-api/src/services/tradeSettlementService.ts`
- Smart router: `spot-api/src/services/routerService.ts`, `spot-api/src/routes/router.ts`
- Copy trading: `spot-api/src/services/copytradeService.ts`, `spot-api/src/services/copytradeWalletContinuationScheduler.ts`
- Margin: `spot-api/src/services/marginService.ts`
- Rewards: `spot-api/src/services/rewardDistributionService.ts`, `rewardPayoutService.ts`, `rewardScheduler.ts`
- Listing: `spot-api/src/services/listingService.ts`, `Lunex/contracts/listing_manager/lib.rs`
- AMM core: `Lunex/contracts/{factory,pair,router,wnative}/lib.rs`

**Database:**
- Canonical schema: `spot-api/prisma/schema.prisma`
- Admin subset: `lunex-admin/prisma/schema.prisma` (sync target)
- Seed: `spot-api/prisma/seed.ts`
- Migrations: `spot-api/prisma/migrations/`

**Testing:**
- Backend Jest: `spot-api/__tests__/` (`npm run test`, `test:e2e`)
- Rust integration: `tests/*.rs` (`cargo test --test <name>`)
- Contract typechain TS: `tests/Dex.spec.ts` (`npm run test:typechain` from root)
- Fuzzing: `fuzz/fuzz_targets/`

**Deploy / Ops:**
- Network manifests: `deployment-testnet-1773537062184.json` (root), `deployment/listing-deploy-*.json`
- Deploy scripts: `scripts/deploy-lunes.ts`, `scripts/deploy-listing-contracts.ts`, `scripts/verify-deployment.ts`
- VPS bootstrap: `scripts/provision-vps.sh`, `scripts/setup-vps.sh`
- Observability: `docker/prometheus.yml`, `docker/alert-rules.yml`, `docker/loki-config.yml`, `config/grafana/`, `deployment/grafana/`

## Workspace Members (root `Cargo.toml`)

Resolver 2; 14 members:
- `.` (root crate `lunex-sim-tests` — sim tests at workspace root, sources in `src/`)
- `Lunex/contracts/asset_wrapper`
- `Lunex/contracts/asymmetric_pair`
- `Lunex/contracts/copy_vault`
- `Lunex/contracts/factory`
- `Lunex/contracts/liquidity_lock`
- `Lunex/contracts/listing_manager`
- `Lunex/contracts/pair`
- `Lunex/contracts/psp22`
- `Lunex/contracts/rewards`
- `Lunex/contracts/router`
- `Lunex/contracts/spot_settlement`
- `Lunex/contracts/staking`
- `Lunex/contracts/wnative`

`fuzz/` is a separate Cargo project (not in the workspace) and is explicitly excluded from workspace-wide gates (`cargo test --workspace --exclude fuzz`, `cargo clippy --workspace --exclude fuzz -- -D warnings`).

Release profile (`Cargo.toml`): `panic = "abort"`, `lto = true`, `opt-level = "z"`, `codegen-units = 1` (size-optimised for ink! Wasm).

## Naming Conventions

**Files (TypeScript):**
- Service: `<domain>Service.ts` (e.g. `orderService.ts`, `marginService.ts`).
- Router (Express): `<domain>.ts` under `spot-api/src/routes/` (e.g. `orders.ts`, `copytrade.ts`).
- Middleware: lowercase descriptor (`auth.ts`, `adminGuard.ts`, `agentAuth.ts`, `errors.ts`, `securityShield.ts`).
- Scheduler / background worker: `<domain>Scheduler.ts` or `<domain>Pipeline.ts`.
- Tests: `*.test.ts` (unit) / `*.e2e.test.ts` (end-to-end) under `__tests__/`.

**Files (React):**
- Components: `PascalCase.tsx` (`ErrorBoundary.tsx`, `LunexLogo/`).
- Hooks: `useXxx.ts` / `useXxx.tsx` (`useSwap.tsx`, `usePools.ts`).
- Services: `<domain>Service.ts` (`contractService.ts`, `socialService.ts`).
- Pages: lowercase directory under `src/pages/` (`spot/`, `pool/`, `staking/`).

**Files (Rust / ink!):**
- One crate per contract under `Lunex/contracts/<snake_case>/`.
- Crate name suffix: `<contract>_contract` (e.g. `pair_contract`, `factory_contract`).
- Tests: `tests/<scenario>_tests.rs` or `tests/<scenario>_integration.rs`.

**Files (Next.js admin):**
- App Router segments: route group `(admin)/<segment>/page.tsx`.
- Server utilities under `lunex-admin/src/lib/*.ts` (`prisma.ts`, `queries.ts`, `session.ts`, `rateLimit.ts`).

**Directories:**
- snake_case for Rust crates, camelCase for TS file names, kebab-case at the top-level when applicable (e.g. `lunes-dex-main/`, `lunex-admin/`, `lunex-agent-mcp/`).

## Where to Add New Code

Use the `AGENTS.md` ownership matrix as the source of truth. Common cases:

**New REST endpoint (off-chain feature):**
- Add router: `spot-api/src/routes/<domain>.ts` (export default Express router)
- Wire in `spot-api/src/index.ts` with `app.use('/api/v1/<prefix>', <router>)`
- Add business logic: `spot-api/src/services/<domain>Service.ts`
- Add Zod schemas inline or in `spot-api/src/utils/validation.ts`
- Tests: `spot-api/__tests__/<domain>.test.ts` (+ `.e2e.test.ts` if it hits the DB)
- If wallet-initiated: gate with `verifyAddressSignature` from `spot-api/src/middleware/auth.ts`
- If admin: gate with `requireAdminOrInternal` from `spot-api/src/middleware/adminGuard.ts`
- If agent API key: gate with middleware in `spot-api/src/middleware/agentAuth.ts`

**New database model / migration:**
- Edit `spot-api/prisma/schema.prisma`
- Run `npx prisma migrate dev --name <change>` from `spot-api/`
- If the new/changed model is read by admin: also edit `lunex-admin/prisma/schema.prisma` in the same task (per `AGENTS.md`); ensure both `npm run build`/`tsc` pass.

**New on-chain contract or invariant:**
- New crate: create `Lunex/contracts/<snake_case>/` with `Cargo.toml`, `lib.rs`; add to `members = [...]` in root `Cargo.toml`.
- Build: add to `npm run compile:all` in root `package.json`, or call `cargo contract build --release --manifest-path Lunex/contracts/<name>/Cargo.toml`.
- Deploy: extend `scripts/deploy-lunes.ts` (or a new `scripts/deploy-*.ts`); register address in the appropriate `deployment-*.json` and in env/config consumed by `spot-api/src/config.ts`.
- Off-chain wiring: ABI JSON goes into `spot-api/abis/<Contract>.json` (and `lunes-dex-main/src/abis/` if the frontend calls it directly); service wrapper in `spot-api/src/services/<contract>Service.ts`.
- Tests: integration in `tests/*.rs` (e.g. `tests/integration_e2e.rs`), security in `tests/security_tests.rs`, stress in `tests/stress_tests.rs`, fuzz targets in `fuzz/fuzz_targets/`.

**New frontend page / feature:**
- Page: `lunes-dex-main/src/pages/<feature>/` (own folder with `index.tsx` + sub-components)
- Shared component: `lunes-dex-main/src/components/<area>/<Component>.tsx`
- Hook: `lunes-dex-main/src/hooks/use<Feature>.ts`
- Service (HTTP/contract): `lunes-dex-main/src/services/<feature>Service.ts`
- Route registration: update `lunes-dex-main/src/routers/`
- Do not introduce authoritative business logic here — see `AGENTS.md` "Guardrail de Frontend".

**New admin screen:**
- Page: `lunex-admin/src/app/(admin)/<segment>/page.tsx`
- Server actions / DB queries: `lunex-admin/src/lib/queries.ts` (and any new helpers)
- Sidebar entry: `lunex-admin/src/components/app-sidebar.tsx`
- If it writes back to the protocol DB, prefer calling `spot-api` over editing rows directly — keep authoritative logic on the API.

**New SDK surface:**
- Public types: `sdk/src/types.ts` or `sdk/src/spot-types.ts`
- Client method: extend `sdk/src/http-client.ts` (REST) or `sdk/src/websocket-client.ts` (WS)
- Re-export from `sdk/src/index.ts`
- Examples: `sdk/examples/<scenario>.ts`

**New MCP tool for agents:**
- Register tool in `mcp/lunex-agent-mcp/src/index.ts` (or factor into a sibling module like `routerTools.ts` if the surface grows)
- Add smoke check in `mcp/lunex-agent-mcp/src/smokeRouter.ts` or a new `*.test.ts`
- Underlying API must already exist in `spot-api/` — MCP must not be the only auth path.

**New indexed event:**
- Extend `subquery-node/schema.graphql` (entity definition + `@index` columns)
- Add handler in `subquery-node/src/mappings/<event>.ts`
- Register in `subquery-node/project.template.yaml`
- Run codegen (regenerates `subquery-node/src/types/`); commit generated `project.yaml` if stable
- Consumer in `spot-api/src/services/subqueryClient.ts` for GraphQL queries

**New script (deploy / ops):**
- TypeScript scripts go in `scripts/<verb>-<noun>.ts`, runnable via `npx ts-node scripts/<file>.ts`
- Shell scripts in `scripts/<verb>-<noun>.sh`
- If it produces a manifest, write to `deployment/<network>-<timestamp>.json`

**Utilities:**
- Backend shared helpers: `spot-api/src/utils/<name>.ts`
- Frontend shared helpers: `lunes-dex-main/src/utils/`
- SDK shared helpers: `sdk/src/utils.ts` / `sdk/src/spot-utils.ts`

**Tests:**
- Per-app unit: `<app>/__tests__/` (Jest)
- Cross-cutting Rust: `tests/<scope>_tests.rs`
- Cross-cutting TS contract: `tests/<Domain>.spec.ts` (Jest from root)
- Fuzz: `fuzz/fuzz_targets/<target>.rs`

**Documentation:**
- New feature SDD pack: `docs/features/<feature-slug>/{PRD.md,SPEC.md,BREAK.md,...}`
- Cross-cutting reference: `docs/<TOPIC>.md`
- Implementation diary (transient): `tasks/IMPLEMENTACAO-<topic>.md`

## Special Directories

**`PATHFINDER-2026-04-28/`:**
- Purpose: Dated April-2026 implementation snapshot (features + production report).
- Generated: No (manually curated).
- Committed: Yes.
- Stability: Historical — do not add new work here.

**`.agent/`:**
- Purpose: Project agent toolkit (skills, personas, workflows, MCP config).
- Generated: No (curated).
- Committed: Yes.
- Stability: Active — extend skills/agents here; do not load whole nested `AGENTS.md` files into context.

**`artifacts/`:**
- Purpose: Pre-built ink! contract artifacts committed for deploy reproducibility.
- Generated: Yes (by `cargo contract build`).
- Committed: Yes (snapshots).
- Stability: Refresh whenever contract sources change in `Lunex/contracts/`.

**`tasks/`:**
- Purpose: Active SDD task plans + implementation diaries.
- Generated: No (manual).
- Committed: Yes.
- Stability: `tasks/plan.md` + `tasks/todo.md` are live; dated `IMPLEMENTACAO-*.md` files are snapshots.

**`target/` and `node_modules/`:**
- Purpose: Build / dependency outputs.
- Generated: Yes.
- Committed: No (gitignored).

**`patches/`:**
- Purpose: `patch-package` overrides applied via `npm postinstall`.
- Committed: Yes (small targeted diffs only).

**`fuzz/`:**
- Purpose: Cargo-fuzz harnesses; lives outside the workspace.
- Committed: Yes (sources + corpora).
- Note: Excluded from default `cargo test --workspace` and `cargo clippy --workspace` per `AGENTS.md`.

---

*Structure analysis: 2026-05-21*
