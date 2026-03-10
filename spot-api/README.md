# spot-api

> REST API + WebSocket server for the Lunex DEX. Built with Express 5, TypeScript, Prisma, and Redis.

---

## Quick Start

```bash
# Install dependencies
yarn install

# Configure environment
cp .env.example .env
# Edit DATABASE_URL, REDIS_URL, ADMIN_SECRET, LUNES_WS_URL

# Database setup
npx prisma migrate dev
npx prisma generate

# Start development server
yarn dev
```

Servers start on:
- HTTP API: `http://localhost:4000`
- WebSocket: `ws://localhost:4001`

---

## Tech Stack

| Tool | Purpose |
|------|---------|
| Express 5 | HTTP server and routing |
| TypeScript 5 | Type safety |
| Prisma | ORM + migrations for PostgreSQL |
| Zod | Request body schema validation |
| Redis | Nonce replay protection, rate limiting |
| Polkadot.js | Lunes node connectivity and signature verification |
| Pino | Structured JSON logging |
| prom-client | Prometheus metrics |
| ws | WebSocket server |

---

## Project Structure

```
spot-api/
├── src/
│   ├── index.ts              # Entry point: middleware, routes, background jobs
│   ├── config.ts             # Typed config from env vars
│   ├── db.ts                 # Prisma client singleton
│   ├── routes/               # 15 route modules
│   │   ├── pairs.ts          # Trading pairs
│   │   ├── orders.ts         # Order placement & cancellation
│   │   ├── trades.ts         # Trade history
│   │   ├── orderbook.ts      # Orderbook snapshot
│   │   ├── candles.ts        # OHLCV candles
│   │   ├── social.ts         # Social trading (leaders, ideas, vaults)
│   │   ├── copytrade.ts      # Copy trade positions & signals
│   │   ├── margin.ts         # Leveraged positions
│   │   ├── affiliate.ts      # Referral codes & commissions
│   │   ├── agents.ts         # AI agent registration & API keys
│   │   ├── router.ts         # Smart Router (quote + swap)
│   │   ├── asymmetric.ts     # Asymmetric order matching
│   │   ├── listing.ts        # Token listing & liquidity locks
│   │   ├── governance.ts     # Governance vote check/record
│   │   └── tradeApi.ts       # Agent trade execution API
│   ├── services/             # 24 business logic services
│   ├── middleware/           # Auth, errors, pagination, metrics
│   ├── utils/                # Logger, Redis, signing, metrics
│   └── websocket/            # WebSocket server + channel pub/sub
├── prisma/
│   ├── schema.prisma         # Database schema (source of truth)
│   └── migrations/           # Versioned SQL migrations
├── __tests__/                # Integration & E2E tests
└── .env.example              # Environment variable template
```

---

## Environment Variables

See `.env.example` for the complete list. Required for startup:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `PORT` | HTTP port (default: 4000) |
| `WS_PORT` | WebSocket port (default: 4001) |
| `ADMIN_SECRET` | Bearer token for admin endpoints |
| `LUNES_WS_URL` | Lunes node WebSocket RPC URL |

See [.env.example](./.env.example) for all optional variables.

---

## Available Scripts

```bash
yarn dev          # Start with ts-node-dev (hot reload)
yarn build        # Compile TypeScript → dist/
yarn start        # Run compiled dist/index.js
yarn test         # Run Jest test suite
yarn test:e2e     # Run E2E tests only
yarn lint         # ESLint
yarn typecheck    # TypeScript check (tsc --noEmit)
```

---

## Database

### Migrations

```bash
# Create a new migration after schema changes
npx prisma migrate dev --name <description>

# Apply migrations in production
npx prisma migrate deploy

# Reset database (dev only!)
npx prisma migrate reset

# Open Prisma Studio (GUI)
npx prisma studio
```

### Schema

The full schema is in `prisma/schema.prisma`. Key models:

- `Order` — Spot orders with status tracking
- `Trade` — Executed trades
- `Leader` — Copy-trade leaders with vault relation
- `CopyVault` / `CopyVaultPosition` — Vault state per follower
- `Agent` / `AgentApiKey` — AI trading agents
- `Referral` / `AffiliateCommission` — Affiliate system
- `Listing` / `LiquidityLock` — Token listing workflow
- `GovernanceVote` — On-chain governance vote records

---

## Testing

```bash
# All tests
yarn test

# Watch mode
yarn test --watch

# Single file
yarn test -- --testPathPattern=affiliate

# Coverage
yarn test --coverage
```

### Test Files

| File | Coverage |
|------|----------|
| `agent.e2e.test.ts` | Agent registration, API key generation, leaderboard |
| `affiliate.test.ts` | Referral codes, commission math, dashboard, tree |
| `botSandbox.test.ts` | Strategy sandbox execution |
| `governance.e2e.test.ts` | Vote cooldown, record, history |
| `tradeApi.e2e.test.ts` | Trade API E2E with agent auth |

---

## Monitoring

Prometheus metrics exposed at `GET /metrics`:

```bash
# View metrics
curl http://localhost:4000/metrics | grep -E "^lunex_|^http_"
```

Key metrics:
- `http_request_duration_seconds` — Latency by route, method, status
- `redis_healthy` — 0/1 Redis health gauge
- `blockchain_latest_block` — Last indexed block number
- `vault_total_equity` — Total AUM across all copy vaults

Health check:
```bash
curl http://localhost:4000/health
```

---

## Authentication Quick Reference

| Endpoint Type | Mechanism | Where |
|--------------|-----------|-------|
| Wallet writes | sr25519 signature + nonce | `signature` in body |
| Admin routes | Bearer token | `Authorization: Bearer <ADMIN_SECRET>` |
| AI Agent | API key | `X-API-Key: lnx_<key>` |
| Leader API | Leader key | `X-Leader-Key: <key>` |
