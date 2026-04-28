# Lunex DEX Platform — Feature Inventory
**Date:** 2026-04-28  
**Version:** 0.8.0 (lunex-platform), SDK 1.0.0  
**Stack:** Node.js/Express (TS), React 18/Vite, Next.js 14, Rust/ink! 4.2.1, Polkadot/Substrate, SubQuery 3.15.0

---

## Architecture Overview

| Layer | Component | Tech |
|-------|-----------|------|
| Backend API | `spot-api/` | Express + TypeScript + Prisma + PostgreSQL + Redis |
| Frontend | `lunes-dex-main/` | React 18 + Vite + styled-components |
| Admin Dashboard | `lunex-admin/` | Next.js 14 App Router + NextAuth |
| SDK | `sdk/` | TypeScript, Axios, WebSocket |
| Smart Contracts | `Lunex/contracts/` | Rust/ink! 4.2.1 (13 contracts) |
| Blockchain Indexer | `subquery-node/` | SubQuery 3.15.0 + GraphQL |
| Testnet Faucet | `faucet/` | Node.js |
| Infra | `docker/` | Docker Compose + Nginx + Prometheus + Loki + AlertManager |

---

## Feature Inventory (23 Features)

### 1. Spot Trading (Order Book)
- **Entry:** `spot-api/src/routes/orders.ts`, `spot-api/src/routes/orderbook.ts`
- **Services:** `orderService.ts`, `tradeService.ts`, `matchingLockService.ts`, `orderbookBootstrapService.ts`
- **Contract:** `contracts/spot_settlement/lib.rs`
- **SDK:** `sdk/src/modules/orders.ts`
- **Purpose:** FIFO order book, sr25519 signature auth, on-chain settlement

### 2. Copy Trading
- **Entry:** `spot-api/src/routes/copytrade.ts`, `lunes-dex-main/src/services/strategyService.ts`
- **Services:** `copytradeService.ts` (58KB), `copyVaultService.ts`, `copytradeWalletContinuationScheduler.ts`
- **Contract:** `contracts/copy_vault/lib.rs`
- **SDK:** `sdk/src/modules/copytrade.ts`
- **Purpose:** Vault-based copy trading, performance fees, scheduled replication

### 3. Margin Trading
- **Entry:** `spot-api/src/routes/margin.ts`, `lunes-dex-main/src/services/marginService.ts`
- **Services:** `marginService.ts` (35KB), `walletRiskService.ts`
- **Frontend:** `hooks/useAsymmetricDeploy.ts`
- **Purpose:** Leveraged positions, automatic liquidation, collateral management

### 4. Smart Router (Best Execution)
- **Entry:** `spot-api/src/routes/router.ts`, `lunes-dex-main/src/services/contractService.ts`
- **Services:** `routerService.ts` (18KB), `executionLayerService.ts` (14KB)
- **Contract:** `contracts/router/lib.rs`
- **SDK:** `sdk/src/modules/router.ts`
- **Purpose:** Best-route across orderbook/AMM/asymmetric liquidity

### 5. Asymmetric Liquidity Pools
- **Entry:** `spot-api/src/routes/asymmetric.ts` (21KB), `lunes-dex-main/src/hooks/useLiquidity.tsx`
- **Services:** `asymmetricService.ts` (16KB), `rebalancerService.ts` (15KB)
- **Contract:** `contracts/asymmetric_pair/lib.rs`
- **SDK:** `sdk/src/modules/asymmetric/AsymmetricClient.ts`
- **Purpose:** Concentrated liquidity AMM, custom price ranges

### 6. AI Agent Trading API
- **Entry:** `spot-api/src/routes/agents.ts` (10KB), `spot-api/src/routes/tradeApi.ts` (13KB)
- **Services:** `agentService.ts` (12KB), `botSandbox.ts` (15KB), `strategyService.ts` (16KB)
- **SDK:** `sdk/src/modules/agents.ts`, `execution.ts`, `strategy.ts`
- **Purpose:** API key auth, staking-gated permissions, DCA/grid bot execution sandbox

### 7. Social Trading & Leaderboards
- **Entry:** `spot-api/src/routes/social.ts` (14KB)
- **Services:** `socialService.ts` (20KB), `socialIndexerService.ts` (42KB), `socialAnalyticsService.ts` (11KB), `socialAnalyticsPipeline.ts`, `socialAnalyticsMath.ts`
- **SDK:** `sdk/src/modules/social.ts`
- **Purpose:** Leaderboards, trader profiles, follow/copy recommendations, trade sharing

### 8. Affiliate System
- **Entry:** `spot-api/src/routes/affiliate.ts` (8KB)
- **Services:** `affiliateService.ts` (12KB)
- **Purpose:** Multi-level referral (up to 5 levels), automated commission distribution

### 9. Reward Distribution & Staking
- **Entry:** `spot-api/src/routes/rewards.ts` (5KB), `lunex-admin/src/app/(admin)/rewards/page.tsx`
- **Services:** `rewardDistributionService.ts` (35KB), `rewardPayoutService.ts` (16KB), `rewardScheduler.ts`
- **Contracts:** `contracts/rewards/lib.rs`, `contracts/staking/lib.rs`
- **SDK:** `sdk/src/modules/rewards.ts`, `staking.ts`
- **Purpose:** Staking rewards, trading incentives, fee rebates, automated on-chain payout

