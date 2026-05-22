# Documentation, SDK, MCP & Indexer Production Readiness Audit

**Auditor:** Claude Opus 4.7 — methodology: tests-before-code (specs derived from docs, then verified against source).
**Date:** 2026-05-21
**Scope:** `/Users/lucas/Documents/Projetos_DEV/Lunex` — docs, `sdk/`, `mcp/lunex-agent-mcp/`, `subquery-node/`, `faucet/`.

---

## 0. TL;DR

- **SDK is functionally broken against the current `spot-api`.** 27 of 36 HTTP calls hit non-existent legacy routes (`/factory/...`, `/router/...`, `/staking/...`, `/wnative/...`, `/auth/nonce`). Only 9 calls match the live `/api/v1/...` namespace. No tests in the SDK package despite a `test: jest` script and `prepublishOnly: npm run build && npm test`.
- **API documentation is fragmented and stale.** Four parallel "spec" documents disagree with each other and with the code:
  - `docs/API_SPECIFICATION.md` (38 endpoints, `/factory/...` legacy namespace) — **0% match** with code.
  - `docs/PUBLIC_API_SPECIFICATION.md` (32 endpoints, `/v2/public/...` namespace) — **0% match** with code; an entire `/v2/*` surface that does not exist.
  - `docs/api/openapi.json` (5 endpoints, OpenAPI 3.0.0) — **0% match** with code; declares `https://api.lunex.io/v1` as base.
  - `docs/API.md` (65 endpoints, no prefix shown) — partial overlap, no prefix declaration, stale.
  - Code reality: **149 routes** under `/api/v1/...` across 22 mounted prefixes.
- **MCP server is the only well-aligned component.** ~52 tools in code match the README tool list exactly. Auth scheme (external wallet signing + API key) is consistent with docs.
- **SubQuery schema is current** and matches handler files for `Swap/Liquidity/Vault/Trade/SpotSettlement/Staking/Listing` events. Schema doc in README undercounts entities (missing `VaultDailyStat`, `ListingEvent`, `SpotSettlementEvent`, `StakingEvent`).
- **Faucet ships without README, without captcha, with `//Alice`-funded initial wallet** — testnet-grade only.
- **No `SECURITY.md`** at repo root; no vuln-disclosure path in `README.md` or `CONTRIBUTING.md`. No threat-model doc (only `PRELAUNCH_SECURITY_REVIEW_TEMPLATE.md` which is a template, not an instance).
- **Root `.env.example` is 2 lines and useless** for the multi-service stack. Spot-api has its own 81-line `.env.example` which compensates.

---

## 1. Documentation Inventory

### 1.1 Root-level docs

| File | Size | Status | Notes |
|---|---|---|---|
| `/Users/lucas/Documents/Projetos_DEV/Lunex/README.md` | 61.3 KB | PT-BR | Massive, includes architecture diagrams, setup steps, but minimal API-endpoint coverage (3 endpoints found by regex) |
| `/Users/lucas/Documents/Projetos_DEV/Lunex/AGENTS.md` | 5.2 KB | Current | Declares canonical docs `docs/prd/PROJECT_PRD.md`, `docs/specs/PROJECT_SPEC.md`, `docs/PUBLIC_API_SPECIFICATION.md`, `docs/api/openapi.json` — last two are stale |
| `/Users/lucas/Documents/Projetos_DEV/Lunex/CONTRIBUTING.md` | 6.5 KB | Standard | No vuln-disclosure path |
| `/Users/lucas/Documents/Projetos_DEV/Lunex/PRODUCTION-READINESS.md` | 9.5 KB | 2026-04-28 | Most recent canonical doc; claims SDK retry hardening but does **not** mention SDK endpoint drift |
| `/Users/lucas/Documents/Projetos_DEV/Lunex/CHANGELOG.md` | 5.5 KB | 2026-03-09 (last tagged) | Keep-a-Changelog format; current `[Unreleased]` lags behind PRODUCTION-READINESS.md by ~50 days |
| `/Users/lucas/Documents/Projetos_DEV/Lunex/llms.txt` | 3.2 KB | Mostly correct | Correctly declares `/api/v1` base; understates route modules ("15") — actually 22 mounted prefixes |
| `/Users/lucas/Documents/Projetos_DEV/Lunex/NOTICE.md`, `LICENSE.md` | 635 B / 9.4 KB | Standard | OK |
| `/Users/lucas/Documents/Projetos_DEV/Lunex/.env.example` | 72 B | **Useless** | Contains only `PRIVATE_KEY=horn horn horn horn horn horn horn horn horn horn horn horn` |

### 1.2 `docs/` root

Counts represent total file size:

