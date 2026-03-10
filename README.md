# Lunex DEX

> Non-custodial decentralized exchange built on the Lunes blockchain. Spot trading, copy trading, margin, staking, governance, and AI agent API — all in one protocol.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/License-Proprietary-red)](./LICENSE.md)

---

## What is Lunex?

Lunex is a full-stack DEX protocol on the [Lunes Network](https://lunes.io) (Substrate/Polkadot). It provides:

- **Spot Trading** — On-chain order book with sr25519 signature-based authentication
- **Copy Trading** — Follow top traders' vaults with performance fee logic
- **Margin Trading** — Leveraged positions with automated liquidation
- **AI Agents API** — Programmatic trading via API keys with staking-based limits
- **Social Trading** — Leaderboards, trade ideas, leader profiles
- **Affiliate System** — Multi-level commission distribution (up to 5 levels)
- **Token Listing** — Permissioned listing with on-chain liquidity locks

---

## Quick Start (Development)

### Prerequisites

- Node.js ≥ 20
- PostgreSQL ≥ 15
- Redis ≥ 7
- Docker (optional, for full stack)

### 1. Clone & Install

```bash
git clone <repo-url>
cd Lunex
yarn install
```

### 2. Configure Environment

```bash
# Backend API
cp spot-api/.env.example spot-api/.env
# Edit: DATABASE_URL, REDIS_URL, ADMIN_SECRET

# Frontend
cp lunes-dex-main/.env.example lunes-dex-main/.env
# Edit: VITE_API_URL, VITE_WS_URL
```

### 3. Database Setup

```bash
cd spot-api
npx prisma migrate dev
npx prisma generate
```

### 4. Start Services

```bash
# Backend API (port 4000) + WebSocket (port 4001)
cd spot-api && yarn dev

# Frontend (port 3000)
cd lunes-dex-main && yarn dev
```

### 5. Docker (Full Stack)

```bash
docker-compose -f docker-compose.dev.yml up
```

---

## System Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌──────────────────┐
│  lunes-dex-main │────▶│   spot-api      │────▶│   PostgreSQL     │
│  (React/Vite)   │     │   (Express 5)   │     │   (Prisma ORM)   │
└─────────────────┘     │   Port 4000     │     └──────────────────┘
                        │   WS: 4001      │     ┌──────────────────┐
                        └────────┬────────┘────▶│   Redis          │
                                 │              │   (Nonces/Cache) │
                        ┌────────▼────────┐     └──────────────────┘
                        │  Lunes Node     │     ┌──────────────────┐
                        │  (Substrate RPC)│────▶│  SubQuery        │
                        └─────────────────┘     │  (Block Indexer) │
                                                └──────────────────┘
```

For detailed architecture, see [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

---

## Project Structure

```
Lunex/
├── spot-api/          # Backend REST API + WebSocket server
│   ├── prisma/        # Database schema & migrations
│   ├── src/
│   │   ├── routes/    # 15 API route modules
│   │   ├── services/  # 24 business logic services
│   │   ├── middleware/ # Auth, error, pagination, metrics
│   │   └── utils/     # Logger, Redis, Metrics, Signing
├── lunes-dex-main/    # React frontend (Vite)
│   ├── src/
│   │   ├── components/ # UI components
│   │   ├── context/    # SpotContext, SDKContext
│   │   └── services/   # API client layer
├── contracts/         # ink! smart contracts (Rust)
│   ├── factory/       # AMM pair factory
│   ├── pair/          # Liquidity pair
│   └── marketplace/   # Order book contract
├── sdk/               # TypeScript SDK for external integrations
├── subquery-node/     # SubQuery indexer for Lunes events
├── mcp/               # Model Context Protocol server
├── docs/              # Documentation
└── scripts/           # Deployment & utility scripts
```

---

## API Reference

Base URL: `http://localhost:4000/api/v1`

| Module | Prefix | Description |
|--------|--------|-------------|
| Pairs | `/pairs` | Trading pairs, ticker, sync |
| Orders | `/orders` | Create, cancel, list orders |
| Trades | `/trades` | Trade history, user trades |
| Orderbook | `/orderbook` | Order book snapshot |
| Candles | `/candles` | OHLCV candlestick data |
| Social | `/social` | Leaders, ideas, follow, vaults |
| Copy Trade | `/copytrade` | Copy vault positions & signals |
| Margin | `/margin` | Leveraged positions |
| Affiliate | `/affiliate` | Referrals, commissions, payouts |
| Agents | `/agents` | AI agent registration & API keys |
| Smart Router | `/route` | Best-route quotes & execution |
| Asymmetric | `/asymmetric` | Asymmetric order matching |
| Listing | `/listing` | Token listing & lock management |
| Governance | `/governance` | Vote check, record, history |

Full API docs: [docs/API.md](./docs/API.md)

### WebSocket

Connect to `ws://localhost:4001` and subscribe to channels:

```js
// Subscribe
ws.send(JSON.stringify({ type: 'subscribe', channel: 'orderbook:LUNES/LUSDT' }))
ws.send(JSON.stringify({ type: 'subscribe', channel: 'trades:LUNES/LUSDT' }))
ws.send(JSON.stringify({ type: 'subscribe', channel: 'ticker:LUNES/LUSDT' }))
ws.send(JSON.stringify({ type: 'subscribe', channel: 'user:<walletAddress>' }))
```

---

## Environment Variables

See [spot-api/.env.example](./spot-api/.env.example) for the full list. Critical variables:

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | ✅ |
| `REDIS_URL` | Redis connection string | ✅ |
| `ADMIN_SECRET` | Bearer token for admin routes | ✅ prod |
| `RELAYER_SEED` | Relayer wallet seed for settlements | ✅ prod |
| `LUNES_WS_URL` | Lunes node WebSocket RPC | ✅ |
| `FACTORY_CONTRACT_ADDRESS` | Deployed factory contract | ✅ |
| `SPOT_CONTRACT_ADDRESS` | Deployed spot contract | ✅ |
| `SUBQUERY_ENDPOINT` | SubQuery indexer URL | Optional |
| `LOG_LEVEL` | Logging level (info/debug/warn) | Optional |

---

## SDK

```bash
yarn add @lunex/sdk
```

```typescript
import { LunexSDK } from '@lunex/sdk'

const sdk = new LunexSDK({ apiUrl: 'https://api.lunex.io' })
const pairs = await sdk.spot.getPairs()
```

See [SDK documentation](./sdk/README.md) for full SDK reference.

---

## Smart Contracts

Contracts are written in [ink! 4.x](https://use.ink/) (Rust) and deployed on the Lunes Network.

| Contract | Purpose |
|----------|---------|
| `factory` | Deploys and tracks AMM pair contracts |
| `pair` | PSP22-compatible AMM liquidity pair |
| `marketplace` | On-chain order book |

Build:
```bash
cargo contract build --release
```

---

## Testing

```bash
# Unit & integration tests
cd spot-api && yarn test

# Specific test
yarn test -- --testPathPattern=affiliate

# E2E tests
yarn test:e2e
```

Test files in `spot-api/__tests__/`:
- `agent.e2e.test.ts` — Agent registration flow
- `affiliate.test.ts` — Commission logic & referral chain
- `botSandbox.test.ts` — Bot execution sandbox
- `governance.e2e.test.ts` — Vote cooldown enforcement
- `tradeApi.e2e.test.ts` — Trade API E2E

---

## Deployment

See [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) for production deployment guide.

Quick production checklist:
- [ ] Set `NODE_ENV=production`
- [ ] Configure `ADMIN_SECRET` (use `openssl rand -base64 32`)
- [ ] Point `DATABASE_URL` to production PostgreSQL
- [ ] Configure `REDIS_URL` to production Redis cluster
- [ ] Set `CORS_ALLOWED_ORIGINS` to production frontend domain
- [ ] Set `TRUST_PROXY=true` if behind nginx/load balancer

---

## License

See [LICENSE.md](./LICENSE.md) and [NOTICE.md](./NOTICE.md).
