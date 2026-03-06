# 🌐 LUNEX DEX - API SPECIFICATION

**Versão:** 1.0.0  
**Data:** 04 de Dezembro de 2025  
**Backend:** Node.js + Polkadot.js  
**Blockchain:** Lunes Network (Substrate)  
**Contratos:** ink! 4.2.1

---

## 📋 ÍNDICE

1. [Arquitetura Geral](#arquitetura-geral)
2. [Autenticação](#autenticação)
3. [Factory API](#factory-api)
4. [Router API](#router-api)
5. [Pair API](#pair-api)
6. [WNative API](#wnative-api)
7. [Staking API](#staking-api)
8. [Trading Rewards API](#trading-rewards-api)
9. [WebSocket Events](#websocket-events)
10. [Error Handling](#error-handling)
11. [Rate Limiting](#rate-limiting)
12. [Exemplos de Integração](#exemplos-de-integração)

---

## ARQUITETURA GERAL

### **Stack Tecnológico**

```
┌─────────────────────────────────────────────────┐
│              FRONTEND (React/Vue)               │
│         Polkadot.js Extension Integration       │
└─────────────────┬───────────────────────────────┘
                  │ HTTP/WebSocket
┌─────────────────▼───────────────────────────────┐
│           API BACKEND (Node.js)                 │
│  - Express.js REST API                          │
│  - Socket.IO WebSocket                          │
│  - Redis Cache                                  │
│  - PostgreSQL Database (indexing)               │
└─────────────────┬───────────────────────────────┘
                  │ @polkadot/api
┌─────────────────▼───────────────────────────────┐
│         LUNES BLOCKCHAIN (Substrate)            │
│  - Factory Contract                             │
│  - Router Contract                              │
│  - Pair Contracts                               │
│  - WNative Contract                             │
│  - Staking Contract                             │
│  - Trading Rewards Contract                     │
└─────────────────────────────────────────────────┘
```

### **Base URL**

```
Production:  https://api.lunex.io/v1
Testnet:     https://api-testnet.lunex.io/v1
Local:       http://localhost:3000/v1
```

### **Response Format**

**Success:**
```json
{
  "success": true,
  "data": { ... },
  "timestamp": "2025-12-04T23:50:08Z",
  "requestId": "uuid-v4"
}
```

**Error:**
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "details": { ... }
  },
  "timestamp": "2025-12-04T23:50:08Z",
  "requestId": "uuid-v4"
}
```

---

## AUTENTICAÇÃO

### **Método: Wallet Signature**

```http
POST /auth/nonce
Content-Type: application/json

{
  "address": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "nonce": "sign-this-nonce-abc123xyz",
    "expiresIn": 300
  }
}
```

### **Sign & Authenticate**

```http
POST /auth/login
Content-Type: application/json

{
  "address": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
  "signature": "0x...",
  "nonce": "sign-this-nonce-abc123xyz"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 86400,
    "refreshToken": "refresh-token-xyz"
  }
}
```

### **Headers para Requests Autenticados**

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## FACTORY API

### **1. Get All Pairs**

```http
GET /factory/pairs
```

**Query Parameters:**
- `page` (number): Página (default: 1)
- `limit` (number): Itens por página (default: 20, max: 100)
- `sort` (string): Campo de ordenação (`createdAt`, `volume`, `liquidity`)
- `order` (string): Direção (`asc`, `desc`)

**Response:**
```json
{
  "success": true,
  "data": {
    "pairs": [
      {
        "address": "5Eabc123...",
        "token0": {
          "address": "5Fxyz456...",
          "symbol": "WLUNES",
          "name": "Wrapped LUNES",
          "decimals": 8
        },
        "token1": {
          "address": "5Gdef789...",
          "symbol": "USDT",
          "name": "Tether USD",
          "decimals": 6
        },
        "reserve0": "1000000000000",
        "reserve1": "500000000000",
        "totalSupply": "707106781187",
        "createdAt": "2025-12-01T10:00:00Z",
        "volume24h": "10000000000",
        "volume7d": "50000000000",
        "fees24h": "5000000",
        "tvl": "1500000000000"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 45,
      "totalPages": 3
    }
  }
}
```

### **2. Get Pair by Tokens**

```http
GET /factory/pair/:tokenA/:tokenB
```

**Example:**
```http
GET /factory/pair/5Fxyz456.../5Gdef789...
```

**Response:**
```json
{
  "success": true,
  "data": {
    "address": "5Eabc123...",
    "token0": { ... },
    "token1": { ... },
    "reserve0": "1000000000000",
    "reserve1": "500000000000",
    "price0": "0.5",
    "price1": "2.0",
    "totalSupply": "707106781187",
    "createdAt": "2025-12-01T10:00:00Z"
  }
}
```

### **3. Create Pair**

```http
POST /factory/pair
Authorization: Bearer <token>
Content-Type: application/json

{
  "tokenA": "5Fxyz456...",
  "tokenB": "5Gdef789...",
  "gasLimit": "300000000000",
  "storageDeposit": "1000000000"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "pairAddress": "5Eabc123...",
    "transactionHash": "0x...",
    "blockNumber": 12345,
    "gasUsed": "250000000000",
    "status": "success"
  }
}
```

### **4. Get Factory Stats**

```http
GET /factory/stats
```

**Response:**
```json
{
  "success": true,
  "data": {
    "totalPairs": 45,
    "totalVolume24h": "1000000000000",
    "totalVolume7d": "5000000000000",
    "totalLiquidity": "50000000000000",
    "totalFees24h": "50000000000",
    "feeTo": "5Gabcd...",
    "feeToSetter": "5Hxyz..."
  }
}
```

---

## ROUTER API

### **1. Get Quote (Read-Only)**

```http
GET /router/quote
```

**Query Parameters:**
- `amountIn` (string): Amount de entrada
- `path` (string[]): Array de endereços de tokens (JSON encoded)

**Example:**
```http
GET /router/quote?amountIn=1000000000&path=["5Fxyz...","5Gdef..."]
```

**Response:**
```json
{
  "success": true,
  "data": {
    "amountIn": "1000000000",
    "amountOut": "997000000",
    "path": ["5Fxyz...", "5Gdef..."],
    "priceImpact": "0.3",
    "minimumReceived": "987030000",
    "fee": "3000000",
    "route": [
      {
        "pair": "5Eabc123...",
        "tokenIn": "5Fxyz...",
        "tokenOut": "5Gdef...",
        "amountIn": "1000000000",
        "amountOut": "997000000"
      }
    ]
  }
}
```

### **2. Add Liquidity**

```http
POST /router/add-liquidity
Authorization: Bearer <token>
Content-Type: application/json

{
  "tokenA": "5Fxyz456...",
  "tokenB": "5Gdef789...",
  "amountADesired": "1000000000",
  "amountBDesired": "500000000",
  "amountAMin": "950000000",
  "amountBMin": "475000000",
  "to": "5GrwvaEF...",
  "deadline": 1733359808,
  "gasLimit": "500000000000"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "amountA": "1000000000",
    "amountB": "500000000",
    "liquidity": "707106781",
    "transactionHash": "0x...",
    "blockNumber": 12346,
    "gasUsed": "450000000000",
    "events": [
      {
        "name": "LiquidityAdded",
        "data": { ... }
      }
    ]
  }
}
```

### **3. Remove Liquidity**

```http
POST /router/remove-liquidity
Authorization: Bearer <token>
Content-Type: application/json

{
  "tokenA": "5Fxyz456...",
  "tokenB": "5Gdef789...",
  "liquidity": "707106781",
  "amountAMin": "950000000",
  "amountBMin": "475000000",
  "to": "5GrwvaEF...",
  "deadline": 1733359808,
  "gasLimit": "500000000000"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "amountA": "1000000000",
    "amountB": "500000000",
    "transactionHash": "0x...",
    "blockNumber": 12347,
    "gasUsed": "420000000000"
  }
}
```

### **4. Swap Exact Tokens For Tokens**

```http
POST /router/swap-exact-in
Authorization: Bearer <token>
Content-Type: application/json

{
  "amountIn": "1000000000",
  "amountOutMin": "987030000",
  "path": ["5Fxyz...", "5Gdef..."],
  "to": "5GrwvaEF...",
  "deadline": 1733359808,
  "gasLimit": "500000000000"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "amountIn": "1000000000",
    "amountOut": "995000000",
    "path": ["5Fxyz...", "5Gdef..."],
    "transactionHash": "0x...",
    "blockNumber": 12348,
    "gasUsed": "380000000000",
    "priceImpact": "0.5",
    "executionPrice": "0.995"
  }
}
```

### **5. Swap Tokens For Exact Tokens**

```http
POST /router/swap-exact-out
Authorization: Bearer <token>
Content-Type: application/json

{
  "amountOut": "1000000000",
  "amountInMax": "1013000000",
  "path": ["5Fxyz...", "5Gdef..."],
  "to": "5GrwvaEF...",
  "deadline": 1733359808,
  "gasLimit": "500000000000"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "amountIn": "1005000000",
    "amountOut": "1000000000",
    "path": ["5Fxyz...", "5Gdef..."],
    "transactionHash": "0x...",
    "blockNumber": 12349,
    "gasUsed": "380000000000"
  }
}
```

---

## PAIR API

### **1. Get Pair Info**

```http
GET /pair/:address
```

**Response:**
```json
{
  "success": true,
  "data": {
    "address": "5Eabc123...",
    "token0": {
      "address": "5Fxyz...",
      "symbol": "WLUNES",
      "name": "Wrapped LUNES",
      "decimals": 8,
      "logoURI": "https://..."
    },
    "token1": {
      "address": "5Gdef...",
      "symbol": "USDT",
      "name": "Tether USD",
      "decimals": 6,
      "logoURI": "https://..."
    },
    "reserve0": "1000000000000",
    "reserve1": "500000000000",
    "totalSupply": "707106781187",
    "price0": "0.5",
    "price1": "2.0",
    "fee": "0.003",
    "volume24h": "10000000000",
    "volume7d": "50000000000",
    "fees24h": "30000000",
    "tvl": "1500000000000",
    "apr": "25.5"
  }
}
```

### **2. Get Pair Reserves**

```http
GET /pair/:address/reserves
```

**Response:**
```json
{
  "success": true,
  "data": {
    "reserve0": "1000000000000",
    "reserve1": "500000000000",
    "blockTimestampLast": 1733359808,
    "price0CumulativeLast": "123456789",
    "price1CumulativeLast": "987654321"
  }
}
```

### **3. Get Historical Data**

```http
GET /pair/:address/history
```

**Query Parameters:**
- `interval` (string): `1h`, `4h`, `1d`, `1w`
- `from` (number): Unix timestamp
- `to` (number): Unix timestamp

**Response:**
```json
{
  "success": true,
  "data": {
    "candles": [
      {
        "timestamp": 1733356208,
        "open": "2.0",
        "high": "2.05",
        "low": "1.98",
        "close": "2.02",
        "volume": "1000000000",
        "liquidity": "1500000000000"
      }
    ]
  }
}
```

### **4. Get LP Token Balance**

```http
GET /pair/:address/balance/:owner
```

**Response:**
```json
{
  "success": true,
  "data": {
    "balance": "707106781",
    "totalSupply": "707106781187",
    "share": "0.001",
    "token0Amount": "1000000",
    "token1Amount": "500000",
    "value": "1500000"
  }
}
```

---

## WNATIVE API

### **1. Wrap LUNES**

```http
POST /wnative/deposit
Authorization: Bearer <token>
Content-Type: application/json

{
  "amount": "1000000000",
  "gasLimit": "200000000000"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "amount": "1000000000",
    "wlunes": "1000000000",
    "transactionHash": "0x...",
    "blockNumber": 12350,
    "gasUsed": "150000000000"
  }
}
```

### **2. Unwrap WLUNES**

```http
POST /wnative/withdraw
Authorization: Bearer <token>
Content-Type: application/json

{
  "amount": "1000000000",
  "gasLimit": "200000000000"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "amount": "1000000000",
    "lunes": "1000000000",
    "transactionHash": "0x...",
    "blockNumber": 12351,
    "gasUsed": "150000000000"
  }
}
```

### **3. Get WLUNES Info**

```http
GET /wnative/info
```

**Response:**
```json
{
  "success": true,
  "data": {
    "address": "5Hwnative...",
    "name": "Wrapped LUNES",
    "symbol": "WLUNES",
    "decimals": 8,
    "totalSupply": "1000000000000",
    "nativeBalance": "1000000000000",
    "isHealthy": true
  }
}
```

### **4. Get Balance**

```http
GET /wnative/balance/:address
```

**Response:**
```json
{
  "success": true,
  "data": {
    "wlunesBalance": "500000000",
    "lunesBalance": "1000000000",
    "totalValue": "1500000000"
  }
}
```

---

## STAKING API

### **1. Stake LUNES**

```http
POST /staking/stake
Authorization: Bearer <token>
Content-Type: application/json

{
  "amount": "10000000000",
  "duration": 604800,
  "gasLimit": "300000000000"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "amount": "10000000000",
    "duration": 604800,
    "tier": "Bronze",
    "estimatedRewards": "800000000",
    "apr": "8.0",
    "transactionHash": "0x...",
    "blockNumber": 12352
  }
}
```

### **2. Unstake**

```http
POST /staking/unstake
Authorization: Bearer <token>
Content-Type: application/json

{
  "gasLimit": "300000000000"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "amount": "10000000000",
    "rewards": "800000000",
    "penalty": "0",
    "totalReceived": "10800000000",
    "transactionHash": "0x...",
    "blockNumber": 12353
  }
}
```

### **3. Claim Rewards**

```http
POST /staking/claim
Authorization: Bearer <token>
Content-Type: application/json