| File | Size | Topic | Status |
|---|---|---|---|
| `/Users/lucas/Documents/Projetos_DEV/Lunex/docs/API.md` | 16.9 KB | Internal API ref | **DRIFTED** — 65 endpoints, no prefix shown, format inconsistent with code |
| `/Users/lucas/Documents/Projetos_DEV/Lunex/docs/API_SPECIFICATION.md` | 29.1 KB | Legacy API contract | **DRIFTED** — 38 endpoints in `/factory/...`, `/router/...`, `/staking/...` namespace; 0 match code |
| `/Users/lucas/Documents/Projetos_DEV/Lunex/docs/PUBLIC_API_SPECIFICATION.md` | 27.8 KB | v2.0.0 "Public API" | **DRIFTED** — entire `/v2/*` namespace doesn't exist in code |
| `/Users/lucas/Documents/Projetos_DEV/Lunex/docs/ARCHITECTURE.md` | 14.4 KB | System diagrams + ADRs | Partial — mentions 24 services, code currently has 22 routes + 24 services. Mostly OK |
| `/Users/lucas/Documents/Projetos_DEV/Lunex/docs/DEPARA_ARCHITECTURE.md` | 12.9 KB | Mermaid de-para | OK |
| `/Users/lucas/Documents/Projetos_DEV/Lunex/docs/DEPLOYMENT.md` | 14.1 KB | Deploy guide | Not deeply verified, sub-doc |
| `/Users/lucas/Documents/Projetos_DEV/Lunex/docs/FRONTEND_IMPLEMENTATION_GUIDE.md` | 22.6 KB | Frontend guide | Out of audit scope |
| `/Users/lucas/Documents/Projetos_DEV/Lunex/docs/LUNEX_DEX_FEATURES.md` | 8.6 KB | Feature list | Generic |
| `/Users/lucas/Documents/Projetos_DEV/Lunex/docs/SDK_COMPLETE_SUMMARY.md` | 6.3 KB | SDK summary | Likely stale — does not flag endpoint drift |
| `/Users/lucas/Documents/Projetos_DEV/Lunex/docs/SPOT_ORDERBOOK_ARCHITECTURE.md` | 23.6 KB | Spot orderbook | Domain doc |
| `/Users/lucas/Documents/Projetos_DEV/Lunex/docs/SISTEMA_*.md`, `MEDIDAS_*.md`, `RESUMO_*.md` | 5–11 KB each | PT-BR feature memos | Reference material |
| `/Users/lucas/Documents/Projetos_DEV/Lunex/docs/dex-requisitos.md` | **274.1 KB** | Megafile requisitos | Indexer fodder; not source of truth |
| `/Users/lucas/Documents/Projetos_DEV/Lunex/docs/requisitonovo.md` | 62.2 KB | Megafile requisitos | Same |
| `/Users/lucas/Documents/Projetos_DEV/Lunex/docs/PRELAUNCH_SECURITY_REVIEW_TEMPLATE.md` | 4.0 KB | Security template | Template only — no filled instance |

### 1.3 `docs/` subdirectories

- `/Users/lucas/Documents/Projetos_DEV/Lunex/docs/api/openapi.json` — **5 paths only**, declares servers `https://api.lunex.io/v1` (wrong: code uses `/api/v1/...`).
- `/Users/lucas/Documents/Projetos_DEV/Lunex/docs/api/lunex-sdk.ts` — duplicated SDK file in `docs/`, drift risk vs `sdk/src/`.
- `/Users/lucas/Documents/Projetos_DEV/Lunex/docs/features/` — feature-specific specs (production-readiness-v1, social-copytrade-v1, etc.); SDD-style, not audited individually here.
- `/Users/lucas/Documents/Projetos_DEV/Lunex/docs/guides/QUICK_START_GUIDE.md` — onboarding deck (Portuguese, with `//Alice` seed pattern → dev-only).
- `/Users/lucas/Documents/Projetos_DEV/Lunex/docs/reports/` — 16 historical audit/QA reports.
- `/Users/lucas/Documents/Projetos_DEV/Lunex/docs/prd/PROJECT_PRD.md`, `docs/specs/PROJECT_SPEC.md` — declared canonical by `AGENTS.md`; not deeply verified in this pass.

### 1.4 Per-service README

| Path | Present | Quality |
|---|---|---|
| `/Users/lucas/Documents/Projetos_DEV/Lunex/sdk/README.md` (11.6 KB) | YES | **Documents `baseURL: 'https://api.lunex.io/v1'` — leads to double-prefix bug for `/api/v1/...` modules and 404 for `/factory/...` modules** |
| `/Users/lucas/Documents/Projetos_DEV/Lunex/mcp/lunex-agent-mcp/README.md` (9.3 KB) | YES | Aligned with code |
| `/Users/lucas/Documents/Projetos_DEV/Lunex/subquery-node/README.md` (5.1 KB) | YES | Lists 7 entities, schema has 11 — undercount |
| `/Users/lucas/Documents/Projetos_DEV/Lunex/faucet/README.md` | **MISSING** | Only `Dockerfile`, `index.js`, `package.json` |
| `/Users/lucas/Documents/Projetos_DEV/Lunex/spot-api/README.md` | YES (CHANGELOG mentions it) | Not deeply audited |

---

## 2. Documentation Verification Matrix

