# Lunex Agent MCP

MCP server (`stdio`) for AI agents to integrate with Lunex spot market data, authenticated spot trading, social trading and copytrade workflows.

This server is intentionally scoped to `spot-api` domains only.

It does not support:

- AMM swap
- Router operations
- Liquidity management
- Farming
- Staking

## What it exposes

This MCP server wraps the existing `spot-api` and exposes tools for:

- Spot market discovery
- Pair ticker and orderbook snapshots
- Recent trades and candles
- Authenticated spot order preparation, submission, cancellation and user history
- Social leaders and leader profiles
- Copytrade vaults, positions, activity and executions
- Copytrade API key challenge / rotation
- Copytrade signal submission for autonomous agents

## MCP resources

Dynamic resources exposed by this server:

- `lunex://scope`
- `lunex://docs/spot-authenticated-trading`
- `lunex://config/runtime`
- `lunex://config/openclaw`

## MCP prompts

Reusable prompts exposed by this server:

- `openclaw_scope_guard`
- `openclaw_authenticated_spot_trade`
- `openclaw_social_copytrade_scan`

## Requirements

- Node.js 20+
- A running Lunex `spot-api`

Default backend URL:

- `http://127.0.0.1:4010`

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

## Build

```bash
npm run build
```

## Start

```bash
npm start
```

## Environment variables

Create a `.env` file if desired:

```bash
LUNEX_SPOT_API_URL=http://127.0.0.1:4010
LUNEX_LEADER_API_KEY=
```

Notes:

- `LUNEX_SPOT_API_URL` points to the Lunex backend.
- `LUNEX_LEADER_API_KEY` is optional and only used by `submit_copytrade_signal` when the tool input does not provide `apiKey`.
- Do not hardcode secrets in prompts or source code.

## Tool list

- `get_server_scope`
- `get_lunex_health`
- `list_pairs`
- `get_pair_ticker`
- `get_orderbook`
- `get_recent_trades`
- `get_candles`
- `prepare_spot_order_signature`
- `create_spot_order`
- `prepare_spot_cancel_signature`
- `cancel_spot_order`
- `get_user_orders`
- `get_user_trade_history`
- `list_social_leaders`
- `get_leader_profile`
- `list_copytrade_vaults`
- `get_copytrade_vault`
- `get_copytrade_positions`
- `get_copytrade_activity`
- `get_vault_executions`
- `create_leader_api_key_challenge`
- `rotate_leader_api_key`
- `submit_copytrade_signal`

## Claude Desktop example

```json
{
  "mcpServers": {
    "lunex-spot-social-copytrade": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/Lunex/mcp/lunex-agent-mcp/dist/index.js"
      ],
      "env": {
        "LUNEX_SPOT_API_URL": "http://127.0.0.1:4010",
        "LUNEX_LEADER_API_KEY": ""
      }
    }
  }
}
```

## OpenClaw ready config

This package also ships a ready-to-use config file:

- `./openclaw.mcp.json`
- `./OPENCLAW_SESSION_EXAMPLE.md`

It points to this server's local `dist/index.js` entrypoint inside the current Lunex workspace.

Exact block for this workspace:

```json
{
  "mcpServers": {
    "lunex-spot-social-copytrade": {
      "command": "node",
      "args": [
        "/Users/lucas/Documents/Projetos_DEV/Lunex/mcp/lunex-agent-mcp/dist/index.js"
      ],
      "env": {
        "LUNEX_SPOT_API_URL": "http://127.0.0.1:4010",
        "LUNEX_LEADER_API_KEY": ""
      }
    }
  }
}
```

## OpenClaw / agent flow

Recommended autonomous flow:

1. Call `get_server_scope` first to confirm this MCP only supports spot market data, social trading, and copytrade.
2. Optionally read `lunex://docs/spot-authenticated-trading` and `lunex://config/openclaw` for dynamic docs/config.
3. Call `list_pairs`, `get_pair_ticker`, `get_orderbook`, `get_recent_trades`, and `get_candles` to build market context.
4. For authenticated spot execution, call `prepare_spot_order_signature`, sign externally, then call `create_spot_order`.
5. For order cancellation, call `prepare_spot_cancel_signature`, sign externally, then call `cancel_spot_order`.
6. Use `get_user_orders` and `get_user_trade_history` for post-trade monitoring.
7. Call `list_social_leaders`, `get_leader_profile`, `list_copytrade_vaults`, and `get_vault_executions` to rank leaders and vault behavior.
8. For follower analytics, call `get_copytrade_positions` and `get_copytrade_activity`.
9. For AI trading automation, call `submit_copytrade_signal` with a valid leader API key.
10. To rotate a leader API key securely, call `create_leader_api_key_challenge`, sign the returned message with the leader wallet, then call `rotate_leader_api_key`.

If an agent asks for swap, router, liquidity, farming, or staking, it should not use this MCP server for that request. The server now returns an explicit scope refusal for unsupported tool names in those domains.

## Security notes

- Prefer environment variables for API keys.
- Keep wallet signing outside the MCP server when rotating API keys.
- Treat `submit_copytrade_signal` as a privileged action.
- Run the MCP server close to the backend or behind a trusted local network boundary.