{
  "gasLimit": "200000000000"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "rewards": "800000000",
    "transactionHash": "0x...",
    "blockNumber": 12354
  }
}
```

### **4. Get Staking Position**

```http
GET /staking/position/:address
```

**Response:**
```json
{
  "success": true,
  "data": {
    "amount": "10000000000",
    "startTime": 1733270400,
    "duration": 604800,
    "endTime": 1733875200,
    "tier": "Bronze",
    "pendingRewards": "200000000",
    "claimedRewards": "600000000",
    "votingPower": "10000000000",
    "active": true,
    "earlyAdopterTier": "Top1000"
  }
}
```

### **5. Get Staking Stats**

```http
GET /staking/stats
```

**Response:**
```json
{
  "success": true,
  "data": {
    "totalStaked": "1000000000000",
    "totalRewardsDistributed": "50000000000",
    "activeStakers": 1500,
    "averageAPR": "10.5",
    "tierDistribution": {
      "Bronze": 800,
      "Silver": 450,
      "Gold": 200,
      "Platinum": 50
    }
  }
}
```

### **6. Create Proposal**

```http
POST /staking/proposal
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "List TOKEN XYZ",
  "description": "Proposal to list TOKEN XYZ on Lunex DEX",
  "tokenAddress": "5Gtoken...",
  "fee": "100000000000",
  "gasLimit": "400000000000"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "proposalId": 15,
    "votingDeadline": 1734465808,
    "transactionHash": "0x...",
    "blockNumber": 12355
  }
}
```

### **7. Vote on Proposal**

```http
POST /staking/vote
Authorization: Bearer <token>
Content-Type: application/json