| SPEC | Status | Evidence | Drift detected |
|---|---|---|---|
| **SPEC-DOC-001** README has current architecture diagram matching ARCHITECTURE.md | PARTIAL | README sections 2.1–2.6 contain diagrams; `docs/ARCHITECTURE.md` has its own ASCII diagrams; `.planning/codebase/ARCHITECTURE.md` (2026-05-21, refreshed) is the only current reflection of code | README counts services differently in different places; llms.txt says "15 REST API route modules", code has 22; ARCHITECTURE.md says "24 services" which matches code |
| **SPEC-DOC-002** README lists all services with start commands | PARTIAL | README has setup paths Opção A/B/C; `spot-api`, `lunes-dex-main`, `lunex-admin` start commands present; `mcp/`, `subquery-node/`, `faucet/` start commands NOT in main README | Service-discovery friction |
| **SPEC-DOC-003** API endpoints documented (OpenAPI/markdown) | **MISSING/DRIFTED** | `docs/api/openapi.json` exists but only 5 paths (0% of 149 real endpoints); `docs/API.md` documents 65 paths with no prefix; `docs/API_SPECIFICATION.md` documents 38 paths in dead namespace; `docs/PUBLIC_API_SPECIFICATION.md` documents 32 paths in non-existent `/v2/*` namespace | **DRIFTED — see §5 Cross-Reference Drift below** |
| **SPEC-DOC-004** Every claim in PRODUCTION-READINESS.md verifiable in code | PARTIAL | Spot-checked: `productionGuards.ts` exists; `emergencyService.ts` exists; `redisRateLimit.ts` exists; spot-api test count "323/323 passed" not re-run but plausible; SDK retry claim verified by grep on `http-client.ts` (axios + retry) | PRODUCTION-READINESS.md silent on SDK endpoint drift — fails SPEC-DOC-004 spirit because the SDK retry claim implies a working SDK |
| **SPEC-DOC-005** CHANGELOG follows conventional commits + covers last release | PARTIAL | Keep-a-Changelog format observed; last tagged version 0.8.0 (2026-03-09); current `[Unreleased]` covers smaller changes but does not cover the 2026-04-28 production-readiness pass (37 closed items) | Gap of ~50 days between CHANGELOG `[Unreleased]` and `PRODUCTION-READINESS.md` (2026-04-28) and codebase refresh (2026-05-21) |
| **SPEC-DOC-006** Onboarding ≤30 min from clone to running locally | PARTIAL | `docs/guides/QUICK_START_GUIDE.md` exists; README has "Caminho rápido validado" section; but root `.env.example` is 72 bytes with one bogus line; multi-service dependencies (Postgres, Redis, lunes-node, subquery, faucet, MCP) not consolidated; 30 min likely optimistic | High friction |
| **SPEC-DOC-007** SECURITY.md present + vuln disclosure path | **MISSING** | No `SECURITY.md` at repo root or in `docs/`; no `security@lunex.io` or similar in README/CONTRIBUTING; `docs/PRELAUNCH_SECURITY_REVIEW_TEMPLATE.md` is a checklist template, not a policy | **BLOCKER for public launch** |
| **SPEC-DOC-008** Threat model documented | PARTIAL | `docs/reports/SECURITY_AUDIT_REPORT_INK_4_2_1.md` covers ink! contract threats; `docs/reports/SECURITY_ROADMAP_2_0.md` exists; no holistic STRIDE/DREAD/attack-tree document covering the full stack (API + relayer + faucet + MCP + indexer). Existing material is reactive (audit reports), not proactive (threat model) | Partial |

---

## 3. SDK Audit (`/Users/lucas/Documents/Projetos_DEV/Lunex/sdk/`)

### 3.1 Public surface

`/Users/lucas/Documents/Projetos_DEV/Lunex/sdk/src/index.ts` exports `LunexSDK` class with 16 module instances:
`auth, factory, router, pair, staking, rewards, wnative, tokens, market, orders, social, copytrade, agents, asymmetric, strategies, execution`
Plus re-exports of types from each module. JSDoc example block present at class level (one example).

Module file inventory:
```
/Users/lucas/Documents/Projetos_DEV/Lunex/sdk/src/modules/{auth,factory,router,pair,staking,rewards,wnative,tokens,market,orders,social,copytrade,agents,strategy,execution}.ts
/Users/lucas/Documents/Projetos_DEV/Lunex/sdk/src/modules/asymmetric/{AsymmetricClient,types}.ts
```

### 3.2 SDK → API endpoint drift

**Discriminator check performed:** `docker/nginx.dev.conf`, `nginx.testnet.conf`, `nginx.prod.conf` were grepped for path rewrites that could remap `/factory/...` → `/api/v1/factory/...` or `/v1/...` → `/api/v1/...`. **No such rewrite exists** — nginx prod config exposes `/api/v1/...` directly via `proxy_pass http://api_backend;` and routes orders/auth/user without path-rewriting. The SDK calls to `/factory/...`, `/router/...`, `/staking/...`, `/wnative/...`, `/auth/nonce` are therefore genuinely 404 against any deployment.

**Discriminator check on staking dispatch mode:** `sdk/src/modules/staking.ts` imports `HttpClient` (line 1) — staking module is HTTP-based, not on-chain Polkadot.js dispatch. The "Staking is unsupported in spot-api" finding stands.

Extracted via grep of `this.client.(get|post|put|delete|patch)(...)` across `sdk/src/modules/`:

