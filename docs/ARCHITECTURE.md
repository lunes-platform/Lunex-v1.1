# Lunex DEX — Architecture

> System architecture, data flow, design decisions, and ADRs.

---

## System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                          CLIENT LAYER                                 │
│  ┌──────────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │  lunes-dex-main  │  │ External DApp│  │   AI Agent (API Key)   │  │
│  │  (React / Vite)  │  │ (SDK)        │  │   (lnx_xxx key)        │  │
│  └────────┬─────────┘  └──────┬───────┘  └──────────┬─────────────┘  │
└───────────┼───────────────────┼─────────────────────┼───────────────┘
            │  HTTP REST        │  SDK               │ X-API-Key
            ▼                  ▼                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        API LAYER (spot-api)                           │
│                    Express 5 | TypeScript | Zod                       │
│                                                                       │
│  ┌──────────────┐  ┌─────────────┐  ┌────────────┐  ┌────────────┐  │
│  │  REST Routes │  │  WebSocket  │  │  Rate Limit│  │  Helmet    │  │
│  │  /api/v1/*   │  │  port 4001  │  │  (Redis)   │  │  (CSP)     │  │
│  └──────┬───────┘  └──────┬──────┘  └────────────┘  └────────────┘  │
│         │                 │                                           │
│  ┌──────▼─────────────────▼──────────────────────────────────────┐   │
│  │                    SERVICE LAYER (24 services)                 │   │
│  │  orderService | tradeService | marginService | socialService   │   │
│  │  affiliateService | agentService | routerService | ...         │   │
│  └──────┬──────────────────────────────────────────────┬─────────┘   │
└─────────┼──────────────────────────────────────────────┼────────────┘
          │  Prisma ORM                                  │  Polkadot.js
          ▼                                              ▼
┌─────────────────────┐             ┌────────────────────────────────────┐
│   PostgreSQL        │             │         Lunes Network Node          │
│   (Primary DB)      │             │   (Substrate / Polkadot v0.9.40)   │
│                     │             │                                     │
│  ┌─────────────────────────┐  │             │  ┌────────────────┐  │
│  │  Lunex Smart Contracts  │  │             │  │  pallet-orders │  │
│  │ Factory, Pair, Router   │  │             │  │  pallet-copy   │  │
│  │ Staking, Rewards, PSP22 │  │             │  └────────────────┘  │
│  │ Listing, AssetWrapper   │  │             │                      │
│  └─────────────────────────┘  │             │                      │
└───────────────────────────────┘             └──────────────────────┘
│   Redis             │                        │
│   (Nonce store)     │             ┌──────────▼─────────────────────────┐
│   (Rate limit)      │             │         SubQuery Indexer            │
│   (WebSocket state) │             │   (Block event → GraphQL)           │
└─────────────────────┘             └────────────────────────────────────┘
```

---

## Core Modules

### spot-api Services

| Service | Responsibility |
|---------|---------------|
| `orderService` | Order creation, matching engine (FIFO), settlement triggers |
| `tradeService` | Trade records, history, user aggregation |
| `marginService` | Leveraged positions, liquidation logic, collateral tracking |
| `socialService` | Leaders, followers, ideas, comments, vault deposits/withdrawals |
| `affiliateService` | Referral codes, commission distribution (5-level chain, batched) |
| `agentService` | AI agent registration, API key lifecycle, staking tiers |
| `routerService` | Smart Router V2: best-route between orderbook / AMM / asymmetric |
| `copytradeService` | Copy vault positions, signals, replication |
| `settlementService` | On-chain settlement submission via relayer |
| `factoryService` | Polkadot.js binding to the Factory contract |
| `socialIndexerService` | SubQuery / RPC polling for on-chain analytics events |
| `rebalancerService` | Periodic rebalancing of AMM positions |
| `vaultReconciliationService` | Drift detection and repair between DB and on-chain state |
| `botSandbox` | Safe execution environment for bot strategies |
| `listingService` | Token listing workflow and liquidity lock management |

### Security Layers

```
Request → Helmet (headers) → CORS → Rate Limit → Route Handler
                                                      │
                            ┌─────────────────────────▼──────────────┐
                            │         Auth Middleware                  │
                            │  1. requireAdmin (Bearer token)          │
                            │  2. verifyWalletActionSignature (sr25519)│
                            │  3. agentAuth (X-API-Key + permissions)  │
                            └────────────────────────────────────────┘
```

### Nonce Replay Protection

All wallet-signed requests include a `nonce`. The nonce is stored in Redis with a TTL (`NONCE_TTL_SECONDS`, default 5 min). Replay of the same nonce within the TTL window is rejected with 401.

---

## Data Flow: Order Placement

```
Client
  │  POST /api/v1/orders
  │  { pairSymbol, side, type, price, amount, nonce, signature, makerAddress }
  │
  ▼
orders.ts route
  ├─ Validate body (Zod schema)
  ├─ Verify sr25519 signature
  └─ orderService.createOrder()
       ├─ Compute order hash
       ├─ Write order to DB (status: OPEN)
       ├─ Push to in-memory orderbook
       ├─ Run matching engine (FIFO, price-time priority)
       │   └── for each match → tradeService.recordTrade()
       │                      → settlementService.scheduleSettlement()
       └─ Broadcast via WebSocket (orderbook:PAIR, user:ADDRESS)
```

---

## Data Flow: Copy Trade Signal

```
Leader (via Copy Trade API Key)
  │  POST /api/v1/copytrade/vaults/:leaderId/signals
  │
  ▼
copytrade.ts route (leader auth)
  └─ copytradeService.createSignal()
       ├─ Find all active followers of this leader
       ├─ For each follower:
       │   ├─ Calculate proportional position size (by share balance)
       │   └─ Create mirrored order via orderService
       └─ Record signal + execution result
```

---

## Data Flow: Listing & Fee Distribution (Real PSP22)

```
Project Owner
  │  POST /api/v1/listing/create
  │  Submits LUNES tokens to ListingManager contract
  │
  ▼
ListingManager Contract (ink! v4)
  ├─ PSP22::transfer_from(caller, self, listing_fee)
  ├─ Distributes fees via cross-contract PSP22::transfer:
  │   ├─ Treasury (50%)
  │   ├─ Rewards Pool (30%)
  │   └─ Staking Pool (20% - replaces burn)
  └─ Registers listing and emits event
  
Backend Relayer / Webhook
  ├─ Waits for on-chain block confirmation
  └─ Activates token listing in PostgreSQL DB for trading
```

---

## Data Flow: Affiliate Commission

```
Trade executed → tradeService.recordTrade()
  └─ affiliateService.distributeCommissions(traderAddress, token, fee, 'SPOT')
       ├─ Walk referral chain (max 5 levels)
       │   └─ Batched: 5 sequential findUnique (bounded depth)
       └─ For each ancestor:
           ├─ Calculate commission (level 1: 4%, 2: 3%, 3: 1.5%, 4: 1%, 5: 0.5%)
           └─ Insert AffiliateCommission record (isPaid: false)

Weekly cron → affiliateService.processPayoutBatch()
  └─ Batch update all isPaid: false → true in single $transaction
```

---

## Database Schema (Simplified ERD)

```
User/Wallet (address as PK)
  ├── referrals (Referral)
  ├── orders (Order)
  ├── trades (Trade)
  └── affiliateCommissions (AffiliateCommission)

Order
  ├── pairSymbol → TradingPair
  ├── trades (Trade[])
  └── settlement (Settlement?)

Leader
  ├── vault (CopyVault)
  │   ├── positions (CopyVaultPosition[])
  │   └── activity (CopyVaultActivity[])
  ├── follows (LeaderFollow[])
  ├── trades (LeaderTrade[])
  └── ideas (SocialIdea[])
       └── comments (SocialIdeaComment[])
            └── likes (SocialIdeaLike[])

Agent
  ├── apiKeys (AgentApiKey[])
  └── stakes (AgentStake[])

Listing
  └── lock (LiquidityLock)

AffiliateCommission
  └── batch (AffiliatePayoutBatch)
```

---

## Architecture Decision Records (ADRs)

### ADR-001: sr25519 Signatures for Authentication

**Status:** Accepted

**Context:** DEX requires wallet-based authentication without storing passwords. Standard JWT would require a trusted auth server.

**Decision:** Use the wallet's sr25519 keypair (native to Substrate/Lunes) to sign structured messages containing the action, nonce, and timestamp. The backend verifies signatures using `@polkadot/util-crypto`.

**Consequences:** ✅ Trustless, no session management. ⚠️ Client must have wallet access for every write operation.

---

### ADR-002: REST + WebSocket (not GraphQL)

**Status:** Accepted

**Context:** API needs to serve both web browsers and AI agents. Multiple potential external integrators.

**Decision:** REST `/api/v1/...` for CRUD operations. WebSocket for real-time orderbook/trade streams. No GraphQL.

**Consequences:** ✅ Wide compatibility, HTTP caching native, simple clients. ⚠️ Some under/over-fetching for complex queries. **SubQuery GraphQL is used internally** for block indexing (not exposed to clients).

---

### ADR-003: Redis for Nonce Replay Protection

**Status:** Accepted

**Context:** Replay attacks — resubmitting a previously valid signed transaction — must be prevented without storing all nonces permanently.

**Decision:** Each signed nonce is stored in Redis with a TTL equal to `NONCE_TTL_SECONDS` (default 5 min). Within the TTL window, replay is rejected.

**Consequences:** ✅ O(1) nonce lookup, automatic expiry, scales across multiple API instances. ⚠️ Redis becomes a dependency for write operations.

---

### ADR-004: Batched Affiliate Queries (no N+1)

**Status:** Accepted

**Context:** Early implementation of `getReferralTree` executed 2 queries per referee in a loop, creating an N+1 problem that would degrade significantly at scale.

**Decision:** Use Prisma `groupBy` to batch-fetch counts and earnings for all referees at each tree level in exactly 2 queries, then build the tree from in-memory maps.

**Consequences:** ✅ O(depth × 2) queries instead of O(N × 2). ✅ Sub-millisecond tree build for any tree size.

---

### ADR-005: SubQuery as Primary Analytics Data Source

**Status:** Accepted

**Context:** Direct RPC polling (Polkadot.js) for analytics events is slow, misses events on restarts, and creates heavy load on the node.

**Decision:** SubQuery indexer processes chain events into a PostgreSQL-backed GraphQL API. The `socialIndexerService` queries SubQuery as primary source, with fallback to direct RPC polling when SubQuery is unavailable.

**Consequences:** ✅ Near-instant block event consumption, missed events replayed on restart. ⚠️ Requires running a SubQuery node alongside the API.

---

## Performance Characteristics

| Component | Current Approach | Notes |
|-----------|-----------------|-------|
| Matching Engine | In-memory orderbook (sorted map) + DB persistence | Rehydrated from DB on startup |
| WebSocket | Native ws library + channel subscriptions | No broker dependency in dev |
| Rate limiting | Redis sliding window (express-rate-limit) | Per-IP (trust proxy aware) |
| Metrics | Prometheus via prom-client, exposed at `/metrics` | Grafana dashboards ready |
| Logging | Pino structured JSON | Log level controlled by `LOG_LEVEL` env |

---

## Observability

### Metrics (`/metrics`)

- `http_request_duration_seconds` — HTTP latency histogram by route+method+status
- `redis_healthy` — Redis connectivity gauge
- `blockchain_latest_block` — Latest indexed block number
- `vault_total_equity` — Total AUM across all copy vaults
- `vault_reconciliation_repairs` — Count of drift repairs

### Logging

All logs are structured JSON via Pino:
```json
{
  "level": "info",
  "time": "2026-03-10T11:00:00.000Z",
  "service": "spot-api",
  "msg": "[Order] Created LIMIT BUY LUNES/LUSDT",
  "orderId": "ord_abc123"
}
```