### 10. Token Listing (Hybrid Permissioned)
- **Entry:** `spot-api/src/routes/listing.ts` (13KB), `lunex-admin/src/app/(admin)/listings/`
- **Services:** `listingService.ts` (10KB), `tokenRegistryService.ts` (2KB)
- **Contract:** `contracts/listing_manager/src/lib.rs`
- **SDK:** `sdk/src/modules/tokens.ts`
- **Purpose:** Permissioned listing workflow, on-chain liquidity lock management

### 11. Governance & Voting
- **Entry:** `spot-api/src/routes/governance.ts` (6KB)
- **Purpose:** Proposal creation, voting with anti-spam cooldowns

### 12. On-Chain Settlement & Relayer
- **Entry:** `spot-api/src/routes/execution.ts` (7KB)
- **Services:** `settlementService.ts` (19KB), `tradeSettlementService.ts` (8KB)
- **Contract:** `contracts/spot_settlement/lib.rs`
- **SDK:** `sdk/src/modules/execution.ts`
- **Purpose:** Batched off-chain matching with on-chain finality

### 13. WebSocket Real-Time Data
- **Entry:** `spot-api/src/websocket/server.ts`
- **SDK:** `sdk/src/websocket-client.ts`
- **Purpose:** Order book updates, trade feeds, price tickers

### 14. Market Data & Candles
- **Entry:** `spot-api/src/routes/candles.ts`, `pairs.ts`, `marketInfo.ts`
- **Services:** `candleService.ts` (2KB)
- **SDK:** `sdk/src/modules/pair.ts`, `market.ts`
- **Purpose:** OHLCV, market stats, liquidity snapshots

### 15. Asset Bridge (Cross-Chain)
- **Entry:** `spot-api/src/routes/assetBridge.ts`
- **Services:** `assetBridgeService.ts` (15KB)
- **Contract:** `contracts/asset_wrapper/src/lib.rs`
- **Purpose:** Native asset wrapping (wLUNES), cross-chain token support

### 16. User Favorites & Preferences
- **Entry:** `spot-api/src/routes/favorites.ts` (4KB)
- **Frontend:** `hooks/useFavorites.ts`
- **Purpose:** Saved token pairs, watchlists

### 17. Admin Dashboard
- **Entry:** `lunex-admin/src/app/layout.tsx`, `lunex-admin/src/auth.ts`
- **Pages (12):** listings, listings/pending, agents, copytrade, dex-users, team, affiliates, margin, treasury, audit, emergency, rewards
- **Auth:** NextAuth + session management
- **Purpose:** Governance, compliance, monitoring, circuit breakers

### 18. Frontend Web App (lunes-dex-main)
- **Entry:** `lunes-dex-main/src/index.tsx`, `App.tsx`
- **Services (8):** spotService, contractService, asymmetricContractService, socialService, marginService, rewardsService, agentService, strategyService
- **Hooks (8+):** useSwap, useLiquidity, usePools, useSelectOptions, useFavorites, useWebMCP
- **Purpose:** Full trading UI — swaps, orders, copy trading, margins, social, agent control

### 19. TypeScript SDK (@lunex/sdk)
- **Entry:** `sdk/src/index.ts` (LunexSDK class)
- **Modules (16):** auth, tokens, factory, router, pair, orders, copytrade, social, agents, execution, strategy, staking, rewards, wnative, market, asymmetric/AsymmetricClient
- **Clients:** `http-client.ts` (Axios), `websocket-client.ts`
- **Purpose:** Official TS client for Lunex API and smart contracts

### 20. SubQuery Indexer
- **Entry:** `subquery-node/`
- **Purpose:** GraphQL indexer for Lunes blockchain events (pairs, trades, governance, rewards)

### 21. Smart Contracts (Rust/ink! — 13 contracts)
| Contract | Purpose |
|----------|---------|
| `factory/` | Pair factory, protocol fee |
| `router/` | Routing logic, swaps |
| `pair/` | AMM pairs (Uniswap V2) |
| `asymmetric_pair/` | Concentrated liquidity (V3-like) |
| `copy_vault/` | Copy trading vaults |
| `staking/` | Governance token staking |
| `rewards/` | Reward distribution |
| `spot_settlement/` | Spot order settlement |
| `listing_manager/` | Token listing approvals |
| `liquidity_lock/` | Locked liquidity enforcement |
| `wnative/` | Wrapped native LUNES |
| `asset_wrapper/` | Multi-asset wrapping |
| `psp22/` | PSP22 token standard |

### 22. Faucet Service
- **Entry:** `faucet/index.js`
- **Purpose:** Testnet token distribution (NOT for mainnet)

### 23. API Auth & Security Infrastructure
- **Mechanisms:** sr25519 signature, Bearer token (admin), API key + staking tier, nonce replay protection (Redis), rate limiting, Helmet headers, CORS/CSP
- **Middleware:** `spot-api/src/middleware/adminGuard.ts`, `securityShield.ts`

---

## Known Gaps (Require Specialized Audit)
- Smart contract internals (function-level logic)
- SubQuery GraphQL schema details
- Database schema (`spot-api/prisma/schema.prisma`)
- Docker Compose orchestration (dev/testnet/prod configs)
- CI/CD pipeline configuration
- WebSocket message type contracts
- Load testing / fuzz test coverage