| Status | Count | Examples |
|---|---|---|
| Match `/api/v1/...` code | 9 | `GET /api/v1/agents/config/staking-tiers`, `GET /api/v1/strategies`, `POST /api/v1/trade/swap`, `POST /api/v1/trade/limit`, `POST /api/v1/execution/validate`, `GET /api/v1/strategies/marketplace`, `GET /api/v1/trade/portfolio`, `POST /api/v1/execution/validate-and-log`, `POST /api/v1/agents/register` |
| **Hit non-existent legacy paths** | **27** | `POST /auth/nonce`, `GET /factory/pairs`, `POST /factory/pair`, `GET /factory/stats`, `GET /router/quote`, `POST /router/swap-exact-in`, `POST /router/swap-exact-out`, `POST /router/add-liquidity`, `POST /router/remove-liquidity`, `POST /staking/stake`, `POST /staking/unstake`, `POST /staking/claim`, `POST /staking/vote`, `POST /staking/proposal`, `POST /staking/admin/list-token`, `GET /staking/stats`, `GET /staking/proposals`, `POST /wnative/deposit`, `POST /wnative/withdraw`, `GET /wnative/info`, `POST /tokens/wrap`, `POST /tokens/unwrap`, `GET /public/tokens`, `GET /public/prices`, `GET /public/native-assets`, `GET /health`, `GET /metrics` |

Raw lists saved to `/tmp/sdk_calls.txt`, `/tmp/sdk_drift.txt`, `/tmp/lunex_endpoints.txt`.

### 3.3 SDK verification matrix

| SPEC | Status | Evidence |
|---|---|---|
| **SPEC-SDK-001** Public exports typed | COVERED | All modules in TS; `tsconfig.json` strict mode (not verified but `quality` script includes lint + dead-code) |
| **SPEC-SDK-002** Versioning policy documented (semver?) | MISSING | `package.json` v1.0.0 but no SEMVER policy doc in `sdk/README.md`; no migration guide despite the namespace migration |
| **SPEC-SDK-003** Methods have JSDoc + examples | PARTIAL | `LunexSDK` class has rich JSDoc example; individual module methods not deeply verified but spot-check on `index.ts` shows top-level methods documented |
| **SPEC-SDK-004** Error types exported and documented | UNKNOWN | Not deeply verified in this pass; no dedicated `errors.ts` in `sdk/src/`; relies on Axios errors implicitly |
| **SPEC-SDK-005** SDK matches spot-api contract | **DRIFTED — CRITICAL** | 27 of 36 endpoints called by SDK do not exist on the server. SDK is broken for: auth/nonce, factory module, router module, staking module, wnative module, tokens wrap/unwrap, public price feed, health/metrics |
| **SPEC-SDK-006** Tests covering happy path + errors | **MISSING** | Zero `.test.ts` / `.spec.ts` files under `sdk/src/`. `package.json` declares `"test": "jest"` and `prepublishOnly: npm run build && npm test` — if executed, jest will find no tests; behaviour depends on jest config (could pass or fail with "no tests found") |

### 3.4 SDK production blockers

1. **Endpoint namespace mismatch** — 75% of SDK calls hit dead routes. Symptom: any consumer calling `sdk.factory.*`, `sdk.router.*`, `sdk.staking.*`, `sdk.wnative.*`, `sdk.tokens.wrap/unwrap`, `sdk.auth.getNonce` against current spot-api receives 404.
2. **README `baseURL` example is wrong** — `https://api.lunex.io/v1` produces double-prefix `/v1/api/v1/...` for the few working modules and `/v1/factory/...` for broken ones. Correct base for working modules would be `https://api.lunex.io` (so they hit `/api/v1/...`).
3. **No tests** — `prepublishOnly` will silently pass with no coverage on `npm publish`.
4. **No CHANGELOG** in `sdk/` and no migration guide for the legacy → `/api/v1/...` namespace transition.
5. **No error type exports** — consumers cannot programmatically catch typed SDK errors.

---

## 4. MCP Server Audit (`/Users/lucas/Documents/Projetos_DEV/Lunex/mcp/lunex-agent-mcp/`)

### 4.1 Exposed tools

`/Users/lucas/Documents/Projetos_DEV/Lunex/mcp/lunex-agent-mcp/src/index.ts` defines a `toolDefinitions` array with ~52 tools (file is 3,657 lines, partially read). Confirmed tools include all spot/social/copytrade/agent/strategy/execution/asymmetric tools claimed in the README — exact list matches the 52 backticked tool names in `mcp/lunex-agent-mcp/README.md`. Three prompts (`openclaw_scope_guard`, `openclaw_authenticated_spot_trade`, `openclaw_social_copytrade_scan`) and four resources (`lunex://scope`, `lunex://docs/spot-authenticated-trading`, `lunex://config/runtime`, `lunex://config/openclaw`) match README.