{
  "proposalId": 15,
  "inFavor": true,
  "gasLimit": "200000000000"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "proposalId": 15,
    "votePower": "10000000000",
    "inFavor": true,
    "transactionHash": "0x...",
    "blockNumber": 12356
  }
}
```

### **8. Execute Proposal**

```http
POST /staking/proposal/:id/execute
Authorization: Bearer <token>
Content-Type: application/json

{
  "gasLimit": "300000000000"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "proposalId": 15,
    "approved": true,
    "votesFor": "500000000000",
    "votesAgainst": "100000000000",
    "executed": true,
    "transactionHash": "0x...",
    "blockNumber": 12357
  }
}
```

### **9. Get All Proposals**

```http
GET /staking/proposals
```

**Query Parameters:**
- `status` (string): `active`, `executed`, `all`
- `page` (number)
- `limit` (number)

**Response:**
```json
{
  "success": true,
  "data": {
    "proposals": [
      {
        "id": 15,
        "name": "List TOKEN XYZ",
        "description": "Proposal to list...",
        "tokenAddress": "5Gtoken...",
        "proposer": "5GrwvaEF...",
        "votesFor": "500000000000",
        "votesAgainst": "100000000000",
        "votingDeadline": 1734465808,
        "executed": false,
        "active": true,
        "createdAt": "2025-12-04T10:00:00Z"
      }
    ],
    "pagination": { ... }
  }
}
```

### **10. Get Proposal Details**

```http
GET /staking/proposal/:id
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 15,
    "name": "List TOKEN XYZ",
    "description": "Proposal to list TOKEN XYZ on Lunex DEX",
    "tokenAddress": "5Gtoken...",
    "proposer": "5GrwvaEF...",
    "votesFor": "500000000000",
    "votesAgainst": "100000000000",
    "votingDeadline": 1734465808,
    "executed": false,
    "active": true,
    "fee": "100000000000",
    "feeRefunded": false,
    "voters": [
      {
        "address": "5GrwvaEF...",
        "votePower": "10000000000",
        "inFavor": true,
        "timestamp": "2025-12-04T11:00:00Z"
      }
    ],
    "createdAt": "2025-12-04T10:00:00Z"
  }
}
```

### **11. Admin List Token**

```http
POST /staking/admin/list-token
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "tokenAddress": "5Gtoken...",
  "reason": "Initial listing - Strategic partner",
  "gasLimit": "200000000000"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "tokenAddress": "5Gtoken...",
    "reason": "Initial listing - Strategic partner",
    "transactionHash": "0x...",
    "blockNumber": 12358
  }
}
```

### **12. Check if Token is Approved**

```http
GET /staking/token/:address/approved
```

**Response:**
```json
{
  "success": true,
  "data": {
    "tokenAddress": "5Gtoken...",
    "approved": true,
    "approvedAt": "2025-12-04T10:00:00Z",
    "method": "governance"
  }
}
```

---

## TRADING REWARDS API

### **1. Get Trading Position**

```http
GET /rewards/position/:address
```

**Response:**
```json
{
  "success": true,
  "data": {
    "totalVolume": "1000000000000",
    "monthlyVolume": "50000000000",
    "dailyVolume": "5000000000",
    "tier": "Gold",
    "multiplier": "1.5",
    "pendingRewards": "500000000",
    "claimedRewards": "2000000000",
    "tradeCount": 150,
    "lastTrade": "2025-12-04T20:00:00Z",
    "nextTierRequirement": "200000000000",
    "nextTierMultiplier": "2.0"
  }
}
```

### **2. Claim Trading Rewards**

```http
POST /rewards/claim
Authorization: Bearer <token>
Content-Type: application/json

