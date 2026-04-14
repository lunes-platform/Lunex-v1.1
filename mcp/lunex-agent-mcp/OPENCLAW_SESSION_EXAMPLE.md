# OpenClaw Session Example

## Goal

User goal: inspect Lunex spot market health, confirm MCP scope, obtain a Smart Router quote, and prepare for a secure authenticated spot trade without leaving MCP scope.

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
- Refuse direct AMM contract actions, staking, and farming requests
- Continue only with supported flows such as spot market data, Smart Router, externally-signed wallet flows, agent-authenticated trading, social/copytrade, strategies, execution telemetry, and asymmetric management

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
    "smart-router",
    "authenticated-spot-trading",
    "agent-authenticated-trading",
    "social-trading",
    "copytrade",
    "strategy-layer",
    "execution-layer",
    "asymmetric-liquidity"
  ],
  "doesNotSupport": [
    "amm",
    "staking",
    "farming"
  ],
  "guidance": "Use this MCP for spot market context, Smart Router quote/execution, externally-signed wallet flows, agent-authenticated trading, social/copytrade workflows, strategy tooling, execution telemetry, and asymmetric agent management. Do not use it for direct AMM contract actions, staking, or farming."
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
- Optionally call `get_router_quote` for route discovery
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

### 5. Agent asks Smart Router for the best route

Tool call:

```json
{
  "name": "get_router_quote",
  "arguments": {
    "pairSymbol": "BTC/USDT",
    "side": "BUY",
    "amountIn": 1000
  }
}
```

Representative result shape:

```json
{
  "pairSymbol": "BTC/USDT",
  "side": "BUY",
  "amountIn": 1000,
  "bestRoute": "ORDERBOOK",
  "bestAmountOut": 0.0161,
  "routes": []
}
```

### 6. Agent prepares an authenticated spot order signature payload

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
  "timestamp": 1709689254000,
  "message": "lunex-order:BTC/USDT:BUY:LIMIT:62000:0:0.0100:1709689254000-ab12cd34:1709689254000",
  "order": {
    "pairSymbol": "BTC/USDT",
    "side": "BUY",
    "type": "LIMIT",
    "amount": "0.0100",
    "makerAddress": "5FExampleTraderAddress",
    "price": "62000",
    "timeInForce": "GTC",
    "nonce": "1709689254000-ab12cd34",
    "timestamp": 1709689254000
  }
}
```

### 7. External wallet signs the message

This must happen outside MCP.

Example signed message target:

```text
lunex-order:BTC/USDT:BUY:LIMIT:62000:0:0.0100:1709689254000-ab12cd34:1709689254000
```

### 8. Agent submits the signed order

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
    "timestamp": 1709689254000,
    "signature": "0xREAL_EXTERNAL_SIGNATURE"
  }
}
```

### 9. Agent monitors order/trade history

Follow-up tools:

- `get_user_orders`
- `get_user_trade_history`

If those tools return `requiresExternalSignature: true`, the agent must obtain the external wallet signature and replay the same tool with `nonce`, `timestamp`, and `signature`.

### 10. Agent-authenticated Smart Router execution

If the user already has an agent API key, the agent can execute the Smart Router directly:

```json
{
  "name": "agent_router_swap",
  "arguments": {
    "pairSymbol": "BTC/USDT",
    "side": "BUY",
    "amountIn": 1000,
    "maxSlippageBps": 100,
    "apiKey": "lnx_..."
  }
}
```

If the best route resolves to `ASYMMETRIC`, the tool may return `requiresWalletSignature: true` together with `contractCallIntent`. In that case the agent must stop claiming completion and hand off the intent to the user wallet.

## Out-of-scope refusal example

If the agent attempts a tool like `swap_tokens`, the MCP should explicitly refuse it.

Representative refusal:

```text
Tool `swap_tokens` is outside the scope of lunex-spot-social-copytrade-mcp. This MCP explicitly refuses requests for direct AMM contract actions, staking, or farming operations that are outside its contract. Supported domains are: spot market data, Smart Router, externally-signed wallet flows, agent-authenticated trading, social/copytrade workflows, strategy tooling, execution telemetry, and asymmetric agent management. Call `get_server_scope` or read `lunex://scope` for the authoritative scope.
```

## Live validation notes

Observed during local validation:

- `get_lunex_health` path is healthy through the local backend
- direct `GET /api/v1/pairs` currently fails because the backend cannot reach PostgreSQL at `localhost:5432`
- market pair/orderbook/copytrade data calls depending on Prisma-backed DB reads require the database to be up