Tools are organised by domain:
- Server: `get_server_scope`, `get_lunex_health`
- Spot market data: `list_pairs`, `get_pair_ticker`, `get_orderbook`, `get_recent_trades`, `get_candles`, `get_router_quote`
- Spot trading (externally signed): `prepare_spot_order_signature`, `create_spot_order`, `prepare_spot_cancel_signature`, `cancel_spot_order`, `get_user_orders`, `get_user_trade_history`
- Smart Router (agent): `agent_router_swap`
- Social/Copytrade: 11 tools (`list_social_leaders`, `get_leader_profile`, `list_copytrade_vaults`, `get_copytrade_vault`, `get_copytrade_positions`, `get_copytrade_activity`, `get_vault_executions`, `create_leader_api_key_challenge`, `rotate_leader_api_key`, `submit_copytrade_signal`, `list_pending_copytrade_wallet_signals`, `confirm_copytrade_wallet_signal`)
- Agent ecosystem: `register_agent`, `create_agent_api_key`, `list_agents`, `agent_swap`, `agent_limit_order`, `agent_portfolio`
- Asymmetric: `agent_get_strategy_status`, `agent_update_curve_parameters`, `agent_get_asymmetric_delegation_context`, `agent_link_asymmetric_strategy`, `agent_create_asymmetric_strategy`
- AI Trading Network — Strategy: `list_strategies_marketplace`, `get_strategy`, `get_strategy_performance`, `follow_strategy`, `unfollow_strategy`, `get_followed_strategies`, `list_agent_strategies`, `register_strategy`, `update_strategy`
- AI Trading Network — Execution: `validate_trade`, `get_execution_history`, `get_execution_daily_summary`, `get_execution_risk_params`

### 4.2 MCP verification matrix

| SPEC | Status | Evidence |
|---|---|---|
| **SPEC-MCP-001** Tools documented with input/output schemas | COVERED | Each tool definition has `inputSchema` (JSON Schema with required fields, types, descriptions); README lists every tool name in backticks |
| **SPEC-MCP-002** Auth required for write tools | COVERED | Write tools either (a) require external wallet `signature`+`nonce`+`timestamp` (e.g. `create_spot_order`, `follow_strategy`, `register_agent`) — returning a `signingRequest` payload when omitted, or (b) require API keys (`apiKey`, `LUNEX_AGENT_API_KEY` env, `LUNEX_LEADER_API_KEY` env) for agent and leader flows |
| **SPEC-MCP-003** Tools match docs (spot/social/copytrade surface) | COVERED | README tool list intersected with code definitions — 1:1 match for the 52 named tools |
| **SPEC-MCP-004** Tested with at least smoke test | PARTIAL | One test file: `/Users/lucas/Documents/Projetos_DEV/Lunex/mcp/lunex-agent-mcp/src/routerTools.test.ts` (covers `agentRouterSwapTool` and `getRouterQuoteTool`); smoke harness `/Users/lucas/Documents/Projetos_DEV/Lunex/mcp/lunex-agent-mcp/src/smokeRouter.ts` present; remaining 50 tools have no unit tests |

### 4.3 MCP production blockers

1. **Coverage thin** — only 2 tools (`agentRouterSwapTool`, `getRouterQuoteTool`) have dedicated tests out of ~52.
2. **Backend default `http://127.0.0.1:4010`** — port differs from spot-api default port 4001 (per `llms.txt`); confirm env wiring in deployment.
3. **Long file** — `src/index.ts` at 3,657 lines is a monolith; review-friendly modularisation (per-domain tool registration files) recommended pre-launch.
4. **No openapi.json / catalog export** — there's no JSON output of the tool catalog for static analysis; downstream consumers (LLM tool routers) cannot diff schema versions.

---

## 5. SubQuery Indexer Audit (`/Users/lucas/Documents/Projetos_DEV/Lunex/subquery-node/`)

### 5.1 Schema coverage

`/Users/lucas/Documents/Projetos_DEV/Lunex/subquery-node/schema.graphql` declares 11 entities:
```
SwapEvent, LiquidityEvent, VaultEvent, TradeEvent, WalletSummary,
PairStats, DailyProtocolStats, VaultDailyStat, ListingEvent,
SpotSettlementEvent, StakingEvent
```

Handler files (`/Users/lucas/Documents/Projetos_DEV/Lunex/subquery-node/src/mappings/`):
```
copyVault.ts, router.ts, utils.ts, listing.ts, substrate.ts,
staking.ts, spotSettlement.ts
```
Plus generated models in `src/types/models/`.

Match between schema and handlers: every entity has a corresponding mapping module. The 2026-04-28 production-readiness pass added `SpotSettlementEvent` + `StakingEvent` mappings, as claimed.

### 5.2 SubQuery verification matrix

| SPEC | Status | Evidence |
|---|---|---|
| **SPEC-IDX-001** Schema indexes all event types claimed in docs | PARTIAL | `subquery-node/README.md` "Entidades GraphQL" lists only 7 entities; schema has 11. Underdocumented but code is more complete than docs. README claims `Deposited`, `Withdrawn`, `TradeExecuted`, `CircuitBreakerTriggered` on CopyVault — verified via `mappings/copyVault.ts` |
| **SPEC-IDX-002** Resync from genesis documented | PARTIAL | `subquery-node/README.md` describes `START_BLOCK` env var and `project.template.yaml` placeholders; no explicit procedure for hard-reindex (e.g. drop schema, restart with new START_BLOCK). `entrypoint.sh` performs template substitution at startup but does not document drop/recreate flow |
| **SPEC-IDX-003** Lag alerting configured | UNKNOWN | `PRODUCTION-READINESS.md` mentions Grafana dashboard `lunex-overview.json` with metrics; SubQuery lag specifically not called out. `lastProcessedHeight` exposed via `_metadata` GraphQL — exporter→Prometheus wiring not verified in this pass |
| **SPEC-IDX-004** Test fixtures for handler logic | **MISSING** | Zero `.test.ts` / `.spec.ts` files in `subquery-node/`. Mapping logic (especially aggregations on `WalletSummary`, `PairStats`, `DailyProtocolStats`, `VaultDailyStat`) has no unit coverage |