{
  "gasLimit": "200000000000"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "amount": "500000000",
    "transactionHash": "0x...",
    "blockNumber": 12359
  }
}
```

### **3. Get Rewards Stats**

```http
GET /rewards/stats
```

**Response:**
```json
{
  "success": true,
  "data": {
    "rewardsPool": "10000000000000",
    "activeTraders": 5000,
    "totalDistributed": "50000000000000",
    "averageAPR": "15.5",
    "tierDistribution": {
      "Bronze": 3000,
      "Silver": 1500,
      "Gold": 400,
      "Platinum": 100
    }
  }
}
```

### **4. Get Leaderboard**

```http
GET /rewards/leaderboard
```

**Query Parameters:**
- `period` (string): `daily`, `weekly`, `monthly`, `all-time`
- `limit` (number): Default 100

**Response:**
```json
{
  "success": true,
  "data": {
    "period": "monthly",
    "leaderboard": [
      {
        "rank": 1,
        "address": "5GrwvaEF...",
        "volume": "100000000000",
        "tier": "Platinum",
        "rewards": "5000000000",
        "trades": 500
      }
    ]
  }
}
```

### **5. Get Current Epoch**

```http
GET /rewards/epoch/current
```

**Response:**
```json
{
  "success": true,
  "data": {
    "epochId": 12,
    "startTime": 1733270400,
    "endTime": 1733875200,
    "duration": 604800,
    "totalRewards": "10000000000",
    "activeTraders": 5000,
    "daysRemaining": 5
  }
}
```

### **6. Get Antifraud Parameters**

```http
GET /rewards/antifraud/parameters
```

**Response:**
```json
{
  "success": true,
  "data": {
    "minTradeVolume": "10000000000",
    "tradeCooldown": 60,
    "maxDailyVolume": "100000000000000"
  }
}
```

---

## WEBSOCKET EVENTS

### **Connection**

```javascript
const socket = io('wss://api.lunex.io', {
  auth: {
    token: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
  }
});
```

### **Event: New Pair Created**

```javascript
socket.on('pair:created', (data) => {
  console.log(data);
  // {
  //   pairAddress: '5Eabc123...',
  //   token0: '5Fxyz...',
  //   token1: '5Gdef...',
  //   blockNumber: 12360
  // }
});
```

### **Event: Liquidity Added**

```javascript
socket.on('liquidity:added', (data) => {
  // {
  //   pairAddress: '5Eabc123...',
  //   provider: '5GrwvaEF...',
  //   amountA: '1000000000',
  //   amountB: '500000000',
  //   liquidity: '707106781'
  // }
});
```

### **Event: Swap Executed**

```javascript
socket.on('swap:executed', (data) => {
  // {
  //   pairAddress: '5Eabc123...',
  //   sender: '5GrwvaEF...',
  //   amountIn: '1000000000',
  //   amountOut: '995000000',
  //   tokenIn: '5Fxyz...',
  //   tokenOut: '5Gdef...'
  // }
});
```

### **Event: Proposal Created**

```javascript
socket.on('proposal:created', (data) => {
  // {
  //   proposalId: 15,
  //   proposer: '5GrwvaEF...',
  //   projectName: 'TOKEN XYZ',
  //   tokenAddress: '5Gtoken...',
  //   votingDeadline: 1734465808
  // }
});
```

### **Event: Vote Cast**

```javascript
socket.on('vote:cast', (data) => {
  // {
  //   proposalId: 15,
  //   voter: '5GrwvaEF...',
  //   votePower: '10000000000',
  //   inFavor: true
  // }
});
```

### **Event: Price Update**

```javascript
socket.on('price:update', (data) => {
  // {
  //   pairAddress: '5Eabc123...',
  //   price0: '2.02',
  //   price1: '0.495',
  //   timestamp: 1733359808
  // }
});
```

### **Subscribe to Specific Pair**

```javascript
socket.emit('subscribe:pair', {
  pairAddress: '5Eabc123...'
});

