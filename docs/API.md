# Lunex DEX — API Reference

> REST API + WebSocket for the Lunex DEX. Base URL: `/api/v1`

**Authentication:** Most write operations require an `sr25519` wallet signature. Admin operations require `Authorization: Bearer <ADMIN_SECRET>`. AI Agent operations require `X-API-Key: <agent-key>`.

---

## Table of Contents

- [Pairs](#pairs)
- [Orders](#orders)
- [Trades](#trades)
- [Orderbook](#orderbook)
- [Candles](#candles)
- [Smart Router](#smart-router)
- [Social](#social)
- [Copy Trade](#copy-trade)
- [Margin](#margin)
- [Affiliate](#affiliate)
- [AI Agents](#ai-agents)
- [Asymmetric Orders](#asymmetric-orders)
- [Token Listing](#token-listing)
- [Governance](#governance)
- [WebSocket Channels](#websocket-channels)
- [Error Responses](#error-responses)

---

## Pairs

### `GET /pairs`

List all active trading pairs.

**Response `200`:**
```json
{
  "pairs": [
    {
      "symbol": "LUNES/LUSDT",
      "baseToken": "WLUNES",
      "quoteToken": "LUSDT",
      "pairAddress": "5GrwvaEF...",
      "isActive": true,
      "lastPrice": "0.0821",
      "volume24h": "142500.00"
    }
  ]
}
```

---

### `GET /pairs/:symbol/ticker`

Get 24h ticker for a pair.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `symbol` | string | Yes | Pair symbol (e.g. `LUNES/LUSDT`) |

**Response `200`:**
```json
{
  "symbol": "LUNES/LUSDT",
  "lastPrice": "0.0821",
  "priceChange24h": "0.0012",
  "priceChangePct24h": "1.48",
  "high24h": "0.0850",
  "low24h": "0.0800",
  "volume24h": "142500.00",
  "trades24h": 387
}
```

---

### `GET /pairs/on-chain` ⛔ Admin

Fetch all pairs from the Factory smart contract.

**Headers:** `Authorization: Bearer <ADMIN_SECRET>`

---

### `POST /pairs/register` ⛔ Admin

Register a new on-chain pair in the database.

**Body:**
```json
{ "symbol": "TOKEN/LUSDT", "pairAddress": "5Abc..." }
```

---

### `PATCH /pairs/:symbol/sync` ⛔ Admin

Sync pair data from on-chain state.

---

## Orders

### `POST /orders`

Place a new order. Requires wallet signature.

**Body:**
```json
{
  "pairSymbol": "LUNES/LUSDT",
  "side": "BUY",
  "type": "LIMIT",
  "price": "0.0810",
  "amount": "1000",
  "timeInForce": "GTC",
  "nonce": "1741612800001",
  "signature": "0x...",
  "makerAddress": "5GrwvaEF..."
}
```

**Response `201`:**
```json
{
  "order": {
    "id": "ord_abc123",
    "status": "OPEN",
    "pairSymbol": "LUNES/LUSDT",
    "side": "BUY",
    "type": "LIMIT",
    "price": "0.0810",
    "amount": "1000",
    "filledAmount": "0",
    "remainingAmount": "1000",
    "createdAt": "2026-03-10T11:00:00Z"
  }
}
```

**Order types:** `LIMIT`, `MARKET`, `STOP_LIMIT`, `STOP_MARKET`
**Time in force:** `GTC` (Good Till Cancel), `FOK` (Fill or Kill), `IOC` (Immediate or Cancel)

---

### `DELETE /orders/:id`

Cancel an open order. Requires wallet signature.

**Body:**
```json
{ "makerAddress": "5GrwvaEF...", "signature": "0x..." }
```

**Response `200`:** Cancelled order object.

---

### `GET /orders`

List orders for a wallet address.

**Query parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `makerAddress` | string | required | Wallet address |
| `status` | string | all | `OPEN`, `FILLED`, `CANCELLED`, `PARTIALLY_FILLED` |
| `limit` | number | 50 | Max results (≤ 200) |
| `offset` | number | 0 | Pagination offset |

---

## Trades

### `GET /trades/:symbol`

Recent trades for a pair.

**Query:** `limit` (default 50, max 200)

**Response `200`:**
```json
{
  "trades": [
    {
      "id": "trd_xyz",
      "pairSymbol": "LUNES/LUSDT",
      "price": "0.0821",
      "amount": "500",
      "side": "BUY",
      "executedAt": "2026-03-10T10:55:00Z"
    }
  ]
}
```

---

### `GET /trades?address=<wallet>&nonce=...&timestamp=...&signature=...` 🔏 Signature

Trades for a specific wallet address.

**Query:** `limit` (default 50, max 100), `offset` (default 0)

---

## Orderbook

### `GET /orderbook/:symbol`

Orderbook snapshot for a pair.

**Query:** `depth` (default 25, max 200)

**Response `200`:**
```json
{
  "bids": [["0.0810", "5000"], ["0.0800", "12000"]],
  "asks": [["0.0825", "3000"], ["0.0830", "8000"]],
  "spread": "0.0015",
  "lastUpdated": "2026-03-10T11:00:00Z"
}
```

---

## Candles

### `GET /candles/:symbol`

OHLCV candlestick data.

**Query:**
| Name | Description | Default |
|------|-------------|---------|
| `interval` | `1m`, `5m`, `15m`, `1h`, `4h`, `1d` | `1h` |
| `limit` | Number of candles | 100 |
| `from` | Unix timestamp (seconds) | — |
| `to` | Unix timestamp (seconds) | — |

---

## Smart Router

### `GET /route/quote`

Simulate the best execution route. **Public — no auth required.**

**Query:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `pairSymbol` | string | Yes | Pair to trade |
| `side` | string | Yes | `BUY` or `SELL` |
| `amountIn` | number | Yes | Input amount |

**Response `200`:**
```json
{
  "bestRoute": "ORDERBOOK",
  "bestAmountOut": 241.5,
  "routes": [
    { "source": "ORDERBOOK", "amountOut": 241.5, "priceImpactPct": 0.12, "viable": true },
    { "source": "AMM_V1", "amountOut": 239.1, "priceImpactPct": 0.82, "viable": true },
    { "source": "ASYMMETRIC", "amountOut": 245.2, "priceImpactPct": 0.09, "viable": true }
  ],
  "estimatedSlippageBps": 12
}
```

---

### `POST /route/swap` 🔑 Agent Auth

Execute a swap via Smart Router V2. Requires `X-API-Key` with `TRADE_SPOT` permission.

Important:

- `POST /route/swap` is agent-authenticated.
- If the best route resolves to `ASYMMETRIC`, the response can return `requiresWalletSignature: true`
  plus a `contractCallIntent` instead of completing execution server-side.

**Body:**
```json
{
  "pairSymbol": "LUNES/LUSDT",
  "side": "BUY",
  "amountIn": 1000,
  "maxSlippageBps": 100
}
```

---

## Social

### `GET /social/stats`

Platform-wide statistics.

**Response `200`:**
```json
{
  "totalAum": 4250000,
  "activeTraders": 142,
  "aiAgents": 23,
  "totalFollowers": 8830,
  "totalIdeas": 412,
  "totalVaultEquity": 1250000
}
```

---

### `GET /social/leaders`

List all copy-trade leaders.

**Query:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `tab` | string | `all` | `all`, `traders`, `bots` |
| `sortBy` | string | `roi30d` | `roi30d`, `followers`, `winRate` |
| `search` | string | — | Search by name/username/bio |
| `limit` | number | 50 | Max results |

---

### `GET /social/leaders/:leaderId`

Get a leader's full profile, trade history, and ideas.

---

### `GET /social/leaderboard`

Top 10 leaders by Sharpe ratio.

---

### `POST /social/leaders/profile` 🔏 Signature

Upsert (create or update) a leader profile.

**Body:**
```json
{
  "address": "5GrwvaEF...",
  "name": "LunesWhale",
  "username": "luneswhale",
  "bio": "DeFi since 2020",
  "fee": 10,
  "twitterUrl": "https://x.com/luneswhale",
  "signature": "0x...",
  "nonce": "1741612800001"
}
```

---

### `POST /social/leaders/:leaderId/follow` 🔏 Signature

Follow a leader.

### `DELETE /social/leaders/:leaderId/follow` 🔏 Signature

Unfollow a leader.

### `POST /social/ideas/:ideaId/like` 🔏 Signature

Like a trade idea.

### `DELETE /social/ideas/:ideaId/like` 🔏 Signature

Unlike a trade idea.

### `POST /social/ideas/:ideaId/comments` 🔏 Signature

Post a comment on a trade idea.

### `POST /social/vaults/:leaderId/deposit` 🔏 Signature

Legacy route. Returns `410 Gone` and points clients to `/copytrade/vaults/:leaderId/deposit`.

### `POST /social/vaults/:leaderId/withdraw` 🔏 Signature

Legacy route. Returns `410 Gone` and points clients to `/copytrade/vaults/:leaderId/withdraw`.

---

## Copy Trade

### `GET /copytrade/vaults`

List all copy vaults.

### `GET /copytrade/vaults/:leaderId`

Get one vault by leader ID.

### `GET /copytrade/positions?address=<wallet>&nonce=...&timestamp=...&signature=...` 🔏 Signature

Get a follower's positions across all vaults.

### `GET /copytrade/activity?address=<wallet>&limit=50&nonce=...&timestamp=...&signature=...` 🔏 Signature

Activity history (deposits, withdrawals, PnL).

### `POST /copytrade/vaults/:leaderId/deposit` 🔏 Signature

Deposit into the canonical copytrade vault flow.

Response fields:
- `depositId`
- `sharesMinted`
- `amount`
- `positionId`
- `executionMode`: `db-journal` or `on-chain-confirmed`
- `txHash`: on-chain tx hash when a vault contract is enabled and the relayer confirms the deposit

### `POST /copytrade/vaults/:leaderId/withdraw` 🔏 Signature

Withdraw shares from the canonical copytrade vault flow.

Response fields:
- `withdrawalId`
- `grossAmount`
- `feeAmount`
- `netAmount`
- `profitAmount`
- `remainingShares`
- `executionMode`: `db-journal` or `on-chain-confirmed`
- `txHash`: on-chain tx hash when a vault contract is enabled and the relayer confirms the withdrawal

### `GET /copytrade/leaders/:leaderId/api-key/challenge`

Get a signature challenge for generating a leader API key.

### `POST /copytrade/leaders/:leaderId/api-key` 🔏 Signature

Create a leader API key (used to submit trading signals).

### `POST /copytrade/vaults/:leaderId/signals` 🔑 Leader API Key

Submit a copy-trade signal for followers to mirror.

Key fields:
- `amountIn` and `amountOutMin`
- `positionEffect`: `AUTO`, `OPEN`, or `CLOSE`
- `signalMode`: `AUTO`, `JOURNAL`, or `EXECUTE_VAULT`

Notes:
- `positionEffect` is the canonical lifecycle field.
- `realizedPnlPct` is legacy and no longer drives close/open behavior.
- `AUTO` attempts live vault execution when the copy vault is contract-backed and the best server-side route is executable on the backend (`ORDERBOOK` or `AMM_V1`); non-server routes (e.g. `ASYMMETRIC`) fall back to journaling.
- for `ASYMMETRIC` in `AUTO`, the API now also returns `walletAssistedContinuation` with `contractCallIntent`, so agents can continue execution via user wallet signature.
- in `AUTO`, runtime live-execution failures also degrade to journaling (logged server-side) to preserve signal continuity.
- `EXECUTE_VAULT` is stricter and currently fails when live server-side vault execution is unavailable.

### `POST /copytrade/vaults/:leaderId/signals/:signalId/wallet-confirmation` 🔏 Signature

Confirm an `ASYMMETRIC` wallet-assisted signal execution after on-chain completion.

Key fields:
- `leaderAddress`
- `txHash`
- optional `amountOut`
- optional `executionPrice`

Notes:
- requires wallet signature action `copytrade.confirm-wallet-signal`;
- marks pending continuation as confirmed and reconciles signal execution journal.

### `GET /copytrade/vaults/:leaderId/signals/pending-wallet` 🔑 Leader API Key

List pending wallet-assisted continuations for a leader vault.

Notes:
- requires `x-api-key` for the leader;
- used by agents to recover/retry `ASYMMETRIC` continuations;
- stale pending continuations are automatically expired by backend scheduler.

---

## Margin

### `GET /margin/positions?address=<wallet>`

Active leveraged positions for a wallet.

### `POST /margin/positions` 🔏 Signature

Open a leveraged position.

**Body:**
```json
{
  "pairSymbol": "LUNES/LUSDT",
  "side": "LONG",
  "leverage": 5,
  "collateral": "200",
  "collateralToken": "LUSDT",
  "makerAddress": "5GrwvaEF...",
  "signature": "0x...",
  "nonce": "1741612800001"
}
```

### `POST /margin/collateral/deposit` 🔏 Signature

Add collateral to an existing position.

### `POST /margin/collateral/withdraw` 🔏 Signature

Withdraw collateral from a position.

### `POST /margin/positions/:id/close` 🔏 Signature

Close a leveraged position.

---

## Affiliate

### `GET /affiliate/code?address=<wallet>`

Get or generate a referral code for a wallet address.

**Response `200`:**
```json
{ "referralCode": "A1B2C3D4", "address": "5GrwvaEF..." }
```

---

### `POST /affiliate/register`

Register a referral (link referee to referrer's code).

**Body:**
```json
{ "refereeAddress": "5FHne...", "referralCode": "A1B2C3D4" }
```

---

### `GET /affiliate/dashboard?address=<wallet>`

Affiliate earnings dashboard.

**Response `200`:**
```json
{
  "referralCode": "A1B2C3D4",
  "directReferrals": 12,
  "totalUnpaid": 142.5,
  "totalPaid": 890.25,
  "earningsByLevel": [
    { "level": 1, "token": "LUSDT", "totalEarned": 850, "tradeCount": 432 }
  ],
  "levels": [
    { "level": 1, "ratePct": 4, "rateBps": 400 }
  ]
}
```

---

### `GET /affiliate/tree?address=<wallet>`

Referral tree (downstream referees, up to 3 levels deep).

### `GET /affiliate/payouts?address=<wallet>`

Payout history for a wallet.

### `POST /affiliate/payout/process` ⛔ Admin

Trigger the weekly payout batch job.

---

## AI Agents

### `POST /agents/register`

Register an AI trading agent. Requires a wallet-signed payload.

**Body:**
```json
{
  "walletAddress": "5GrwvaEF...",
  "agentType": "AI_AGENT",
  "framework": "custom",
  "strategyDescription": "Grid trading on LUNES/LUSDT",
  "nonce": "1741612800001",
  "timestamp": 1741612800001,
  "signature": "0x..."
}
```

**Response `201`:** `{ "agent": { ... } }`

---

### `POST /agents/:id/api-keys`

Generate an API key for an agent (max 5 active keys).

Notes:

- If the caller already has an agent API key, send `X-API-Key`.
- For the first key bootstrap, send `walletAddress`, `nonce`, `timestamp`, and `signature`.

**Body:**
```json
{
  "walletAddress": "5GrwvaEF...",
  "label": "production-key",
  "permissions": ["TRADE_SPOT", "READ_ONLY"],
  "expiresInDays": 90
}
```

**Response `201`:** `{ "key": "lnx_<64 chars>" }` — **shown once only**.

---

### `DELETE /agents/:id/api-keys/:keyId`

Revoke an API key.

### `GET /agents/me`

Get the authenticated agent profile, staking tier, and trading limits.

### `GET /agents/:id`

Get a public agent profile by ID.

### `POST /agents/:id/stake`

Record a stake event for an agent (increases trading limits).

---

## Staking Tiers

| Tier | Min Stake (LUNES) | Daily Trade Limit | Max Position |
|------|-------------------|-------------------|--------------|
| 0 | 0 | 10 | 100 |
| 1 | 100 | 100 | 1,000 |
| 2 | 1,000 | 500 | 10,000 |
| 3 | 10,000 | 2,000 | 100,000 |

---

## Token Listing

### `GET /listing`

Paginated list of token listings.

**Query:** `tier` (BASIC/VERIFIED/FEATURED), `status`, `limit`, `offset`

### `GET /listing/:id`

Get a listing by ID.

### `GET /listing/token/:tokenAddress`

Get a listing by token contract address.

### `GET /listing/owner/:address`

All listings by an owner wallet.

### `POST /listing`

Create a new token listing (pending on-chain confirmation).

**Body:**
```json
{
  "ownerAddress": "5GrwvaEF...",
  "tokenAddress": "5XYZ...",
  "tokenName": "My Token",
  "tokenSymbol": "MTK",
  "tier": "BASIC",
  "lpTokenAddress": "5LP...",
  "lpAmount": "10000",
  "lunesLiquidity": "5000",
  "tokenLiquidity": "1000000"
}
```

### `POST /listing/:id/activate` ⛔ Admin

Activate a listing after on-chain confirmation.

### `POST /listing/:id/reject` ⛔ Admin

Reject a listing.

### `POST /listing/lock/:lockId/withdraw`

Withdraw a liquidity lock (after lock period expires).

---

## Governance

### `POST /governance/vote/check`

Check if a wallet can vote on a proposal.

**Body:**
```json
{ "walletAddress": "5GrwvaEF...", "proposalId": 1 }
```

**Response `200`:**
```json
{
  "canVote": false,
  "lastVotedAt": "2026-03-10T10:00:00Z",
  "timeUntilNextVote": 2847
}
```

---

### `POST /governance/vote/record`

Record an on-chain vote.

**Body:**
```json
{
  "walletAddress": "5GrwvaEF...",
  "proposalId": 42,
  "voteType": "YES",
  "txHash": "0x..."
}
```

**Cooldown:** 1 hour between votes per wallet+proposal pair.

---

### `GET /governance/vote/history?walletAddress=<wallet>`

Vote history for a wallet.

---

## WebSocket Channels

Connect to `ws://localhost:4001`.

**Subscribe:**
```json
{ "type": "subscribe", "channel": "orderbook:LUNES/LUSDT" }
```

**Unsubscribe:**
```json
{ "type": "unsubscribe", "channel": "orderbook:LUNES/LUSDT" }
```

| Channel | Payload | Description |
|---------|---------|-------------|
| `orderbook:<symbol>` | Full orderbook snapshot | Live order book |
| `trades:<symbol>` | Trade object | New trade executed |
| `ticker:<symbol>` | Ticker object | 24h price stats |
| `user:<address>` | Order/trade event | Personal notifications |

---

## Error Responses

All errors follow this format:

```json
{
  "error": "Human-readable message",
  "code": "MACHINE_READABLE_CODE",
  "details": [ ... ]
}
```

**Common status codes:**

| Code | Meaning |
|------|---------|
| 400 | Bad request / validation failed |
| 401 | Invalid or missing signature/token |
| 403 | Valid auth but insufficient permissions |
| 404 | Resource not found |
| 409 | Conflict (duplicate resource) |
| 422 | Valid syntax, invalid business logic |
| 429 | Rate limit exceeded / vote cooldown |
| 500 | Internal server error |
| 503 | Service unavailable (node disconnected, config missing) |

---

## Authentication Reference

| Method | Where Used | Format |
|--------|-----------|--------|
| sr25519 Signature | Order create/cancel, social writes, margin, copy trade | `signature` field in body |
| Admin Bearer Token | Pair register, listing activate/reject, payouts | `Authorization: Bearer <secret>` |
| Agent API Key | Smart Router swap, trade execution | `X-API-Key: lnx_<key>` |
| Leader API Key | Copy trade signal submission | `X-Leader-Key: <key>` |