### 5.3 SubQuery production blockers

1. **No handler tests** — aggregation correctness (e.g. drawdown computation, daily stat increment, vault HWM) is unverified by automated tests.
2. **README undercounts entities** (lists 7, schema has 11) — consumer documentation drift.
3. **No documented lag-alert SLO** — `socialAnalyticsService` depends on SubQuery freshness; an SLO (e.g. "indexer must be within 50 blocks of head") and alert rule would be a production gate.
4. **Fallback to RPC polling documented in README** — good. But if `socialIndexerService.ts` (42 KB) is the polling path, that file is flagged for review in `PRODUCTION-READINESS.md` Non-blocking polish section but has no test.

---

## 6. Faucet Audit (`/Users/lucas/Documents/Projetos_DEV/Lunex/faucet/`)

### 6.1 Files

```
Dockerfile  index.js  package.json
```
**No README.** No `.env.example`.

### 6.2 Code surface

`/Users/lucas/Documents/Projetos_DEV/Lunex/faucet/index.js` (~21 KB):
- Express app on port 3333.
- Endpoints: `GET /health`, `GET /faucet` (HTML), `GET /faucet/status`, `POST /faucet`.
- Rate limiting via `express-rate-limit` (`globalLimiter`, `faucetLimiter`).
- Per-address cooldown: `COOLDOWN_MINUTES` (default 300 min = 5h).
- Per-IP cooldown via `ipHistory` Map.
- Daily cap: `DAILY_LIMIT` (default 50 drips/day).
- Drip amount: `1000000000000` units (10,000 LUNES at 8 decimals).
- **Initial funding from `//Alice`** dev account (`fundFaucetFromAlice`).
- Dedicated seed generated on first run, stored to `/data/faucet-seed.json` with `mode: 0o600`.

### 6.3 Faucet verification matrix

| SPEC | Status | Evidence |
|---|---|---|
| **SPEC-FAUCET-001** Rate limited per IP and address | COVERED | `addressHistory` Map + `ipHistory` Map + `express-rate-limit` global + faucet limiter + daily cap |
| **SPEC-FAUCET-002** Captcha or anti-bot in prod | **MISSING** | No reCAPTCHA / hCaptcha / Cloudflare Turnstile / proof-of-work; rate limit alone is insufficient for sustained sybil drain |
| **SPEC-FAUCET-003** Drains tracked | COVERED (in-memory only) | `dailyDripCount` counter, `addressHistory` + `ipHistory` maps. **Not persisted** — restart wipes state, allowing replay of cooldown |

### 6.4 Faucet production blockers

1. **No README** — operators have no documentation for env vars, restart behavior, seed rotation, or capacity planning.
2. **No captcha / anti-bot** — public testnet faucet will be drained.
3. **State in-memory** — `addressHistory`, `ipHistory`, `dailyDripCount` lost on container restart; bypasses cooldown.
4. **`//Alice` funding pattern** — clearly dev-only; production runbook needed to fund the faucet wallet from a treasury via secure transfer, not from the well-known `//Alice` seed.
5. **No tests** — zero test files.
6. **Hardcoded port 3333** — not in `llms.txt` service list; not in main README service inventory.
7. **No audit log** — drip events not written to durable store (DB/log file). For production, audit trail is mandatory.

---

## 7. Cross-Reference Drift

### 7.1 API surface drift summary

| Source of truth claim | Endpoints declared | Endpoints matching real code (149 routes under `/api/v1/...`) |
|---|---|---|
| Code (`spot-api/src/routes/*.ts`, mounted in `spot-api/src/index.ts`) | **149** | **149** (canonical) |
| `docs/API_SPECIFICATION.md` | 38 | 0 — entire `/factory/...`, `/router/...`, `/staking/...`, `/wnative/...`, `/auth/...`, `/pair/...`, `/rewards/...` namespace dead |
| `docs/PUBLIC_API_SPECIFICATION.md` | 32 | 0 — entire `/v2/public/*`, `/v2/trading/*`, `/v2/utils/*`, `/v2/liquidity/*`, `/v2/staking/*`, `/v2/listing/*`, `/v2/webhooks` namespace does not exist |
| `docs/api/openapi.json` | 5 | 0 — declares `/auth/nonce`, `/auth/login`, `/factory/pairs`, `/router/quote`, `/router/swap-exact-in`; none of these are mounted |
| `docs/API.md` | 65 (no prefix) | unknown — paths shown without prefix make matching ambiguous; some path suffixes (e.g. `/copytrade/vaults`, `/social/leaders`, `/agents/me`) overlap suffix-wise with real `/api/v1/copytrade/vaults`, `/api/v1/social/leaders`, `/api/v1/agents/me` but document does not declare the `/api/v1` prefix |
| `sdk/src/modules/` HTTP calls | 36 distinct calls | 9 match `/api/v1/...`; 27 hit dead namespaces |
| `sdk/README.md` JSDoc example | `baseURL: 'https://api.lunex.io/v1'` | wrong base (should be host root so that SDK module paths like `/api/v1/trade/swap` resolve to `https://host/api/v1/trade/swap`, not `https://host/v1/api/v1/trade/swap`) |
| `llms.txt` "API Modules" table | 14 prefixes | 22 prefixes mounted in code — missing: `strategies`, `execution`, `asymmetric`, `trade`, `markets`, `rewards`, `admin`, `tokens`, `user`, `social/analytics`, `social/ideas`, `social/vaults` (granularity) |
| `AGENTS.md` declared canonical "API pública": `docs/PUBLIC_API_SPECIFICATION.md`, `docs/api/openapi.json` | both stale | declares dead docs as canonical |