socket.on('pair:5Eabc123...:update', (data) => {
  // Atualizações específicas deste par
});
```

---

## ERROR HANDLING

### **Error Codes**

| Code | Message | HTTP Status |
|------|---------|-------------|
| `AUTH_001` | Invalid signature | 401 |
| `AUTH_002` | Token expired | 401 |
| `AUTH_003` | Nonce expired | 401 |
| `PAIR_001` | Pair not found | 404 |
| `PAIR_002` | Pair already exists | 409 |
| `PAIR_003` | Insufficient liquidity | 400 |
| `SWAP_001` | Slippage too high | 400 |
| `SWAP_002` | Deadline expired | 400 |
| `SWAP_003` | Invalid path | 400 |
| `STAKE_001` | Insufficient balance | 400 |
| `STAKE_002` | Stake period not completed | 400 |
| `STAKE_003` | No active stake | 404 |
| `PROPOSAL_001` | Proposal not found | 404 |
| `PROPOSAL_002` | Already voted | 409 |
| `PROPOSAL_003` | Voting period expired | 400 |
| `TOKEN_001` | Token not approved | 403 |
| `TOKEN_002` | Zero address not allowed | 400 |
| `GAS_001` | Insufficient gas | 400 |
| `NETWORK_001` | Network error | 503 |
| `RATE_LIMIT` | Too many requests | 429 |

### **Example Error Response**

```json
{
  "success": false,
  "error": {
    "code": "SWAP_001",
    "message": "Slippage tolerance exceeded",
    "details": {
      "expectedOutput": "995000000",
      "actualOutput": "980000000",
      "slippage": "1.5%",
      "maxSlippage": "1.0%"
    }
  },
  "timestamp": "2025-12-04T23:50:08Z",
  "requestId": "uuid-v4"
}
```

---

## RATE LIMITING

### **Limites**

| Tier | Requests/minute | Requests/day |
|------|----------------|--------------|
| **Anonymous** | 20 | 1,000 |
| **Authenticated** | 60 | 5,000 |
| **Premium** | 120 | 20,000 |
| **VIP** | 300 | 100,000 |

### **Headers**

```http
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1733359868
```

### **Rate Limit Exceeded Response**

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT",
    "message": "Too many requests",
    "details": {
      "limit": 60,
      "windowMinutes": 1,
      "retryAfter": 30
    }
  },
  "timestamp": "2025-12-04T23:50:08Z"
}
```

