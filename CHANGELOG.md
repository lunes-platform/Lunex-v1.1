# Changelog

All notable changes to the Lunex DEX are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Added
- Complete system documentation: `README.md`, `docs/API.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`
- `CONTRIBUTING.md` with code standards, TypeScript rules, testing requirements, and PR checklist
- `llms.txt` for AI-friendly documentation (llms.txt spec)
- `spot-api/README.md` with quick start, project structure, and monitoring guide
- `ErrorBoundary.tsx` React component for frontend runtime error recovery
- `governance.e2e.test.ts` — E2E tests for vote cooldown enforcement
- `affiliate.test.ts` — Unit tests for commission math, referral tree, and dashboard
- `ADR-001` through `ADR-005` in `docs/ARCHITECTURE.md`

### Changed
- `affiliateService.ts`: Replaced `pismaAny` cast with proper Prisma types (`GroupByEarning`, `CommissionRow`)
- `affiliateService.ts`: Fixed N+1 in `getReferralTree` — now uses 2 `groupBy` batch queries per depth level
- `affiliateService.ts`: `processPayoutBatch` uses single `$transaction` instead of per-item awaits
- `orderService.ts`: `where: any` → `where: Prisma.OrderWhereInput` in `getUserOrders`
- `orderService.ts`: Imported `OrderStatus` type for proper status filter casting
- `orderService.ts`: Renamed redundant `updatedOrder` → `currentOrder` in `finalizeMarketLikeOrder`
- `agentService.ts`: `formatAgent(agent: any)` → `formatAgent(agent: AgentWithRelations)` with Prisma type
- `factoryService.ts`: Sequential `for` loop in `getAllPairs` → `Promise.all` concurrent execution
- `trades.ts`: `parseInt` → `parseInt(..., 10)` + `Math.min(..., 200)` cap
- `orderbook.ts`: `parseInt` → `parseInt(..., 10)` + `Math.min(..., 200)` cap
- `SpotContext.tsx`: `catch(err: any)` → `catch(err: unknown)` with type guard
- `SDKContext.tsx`: `console.log` statements wrapped in `NODE_ENV !== 'production'` checks
- `listing.ts`: All 8 handlers migrated from inline `res.status(500)` to `next(err)` delegation
- `listing.ts`: Manual field validation replaced with Zod `CreateListingSchema`
- `listing.ts`: Added `requireAdmin` to `activate`, `reject`, and `process-expired-locks` endpoints
- `social.ts`: Added `requireAdmin` to `POST /analytics/recompute`
- `tradeApi.ts`: Magic number `365` extracted to `const APPROX_DAYS_PER_YEAR = 365`

### Fixed
- `listing.ts`: Admin-callable endpoints had no authentication (security fix)
- `social.ts`: `POST /analytics/recompute` exposed to any client (security fix)
- N+1 query performance issue in affiliate referral tree queries
- TypeScript compile errors from `prismaAny` bypass in affiliate service

### Security
- Added `requireAdmin` guard to 4 previously unprotected admin endpoints
- Eliminated `prismaAny` type bypass in `affiliateService.ts`
- Consolidated error handling — all errors now flow through centralized `errorHandler`

---

## [0.8.0] — 2026-03-09

### Added
- SubQuery indexer integration (`subqueryClient.ts`) as primary analytics data source
- `socialAnalyticsService.ts` with Sharpe ratio, win rate, and drawdown computation
- `vaultReconciliationService.ts` for detecting and repairing DB drift from on-chain state
- `asymmetricService.ts` — Parametric curve (y = k·(1-x/x₀)^γ - t·x) liquidity pool
- Smart Router V2 (`routerService.ts`) — Auto-selects best of AMM / Orderbook / Asymmetric
- Asymmetric order routing (`asymmetric.ts` routes + `asymmetricService.ts`)
- AI Agent API (`agentService.ts`, `agents.ts`) with staking tiers and API key management
- Agent trading API (`tradeApi.ts`) with permission-based rate limiting
- Bot sandbox execution environment (`botSandbox.ts`)
- Prometheus metrics at `/metrics` endpoint
- Pino structured logging with configurable log level

### Changed
- Social analytics pipeline migrated from polling-only to SubQuery-first with RPC fallback
- Sorting by Sharpe ratio on the leaderboard (was: by ROI 30d)
- Leader avatar compression via canvas (400×400 JPEG 80%) for 5M Zod + 5MB Express limits
- Governance vote cooldown enforced server-side (was: frontend-only via localStorage)

---

## [0.7.0] — 2026-03-07

### Added
- Margin trading (`marginService.ts`, `margin.ts` routes) with automated liquidation
- Copy vault deposit/withdrawal (`copyVaultService.ts`) with share price and HWM fee
- Affiliate multi-level commission system (5 levels: 4% → 3% → 1.5% → 1% → 0.5%)
- Token listing workflow with on-chain liquidity lock (`listingService.ts`)
- Governance vote recording and cooldown (`governance.ts` routes)
- Redis nonce replay protection (global for all sr25519-signed writes)
- Rate limiting (global + per-endpoint for orders)

### Changed
- Authentication migrated to sr25519 wallet signatures (was: simple JWT)
- Order book bootstrap service: rehydrates from PostgreSQL on startup
- Settlement service: batches pending trades and submits to relayer

---

## [0.5.0] — 2026-02-15

### Added
- Initial spot trading (LIMIT, MARKET, STOP orders)
- FIFO price-time priority matching engine (in-memory + PostgreSQL persistence)
- WebSocket server for real-time orderbook, trades, and ticker streams
- Social trading: leader profiles, follow/unfollow, trade ideas, comments, likes
- Copy trade basic: vault deposit, position tracking
- Pair registration with on-chain factory contract sync
- OHLCV candle aggregation service
- Docker Compose for local development

---

## [0.1.0] — 2026-01-10

### Added
- Initial project structure (Express + Prisma + TypeScript)
- Basic order placement and cancellation
- PostgreSQL schema with Prisma ORM
- Lunes node connectivity via Polkadot.js
