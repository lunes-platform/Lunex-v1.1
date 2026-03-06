# 🌐 LUNEX DEX - PUBLIC API SPECIFICATION

**Versão:** 2.0.0  
**Data:** 05 de Dezembro de 2025  
**Tipo:** API Pública para Automação e Integração  
**Segurança:** API Keys, Rate Limiting, IP Whitelist

---

## 📋 ÍNDICE

1. [Visão Geral](#visão-geral)
2. [Autenticação & API Keys](#autenticação--api-keys)
3. [Rate Limiting](#rate-limiting)
4. [Public Market Data API](#public-market-data-api)
5. [Trading Automation API](#trading-automation-api)
6. [Liquidity Pool API](#liquidity-pool-api)
7. [Staking Automation API](#staking-automation-api)
8. [Token Listing API](#token-listing-api)
9. [Webhooks & Notifications](#webhooks--notifications)
10. [Security Best Practices](#security-best-practices)

---

## VISÃO GERAL

### **Tipos de Endpoints**

```
┌─────────────────────────────────────────────────┐
│          PUBLIC ENDPOINTS (No Auth)             │
│  - Market data (preços, volume, TVL)            │
│  - Token info                                   │
│  - Historical data                              │
│  Rate: 120 req/min                              │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│       AUTHENTICATED ENDPOINTS (API Key)         │
│  - Trading automation                           │
│  - Liquidity management                         │
│  - Staking operations                           │
│  Rate: 600 req/min                              │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│      PREMIUM ENDPOINTS (Premium API Key)        │
│  - Webhooks                                     │
│  - Real-time streaming                          │
│  - Bulk operations                              │
│  Rate: 3000 req/min                             │
└─────────────────────────────────────────────────┘
```

---

## AUTENTICAÇÃO & API KEYS

### **Criar API Key**

```http
POST https://api.lunex.io/v2/apikeys
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "name": "Trading Bot Production",
  "scopes": ["read", "trade", "liquidity", "staking"],
  "ipWhitelist": ["203.0.113.0/24"],
  "expiresIn": 31536000
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "apiKey": "lnx_live_abc123xyz456...",
    "apiSecret": "sk_abc123...",
    "name": "Trading Bot Production",
    "scopes": ["read", "trade", "liquidity", "staking"],
    "rateLimit": 600,
    "ipWhitelist": ["203.0.113.0/24"],
    "createdAt": "2025-12-05T00:00:00Z",
    "expiresAt": "2026-12-05T00:00:00Z"
  }
}
```

### **Usar API Key**

**Header:**
```http
X-API-Key: lnx_live_abc123xyz456...
X-API-Secret: sk_abc123...
```

**Query Parameter (para webhooks):**
```http
?apiKey=lnx_live_abc123xyz456...
```

---

## RATE LIMITING

### **Tiers**

| Tier | Rate Limit | Burst | Price |
|------|------------|-------|-------|
| **Public** | 120/min | 200 | Free |
| **Standard** | 600/min | 1000 | $49/mês |
| **Premium** | 3000/min | 5000 | $199/mês |
| **Enterprise** | Custom | Custom | Custom |

### **Headers de Resposta**

```http
X-RateLimit-Limit: 600
X-RateLimit-Remaining: 543
X-RateLimit-Reset: 1733375400
X-RateLimit-Retry-After: 32
```

---

## PUBLIC MARKET DATA API

### **1. Get All Tokens**

```http
GET /v2/public/tokens
```

**Query Parameters:**
- `page` (number): Página
- `limit` (number): Itens por página (max: 100)
- `sort` (string): `marketCap`, `volume24h`, `priceChange24h`
- `order` (string): `asc`, `desc`
- `listed` (boolean): Apenas tokens aprovados

**Response:**
```json
{
  "success": true,
  "data": {
    "tokens": [
      {
        "address": "5Fxyz...",
        "symbol": "WLUNES",
        "name": "Wrapped LUNES",
        "decimals": 8,
        "logoURI": "https://assets.lunex.io/tokens/wlunes.png",
        "price": "2.50",
        "priceChange24h": "5.2",
        "volume24h": "1500000",
        "marketCap": "50000000",
        "circulatingSupply": "20000000",
        "totalSupply": "100000000",
        "holders": 15420,
        "listed": true,
        "verified": true
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 145,
      "totalPages": 8
    },
    "timestamp": "2025-12-05T00:03:01Z"
  }
}
```

### **2. Get Token Price**

```http
GET /v2/public/price/:address
```

**Response:**
```json
{
  "success": true,
  "data": {
    "address": "5Fxyz...",
    "symbol": "WLUNES",
    "price": "2.50",
    "priceUSD": "2.50",
    "priceBTC": "0.000042",
    "priceChange1h": "0.5",
    "priceChange24h": "5.2",
    "priceChange7d": "12.8",
    "volume24h": "1500000",
    "marketCap": "50000000",
    "timestamp": "2025-12-05T00:03:01Z",
    "source": "liquidity_pool"
  }
}
```

### **3. Get Multiple Prices (Batch)**

```http
GET /v2/public/prices
```

**Query Parameters:**
- `addresses` (string): Comma-separated addresses
- `currency` (string): `USD`, `BTC`, `LUNES` (default: `USD`)

**Example:**
```http
GET /v2/public/prices?addresses=5Fxyz...,5Gdef...,5Habc...&currency=USD
```

**Response:**
```json
{
  "success": true,
  "data": {
    "prices": {
      "5Fxyz...": {
        "symbol": "WLUNES",
        "price": "2.50",
        "priceChange24h": "5.2",
        "timestamp": "2025-12-05T00:03:01Z"
      },
      "5Gdef...": {
        "symbol": "USDT",
        "price": "1.00",
        "priceChange24h": "0.05",
        "timestamp": "2025-12-05T00:03:01Z"
      }
    },
    "timestamp": "2025-12-05T00:03:01Z"
  }
}
```

### **4. Get OHLCV Data**

```http
GET /v2/public/ohlcv/:pairAddress
```

**Query Parameters:**
- `interval` (string): `1m`, `5m`, `15m`, `1h`, `4h`, `1d`, `1w`
- `from` (number): Unix timestamp start
- `to` (number): Unix timestamp end
- `limit` (number): Max candles (default: 500, max: 2000)

**Response:**
```json
{
  "success": true,
  "data": {
    "pairAddress": "5Eabc...",
    "interval": "1h",
    "candles": [
      {
        "timestamp": 1733270400,
        "open": "2.48",
        "high": "2.53",
        "low": "2.45",
        "close": "2.50",
        "volume": "150000",
        "volumeQuote": "375000",
        "trades": 342
      }
    ],
    "from": 1733270400,
    "to": 1733356800,
    "count": 24
  }
}
```

### **5. Get Market Summary**

```http
GET /v2/public/market/summary
```

**Response:**
```json
{
  "success": true,
  "data": {
    "totalMarketCap": "500000000",
    "total24hVolume": "50000000",
    "dominance": {
      "WLUNES": 45.2,
      "USDT": 30.5,
      "BTC": 15.3
    },
    "totalPairs": 145,
    "totalLiquidity": "250000000",
    "totalStaked": "100000000",
    "avgAPR": "12.5",
    "activeTraders24h": 5420,
    "timestamp": "2025-12-05T00:03:01Z"
  }
}
```

### **6. Get Trending Tokens**

```http
GET /v2/public/trending
```

**Query Parameters:**
- `period` (string): `1h`, `24h`, `7d`, `30d`
- `limit` (number): Max tokens (default: 10, max: 50)

**Response:**
```json
{
  "success": true,
  "data": {
    "trending": [
      {
        "rank": 1,
        "address": "5Fxyz...",
        "symbol": "TOKEN",
        "price": "1.25",
        "priceChange": "245.5",
        "volume24h": "5000000",
        "volumeChange": "1200.3",
        "uniqueTraders": 2150,
        "momentum": 98.5
      }
    ],
    "period": "24h",
    "timestamp": "2025-12-05T00:03:01Z"
  }
}
```

---

## TRADING AUTOMATION API

### **1. Get Optimal Route**

```http
GET /v2/trading/route
X-API-Key: lnx_live_abc123...
```

**Query Parameters:**
- `tokenIn` (string): Input token address
- `tokenOut` (string): Output token address
- `amountIn` (string): Input amount
- `maxHops` (number): Max hops (default: 3, max: 5)

**Response:**
```json
{
  "success": true,
  "data": {
    "route": [
      {
        "pairAddress": "5Epair1...",
        "tokenIn": "5Fxyz...",
        "tokenOut": "5Gmid...",
        "amountIn": "1000000000",
        "amountOut": "500000000",
        "priceImpact": "0.3",
        "fee": "3000000"
      },
      {
        "pairAddress": "5Epair2...",
        "tokenIn": "5Gmid...",
        "tokenOut": "5Gdef...",
        "amountIn": "500000000",
        "amountOut": "997000000",
        "priceImpact": "0.2",
        "fee": "1500000"
      }
    ],
    "totalAmountIn": "1000000000",
    "totalAmountOut": "997000000",
    "totalPriceImpact": "0.5",
    "totalFee": "4500000",
    "executionPrice": "0.997",
    "minimumReceived": "987000000",
    "gasEstimate": "450000000000"
  }
}
```

### **2. Execute Trade (Automated)**

```http
POST /v2/trading/swap
X-API-Key: lnx_live_abc123...
X-API-Secret: sk_abc123...
Content-Type: application/json

{
  "tokenIn": "5Fxyz...",
  "tokenOut": "5Gdef...",
  "amountIn": "1000000000",
  "slippageTolerance": 1.0,
  "deadline": 1200,
  "recipient": "5GrwvaEF...",
  "maxHops": 3
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "orderId": "ord_abc123",
    "status": "pending",
    "route": [...],
    "estimatedOutput": "997000000",
    "minimumOutput": "987000000",
    "createdAt": "2025-12-05T00:03:01Z",
    "expiresAt": "2025-12-05T00:23:01Z"
  }
}
```

### **3. Get Order Status**

```http
GET /v2/trading/order/:orderId
X-API-Key: lnx_live_abc123...
```

**Response:**
```json
{
  "success": true,
  "data": {
    "orderId": "ord_abc123",
    "status": "completed",
    "tokenIn": "5Fxyz...",
    "tokenOut": "5Gdef...",
    "amountIn": "1000000000",
    "amountOut": "995000000",
    "executionPrice": "0.995",
    "priceImpact": "0.5",
    "gasUsed": "420000000000",
    "transactionHash": "0x...",
    "blockNumber": 12500,
    "createdAt": "2025-12-05T00:03:01Z",
    "executedAt": "2025-12-05T00:03:15Z"
  }
}
```

### **4. Cancel Order**

```http
DELETE /v2/trading/order/:orderId
X-API-Key: lnx_live_abc123...
X-API-Secret: sk_abc123...
```

### **5. Get Trade History**

```http
GET /v2/trading/history
X-API-Key: lnx_live_abc123...
```

**Query Parameters:**
- `from` (number): Unix timestamp
- `to` (number): Unix timestamp
- `status` (string): `completed`, `failed`, `cancelled`
- `page` (number)
- `limit` (number)

---

## LIQUIDITY POOL API

### **1. Get All Pools**

```http
GET /v2/public/pools
```

**Query Parameters:**
- `sort` (string): `tvl`, `volume24h`, `apr`, `createdAt`
- `minTVL` (number): Minimum TVL filter
- `page`, `limit`

**Response:**
```json
{
  "success": true,
  "data": {
    "pools": [
      {
        "address": "5Epair...",
        "token0": {
          "address": "5Fxyz...",
          "symbol": "WLUNES",
          "reserve": "1000000000000"
        },
        "token1": {
          "address": "5Gdef...",
          "symbol": "USDT",
          "reserve": "500000000000"
        },
        "tvl": "2500000",
        "volume24h": "150000",
        "volume7d": "800000",
        "fees24h": "450",
        "apr": "25.5",
        "totalSupply": "707106781187",
        "priceToken0": "2.50",
        "priceToken1": "0.40"
      }
    ],
    "pagination": {...}
  }
}
```

### **2. Get Pool Details**

```http
GET /v2/public/pool/:address
```

**Response:**
```json
{
  "success": true,
  "data": {
    "address": "5Epair...",
    "token0": {...},
    "token1": {...},
    "reserves": {
      "reserve0": "1000000000000",
      "reserve1": "500000000000",
      "blockTimestampLast": 1733356800
    },
    "metrics": {
      "tvl": "2500000",
      "volume24h": "150000",
      "fees24h": "450",
      "transactions24h": 342,
      "uniqueTraders24h": 120,
      "apr": "25.5"
    },
    "lpToken": {
      "totalSupply": "707106781187",
      "holders": 45
    }
  }
}
```

### **3. Add Liquidity (Automated)**

```http
POST /v2/liquidity/add
X-API-Key: lnx_live_abc123...
X-API-Secret: sk_abc123...
Content-Type: application/json

{
  "tokenA": "5Fxyz...",
  "tokenB": "5Gdef...",
  "amountA": "1000000000",
  "amountB": "500000000",
  "slippageTolerance": 1.0,
  "deadline": 1200,
  "recipient": "5GrwvaEF..."
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "orderId": "liq_add_abc123",
    "status": "pending",
    "pairAddress": "5Epair...",
    "amountA": "1000000000",
    "amountB": "500000000",
    "estimatedLiquidity": "707106781",
    "shareOfPool": "0.1",
    "createdAt": "2025-12-05T00:03:01Z"
  }
}
```

### **4. Remove Liquidity (Automated)**

```http
POST /v2/liquidity/remove
X-API-Key: lnx_live_abc123...
X-API-Secret: sk_abc123...
Content-Type: application/json

{
  "pairAddress": "5Epair...",
  "liquidity": "707106781",
  "slippageTolerance": 1.0,
  "deadline": 1200,
  "recipient": "5GrwvaEF..."
}
```

### **5. Get LP Position**

```http
GET /v2/liquidity/position/:pairAddress/:owner
X-API-Key: lnx_live_abc123...
```

**Response:**
```json
{
  "success": true,
  "data": {
    "pairAddress": "5Epair...",
    "owner": "5GrwvaEF...",
    "lpBalance": "707106781",
    "shareOfPool": "0.1",
    "token0Amount": "1000000000",
    "token1Amount": "500000000",
    "valueUSD": "2500",
    "unclaimedFees": {
      "token0": "500000",
      "token1": "250000",
      "valueUSD": "1.25"
    },
    "impermanentLoss": "0.5"
  }
}
```

---

## STAKING AUTOMATION API

### **1. Get Staking Tiers**

```http
GET /v2/public/staking/tiers
```

**Response:**
```json
{
  "success": true,
  "data": {
    "tiers": [
      {
        "name": "Bronze",
        "minAmount": "0",
        "minDuration": 604800,
        "apr": "8.0",
        "votingPowerMultiplier": 1.0,
        "earlyWithdrawalPenalty": "10"
      },
      {
        "name": "Silver",
        "minAmount": "10000000000000",
        "minDuration": 2592000,
        "apr": "10.0",
        "votingPowerMultiplier": 1.2,
        "earlyWithdrawalPenalty": "8"
      },
      {
        "name": "Gold",
        "minAmount": "50000000000000",
        "minDuration": 7776000,
        "apr": "12.0",
        "votingPowerMultiplier": 1.5,
        "earlyWithdrawalPenalty": "5"
      },
      {
        "name": "Platinum",
        "minAmount": "200000000000000",
        "minDuration": 15552000,
        "apr": "15.0",
        "votingPowerMultiplier": 2.0,
        "earlyWithdrawalPenalty": "0"
      }
    ]
  }
}
```

### **2. Stake Tokens (Automated)**

```http
POST /v2/staking/stake
X-API-Key: lnx_live_abc123...
X-API-Secret: sk_abc123...
Content-Type: application/json

{
  "amount": "10000000000000",
  "duration": 2592000,
  "autoRenew": true,
  "autoCompound": true
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "stakeId": "stake_abc123",
    "status": "pending",
    "amount": "10000000000000",
    "duration": 2592000,
    "tier": "Silver",
    "estimatedAPR": "10.0",
    "estimatedRewards": "800000000000",
    "maturityDate": "2026-01-05T00:03:01Z",
    "autoRenew": true,
    "autoCompound": true,
    "createdAt": "2025-12-05T00:03:01Z"
  }
}
```

### **3. Get Staking Position**

```http
GET /v2/staking/position
X-API-Key: lnx_live_abc123...
```

**Response:**
```json
{
  "success": true,
  "data": {
    "totalStaked": "10000000000000",
    "tier": "Silver",
    "votingPower": "12000000000000",
    "pendingRewards": "200000000000",
    "claimedRewards": "600000000000",
    "apr": "10.0",
    "positions": [
      {
        "stakeId": "stake_abc123",
        "amount": "10000000000000",
        "startTime": 1733356800,
        "maturityTime": 1735948800,
        "tier": "Silver",
        "active": true,
        "autoRenew": true,
        "autoCompound": true
      }
    ]
  }
}
```

### **4. Claim Rewards (Automated)**

```http
POST /v2/staking/claim
X-API-Key: lnx_live_abc123...
X-API-Secret: sk_abc123...
Content-Type: application/json

{
  "stakeIds": ["stake_abc123"],
  "reinvest": true
}
```

### **5. Get Staking Stats**

```http
GET /v2/public/staking/stats
```

**Response:**
```json
{
  "success": true,
  "data": {
    "totalStaked": "100000000000000",
    "totalStakers": 5420,
    "averageAPR": "10.5",
    "totalRewardsDistributed": "5000000000000",
    "tierDistribution": {
      "Bronze": 3200,
      "Silver": 1500,
      "Gold": 600,
      "Platinum": 120
    },
    "averageStakeDuration": 5184000
  }
}
```

---

## DECIMAL UTILITIES API

> ⚠️ **IMPORTANTE**: Tokens podem ter diferentes casas decimais (0-18).
> Use estes endpoints para garantir operações seguras.

### **Decimais Comuns**

| Token | Decimais | 1 Token |
|-------|----------|---------|
| LUNES | 8 | `100000000` |
| USDT/USDC | 6 | `1000000` |
| ETH/DAI | 18 | `1000000000000000000` |
| BTC | 8 | `100000000` |
| SOL | 9 | `1000000000` |

### **1. Get Token Decimals**

```http
GET /v2/public/token/:address/decimals
```

**Response:**
```json
{
  "success": true,
  "data": {
    "address": "5Fxyz...",
    "symbol": "WLUNES",
    "decimals": 8,
    "name": "Wrapped LUNES"
  }
}
```

### **2. Convert Amount Between Decimals**

```http
POST /v2/utils/convert-decimals
Content-Type: application/json

{
  "amount": "100000000",
  "fromDecimals": 6,
  "toDecimals": 8
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "originalAmount": "100000000",
    "convertedAmount": "10000000000",
    "fromDecimals": 6,
    "toDecimals": 8,
    "precisionLoss": false
  }
}
```

**Error Response (precision loss):**
```json
{
  "success": false,
  "error": {
    "code": "PRECISION_LOSS",
    "message": "Conversion would lose precision. Use rounded endpoint for display.",
    "details": {
      "lostDigits": "01",
      "originalAmount": "10000000001"
    }
  }
}
```

### **3. Normalize Pair Amounts**

```http
POST /v2/utils/normalize-amounts
Content-Type: application/json

{
  "tokenA": {
    "address": "5Fxyz...",
    "amount": "10000000000"
  },
  "tokenB": {
    "address": "5Gdef...",
    "amount": "50000000"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "tokenA": {
      "address": "5Fxyz...",
      "symbol": "WLUNES",
      "originalAmount": "10000000000",
      "normalizedAmount": "10000000000",
      "decimals": 8
    },
    "tokenB": {
      "address": "5Gdef...",
      "symbol": "USDT",
      "originalAmount": "50000000",
      "normalizedAmount": "5000000000",
      "decimals": 6
    },
    "targetDecimals": 8,
    "exchangeRate": "0.5"
  }
}
```

### **4. Validate Swap Decimals**

```http
POST /v2/utils/validate-swap
Content-Type: application/json

{
  "tokenIn": "5Fxyz...",
  "tokenOut": "5Gdef...",
  "amountIn": "1000000000",
  "amountOut": "500000"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "valid": true,
    "warnings": [],
    "tokenIn": {
      "decimals": 8,
      "formattedAmount": "10"
    },
    "tokenOut": {
      "decimals": 6,
      "formattedAmount": "0.5"
    }
  }
}
```

**Warning Response:**
```json
{
  "success": true,
  "data": {
    "valid": true,
    "warnings": [
      "Large decimal difference (12) - verify amounts carefully",
      "Output token has low decimals (2) - small amounts may be truncated"
    ]
  }
}
```

### **5. Format Amount for Display**

```http
GET /v2/utils/format-amount
```

**Query Parameters:**
- `amount` (string): Raw amount
- `decimals` (number): Token decimals
- `maxDisplay` (number): Max decimal places to show (optional)

**Example:**
```http
GET /v2/utils/format-amount?amount=12345678900&decimals=8&maxDisplay=4
```

**Response:**
```json
{
  "success": true,
  "data": {
    "raw": "12345678900",
    "formatted": "123.4567",
    "fullPrecision": "123.456789",
    "decimals": 8,
    "maxDisplay": 4
  }
}
```

### **6. Parse User Input**

```http
POST /v2/utils/parse-amount
Content-Type: application/json

{
  "input": "123.456789",
  "decimals": 8
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "input": "123.456789",
    "parsed": "12345678900",
    "decimals": 8,
    "valid": true
  }
}
```

**Error Response (too many decimals):**
```json
{
  "success": false,
  "error": {
    "code": "PRECISION_LOSS",
    "message": "Input has 10 decimal places, but token only supports 8",
    "maxDecimals": 8,
    "inputDecimals": 10
  }
}
```

---

## TOKEN LISTING API

### **1. Check Token Approval Status**

```http
GET /v2/public/token/:address/status
```

**Response:**
```json
{
  "success": true,
  "data": {
    "address": "5Gtoken...",
    "symbol": "TOKEN",
    "name": "Token Name",
    "approved": true,
    "listedAt": "2025-12-01T10:00:00Z",
    "method": "governance",
    "proposalId": 15,
    "verification": {
      "verified": true,
      "contract": "PSP22",
      "audit": true,
      "auditBy": "CertiK",
      "auditDate": "2025-11-15"
    }
  }
}
```

### **2. Get Listing Requirements**

```http
GET /v2/public/listing/requirements
```

**Response:**
```json
{
  "success": true,
  "data": {
    "methods": {
      "governance": {
        "proposalFee": "100000000000000",
        "minVotingPower": "10000000000000",
        "votingDuration": 1209600,
        "approvalThreshold": "50"
      },
      "admin": {
        "available": true,
        "criteria": [
          "Strategic partnership",
          "Significant liquidity commitment",
          "Verified audit"
        ]
      }
    },
    "requirements": {
      "psp22Compliance": true,
      "minLiquidity": "10000000000",
      "contractVerified": true,
      "auditRecommended": true
    }
  }
}
```

### **3. Submit Listing Proposal**

```http
POST /v2/listing/propose
X-API-Key: lnx_live_abc123...
X-API-Secret: sk_abc123...
Content-Type: application/json

{
  "tokenAddress": "5Gtoken...",
  "name": "List TOKEN XYZ",
  "description": "Proposal to list TOKEN XYZ on Lunex DEX...",
  "documentation": {
    "website": "https://token.xyz",
    "whitepaper": "https://token.xyz/whitepaper.pdf",
    "audit": "https://certik.com/projects/token",
    "github": "https://github.com/token-xyz"
  },
  "liquidity": {
    "commit": "50000000000",
    "duration": 7776000
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "proposalId": 20,
    "status": "pending",
    "votingDeadline": "2025-12-19T00:03:01Z",
    "fee": "100000000000000",
    "feeTransaction": "0x...",
    "createdAt": "2025-12-05T00:03:01Z"
  }
}
```

### **4. Get All Proposals**

```http
GET /v2/public/listing/proposals
```

**Query Parameters:**
- `status` (string): `active`, `approved`, `rejected`, `executed`
- `sort` (string): `votesFor`, `votesAgainst`, `createdAt`
- `page`, `limit`

---

## WEBHOOKS & NOTIFICATIONS

### **1. Register Webhook**

```http
POST /v2/webhooks
X-API-Key: lnx_live_abc123...
X-API-Secret: sk_abc123...
Content-Type: application/json

{
  "url": "https://your-server.com/webhooks/lunex",
  "events": [
    "trade.completed",
    "liquidity.added",
    "liquidity.removed",
    "stake.completed",
    "proposal.created",
    "proposal.executed",
    "price.alert"
  ],
  "filters": {
    "tokens": ["5Fxyz...", "5Gdef..."],
    "minValue": "1000000"
  },
  "secret": "whsec_abc123..."
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "webhookId": "wh_abc123",
    "url": "https://your-server.com/webhooks/lunex",
    "events": [...],
    "status": "active",
    "createdAt": "2025-12-05T00:03:01Z"
  }
}
```

### **2. Webhook Payload Example**

```json
{
  "id": "evt_abc123",
  "type": "trade.completed",
  "data": {
    "orderId": "ord_xyz456",
    "trader": "5GrwvaEF...",
    "tokenIn": "5Fxyz...",
    "tokenOut": "5Gdef...",
    "amountIn": "1000000000",
    "amountOut": "995000000",
    "priceImpact": "0.5",
    "transactionHash": "0x...",
    "blockNumber": 12500
  },
  "timestamp": "2025-12-05T00:03:15Z",
  "signature": "sha256=abc123..."
}
```

### **3. Verify Webhook Signature**

```javascript
const crypto = require('crypto');

function verifyWebhook(payload, signature, secret) {
  const hash = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
  
  return `sha256=${hash}` === signature;
}
```

---

## SECURITY BEST PRACTICES

### **1. API Key Management**

✅ **DO:**
- Rotate API keys periodically (90 days)
- Use different keys for prod/staging
- Store keys in environment variables
- Use IP whitelist
- Set appropriate scopes
- Monitor usage

❌ **DON'T:**
- Commit keys to git
- Share keys between services
- Use keys in client-side code
- Give excessive permissions

### **2. Rate Limiting Strategies**

```javascript
// Implement exponential backoff
async function makeRequestWithRetry(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (error.statusCode === 429) {
        const retryAfter = error.headers['x-ratelimit-retry-after'];
        await sleep(retryAfter * 1000 * Math.pow(2, i));
      } else {
        throw error;
      }
    }
  }
}
```

### **3. IP Whitelist**

```json
{
  "ipWhitelist": [
    "203.0.113.0/24",
    "198.51.100.42"
  ]
}
```

### **4. Request Signing**

```javascript
const crypto = require('crypto');

function signRequest(method, path, body, secret) {
  const timestamp = Date.now();
  const message = `${timestamp}.${method}.${path}.${JSON.stringify(body)}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('hex');
  
  return {
    'X-Timestamp': timestamp,
    'X-Signature': signature
  };
}
```

### **5. CORS Configuration**

```http
Access-Control-Allow-Origin: https://your-domain.com
Access-Control-Allow-Methods: GET, POST, PUT, DELETE
Access-Control-Allow-Headers: X-API-Key, Content-Type
Access-Control-Max-Age: 3600
```

---

## ERROR CODES ESPECÍFICOS

| Code | Message | HTTP | Description |
|------|---------|------|-------------|
| `API_001` | Invalid API Key | 401 | Key inválida ou expirada |
| `API_002` | Insufficient permissions | 403 | Scope insuficiente |
| `API_003` | IP not whitelisted | 403 | IP não autorizado |
| `RATE_001` | Rate limit exceeded | 429 | Limite de requests |
| `TRADE_001` | Insufficient liquidity | 400 | Liquidez insuficiente |
| `TRADE_002` | Price slippage too high | 400 | Slippage excedido |
| `STAKE_001` | Below minimum amount | 400 | Valor mínimo não atingido |
| `STAKE_002` | Invalid duration | 400 | Duração inválida |
| `LIST_001` | Token already listed | 409 | Token já listado |
| `LIST_002` | Insufficient fee | 400 | Taxa insuficiente |
| `WEBHOOK_001` | Invalid URL | 400 | URL de webhook inválida |
| `WEBHOOK_002` | Delivery failed | 500 | Falha ao entregar webhook |

---

## APPENDIX: CODE EXAMPLES

### **Python Trading Bot**

```python
import requests
import time

class LunexTradingBot:
    def __init__(self, api_key, api_secret):
        self.api_key = api_key
        self.api_secret = api_secret
        self.base_url = "https://api.lunex.io/v2"
    
    def get_price(self, token_address):
        response = requests.get(
            f"{self.base_url}/public/price/{token_address}"
        )
        return response.json()['data']['price']
    
    def execute_trade(self, token_in, token_out, amount_in):
        headers = {
            'X-API-Key': self.api_key,
            'X-API-Secret': self.api_secret
        }
        
        payload = {
            'tokenIn': token_in,
            'tokenOut': token_out,
            'amountIn': amount_in,
            'slippageTolerance': 1.0,
            'deadline': 1200
        }
        
        response = requests.post(
            f"{self.base_url}/trading/swap",
            headers=headers,
            json=payload
        )
        
        return response.json()['data']

# Usage
bot = LunexTradingBot('lnx_live_abc...', 'sk_abc...')
price = bot.get_price('5Fxyz...')
if float(price) < 2.0:  # Buy if price below $2
    result = bot.execute_trade('5USDT...', '5Fxyz...', '1000000000')
    print(f"Trade executed: {result['orderId']}")
```

---

**FIM DA ESPECIFICAÇÃO DE API PÚBLICA V2.0**

Esta API fornece todos os endpoints necessários para automação completa de trading, staking, liquidez e listagem de tokens com segurança robusta.
