# OpenClaw Session Example

## Goal

User goal: inspect Lunex spot market health, confirm MCP scope, retrieve guided prompt context, and prepare for a secure authenticated spot trade without leaving MCP scope.

## Preconditions

- MCP server config loaded from `openclaw.mcp.json`
- `spot-api` reachable at `http://127.0.0.1:4010`
- Wallet signing stays external to the MCP server

## Example session transcript

### 1. Agent confirms scope first

Prompt used:

- `openclaw_scope_guard`

Prompt arguments:

```json
{
  "userGoal": "Check Lunex market health and prepare a secure BTC/USDT limit buy order flow."
}
```

Expected agent behavior:

- Call `get_server_scope`
- Refuse swap/staking/liquidity/router/farming requests
- Continue only with spot market data, authenticated spot trading, social trading, or copytrade

Tool call:

```json
{
  "name": "get_server_scope",
  "arguments": {}
}
```

Representative result:

```json
{
  "name": "lunex-spot-social-copytrade-mcp",
  "supports": [
    "spot-market-data",
    "authenticated-spot-trading",
    "social-trading",
    "copytrade"
  ],
  "doesNotSupport": [
    "swap",
    "router",
    "liquidity",
    "amm",
    "staking",
    "farming"
  ],
  "guidance": "Use this MCP for spot orderbook market context, authenticated spot order flows with external signing, social leader discovery, follower analytics, and copytrade automation only."
}
```

### 2. Agent reads dynamic docs/config resources

Resource reads:

- `lunex://scope`
- `lunex://docs/spot-authenticated-trading`
- `lunex://config/openclaw`

These resources let the agent verify current runtime scope and retrieve the secure signing workflow before taking action.

### 3. Agent fetches a guided authenticated spot trading prompt

Prompt used:

- `openclaw_authenticated_spot_trade`

Prompt arguments:

```json
{
  "pairSymbol": "BTC/USDT",
  "side": "BUY",
  "type": "LIMIT",
  "amount": "0.0100",
  "makerAddress": "5FExampleTraderAddress",
  "price": "62000"
}
```

Expected agent behavior from this prompt:

- Gather market context if relevant
- Call `prepare_spot_order_signature`
- Wait for a real external signature
- Call `create_spot_order` only after receiving the real signature

### 4. Agent validates backend health through MCP

Tool call:

```json
{
  "name": "get_lunex_health",
  "arguments": {}
}
```

Observed live result during validation:

```json
{
  "status": "ok",
  "timestamp": "2026-03-06T01:40:54.728Z"
}
```

### 5. Agent prepares an authenticated spot order signature payload

Tool call:

```json
{
  "name": "prepare_spot_order_signature",
  "arguments": {
    "pairSymbol": "BTC/USDT",
    "side": "BUY",
    "type": "LIMIT",
    "amount": "0.0100",
    "makerAddress": "5FExampleTraderAddress",
    "price": "62000"
  }
}
```

Representative result shape:

```json
{
  "nonce": "1709689254000-ab12cd34",
  "message": "lunex-order:BTC/USDT:BUY:LIMIT:62000:0.0100:1709689254000-ab12cd34",
  "order": {
    "pairSymbol": "BTC/USDT",
    "side": "BUY",
    "type": "LIMIT",
    "amount": "0.0100",
    "makerAddress": "5FExampleTraderAddress",
    "price": "62000",
    "timeInForce": "GTC",
    "nonce": "1709689254000-ab12cd34"
  }
}
```

### 6. External wallet signs the message

This must happen outside MCP.

Example signed message target:

```text
lunex-order:BTC/USDT:BUY:LIMIT:62000:0.0100:1709689254000-ab12cd34
```

### 7. Agent submits the signed order

Tool call:

```json
{
  "name": "create_spot_order",
  "arguments": {
    "pairSymbol": "BTC/USDT",
    "side": "BUY",
    "type": "LIMIT",
    "amount": "0.0100",
    "makerAddress": "5FExampleTraderAddress",
    "price": "62000",
    "nonce": "1709689254000-ab12cd34",
    "signature": "0xREAL_EXTERNAL_SIGNATURE"
  }
}
```

### 8. Agent monitors order/trade history

Follow-up tools:

- `get_user_orders`
- `get_user_trade_history`

## Out-of-scope refusal example

If the agent attempts a tool like `swap_tokens`, the MCP should explicitly refuse it.

Representative refusal:

```text
Tool `swap_tokens` is outside the scope of lunex-spot-social-copytrade-mcp. This MCP explicitly refuses requests for swap, router, liquidity, amm, staking, or farming operations. Supported domains are: spot market data, authenticated spot trading, social trading, and copytrade. Call `get_server_scope` or read `lunex://scope` for the authoritative scope.
```

## Live validation notes

Observed during local validation:

- `get_lunex_health` path is healthy through the local backend
- direct `GET /api/v1/pairs` currently fails because the backend cannot reach PostgreSQL at `localhost:5432`
- market pair/orderbook/copytrade data calls depending on Prisma-backed DB reads require the database to be up
