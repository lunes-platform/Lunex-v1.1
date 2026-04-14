# Lunex Agent MCP

MCP server (`stdio`) for AI agents to integrate with Lunex spot market data, externally-signed wallet flows, agent-authenticated spot trading, social trading, copytrade, strategy tooling, execution telemetry, and asymmetric liquidity management.

This server is intentionally scoped to `spot-api` domains only.

It does not support:

- Direct AMM contract operations
- Farming
- Staking

## What it exposes

This MCP server wraps the existing `spot-api` and exposes tools for:

- Spot market discovery
- Smart Router quote and agent-authenticated execution
- Pair ticker and orderbook snapshots
- Recent trades and candles
- Externally-signed spot order preparation, submission, cancellation, and wallet-scoped reads
- Social leaders and leader profiles
- Copytrade vaults, positions, activity and executions
- Copytrade API key challenge / rotation
- Copytrade signal submission for autonomous agents
- Agent registration and API key bootstrap
- Agent spot trading, portfolio, and strategy management
- Execution Layer inspection
- Asymmetric liquidity agent operations

Important:

- Wallet-scoped reads and actions now return a `signingRequest` payload when the tool needs external signature proof.
- The MCP never signs with private keys. Signing must happen in the user wallet or another trusted signer outside the MCP process.
- Agent API key flows are separate from wallet-signed flows.

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

## Smart Router smoke

After building, run the repeatable MCP-to-backend smoke for Smart Router:

```bash
npm run smoke:router
```

Optional environment variables:

- `LUNEX_SMOKE_PAIR_SYMBOL` to force a specific pair instead of the first active pair.
- `LUNEX_SMOKE_SIDE` with `BUY` or `SELL` (default `BUY`).
- `LUNEX_SMOKE_AMOUNT_IN` with a positive numeric input amount (default `1`).
- `LUNEX_SMOKE_AGENT_API_KEY` or `LUNEX_AGENT_API_KEY` for authenticated agent execution.
- `LUNEX_MCP_SMOKE_EXECUTE_ROUTER_SWAP=true` to opt in to a live `agent_router_swap`.

Important:

- By default the smoke is read-only plus quote validation.
- When `LUNEX_MCP_SMOKE_EXECUTE_ROUTER_SWAP=true`, the script may execute a real trade through `POST /api/v1/route/swap`.

## Start

```bash
npm start
```

## Environment variables

Create a `.env` file if desired:

```bash
LUNEX_SPOT_API_URL=http://127.0.0.1:4010
LUNEX_LEADER_API_KEY=
LUNEX_AGENT_API_KEY=
LUNEX_MCP_ORIGIN=
```

Notes:

- `LUNEX_SPOT_API_URL` points to the Lunex backend.
- `LUNEX_LEADER_API_KEY` is optional and only used by `submit_copytrade_signal` when the tool input does not provide `apiKey`.
- `LUNEX_AGENT_API_KEY` is optional and used by agent-authenticated tools when the tool input does not provide `apiKey`.
- `LUNEX_MCP_ORIGIN` is optional and sets an `Origin` header on MCP outbound requests when your production CORS policy requires an allowlisted origin.
- `LUNEX_SMOKE_PAIR_SYMBOL`, `LUNEX_SMOKE_SIDE`, and `LUNEX_SMOKE_AMOUNT_IN` tune the Smart Router smoke command.
- `LUNEX_MCP_SMOKE_EXECUTE_ROUTER_SWAP=true` opts in to a live Smart Router execution during smoke validation.
- MCP requests include `x-lunex-client: mcp` to support strict backend traffic policies for server-to-server integrations.
- Do not hardcode secrets in prompts or source code.
- `submit_copytrade_signal` now accepts `positionEffect` (`AUTO`, `OPEN`, `CLOSE`) and `signalMode` (`AUTO`, `JOURNAL`, `EXECUTE_VAULT`).
- `signalMode: AUTO` tries live vault execution when the vault is contract-backed and the best route is backend-executable (`ORDERBOOK` or `AMM_V1`); otherwise (e.g. `ASYMMETRIC`) it falls back to journaling.
- When `signalMode: AUTO` resolves to `ASYMMETRIC`, the API can include `walletAssistedContinuation.contractCallIntent` for wallet-assisted completion.
- Query pending continuations via `GET /api/v1/copytrade/vaults/:leaderId/signals/pending-wallet` (leader API key).
- After wallet execution, confirm the signal via `POST /api/v1/copytrade/vaults/:leaderId/signals/:signalId/wallet-confirmation` using `copytrade.confirm-wallet-signal`.