---

## EXEMPLOS DE INTEGRAÇÃO

### **React + @polkadot/extension-dapp**

```typescript
// api/lunexApi.ts
import axios from 'axios';
import { web3FromSource } from '@polkadot/extension-dapp';

const API_BASE_URL = 'https://api.lunex.io/v1';

export class LunexAPI {
  private token: string | null = null;

  async authenticate(address: string, signature: string, nonce: string) {
    const response = await axios.post(`${API_BASE_URL}/auth/login`, {
      address,
      signature,
      nonce
    });
    
    this.token = response.data.data.token;
    axios.defaults.headers.common['Authorization'] = `Bearer ${this.token}`;
    
    return response.data.data;
  }

  async getAllPairs(page = 1, limit = 20) {
    const response = await axios.get(`${API_BASE_URL}/factory/pairs`, {
      params: { page, limit }
    });
    return response.data.data;
  }

  async getQuote(amountIn: string, path: string[]) {
    const response = await axios.get(`${API_BASE_URL}/router/quote`, {
      params: {
        amountIn,
        path: JSON.stringify(path)
      }
    });
    return response.data.data;
  }

  async swapExactTokensForTokens(
    amountIn: string,
    amountOutMin: string,
    path: string[],
    to: string,
    deadline: number
  ) {
    const response = await axios.post(`${API_BASE_URL}/router/swap-exact-in`, {
      amountIn,
      amountOutMin,
      path,
      to,
      deadline,
      gasLimit: '500000000000'
    });
    return response.data.data;
  }

  async stake(amount: string, duration: number) {
    const response = await axios.post(`${API_BASE_URL}/staking/stake`, {
      amount,
      duration,
      gasLimit: '300000000000'
    });
    return response.data.data;
  }
}

export const lunexApi = new LunexAPI();
```