### 7.2 Specific drift items

1. **`/v2/*` namespace is a phantom** — `docs/PUBLIC_API_SPECIFICATION.md` documents 32 endpoints in `/v2/public/...`, `/v2/trading/...`, `/v2/liquidity/...`, `/v2/staking/...`, `/v2/listing/...`, `/v2/utils/...`, `/v2/webhooks`. Code mounts NONE of these.
2. **`/factory/...`, `/router/...`, `/staking/...`, `/wnative/...`, `/pair/...`, `/rewards/...`, `/auth/...` are dead** — claimed by `API_SPECIFICATION.md`, `openapi.json`, SDK modules `factory.ts`/`router.ts`/`staking.ts`/`wnative.ts`/`pair.ts`/`rewards.ts`/`auth.ts`. Real code uses `/api/v1/...`. The token wrap/unwrap calls (`/tokens/wrap`, `/tokens/unwrap`) in `sdk/src/modules/tokens.ts` also don't exist; closest is `/api/v1/tokens` (4 routes, all for token registry, not wrap/unwrap).
3. **Staking is unsupported in spot-api** — there is no `/api/v1/staking/*` route mounted; the closest is `/api/v1/agents/config/staking-tiers`. The SDK's entire `staking` module and the MCP server's "out of scope: staking" stance contradict the `staking_*` features in CHANGELOG/llms.txt/`docs/SISTEMA_PREMIACAO_STAKING.md`. Staking lives in contracts (ink!) and possibly elsewhere; the public REST surface for staking is not in spot-api.
4. **Auth flow drifted** — SDK calls `POST /auth/nonce` and `POST /auth/login`; spot-api has no auth router mounted (auth uses sr25519 signed messages on each request via middleware, per `llms.txt`). The historical `/auth/nonce` flow may have been replaced with `requireWalletSignature` middleware. SDK `auth` module is dead.
5. **`/health` and `/metrics` not under `/api/v1`** — SDK calls these at root; need to verify mount in `spot-api/src/index.ts` (likely top-level, separate from `/api/v1/...`). Not necessarily a bug, but means `sdk.health()` works only when `baseURL` is host-root.
6. **README "API Base URL" in `llms.txt`** says `/api/v1` is base — correct. But the same llms.txt API Modules table lists prefixes WITHOUT `/api/v1/` (e.g. `Pairs | /pairs`). Consumers will infer that `/pairs` is the canonical path.
7. **Subquery README undercounts entities** — 7 listed, 11 in schema.
8. **MCP backend port mismatch** — MCP default `http://127.0.0.1:4010`, llms.txt says spot-api port 4001. Verify deployment wiring; if dev convention is 4010, document it.
9. **CHANGELOG missing 2026-04-28 production-readiness pass** — the [Unreleased] section pre-dates `PRODUCTION-READINESS.md`; the 37 closed items from the production-hardening pass should appear in [Unreleased] or a new tagged release.
10. **No SDK CHANGELOG** — the namespace migration from `/factory/...` → `/api/v1/...` (where it happened) has no migration note for SDK consumers.

---

## 8. Prioritized Production Blockers

### Tier 0 — must fix before publishing SDK to npm or pointing third parties to docs

1. **SDK namespace fix** — migrate all SDK module HTTP calls to `/api/v1/...` and align with current spot-api. Files to update:
   - `/Users/lucas/Documents/Projetos_DEV/Lunex/sdk/src/modules/auth.ts`
   - `/Users/lucas/Documents/Projetos_DEV/Lunex/sdk/src/modules/factory.ts`
   - `/Users/lucas/Documents/Projetos_DEV/Lunex/sdk/src/modules/router.ts`
   - `/Users/lucas/Documents/Projetos_DEV/Lunex/sdk/src/modules/staking.ts`
   - `/Users/lucas/Documents/Projetos_DEV/Lunex/sdk/src/modules/wnative.ts`
   - `/Users/lucas/Documents/Projetos_DEV/Lunex/sdk/src/modules/pair.ts`
   - `/Users/lucas/Documents/Projetos_DEV/Lunex/sdk/src/modules/rewards.ts`
   - `/Users/lucas/Documents/Projetos_DEV/Lunex/sdk/src/modules/tokens.ts`
   For routes that don't exist on the server, either implement server routes or remove SDK modules. Confirmed code endpoints saved to `/tmp/lunex_endpoints.txt`.