## Tool families

- Scope and market data:
  `get_server_scope`, `get_lunex_health`, `list_pairs`, `get_pair_ticker`, `get_orderbook`, `get_recent_trades`, `get_candles`, `get_router_quote`
- Externally-signed wallet trading:
  `prepare_spot_order_signature`, `create_spot_order`, `prepare_spot_cancel_signature`, `cancel_spot_order`, `get_user_orders`, `get_user_trade_history`
- Social and copytrade:
  `list_social_leaders`, `get_leader_profile`, `list_copytrade_vaults`, `get_copytrade_vault`, `get_copytrade_positions`, `get_copytrade_activity`, `get_vault_executions`, `create_leader_api_key_challenge`, `rotate_leader_api_key`, `submit_copytrade_signal`, `list_pending_copytrade_wallet_signals`, `confirm_copytrade_wallet_signal`
- Agent onboarding and trading:
  `register_agent`, `create_agent_api_key`, `list_agents`, `agent_swap`, `agent_limit_order`, `agent_portfolio`, `agent_router_swap`
- Strategy and execution:
  `validate_trade`, `get_execution_history`, `get_execution_daily_summary`, `get_execution_risk_params`, `list_strategies_marketplace`, `get_strategy`, `get_strategy_performance`, `follow_strategy`, `unfollow_strategy`, `get_followed_strategies`, `register_strategy`, `update_strategy`, `list_agent_strategies`
- Asymmetric liquidity:
  `agent_get_asymmetric_delegation_context`, `agent_link_asymmetric_strategy`, `agent_create_asymmetric_strategy`, `agent_update_curve_parameters`, `agent_get_strategy_status`

Run `ListTools` against the server for the authoritative schema of every tool.

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
        "LUNEX_LEADER_API_KEY": "",
        "LUNEX_AGENT_API_KEY": ""
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
        "LUNEX_LEADER_API_KEY": "",
        "LUNEX_AGENT_API_KEY": ""
      }
    }
  }
}
```

## OpenClaw / agent flow

Recommended autonomous flow:

1. Call `get_server_scope` first to confirm the exact supported domains and unsupported product areas.
2. Optionally read `lunex://docs/spot-authenticated-trading` and `lunex://config/openclaw` for dynamic docs/config.
3. Call `list_pairs`, `get_pair_ticker`, `get_orderbook`, `get_recent_trades`, `get_candles`, and `get_router_quote` to build market context.
4. For wallet-signed spot execution, call `prepare_spot_order_signature`, sign externally, then call `create_spot_order`.
5. For wallet-scoped reads such as `get_user_orders`, `get_user_trade_history`, `get_copytrade_positions`, `get_copytrade_activity`, and `get_followed_strategies`, sign the returned `signingRequest` and replay the same tool with `nonce`, `timestamp`, and `signature`.
6. For agent onboarding, call `register_agent`; if the tool returns `requiresExternalSignature`, sign it and retry. Then bootstrap the first agent key with `create_agent_api_key` using the same pattern.
7. For agent-authenticated trading, use `agent_swap`, `agent_limit_order`, `agent_router_swap`, `agent_portfolio`, and execution/strategy tools with a valid `X-API-Key`.
8. If `agent_router_swap` returns `requiresWalletSignature: true`, treat it as a wallet-assisted continuation and pass `contractCallIntent` to the user wallet instead of claiming the trade is fully complete.
9. For social/copytrade automation, use `submit_copytrade_signal`; if it returns wallet-assisted continuation, track it with `list_pending_copytrade_wallet_signals` and finalize with `confirm_copytrade_wallet_signal` after on-chain tx confirmation.
10. For asymmetric liquidity, obtain `agent_get_asymmetric_delegation_context`, complete the on-chain manager delegation externally if needed, then use `agent_link_asymmetric_strategy`, `agent_create_asymmetric_strategy`, `agent_update_curve_parameters`, and `agent_get_strategy_status`.

If an agent asks for direct AMM contract actions, farming, or staking, it should not use this MCP server for that request.

## Security notes

- Prefer environment variables for API keys.
- Keep wallet signing outside the MCP server for every `signingRequest` flow.
- Treat `submit_copytrade_signal` as a privileged action.
- Treat `LUNEX_AGENT_API_KEY` and `LUNEX_LEADER_API_KEY` as production secrets.
- Run the MCP server close to the backend or behind a trusted local network boundary.