### **Trading Component Example**

```typescript
// components/SwapInterface.tsx
import React, { useState, useEffect } from 'react';
import { lunexApi } from '../api/lunexApi';

export const SwapInterface: React.FC = () => {
  const [amountIn, setAmountIn] = useState('');
  const [amountOut, setAmountOut] = useState('');
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const getQuote = async () => {
      if (!amountIn || parseFloat(amountIn) <= 0) return;
      
      setLoading(true);
      try {
        const quoteData = await lunexApi.getQuote(
          amountIn,
          [WLUNES_ADDRESS, USDT_ADDRESS]
        );
        setQuote(quoteData);
        setAmountOut(quoteData.amountOut);
      } catch (error) {
        console.error('Quote error:', error);
      } finally {
        setLoading(false);
      }
    };

    const debounce = setTimeout(getQuote, 500);
    return () => clearTimeout(debounce);
  }, [amountIn]);

  const handleSwap = async () => {
    if (!quote) return;
    
    setLoading(true);
    try {
      const result = await lunexApi.swapExactTokensForTokens(
        amountIn,
        quote.minimumReceived,
        [WLUNES_ADDRESS, USDT_ADDRESS],
        userAddress,
        Math.floor(Date.now() / 1000) + 1200 // 20 min deadline
      );
      
      console.log('Swap successful:', result);
      // Update UI
    } catch (error) {
      console.error('Swap error:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="swap-interface">
      <input
        type="number"
        value={amountIn}
        onChange={(e) => setAmountIn(e.target.value)}
        placeholder="Amount In"
      />
      
      {quote && (
        <div className="quote-info">
          <p>Amount Out: {amountOut}</p>
          <p>Price Impact: {quote.priceImpact}%</p>
          <p>Minimum Received: {quote.minimumReceived}</p>
        </div>
      )}
      
      <button onClick={handleSwap} disabled={loading || !quote}>
        {loading ? 'Processing...' : 'Swap'}
      </button>
    </div>
  );
};
```

### **WebSocket Hook**

```typescript
// hooks/useWebSocket.ts
import { useEffect, useState } from 'react';
import io from 'socket.io-client';

export const useWebSocket = (token: string) => {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const newSocket = io('wss://api.lunex.io', {
      auth: { token: `Bearer ${token}` }
    });

    newSocket.on('connect', () => {
      console.log('WebSocket connected');
      setConnected(true);
    });

    newSocket.on('disconnect', () => {
      console.log('WebSocket disconnected');
      setConnected(false);
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, [token]);

  const subscribe = (event: string, callback: (data: any) => void) => {
    if (socket) {
      socket.on(event, callback);
    }
  };

  const unsubscribe = (event: string) => {
    if (socket) {
      socket.off(event);
    }
  };

  return { socket, connected, subscribe, unsubscribe };
};

// Usage in component
const { subscribe, unsubscribe } = useWebSocket(authToken);

useEffect(() => {
  subscribe('swap:executed', (data) => {
    console.log('New swap:', data);
    // Update UI
  });

  return () => unsubscribe('swap:executed');
}, []);
```

---

**FIM DA ESPECIFICAÇÃO API V1.0.0**

Esta documentação cobre todos os endpoints, formatos, exemplos e integrações necessários para consumir a API do Lunex DEX no frontend.