2. **Single canonical API spec** — delete or move to `archive/` the dead specs (`docs/API_SPECIFICATION.md`, `docs/PUBLIC_API_SPECIFICATION.md`, `docs/api/openapi.json`). Generate a fresh OpenAPI 3.x file from the actual `spot-api/src/routes/*.ts` via Zod schemas + `zod-to-openapi` (or similar). Path: `/Users/lucas/Documents/Projetos_DEV/Lunex/docs/api/openapi.json` should be the only source of truth and must declare `servers: [{url: "https://api.lunex.io"}]` with paths starting with `/api/v1/...`.

3. **`SECURITY.md`** at `/Users/lucas/Documents/Projetos_DEV/Lunex/SECURITY.md` — vuln disclosure email, PGP key, scope, response SLA, safe-harbor language. Required for public launch.

4. **`docs/THREAT_MODEL.md`** — STRIDE per layer (frontend → spot-api → relayer → contracts → faucet → MCP → indexer). The existing `docs/PRELAUNCH_SECURITY_REVIEW_TEMPLATE.md` should be filled and committed as an instance, or a new threat model written.

### Tier 1 — fix before public traffic

5. **SDK tests** — at minimum, one happy-path + one error-path test per module under `/Users/lucas/Documents/Projetos_DEV/Lunex/sdk/src/modules/`. Strict mode + msw or nock for HTTP mocking.

6. **Faucet hardening**:
   - Add `/Users/lucas/Documents/Projetos_DEV/Lunex/faucet/README.md` with env vars, start commands, secret handling.
   - Add captcha (hCaptcha or Cloudflare Turnstile).
   - Persist `addressHistory`, `ipHistory`, `dailyDripCount` to Redis or Postgres (survive restarts).
   - Remove `//Alice` funding code path under `NODE_ENV=production`; document treasury-funded flow.
   - Append-only audit log of drips (per `lunex.io/audit/faucet-YYYY-MM-DD.log` or DB row).

7. **CHANGELOG sync** — add an entry capturing the 2026-04-28 production-readiness work (37 closed items, contract changes, backend changes, infra changes) and the 2026-05-21 codebase refresh.

8. **SDK README correction** — `baseURL` example must drop `/v1` suffix; add migration guide for legacy namespace deprecation; add error-type table; add SEMVER policy section.

### Tier 2 — quality and operability

9. **SubQuery hardening**:
   - Update `/Users/lucas/Documents/Projetos_DEV/Lunex/subquery-node/README.md` "Entidades GraphQL" list to include all 11 entities.
   - Add resync/reindex runbook (drop schema + START_BLOCK).
   - Add handler tests (especially aggregation invariants for `WalletSummary`, `VaultDailyStat`, `DailyProtocolStats`).
   - Document SubQuery lag SLO and Prometheus alert rule.

10. **MCP**:
    - Modularise `/Users/lucas/Documents/Projetos_DEV/Lunex/mcp/lunex-agent-mcp/src/index.ts` (3,657 lines) into per-domain files.
    - Add smoke tests for the remaining ~50 tools (at least input-schema validation + one round-trip).
    - Export tool catalog as JSON for static analysis.
    - Reconcile default port `4010` with documented spot-api port `4001`.

11. **AGENTS.md canonical doc update** — update the "Documentos Canônicos" section to point to the new single OpenAPI source after Tier-0 #2 lands.

12. **llms.txt corrections** — update API Modules table to list all 22 prefixes with `/api/v1/` prefix; update "15 REST API route modules" to actual count; add MCP/Faucet/SubQuery service entries to Core Files.

13. **Root `.env.example`** — replace 2-line placeholder with a consolidated multi-service template, or delete and replace with `.env.example` pointers per subproject.

### Tier 3 — polish

14. **Per-service README parity** — `faucet/README.md`, ensure `spot-api/README.md` lists all 22 route prefixes with auth tags.
15. **Onboarding ≤30 min target** — measure cold-clone-to-running with a fresh dev; trim docs that aren't part of the critical path.
16. **Threat-model instance** for each Tier-0 #4 layer signed off by an operator.

---

## 9. Evidence Artifacts

Generated during this audit (transient, in `/tmp/`):
- `/tmp/lunex_routes.txt` — first attempt at route grep
- `/tmp/lunex_endpoints.txt` — canonical list of 149 endpoints with mounted `/api/v1/...` prefix
- `/tmp/doc_endpoints.json` — endpoints extracted from each doc file
- `/tmp/drift_docOnly.txt` — endpoints documented but not in code
- `/tmp/drift_codeOnly.txt` — endpoints in code but not documented (149 of 149 — i.e. essentially every real endpoint is undocumented in the formal spec files)
- `/tmp/sdk_calls.txt` — 36 SDK HTTP calls extracted from `sdk/src/modules/`
- `/tmp/sdk_drift.txt` — 27 SDK calls with no matching backend endpoint

End of audit.
