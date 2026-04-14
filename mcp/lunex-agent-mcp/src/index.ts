import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { agentRouterSwapTool, getRouterQuoteTool } from './routerTools.js';

const serverName = 'lunex-spot-social-copytrade-mcp';
const scopeNotice =
  'This MCP supports Lunex spot market data, Smart Router quote/execution, externally-signed wallet flows, agent-authenticated spot trading, social trading, copytrade, strategy tooling, execution telemetry, and asymmetric liquidity agent management. It does not support direct AMM contract operations, staking, or farming.';

const openClawServerKey = 'lunex-spot-social-copytrade';
const supportedScopes = [
  'spot-market-data',
  'smart-router',
  'authenticated-spot-trading',
  'agent-authenticated-trading',
  'social-trading',
  'copytrade',
  'strategy-layer',
  'execution-layer',
  'asymmetric-liquidity',
] as const;

const promptDefinitions = [
  {
    name: 'openclaw_scope_guard',
    description:
      'Guide the agent to confirm Lunex MCP scope before taking action.',
    arguments: [
      {
        name: 'userGoal',
        description:
          'The end-user goal or request that the agent is trying to fulfill.',
        required: true,
      },
    ],
  },
  {
    name: 'openclaw_authenticated_spot_trade',
    description:
      'Guide the agent through secure authenticated Lunex spot order preparation and submission.',
    arguments: [
      {
        name: 'pairSymbol',
        description: 'Target trading pair such as BTC/USDT.',
        required: true,
      },
      {
        name: 'side',
        description: 'BUY or SELL.',
        required: true,
      },
      {
        name: 'type',
        description: 'LIMIT, MARKET, STOP, or STOP_LIMIT.',
        required: true,
      },
      {
        name: 'amount',
        description: 'Desired order amount as a decimal string.',
        required: true,
      },
      {
        name: 'makerAddress',
        description: 'Trader wallet address used for ownership and signing.',
        required: true,
      },
      {
        name: 'price',
        description: 'Optional price for LIMIT and STOP_LIMIT orders.',
        required: false,
      },
    ],
  },
  {
    name: 'openclaw_social_copytrade_scan',
    description:
      'Guide the agent through social leader discovery and copytrade analysis within MCP scope.',
    arguments: [
      {
        name: 'objective',
        description: 'What the agent is trying to decide, rank, or analyze.',
        required: true,
      },
      {
        name: 'riskProfile',
        description:
          'Optional risk preference such as conservative, balanced, or aggressive.',
        required: false,
      },
    ],
  },
] as const;
const unsupportedScopes = ['amm', 'staking', 'farming'] as const;

function scopedDescription(description: string) {
  return `${description} ${scopeNotice}`;
}

const server = new Server(
  {
    name: serverName,
    version: '0.1.0',
  },
  {
    capabilities: {
      prompts: {},
      resources: {},
      tools: {},
    },
  },
);

const baseUrl =
  process.env.LUNEX_SPOT_API_URL ||
  process.env.SPOT_API_URL ||
  'http://127.0.0.1:4010';
const backendOriginHeader = process.env.LUNEX_MCP_ORIGIN || '';
const defaultLeaderApiKey = process.env.LUNEX_LEADER_API_KEY || '';
const defaultAgentApiKey = process.env.LUNEX_AGENT_API_KEY || '';

const resourceDefinitions = [
  {
    uri: 'lunex://scope',
    name: 'Lunex MCP Scope',
    description: 'Dynamic scope and product boundaries for this MCP server.',
    mimeType: 'application/json',
  },
  {
    uri: 'lunex://docs/spot-authenticated-trading',
    name: 'Authenticated Spot Trading Guide',
    description:
      'Dynamic integration guide for externally signed Lunex spot order flows.',
    mimeType: 'text/markdown',
  },
  {
    uri: 'lunex://config/runtime',
    name: 'Runtime Configuration',
    description:
      'Dynamic runtime metadata for the current MCP instance without exposing secrets.',
    mimeType: 'application/json',
  },
  {
    uri: 'lunex://config/openclaw',
    name: 'OpenClaw MCP Config',
    description:
      'Ready-to-use OpenClaw MCP server configuration pointing to this Lunex MCP entrypoint.',
    mimeType: 'application/json',
  },
] as const;

function generateNonce(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildSpotOrderSignMessage(input: {
  pairSymbol: string;
  side: string;
  type: string;
  price?: string;
  stopPrice?: string;
  amount: string;
  nonce: string;
  timestamp: number;
}) {
  return `lunex-order:${input.pairSymbol}:${input.side}:${input.type}:${input.price || '0'}:${input.stopPrice || '0'}:${input.amount}:${input.nonce}:${input.timestamp}`;
}

function buildSpotCancelSignMessage(orderId: string) {
  return `lunex-cancel:${orderId}`;
}

function getServerEntrypoint() {
  const scriptPath = process.argv[1] || 'dist/index.js';
  return scriptPath
    .replace('/src/index.ts', '/dist/index.js')
    .replace('\\src\\index.ts', '\\dist\\index.js');
}

function buildServerScopePayload() {
  return {
    name: serverName,
    supports: [...supportedScopes],
    doesNotSupport: [...unsupportedScopes],
    guidance:
      'Use this MCP for spot market context, Smart Router quote/execution, externally-signed wallet flows, agent-authenticated trading, social/copytrade workflows, strategy tooling, execution telemetry, and asymmetric agent management. Do not use it for direct AMM contract actions, staking, or farming.',
  };
}

function buildRuntimeConfigPayload() {
  return {
    serverName,
    openClawServerKey,
    baseUrl,
    entrypoint: getServerEntrypoint(),
    defaultLeaderApiKeyConfigured: Boolean(defaultLeaderApiKey),
    defaultAgentApiKeyConfigured: Boolean(defaultAgentApiKey),
    resources: resourceDefinitions.map((resource) => ({
      uri: resource.uri,
      name: resource.name,
      mimeType: resource.mimeType,
    })),
  };
}

function buildOpenClawConfigPayload() {
  return {
    mcpServers: {
      [openClawServerKey]: {
        command: 'node',
        args: [getServerEntrypoint()],
        env: {
          LUNEX_SPOT_API_URL: baseUrl,
          LUNEX_LEADER_API_KEY: '',
          LUNEX_AGENT_API_KEY: '',
        },
      },
    },
  };
}

function buildSpotTradingDocs() {
  return [
    '# Lunex authenticated spot trading via MCP',
    '',
    `Backend base URL: ${baseUrl}`,
    '',
    '## Security model',
    '',
    '- Private keys must stay outside the MCP server.',
    '- Use the prepare tools to obtain the exact signing message.',
    '- Sign with the trader wallet externally, then submit the signed payload back to the create/cancel tools.',
    '- Do not put seed phrases or private keys in prompts, MCP arguments, or environment variables.',
    '',
    '## Order flow',
    '',
    '1. Call `prepare_spot_order_signature` with the intended order fields.',
    '2. Sign the returned `message` using the trader wallet.',
    '3. Call `create_spot_order` with the returned order payload plus the wallet signature.',
    '4. For signed monitoring calls, reuse the same wallet and follow the signing request returned by `get_user_orders` and `get_user_trade_history` when those tools ask for external signature proof.',
    '',
    '## Cancel flow',
    '',
    '1. Call `prepare_spot_cancel_signature` with `orderId` and `makerAddress`.',
    '2. Sign the returned cancel message externally.',
    '3. Call `cancel_spot_order` with `orderId`, `makerAddress`, and `signature`.',
    '',
    '## Message formats',
    '',
    '- Order: `lunex-order:{pairSymbol}:{side}:{type}:{price||0}:{stopPrice||0}:{amount}:{nonce}:{timestamp}`',
    '- Cancel: `lunex-cancel:{orderId}`',
    '',
    '## Notes',
    '',
    '- The current backend contract requires `timestamp` inside both the signed message and the submitted order payload.',
    '- Wallet-scoped reads such as user orders, trade history, copytrade positions, and followed strategies require an additional externally-signed read proof.',
  ].join('\n');
}

function buildScopeGuardPrompt(userGoal: string) {
  return {
    description:
      'Use this prompt to force scope verification before any Lunex MCP action.',
    messages: [
      {
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: [
            'You are using the Lunex MCP server.',
            `User goal: ${userGoal}`,
            '',
            'Before taking any action:',
            '1. Call `get_server_scope`.',
            '2. Read `lunex://scope` if needed.',
            '3. Refuse any plan involving direct AMM contract actions, staking, or farming that falls outside this MCP contract.',
            '4. If the goal is in scope, continue with market data, Smart Router, externally-signed wallet flows, agent-authenticated trading, social/copytrade, strategy, execution, or asymmetric tools as appropriate.',
            '5. Mention scope limits explicitly in your reasoning before calling high-impact tools.',
          ].join('\n'),
        },
      },
    ],
  };
}

function buildAuthenticatedSpotTradePrompt(args: Record<string, string>) {
  const pairSymbol = args.pairSymbol || '';
  const side = args.side || '';
  const type = args.type || '';
  const amount = args.amount || '';
  const makerAddress = args.makerAddress || '';
  const price = args.price || '';

  return {
    description:
      'Use this prompt to execute secure externally-signed Lunex spot orders through MCP.',
    messages: [
      {
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: [
            'Execute an authenticated Lunex spot trading workflow within MCP scope.',
            '',
            `pairSymbol: ${pairSymbol}`,
            `side: ${side}`,
            `type: ${type}`,
            `amount: ${amount}`,
            `makerAddress: ${makerAddress}`,
            `price: ${price || '(not provided)'}`,
            '',
            'Required workflow:',
            '1. Call `get_server_scope` first.',
            '2. Optionally read `lunex://docs/spot-authenticated-trading`.',
            '3. Build market context with `get_pair_ticker`, `get_orderbook`, `get_recent_trades`, `get_candles`, and `get_router_quote` if relevant.',
            '4. Call `prepare_spot_order_signature` with the provided order fields.',
            '5. Stop and wait for an external wallet signature. Never fabricate a signature and never ask for a private key or seed phrase.',
            '6. After a real signature is provided, call `create_spot_order`.',
            '7. If `get_user_orders` or `get_user_trade_history` returns a signing request, obtain that external wallet signature and replay the same tool with nonce, timestamp, and signature.',
            '8. If asked to cancel, use `prepare_spot_cancel_signature` and `cancel_spot_order` with the same external-signing rule.',
          ].join('\n'),
        },
      },
    ],
  };
}

function buildSocialCopytradePrompt(args: Record<string, string>) {
  const objective = args.objective || '';
  const riskProfile = args.riskProfile || 'unspecified';

  return {
    description:
      'Use this prompt to analyze Lunex social leaders and copytrade behavior without leaving MCP scope.',
    messages: [
      {
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: [
            'Analyze Lunex social and copytrade data within MCP scope.',
            '',
            `objective: ${objective}`,
            `riskProfile: ${riskProfile}`,
            '',
            'Suggested workflow:',
            '1. Call `get_server_scope` first.',
            '2. Call `list_social_leaders` to identify candidate leaders.',
            '3. Call `get_leader_profile` for shortlisted leaders.',
            '4. Call `list_copytrade_vaults` and `get_copytrade_vault` to inspect vault-level context.',
            '5. Call `get_vault_executions` for recent execution quality and behavior.',
            '6. If follower analytics are relevant, call `get_copytrade_positions` and `get_copytrade_activity`.',
            '7. If a tool returns a signing request for wallet-scoped reads, stop and obtain the external signature before continuing.',
          ].join('\n'),
        },
      },
    ],
  };
}

function buildOutOfScopeMessage(requestedToolName: string) {
  return [
    `Tool \`${requestedToolName}\` is outside the scope of ${serverName}.`,
    'This MCP explicitly refuses requests for direct AMM contract actions, staking, or farming operations that are outside its contract.',
    'Supported domains are: spot market data, Smart Router, externally-signed wallet flows, agent-authenticated trading, social/copytrade workflows, strategy tooling, execution telemetry, and asymmetric agent management.',
    'Call `get_server_scope` or read `lunex://scope` for the authoritative scope.',
  ].join(' ');
}

function isOutOfScopeToolName(name: string) {
  const normalized = name.toLowerCase();
  return unsupportedScopes.some((keyword) => normalized.includes(keyword));
}

const toolDefinitions = [
  {
    name: 'get_server_scope',
    description: scopedDescription(
      'Return the exact functional scope of this MCP server, including supported domains and unsupported product areas.',
    ),
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'get_lunex_health',
    description: scopedDescription(
      'Check whether the Lunex spot-api backend is reachable and healthy.',
    ),
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'list_pairs',
    description: scopedDescription('List active Lunex spot trading pairs.'),
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'get_pair_ticker',
    description: scopedDescription(
      'Get 24h ticker data for a Lunex spot pair.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Trading pair symbol such as BTC/USDT.',
        },
      },
      required: ['symbol'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_orderbook',
    description: scopedDescription(
      'Get an orderbook snapshot for a Lunex spot pair.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Trading pair symbol such as BTC/USDT.',
        },
        depth: {
          type: 'number',
          description:
            'Maximum number of bids and asks to return. Defaults to 25.',
        },
      },
      required: ['symbol'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_recent_trades',
    description: scopedDescription(
      'Get recent executed trades for a spot pair.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Trading pair symbol such as BTC/USDT.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of trades to return. Defaults to 50.',
        },
      },
      required: ['symbol'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_candles',
    description: scopedDescription(
      'Get OHLCV candles for a spot pair and timeframe.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Trading pair symbol such as BTC/USDT.',
        },
        timeframe: {
          type: 'string',
          description:
            'Candlestick timeframe. Example: 1m, 5m, 15m, 1h, 4h, 1d, 1w.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of candles to return. Defaults to 200.',
        },
      },
      required: ['symbol'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_router_quote',
    description: scopedDescription(
      'Get a Smart Router quote comparing ORDERBOOK, AMM_V1, and ASYMMETRIC liquidity sources for a trade.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        pairSymbol: {
          type: 'string',
          description: 'Trading pair symbol such as LUNES/LUSDT.',
        },
        side: {
          type: 'string',
          description: 'BUY or SELL.',
        },
        amountIn: {
          type: 'number',
          description: 'Input amount to route.',
        },
      },
      required: ['pairSymbol', 'side', 'amountIn'],
      additionalProperties: false,
    },
  },
  {
    name: 'agent_router_swap',
    description: scopedDescription(
      'Execute a Smart Router swap as an authenticated agent. If the best route is ASYMMETRIC, the backend may return a wallet-assisted continuation instead of a fully server-side execution.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        pairSymbol: {
          type: 'string',
          description: 'Trading pair symbol such as LUNES/LUSDT.',
        },
        side: {
          type: 'string',
          description: 'BUY or SELL.',
        },
        amountIn: {
          type: 'number',
          description: 'Input amount to route.',
        },
        maxSlippageBps: {
          type: 'number',
          description:
            'Optional maximum slippage in basis points. Defaults to 100.',
        },
        apiKey: {
          type: 'string',
          description:
            'Optional agent API key. Falls back to LUNEX_AGENT_API_KEY env.',
        },
      },
      required: ['pairSymbol', 'side', 'amountIn'],
      additionalProperties: false,
    },
  },
  {
    name: 'prepare_spot_order_signature',
    description: scopedDescription(
      'Validate an authenticated Lunex spot order and return the exact external signing message plus the unsigned order payload.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        pairSymbol: {
          type: 'string',
          description: 'Trading pair symbol such as BTC/USDT.',
        },
        side: {
          type: 'string',
          description: 'BUY or SELL.',
        },
        type: {
          type: 'string',
          description: 'LIMIT, MARKET, STOP, or STOP_LIMIT.',
        },
        amount: {
          type: 'string',
          description: 'Order amount as a positive decimal string.',
        },
        makerAddress: {
          type: 'string',
          description: 'Trader wallet address.',
        },
        price: {
          type: 'string',
          description:
            'Required positive decimal string for LIMIT and STOP_LIMIT orders.',
        },
        stopPrice: {
          type: 'string',
          description:
            'Required positive decimal string for STOP and STOP_LIMIT orders.',
        },
        timeInForce: {
          type: 'string',
          description: 'Optional time in force: GTC, IOC, or FOK.',
        },
        expiresAt: {
          type: 'string',
          description: 'Optional ISO datetime expiration.',
        },
        nonce: {
          type: 'string',
          description:
            'Optional client nonce. If omitted, the MCP server generates one.',
        },
        timestamp: {
          type: 'number',
          description:
            'Optional unix timestamp in milliseconds. If omitted, the MCP server generates one.',
        },
      },
      required: ['pairSymbol', 'side', 'type', 'amount', 'makerAddress'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_spot_order',
    description: scopedDescription(
      'Submit a previously signed authenticated Lunex spot order. Signing must happen outside the MCP server.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        pairSymbol: {
          type: 'string',
          description: 'Trading pair symbol such as BTC/USDT.',
        },
        side: {
          type: 'string',
          description: 'BUY or SELL.',
        },
        type: {
          type: 'string',
          description: 'LIMIT, MARKET, STOP, or STOP_LIMIT.',
        },
        amount: {
          type: 'string',
          description: 'Order amount as a positive decimal string.',
        },
        makerAddress: {
          type: 'string',
          description: 'Trader wallet address.',
        },
        nonce: {
          type: 'string',
          description: 'Unique client nonce for the order.',
        },
        timestamp: {
          type: 'number',
          description:
            'Unix timestamp in milliseconds used in the signed order message.',
        },
        signature: {
          type: 'string',
          description:
            'External wallet signature for the order signing message.',
        },
        price: {
          type: 'string',
          description:
            'Required positive decimal string for LIMIT and STOP_LIMIT orders.',
        },
        stopPrice: {
          type: 'string',
          description:
            'Required positive decimal string for STOP and STOP_LIMIT orders.',
        },
        timeInForce: {
          type: 'string',
          description: 'Optional time in force: GTC, IOC, or FOK.',
        },
        expiresAt: {
          type: 'string',
          description: 'Optional ISO datetime expiration.',
        },
      },
      required: [
        'pairSymbol',
        'side',
        'type',
        'amount',
        'makerAddress',
        'nonce',
        'timestamp',
        'signature',
      ],
      additionalProperties: false,
    },
  },
  {
    name: 'prepare_spot_cancel_signature',
    description: scopedDescription(
      'Return the exact external signing message required before cancelling a spot order.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        orderId: {
          type: 'string',
          description: 'Order identifier to cancel.',
        },
        makerAddress: {
          type: 'string',
          description: 'Trader wallet address that owns the order.',
        },
      },
      required: ['orderId', 'makerAddress'],
      additionalProperties: false,
    },
  },
  {
    name: 'cancel_spot_order',
    description: scopedDescription(
      'Cancel an authenticated spot order using a previously generated external signature.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        orderId: {
          type: 'string',
          description: 'Order identifier to cancel.',
        },
        makerAddress: {
          type: 'string',
          description: 'Trader wallet address that owns the order.',
        },
        signature: {
          type: 'string',
          description:
            'External wallet signature for the cancel signing message.',
        },
      },
      required: ['orderId', 'makerAddress', 'signature'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_user_orders',
    description: scopedDescription(
      'Get authenticated spot order history for a trader wallet address. If signature fields are omitted, the tool returns the exact read-signing request that must be signed externally.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        makerAddress: {
          type: 'string',
          description: 'Trader wallet address.',
        },
        status: {
          type: 'string',
          description: 'Optional order status filter.',
        },
        limit: {
          type: 'number',
          description: 'Optional maximum results, from 1 to 100.',
        },
        offset: {
          type: 'number',
          description: 'Optional pagination offset, zero or greater.',
        },
        nonce: {
          type: 'string',
          description:
            'Optional read-signature nonce. If omitted, the tool returns a signing request instead of data.',
        },
        timestamp: {
          type: 'number',
          description:
            'Optional read-signature unix timestamp in milliseconds.',
        },
        signature: {
          type: 'string',
          description:
            'Optional external wallet signature for the read request.',
        },
      },
      required: ['makerAddress'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_user_trade_history',
    description: scopedDescription(
      'Get spot trade history for a trader wallet address. If signature fields are omitted, the tool returns the exact read-signing request that must be signed externally.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: 'string',
          description: 'Trader wallet address.',
        },
        limit: {
          type: 'number',
          description: 'Optional maximum results, from 1 to 100.',
        },
        offset: {
          type: 'number',
          description: 'Optional pagination offset, zero or greater.',
        },
        nonce: {
          type: 'string',
          description:
            'Optional read-signature nonce. If omitted, the tool returns a signing request instead of data.',
        },
        timestamp: {
          type: 'number',
          description:
            'Optional read-signature unix timestamp in milliseconds.',
        },
        signature: {
          type: 'string',
          description:
            'Optional external wallet signature for the read request.',
        },
      },
      required: ['address'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_social_leaders',
    description: scopedDescription(
      'List social leaders and AI agents available for social trading and copytrade.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        tab: {
          type: 'string',
          description: 'Optional leader filter: all, traders, or bots.',
        },
        search: {
          type: 'string',
          description: 'Optional free-text search over leader fields.',
        },
        sortBy: {
          type: 'string',
          description:
            'Optional sort field: roi30d, followers, winRate, or sharpe.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of leaders to return. Defaults to 50.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_leader_profile',
    description: scopedDescription(
      'Get a detailed social/copytrade leader profile including vault, recent trades, and ideas. If viewerAddress is supplied, the route becomes wallet-scoped and may return a signing request first.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        leaderId: {
          type: 'string',
          description: 'Leader UUID.',
        },
        viewerAddress: {
          type: 'string',
          description: 'Optional wallet address to resolve follow state.',
        },
        nonce: {
          type: 'string',
          description:
            'Optional read-signature nonce required when viewerAddress is supplied.',
        },
        timestamp: {
          type: 'number',
          description:
            'Optional read-signature unix timestamp in milliseconds required when viewerAddress is supplied.',
        },
        signature: {
          type: 'string',
          description:
            'Optional external wallet signature required when viewerAddress is supplied.',
        },
      },
      required: ['leaderId'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_copytrade_vaults',
    description: scopedDescription(
      'List all copytrade vaults ranked by equity.',
    ),
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'get_copytrade_vault',
    description: scopedDescription(
      'Get detailed copytrade vault data for a specific leader, including recent positions snapshot.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        leaderId: {
          type: 'string',
          description: 'Leader UUID.',
        },
      },
      required: ['leaderId'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_copytrade_positions',
    description: scopedDescription(
      'Get current copytrade positions for a follower wallet. If signature fields are omitted, the tool returns the exact read-signing request that must be signed externally.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: 'string',
          description: 'Follower wallet address.',
        },
        nonce: {
          type: 'string',
          description:
            'Optional read-signature nonce. If omitted, the tool returns a signing request instead of data.',
        },
        timestamp: {
          type: 'number',
          description:
            'Optional read-signature unix timestamp in milliseconds.',
        },
        signature: {
          type: 'string',
          description:
            'Optional external wallet signature for the read request.',
        },
      },
      required: ['address'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_copytrade_activity',
    description: scopedDescription(
      'Get recent copytrade activity for a follower wallet. If signature fields are omitted, the tool returns the exact read-signing request that must be signed externally.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: 'string',
          description: 'Follower wallet address.',
        },
        limit: {
          type: 'number',
          description:
            'Maximum number of activity events to return. Defaults to 50.',
        },
        nonce: {
          type: 'string',
          description:
            'Optional read-signature nonce. If omitted, the tool returns a signing request instead of data.',
        },
        timestamp: {
          type: 'number',
          description:
            'Optional read-signature unix timestamp in milliseconds.',
        },
        signature: {
          type: 'string',
          description:
            'Optional external wallet signature for the read request.',
        },
      },
      required: ['address'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_vault_executions',
    description: scopedDescription(
      'Get recent execution history for a leader vault.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        leaderId: {
          type: 'string',
          description: 'Leader UUID.',
        },
        limit: {
          type: 'number',
          description:
            'Maximum number of executions to return. Defaults to 50.',
        },
      },
      required: ['leaderId'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_leader_api_key_challenge',
    description: scopedDescription(
      'Create a short-lived challenge message required before rotating a copytrade API key for a leader.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        leaderId: {
          type: 'string',
          description: 'Leader UUID.',
        },
        leaderAddress: {
          type: 'string',
          description: 'Leader wallet address that owns the profile.',
        },
      },
      required: ['leaderId', 'leaderAddress'],
      additionalProperties: false,
    },
  },
  {
    name: 'rotate_leader_api_key',
    description: scopedDescription(
      'Rotate or create a copytrade API key for a leader using a signed challenge. The caller must provide a valid wallet signature.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        leaderId: {
          type: 'string',
          description: 'Leader UUID.',
        },
        leaderAddress: {
          type: 'string',
          description: 'Leader wallet address.',
        },
        challengeId: {
          type: 'string',
          description:
            'Challenge identifier returned by create_leader_api_key_challenge.',
        },
        signature: {
          type: 'string',
          description: 'sr25519 signature over the challenge message.',
        },
      },
      required: ['leaderId', 'leaderAddress', 'challengeId', 'signature'],
      additionalProperties: false,
    },
  },
  {
    name: 'submit_copytrade_signal',
    description: scopedDescription(
      'Submit an automated copytrade signal for a leader. Requires a leader API key either in the tool input or via the LUNEX_LEADER_API_KEY environment variable.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        leaderId: {
          type: 'string',
          description: 'Leader UUID.',
        },
        pairSymbol: {
          type: 'string',
          description: 'Trading pair symbol such as BTC/USDT.',
        },
        side: {
          type: 'string',
          description: 'BUY or SELL.',
        },
        positionEffect: {
          type: 'string',
          description:
            'Optional signal intent: AUTO, OPEN, or CLOSE. AUTO resolves from the leader trade journal.',
        },
        signalMode: {
          type: 'string',
          description:
            'Optional execution mode: AUTO, JOURNAL, or EXECUTE_VAULT. AUTO tries live vault execution when a backend-executable route (ORDERBOOK or AMM_V1) is available.',
        },
        amountIn: {
          type: 'string',
          description: 'Input amount as a decimal string.',
        },
        amountOutMin: {
          type: 'string',
          description: 'Minimum output amount as a decimal string.',
        },
        strategyTag: {
          type: 'string',
          description: 'Optional strategy label for the agent execution.',
        },
        route: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional execution route tokens.',
        },
        maxSlippageBps: {
          type: 'number',
          description: 'Optional slippage cap in basis points.',
        },
        executionPrice: {
          type: 'string',
          description: 'Optional execution price.',
        },
        apiKey: {
          type: 'string',
          description:
            'Optional leader API key. If omitted, the MCP server will try LUNEX_LEADER_API_KEY from env.',
        },
      },
      required: ['leaderId', 'pairSymbol', 'side', 'amountIn', 'amountOutMin'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_pending_copytrade_wallet_signals',
    description: scopedDescription(
      'List pending wallet-assisted copytrade continuations for a leader vault. Requires a leader API key either in the tool input or via LUNEX_LEADER_API_KEY.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        leaderId: {
          type: 'string',
          description: 'Leader UUID.',
        },
        limit: {
          type: 'number',
          description:
            'Maximum number of pending continuations to return. Defaults to 50.',
        },
        apiKey: {
          type: 'string',
          description:
            'Optional leader API key. If omitted, MCP uses LUNEX_LEADER_API_KEY.',
        },
      },
      required: ['leaderId'],
      additionalProperties: false,
    },
  },
  {
    name: 'confirm_copytrade_wallet_signal',
    description: scopedDescription(
      'Confirm a wallet-assisted copytrade signal after the on-chain ASYMMETRIC swap is signed and broadcast. If signature fields are omitted, returns the exact wallet-signing request payload.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        leaderId: {
          type: 'string',
          description: 'Leader UUID.',
        },
        signalId: {
          type: 'string',
          description:
            'Copytrade signal UUID that is pending wallet confirmation.',
        },
        leaderAddress: {
          type: 'string',
          description: 'Leader wallet address that signs the confirmation.',
        },
        txHash: {
          type: 'string',
          description:
            'On-chain transaction hash for the wallet-executed swap.',
        },
        amountOut: {
          type: 'string',
          description:
            'Optional executed amountOut to reconcile journal precision.',
        },
        executionPrice: {
          type: 'string',
          description: 'Optional executed price to reconcile signal PnL.',
        },
        nonce: {
          type: 'string',
          description:
            'Optional wallet-signature nonce. If omitted, returns a signing request.',
        },
        timestamp: {
          type: 'number',
          description:
            'Optional wallet-signature unix timestamp in milliseconds.',
        },
        signature: {
          type: 'string',
          description:
            'Optional external wallet signature over action copytrade.confirm-wallet-signal.',
        },
      },
      required: ['leaderId', 'signalId', 'leaderAddress', 'txHash'],
      additionalProperties: false,
    },
  },
  // ─── Agent Ecosystem Tools ──────────────────────────────────────
  {
    name: 'register_agent',
    description: scopedDescription(
      'Register a new trading agent (bot, AI agent, or human trader) on the Lunex platform. If signature fields are omitted, the tool returns the exact wallet-signing request required for registration.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: { type: 'string', description: 'Agent wallet address.' },
        agentType: {
          type: 'string',
          description:
            'Agent type: HUMAN, AI_AGENT, OPENCLAW_BOT, or ALGO_BOT.',
        },
        framework: {
          type: 'string',
          description:
            'Optional framework identifier (e.g. openclaw, langchain).',
        },
        strategyDescription: {
          type: 'string',
          description: 'Optional description of the agent trading strategy.',
        },
        linkLeaderId: {
          type: 'string',
          description:
            'Optional leader UUID to link this agent to an existing leader profile.',
        },
        nonce: {
          type: 'string',
          description:
            'Optional wallet-signature nonce. If omitted, the tool returns a signing request instead of submitting.',
        },
        timestamp: {
          type: 'number',
          description:
            'Optional wallet-signature unix timestamp in milliseconds.',
        },
        signature: {
          type: 'string',
          description: 'Optional external wallet signature for registration.',
        },
      },
      required: ['walletAddress', 'agentType'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_agent_api_key',
    description: scopedDescription(
      'Create an agent API key. For the first key, the tool can return a wallet-signing bootstrap request if no agent API key is provided. For subsequent keys, provide an existing agent API key.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent UUID.' },
        walletAddress: {
          type: 'string',
          description:
            'Agent owner wallet address. Required for first-key bootstrap flow.',
        },
        label: {
          type: 'string',
          description: 'Optional label for the API key.',
        },
        permissions: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Required scoped permissions: TRADE_SPOT, TRADE_MARGIN, SOCIAL_POST, COPYTRADE_SIGNAL, READ_ONLY, MANAGE_ASYMMETRIC.',
        },
        expiresInDays: {
          type: 'number',
          description: 'Optional API key lifetime in days (1-365).',
        },
        apiKey: {
          type: 'string',
          description:
            'Optional existing agent API key used for authenticated key management.',
        },
        nonce: {
          type: 'string',
          description:
            'Optional wallet-signature nonce for first-key bootstrap flow.',
        },
        timestamp: {
          type: 'number',
          description:
            'Optional wallet-signature unix timestamp in milliseconds.',
        },
        signature: {
          type: 'string',
          description:
            'Optional external wallet signature for first-key bootstrap flow.',
        },
      },
      required: ['agentId', 'permissions'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_agents',
    description: scopedDescription(
      'List registered trading agents with optional filters.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        agentType: {
          type: 'string',
          description:
            'Optional filter: HUMAN, AI_AGENT, OPENCLAW_BOT, ALGO_BOT.',
        },
        sortBy: {
          type: 'string',
          description:
            'Optional sort: totalTrades, totalVolume, stakedAmount, createdAt.',
        },
        limit: { type: 'number', description: 'Max results. Defaults to 20.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'agent_swap',
    description: scopedDescription(
      'Execute a market swap as an authenticated agent. Requires LUNEX_AGENT_API_KEY env variable.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        pairSymbol: {
          type: 'string',
          description: 'Trading pair such as LUNES/LUSDT.',
        },
        side: { type: 'string', description: 'BUY or SELL.' },
        amount: {
          type: 'string',
          description: 'Trade amount as a decimal string.',
        },
        apiKey: {
          type: 'string',
          description:
            'Optional agent API key. Falls back to LUNEX_AGENT_API_KEY env.',
        },
      },
      required: ['pairSymbol', 'side', 'amount'],
      additionalProperties: false,
    },
  },
  {
    name: 'agent_limit_order',
    description: scopedDescription(
      'Place a limit order as an authenticated agent. Requires LUNEX_AGENT_API_KEY env variable.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        pairSymbol: {
          type: 'string',
          description: 'Trading pair such as LUNES/LUSDT.',
        },
        side: { type: 'string', description: 'BUY or SELL.' },
        price: {
          type: 'string',
          description: 'Limit price as a decimal string.',
        },
        amount: {
          type: 'string',
          description: 'Order amount as a decimal string.',
        },
        apiKey: {
          type: 'string',
          description:
            'Optional agent API key. Falls back to LUNEX_AGENT_API_KEY env.',
        },
      },
      required: ['pairSymbol', 'side', 'price', 'amount'],
      additionalProperties: false,
    },
  },
  {
    name: 'agent_portfolio',
    description: scopedDescription(
      'Get the portfolio summary for the authenticated agent including balances, orders, and recent trades.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        apiKey: {
          type: 'string',
          description:
            'Optional agent API key. Falls back to LUNEX_AGENT_API_KEY env.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'agent_get_strategy_status',
    description: scopedDescription(
      'Get the current health and parametric curve status of an asymmetric liquidity strategy. Requires MANAGE_ASYMMETRIC permission.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        strategyId: {
          type: 'string',
          description: 'UUID of the asymmetric strategy to inspect.',
        },
        apiKey: {
          type: 'string',
          description:
            'Optional agent API key with MANAGE_ASYMMETRIC permission. Falls back to LUNEX_AGENT_API_KEY env.',
        },
      },
      required: ['strategyId'],
      additionalProperties: false,
    },
  },
  {
    name: 'agent_update_curve_parameters',
    description: scopedDescription(
      'Update the parametric curve parameters (gamma, maxCapacity, feeTargetBps) for one side of an asymmetric strategy. Requires MANAGE_ASYMMETRIC permission. Cannot move funds — only reshapes the liquidity curve.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        strategyId: {
          type: 'string',
          description: 'UUID of the asymmetric strategy to update.',
        },
        isBuySide: {
          type: 'boolean',
          description: 'true = update buy curve, false = update sell curve.',
        },
        newGamma: {
          type: 'number',
          description:
            'Curvature integer 1–5. 1 = near-linear, 5 = highly exponential.',
        },
        newMaxCapacity: {
          type: 'string',
          description:
            'New maximum volume capacity in plancks (string to avoid precision loss).',
        },
        newFeeTargetBps: {
          type: 'number',
          description: 'New fee in basis points (e.g. 30 = 0.30%).',
        },
        apiKey: {
          type: 'string',
          description:
            'Agent API key with MANAGE_ASYMMETRIC permission. Falls back to LUNEX_AGENT_API_KEY env.',
        },
      },
      required: ['strategyId', 'isBuySide'],
      additionalProperties: false,
    },
  },
  {
    name: 'agent_get_asymmetric_delegation_context',
    description: scopedDescription(
      'Get the relayer delegation context required before linking an asymmetric strategy to an authenticated agent. Requires MANAGE_ASYMMETRIC permission.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        apiKey: {
          type: 'string',
          description:
            'Agent API key with MANAGE_ASYMMETRIC permission. Falls back to LUNEX_AGENT_API_KEY env.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'agent_link_asymmetric_strategy',
    description: scopedDescription(
      'Link an existing asymmetric strategy to the authenticated agent after the relayer has been delegated as on-chain manager. Requires MANAGE_ASYMMETRIC permission.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        strategyId: {
          type: 'string',
          description: 'UUID of the asymmetric strategy.',
        },
        pairAddress: {
          type: 'string',
          description:
            'AsymmetricPair ink! contract address used to verify relayer delegation.',
        },
        apiKey: {
          type: 'string',
          description:
            'Agent API key with MANAGE_ASYMMETRIC permission. Falls back to LUNEX_AGENT_API_KEY env.',
        },
      },
      required: ['strategyId', 'pairAddress'],
      additionalProperties: false,
    },
  },
  {
    name: 'agent_create_asymmetric_strategy',
    description: scopedDescription(
      'Suggest and register a new asymmetric liquidity strategy configuration in the backend Sentinel. The on-chain liquidity deposit must be performed separately by the user wallet. Requires MANAGE_ASYMMETRIC permission.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        pairAddress: {
          type: 'string',
          description: 'AsymmetricPair ink! contract address.',
        },
        isAutoRebalance: {
          type: 'boolean',
          description:
            'Enable backend Sentinel auto-rebalancing. Defaults to true.',
        },
        buyK: {
          type: 'string',
          description: 'Base buy-side liquidity in plancks.',
        },
        buyGamma: {
          type: 'number',
          description: 'Buy-side curvature 1–5.',
        },
        buyMaxCapacity: {
          type: 'string',
          description: 'Buy-side maximum capacity in plancks.',
        },
        buyFeeTargetBps: {
          type: 'number',
          description: 'Buy-side fee in basis points. Defaults to 30.',
        },
        sellGamma: {
          type: 'number',
          description: 'Sell-side curvature 1–5.',
        },
        sellMaxCapacity: {
          type: 'string',
          description: 'Sell-side maximum capacity in plancks.',
        },
        sellFeeTargetBps: {
          type: 'number',
          description: 'Sell-side fee in basis points. Defaults to 30.',
        },
        sellProfitTargetBps: {
          type: 'number',
          description:
            'Profit threshold in bps to trigger buy-to-sell rebalance. Defaults to 500 (5%).',
        },
        leverageL: {
          type: 'string',
          description: 'Optional leverage scalar used by the backend model.',
        },
        allocationC: {
          type: 'string',
          description:
            'Optional capital allocation scalar used by the backend model.',
        },
        apiKey: {
          type: 'string',
          description:
            'Agent API key with MANAGE_ASYMMETRIC permission. Falls back to LUNEX_AGENT_API_KEY env.',
        },
      },
      required: ['pairAddress', 'buyK', 'buyMaxCapacity', 'sellMaxCapacity'],
      additionalProperties: false,
    },
  },
  // ─── AI Trading Network: Strategy Layer ─────────────────────────────────
  {
    name: 'list_strategies_marketplace',
    description: scopedDescription(
      'List top AI Trading Network strategies from the public marketplace. Supports text search, type/risk filters, and sort order.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        strategyType: {
          type: 'string',
          description:
            'Filter: COPYTRADE | MARKET_MAKER | ARBITRAGE | MOMENTUM | HEDGE | CUSTOM',
        },
        riskLevel: {
          type: 'string',
          description: 'Filter: LOW | MEDIUM | HIGH | AGGRESSIVE',
        },
        search: {
          type: 'string',
          description: 'Text search on strategy name and description',
        },
        sortBy: {
          type: 'string',
          description:
            'Sort: roi30d | followersCount | totalVolume | sharpeRatio (default: roi30d)',
        },
        limit: { type: 'number', description: 'Max results (default 20)' },
        offset: {
          type: 'number',
          description: 'Pagination offset (default 0)',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_strategy',
    description: scopedDescription(
      'Get detailed information about a specific trading strategy including performance metrics and agent profile.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        strategyId: {
          type: 'string',
          description: 'UUID of the strategy to retrieve.',
        },
      },
      required: ['strategyId'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_strategy_performance',
    description: scopedDescription(
      'Get historical daily performance snapshots for a strategy (ROI, PnL, volume, drawdown).',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        strategyId: { type: 'string', description: 'UUID of the strategy.' },
        days: {
          type: 'number',
          description:
            'Number of days of history to return. Max 365. Defaults to 30.',
        },
      },
      required: ['strategyId'],
      additionalProperties: false,
    },
  },
  {
    name: 'follow_strategy',
    description: scopedDescription(
      'Follow an AI Trading Network strategy. If signature fields are omitted, the tool returns the exact wallet-signing request required for the follow action.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        strategyId: {
          type: 'string',
          description: 'UUID of the strategy to follow.',
        },
        followerAddress: {
          type: 'string',
          description: 'Wallet address of the follower.',
        },
        allocatedCapital: {
          type: 'number',
          description: 'Optional LUNES capital to allocate to this strategy.',
        },
        nonce: {
          type: 'string',
          description:
            'Optional wallet-signature nonce. If omitted, the tool returns a signing request.',
        },
        timestamp: {
          type: 'number',
          description:
            'Optional wallet-signature unix timestamp in milliseconds.',
        },
        signature: {
          type: 'string',
          description:
            'Optional external wallet signature for the follow action.',
        },
      },
      required: ['strategyId', 'followerAddress'],
      additionalProperties: false,
    },
  },
  {
    name: 'unfollow_strategy',
    description: scopedDescription(
      'Unfollow a previously followed AI Trading Network strategy. If signature fields are omitted, the tool returns the exact wallet-signing request required for the unfollow action.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        strategyId: {
          type: 'string',
          description: 'UUID of the strategy to unfollow.',
        },
        followerAddress: {
          type: 'string',
          description: 'Wallet address of the follower.',
        },
        nonce: {
          type: 'string',
          description:
            'Optional wallet-signature nonce. If omitted, the tool returns a signing request.',
        },
        timestamp: {
          type: 'number',
          description:
            'Optional wallet-signature unix timestamp in milliseconds.',
        },
        signature: {
          type: 'string',
          description:
            'Optional external wallet signature for the unfollow action.',
        },
      },
      required: ['strategyId', 'followerAddress'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_followed_strategies',
    description: scopedDescription(
      'Get all strategies currently followed by a wallet address. If signature fields are omitted, the tool returns the exact read-signing request that must be signed externally.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: 'Wallet address to query followed strategies for.',
        },
        nonce: {
          type: 'string',
          description:
            'Optional read-signature nonce. If omitted, the tool returns a signing request instead of data.',
        },
        timestamp: {
          type: 'number',
          description:
            'Optional read-signature unix timestamp in milliseconds.',
        },
        signature: {
          type: 'string',
          description:
            'Optional external wallet signature for the read request.',
        },
      },
      required: ['walletAddress'],
      additionalProperties: false,
    },
  },
  // ─── AI Trading Network: Execution Layer ────────────────────────────────
  {
    name: 'validate_trade',
    description: scopedDescription(
      'Dry-run validate a proposed trade against all Execution Layer risk controls without submitting to the orderbook. Returns allowed status, per-check results, and rejection reason if blocked.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        pairSymbol: {
          type: 'string',
          description: 'Trading pair, e.g. LUNES/LUSDT.',
        },
        side: { type: 'string', description: 'BUY or SELL.' },
        orderType: {
          type: 'string',
          description: 'MARKET, LIMIT, STOP, or STOP_LIMIT.',
        },
        amount: {
          type: 'string',
          description: 'Trade amount as decimal string.',
        },
        price: {
          type: 'string',
          description: 'Optional limit price as decimal string.',
        },
        maxSlippageBps: {
          type: 'number',
          description:
            'Optional max slippage in basis points (1–500). Defaults to 100.',
        },
        strategyId: {
          type: 'string',
          description:
            'Optional strategy UUID to validate against strategy-level risk rules.',
        },
        apiKey: {
          type: 'string',
          description: 'Agent API key. Falls back to LUNEX_AGENT_API_KEY env.',
        },
      },
      required: ['pairSymbol', 'side', 'orderType', 'amount'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_execution_history',
    description: scopedDescription(
      'Get recent execution log entries for the authenticated agent, optionally scoped to a strategy.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        strategyId: {
          type: 'string',
          description: 'Optional strategy UUID to scope history.',
        },
        status: {
          type: 'string',
          description: 'Optional filter: PENDING, EXECUTED, REJECTED, FAILED.',
        },
        pairSymbol: {
          type: 'string',
          description: 'Optional pair symbol filter.',
        },
        since: {
          type: 'string',
          description: 'Optional ISO datetime lower bound.',
        },
        limit: { type: 'number', description: 'Max results. Defaults to 50.' },
        apiKey: {
          type: 'string',
          description: 'Agent API key. Falls back to LUNEX_AGENT_API_KEY env.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_execution_daily_summary',
    description: scopedDescription(
      "Get today's execution summary for the authenticated agent (attempt count, success rate, volume, rejections).",
    ),
    inputSchema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Optional ISO date (YYYY-MM-DD). Defaults to today.',
        },
        apiKey: {
          type: 'string',
          description: 'Agent API key. Falls back to LUNEX_AGENT_API_KEY env.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_execution_risk_params',
    description: scopedDescription(
      'Get current risk parameters for the authenticated agent and optionally a linked strategy (slippage caps, position size limits, daily trade limits).',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        strategyId: {
          type: 'string',
          description:
            'Optional strategy UUID to include strategy-level risk parameters.',
        },
        apiKey: {
          type: 'string',
          description: 'Agent API key. Falls back to LUNEX_AGENT_API_KEY env.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'register_strategy',
    description: scopedDescription(
      'Register a new AI trading strategy on the marketplace. Requires agent API key. Returns the created strategy object with its ID.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Strategy name (max 80 chars)' },
        description: { type: 'string', description: 'Strategy description' },
        strategyType: {
          type: 'string',
          description:
            'COPYTRADE | MARKET_MAKER | ARBITRAGE | MOMENTUM | HEDGE | CUSTOM',
        },
        riskLevel: {
          type: 'string',
          description: 'LOW | MEDIUM | HIGH | AGGRESSIVE',
        },
        vaultAddress: {
          type: 'string',
          description: 'Optional CopyVault on-chain address',
        },
        isPublic: {
          type: 'boolean',
          description: 'Whether to list on public marketplace (default true)',
        },
        apiKey: {
          type: 'string',
          description: 'Agent API key (overrides env)',
        },
      },
      required: ['name', 'strategyType', 'riskLevel'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_strategy',
    description: scopedDescription(
      'Update an existing strategy owned by the authenticated agent. Can change name, description, risk level, status (pause/activate/archive), or vault address.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        strategyId: { type: 'string', description: 'Strategy ID to update' },
        name: { type: 'string', description: 'New strategy name' },
        description: { type: 'string', description: 'New description' },
        strategyType: {
          type: 'string',
          description:
            'COPYTRADE | MARKET_MAKER | ARBITRAGE | MOMENTUM | HEDGE | CUSTOM',
        },
        riskLevel: {
          type: 'string',
          description: 'LOW | MEDIUM | HIGH | AGGRESSIVE',
        },
        status: { type: 'string', description: 'ACTIVE | PAUSED | ARCHIVED' },
        vaultAddress: {
          type: 'string',
          description: 'CopyVault on-chain contract address',
        },
        isPublic: {
          type: 'boolean',
          description: 'Whether to list on public marketplace',
        },
        apiKey: {
          type: 'string',
          description: 'Agent API key (overrides env)',
        },
      },
      required: ['strategyId'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_agent_strategies',
    description: scopedDescription(
      'List all strategies owned by the authenticated agent, including paused and archived ones.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        search: {
          type: 'string',
          description: 'Text search on strategy name and description',
        },
        status: {
          type: 'string',
          description:
            'Filter by status: ACTIVE | PAUSED | ARCHIVED (default: all)',
        },
        sortBy: {
          type: 'string',
          description:
            'Sort field: roi30d | followersCount | sharpeRatio | totalVolume | createdAt (default: createdAt)',
        },
        limit: { type: 'number', description: 'Max results (default 20)' },
        offset: { type: 'number', description: 'Pagination offset' },
        apiKey: {
          type: 'string',
          description: 'Agent API key (overrides env)',
        },
      },
      additionalProperties: false,
    },
  },
] as const;

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as JsonObject;
}

function getRequiredString(args: JsonObject, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new McpError(ErrorCode.InvalidParams, `${key} is required`);
  }
  return value;
}

function getOptionalString(args: JsonObject, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function getOptionalNumber(args: JsonObject, key: string): number | undefined {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function getOptionalStringArray(
  args: JsonObject,
  key: string,
): string[] | undefined {
  const value = args[key];
  if (!Array.isArray(value)) return undefined;
  const items = value.filter(
    (item): item is string => typeof item === 'string' && item.trim() !== '',
  );
  return items.length > 0 ? items : undefined;
}

function getOptionalInteger(
  args: JsonObject,
  key: string,
  min: number,
  max: number,
) {
  const value = args[key];
  if (value === undefined) return undefined;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `${key} must be an integer between ${min} and ${max}`,
    );
  }
  return value;
}

function getRequiredBoolean(args: JsonObject, key: string): boolean {
  const value = args[key];
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }

  throw new McpError(
    ErrorCode.InvalidParams,
    `${key} must be a boolean (true/false)`,
  );
}

function getOptionalPositiveInteger(args: JsonObject, key: string) {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `${key} must be a positive integer`,
    );
  }
  return value;
}

function assertPositiveNumberString(value: string, field: string) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `${field} must be a positive number string`,
    );
  }
}

function assertEnum(value: string, allowed: readonly string[], field: string) {
  if (!allowed.includes(value)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `${field} must be one of: ${allowed.join(', ')}`,
    );
  }
}

function assertOptionalIsoDatetime(value: string | undefined, field: string) {
  if (value && Number.isNaN(Date.parse(value))) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `${field} must be a valid ISO datetime string`,
    );
  }
}

function normalizeSignedValue(
  value: string | number | boolean | Array<string | number> | undefined | null,
) {
  if (Array.isArray(value)) {
    return value.join(',');
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return value == null ? '' : String(value);
}

function buildWalletActionSignMessage(input: {
  action: string;
  address: string;
  nonce: string;
  timestamp: number;
  fields?: Record<
    string,
    string | number | boolean | Array<string | number> | undefined | null
  >;
}) {
  const lines = [`lunex-auth:${input.action}`, `address:${input.address}`];

  const orderedFields = Object.entries(input.fields ?? {})
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([left], [right]) => left.localeCompare(right));

  for (const [key, value] of orderedFields) {
    lines.push(`${key}:${normalizeSignedValue(value)}`);
  }

  lines.push(`nonce:${input.nonce}`);
  lines.push(`timestamp:${normalizeSignedValue(input.timestamp)}`);
  return lines.join('\n');
}

function buildWalletSigningRequest(input: {
  tool: string;
  action: string;
  address: string;
  nonce: string;
  timestamp: number;
  fields?: Record<
    string,
    string | number | boolean | Array<string | number> | undefined | null
  >;
  note?: string;
}) {
  return {
    tool: input.tool,
    requiresExternalSignature: true,
    signingRequest: {
      action: input.action,
      address: input.address,
      nonce: input.nonce,
      timestamp: input.timestamp,
      fields: input.fields ?? {},
      message: buildWalletActionSignMessage({
        action: input.action,
        address: input.address,
        nonce: input.nonce,
        timestamp: input.timestamp,
        fields: input.fields,
      }),
    },
    nextStep:
      'Sign the message externally with the same wallet, then call this tool again with the original arguments plus nonce, timestamp, and signature.',
    note: input.note,
  };
}

function getWalletSignatureArgs(args: JsonObject) {
  const signature = getOptionalString(args, 'signature');
  const providedNonce = getOptionalString(args, 'nonce');
  const providedTimestamp = getOptionalPositiveInteger(args, 'timestamp');

  if (signature && (!providedNonce || !providedTimestamp)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'nonce and timestamp are required whenever signature is provided',
    );
  }

  return {
    nonce: providedNonce ?? generateNonce(),
    timestamp: providedTimestamp ?? Date.now(),
    signature,
  };
}

function validateSpotOrderInput(input: {
  pairSymbol: string;
  side: string;
  type: string;
  amount: string;
  makerAddress: string;
  price?: string;
  stopPrice?: string;
  timeInForce?: string;
  expiresAt?: string;
}) {
  if (!input.pairSymbol.trim()) {
    throw new McpError(ErrorCode.InvalidParams, 'pairSymbol is required');
  }
  if (!input.makerAddress.trim()) {
    throw new McpError(ErrorCode.InvalidParams, 'makerAddress is required');
  }

  assertEnum(input.side, ['BUY', 'SELL'], 'side');
  assertEnum(input.type, ['LIMIT', 'MARKET', 'STOP', 'STOP_LIMIT'], 'type');
  assertPositiveNumberString(input.amount, 'amount');

  if ((input.type === 'LIMIT' || input.type === 'STOP_LIMIT') && !input.price) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'price is required for LIMIT and STOP_LIMIT orders',
    );
  }
  if (
    (input.type === 'STOP' || input.type === 'STOP_LIMIT') &&
    !input.stopPrice
  ) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'stopPrice is required for STOP and STOP_LIMIT orders',
    );
  }
  if (input.price) {
    assertPositiveNumberString(input.price, 'price');
  }
  if (input.stopPrice) {
    assertPositiveNumberString(input.stopPrice, 'stopPrice');
  }
  if (input.timeInForce) {
    assertEnum(input.timeInForce, ['GTC', 'IOC', 'FOK'], 'timeInForce');
  }
  assertOptionalIsoDatetime(input.expiresAt, 'expiresAt');
}

function toQuery(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

async function requestJson(path: string, init?: RequestInit, apiKey?: string) {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('x-lunex-client', 'mcp');
  if (backendOriginHeader && !headers.has('Origin')) {
    headers.set('Origin', backendOriginHeader);
  }

  if (apiKey) {
    headers.set('x-api-key', apiKey);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const message =
      typeof data?.error === 'string' ? data.error : `HTTP ${response.status}`;
    if (response.status >= 400 && response.status < 500) {
      throw new McpError(ErrorCode.InvalidParams, message);
    }
    throw new McpError(ErrorCode.InternalError, message);
  }

  return data;
}

function textResult(payload: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function resourceTextResult(uri: string, text: string, mimeType: string) {
  return {
    contents: [
      {
        uri,
        mimeType,
        text,
      },
    ],
  };
}

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: resourceDefinitions.map((resource) => ({
    uri: resource.uri,
    name: resource.name,
    description: resource.description,
    mimeType: resource.mimeType,
  })),
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  switch (request.params.uri) {
    case 'lunex://scope':
      return resourceTextResult(
        'lunex://scope',
        JSON.stringify(buildServerScopePayload(), null, 2),
        'application/json',
      );
    case 'lunex://docs/spot-authenticated-trading':
      return resourceTextResult(
        'lunex://docs/spot-authenticated-trading',
        buildSpotTradingDocs(),
        'text/markdown',
      );
    case 'lunex://config/runtime':
      return resourceTextResult(
        'lunex://config/runtime',
        JSON.stringify(buildRuntimeConfigPayload(), null, 2),
        'application/json',
      );
    case 'lunex://config/openclaw':
      return resourceTextResult(
        'lunex://config/openclaw',
        JSON.stringify(buildOpenClawConfigPayload(), null, 2),
        'application/json',
      );
    default:
      throw new McpError(
        ErrorCode.InvalidParams,
        `Unknown resource: ${request.params.uri}`,
      );
  }
});

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: promptDefinitions.map((prompt) => ({
    name: prompt.name,
    description: prompt.description,
    arguments: prompt.arguments,
  })),
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const args = request.params.arguments || {};

  switch (request.params.name) {
    case 'openclaw_scope_guard': {
      const userGoal =
        args.userGoal || 'Evaluate the request within Lunex MCP scope.';
      return buildScopeGuardPrompt(userGoal);
    }
    case 'openclaw_authenticated_spot_trade': {
      return buildAuthenticatedSpotTradePrompt(args);
    }
    case 'openclaw_social_copytrade_scan': {
      return buildSocialCopytradePrompt(args);
    }
    default:
      throw new McpError(
        ErrorCode.InvalidParams,
        `Unknown prompt: ${request.params.name}`,
      );
  }
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolDefinitions.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = asObject(request.params.arguments);

  switch (request.params.name) {
    case 'get_server_scope': {
      return textResult(buildServerScopePayload());
    }
    case 'get_lunex_health': {
      const data = await requestJson('/health');
      return textResult(data);
    }
    case 'list_pairs': {
      const data = await requestJson('/api/v1/pairs');
      return textResult(data);
    }
    case 'get_pair_ticker': {
      const symbol = encodeURIComponent(getRequiredString(args, 'symbol'));
      const data = await requestJson(`/api/v1/pairs/${symbol}/ticker`);
      return textResult(data);
    }
    case 'get_orderbook': {
      const symbol = encodeURIComponent(getRequiredString(args, 'symbol'));
      const depth = getOptionalNumber(args, 'depth');
      const query = toQuery({ depth });
      const data = await requestJson(`/api/v1/orderbook/${symbol}${query}`);
      return textResult(data);
    }
    case 'get_recent_trades': {
      const symbol = encodeURIComponent(getRequiredString(args, 'symbol'));
      const limit = getOptionalNumber(args, 'limit');
      const query = toQuery({ limit });
      const data = await requestJson(`/api/v1/trades/${symbol}${query}`);
      return textResult(data);
    }
    case 'get_candles': {
      const symbol = encodeURIComponent(getRequiredString(args, 'symbol'));
      const timeframe = getOptionalString(args, 'timeframe');
      const limit = getOptionalNumber(args, 'limit');
      const query = toQuery({ timeframe, limit });
      const data = await requestJson(`/api/v1/candles/${symbol}${query}`);
      return textResult(data);
    }
    case 'get_router_quote': {
      return textResult(await getRouterQuoteTool(args, { requestJson }));
    }
    case 'agent_router_swap': {
      return textResult(
        await agentRouterSwapTool(args, {
          requestJson,
          defaultAgentApiKey,
        }),
      );
    }
    case 'prepare_spot_order_signature': {
      const pairSymbol = getRequiredString(args, 'pairSymbol');
      const side = getRequiredString(args, 'side');
      const type = getRequiredString(args, 'type');
      const amount = getRequiredString(args, 'amount');
      const makerAddress = getRequiredString(args, 'makerAddress');
      const price = getOptionalString(args, 'price');
      const stopPrice = getOptionalString(args, 'stopPrice');
      const timeInForce = getOptionalString(args, 'timeInForce') || 'GTC';
      const expiresAt = getOptionalString(args, 'expiresAt');
      const nonce = getOptionalString(args, 'nonce') || generateNonce();
      const timestamp =
        getOptionalPositiveInteger(args, 'timestamp') ?? Date.now();

      validateSpotOrderInput({
        pairSymbol,
        side,
        type,
        amount,
        makerAddress,
        price,
        stopPrice,
        timeInForce,
        expiresAt,
      });

      return textResult({
        nonce,
        timestamp,
        message: buildSpotOrderSignMessage({
          pairSymbol,
          side,
          type,
          price,
          stopPrice,
          amount,
          nonce,
          timestamp,
        }),
        order: {
          pairSymbol,
          side,
          type,
          amount,
          makerAddress,
          price,
          stopPrice,
          timeInForce,
          expiresAt,
          nonce,
          timestamp,
        },
      });
    }
    case 'create_spot_order': {
      const pairSymbol = getRequiredString(args, 'pairSymbol');
      const side = getRequiredString(args, 'side');
      const type = getRequiredString(args, 'type');
      const amount = getRequiredString(args, 'amount');
      const makerAddress = getRequiredString(args, 'makerAddress');
      const nonce = getRequiredString(args, 'nonce');
      const timestamp = getOptionalPositiveInteger(args, 'timestamp');
      const signature = getRequiredString(args, 'signature');
      const price = getOptionalString(args, 'price');
      const stopPrice = getOptionalString(args, 'stopPrice');
      const timeInForce = getOptionalString(args, 'timeInForce') || 'GTC';
      const expiresAt = getOptionalString(args, 'expiresAt');

      if (!timestamp) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'timestamp is required for create_spot_order',
        );
      }

      validateSpotOrderInput({
        pairSymbol,
        side,
        type,
        amount,
        makerAddress,
        price,
        stopPrice,
        timeInForce,
        expiresAt,
      });

      const data = await requestJson('/api/v1/orders', {
        method: 'POST',
        body: JSON.stringify({
          pairSymbol,
          side,
          type,
          amount,
          makerAddress,
          nonce,
          timestamp,
          signature,
          price,
          stopPrice,
          timeInForce,
          expiresAt,
        }),
      });
      return textResult(data);
    }
    case 'prepare_spot_cancel_signature': {
      const orderId = getRequiredString(args, 'orderId');
      const makerAddress = getRequiredString(args, 'makerAddress');

      return textResult({
        message: buildSpotCancelSignMessage(orderId),
        cancellation: {
          orderId,
          makerAddress,
        },
      });
    }
    case 'cancel_spot_order': {
      const orderId = getRequiredString(args, 'orderId');
      const makerAddress = getRequiredString(args, 'makerAddress');
      const signature = getRequiredString(args, 'signature');

      const data = await requestJson(
        `/api/v1/orders/${encodeURIComponent(orderId)}`,
        {
          method: 'DELETE',
          body: JSON.stringify({
            makerAddress,
            signature,
          }),
        },
      );
      return textResult(data);
    }
    case 'get_user_orders': {
      const makerAddress = getRequiredString(args, 'makerAddress');
      const status = getOptionalString(args, 'status');
      const limit = getOptionalInteger(args, 'limit', 1, 100);
      const offset = getOptionalInteger(args, 'offset', 0, 1000000);
      const signed = getWalletSignatureArgs(args);

      if (!signed.signature) {
        return textResult(
          buildWalletSigningRequest({
            tool: 'get_user_orders',
            action: 'orders.list',
            address: makerAddress,
            nonce: signed.nonce,
            timestamp: signed.timestamp,
            fields: {
              status,
              limit: limit ?? 50,
              offset: offset ?? 0,
            },
          }),
        );
      }

      const query = toQuery({
        makerAddress,
        status,
        limit,
        offset,
        nonce: signed.nonce,
        timestamp: signed.timestamp,
        signature: signed.signature,
      });
      const data = await requestJson(`/api/v1/orders${query}`);
      return textResult(data);
    }
    case 'get_user_trade_history': {
      const address = getRequiredString(args, 'address');
      const limit = getOptionalInteger(args, 'limit', 1, 100);
      const offset = getOptionalInteger(args, 'offset', 0, 1000000);
      const signed = getWalletSignatureArgs(args);

      if (!signed.signature) {
        return textResult(
          buildWalletSigningRequest({
            tool: 'get_user_trade_history',
            action: 'trades.list',
            address,
            nonce: signed.nonce,
            timestamp: signed.timestamp,
            fields: {
              limit: limit ?? 50,
              offset: offset ?? 0,
            },
          }),
        );
      }

      const query = toQuery({
        address,
        limit,
        offset,
        nonce: signed.nonce,
        timestamp: signed.timestamp,
        signature: signed.signature,
      });
      const data = await requestJson(`/api/v1/trades${query}`);
      return textResult(data);
    }
    case 'list_social_leaders': {
      const tab = getOptionalString(args, 'tab');
      const search = getOptionalString(args, 'search');
      const sortBy = getOptionalString(args, 'sortBy');
      const limit = getOptionalNumber(args, 'limit');
      const query = toQuery({ tab, search, sortBy, limit });
      const data = await requestJson(`/api/v1/social/leaders${query}`);
      return textResult(data);
    }
    case 'get_leader_profile': {
      const leaderId = getRequiredString(args, 'leaderId');
      const viewerAddress = getOptionalString(args, 'viewerAddress');
      if (!viewerAddress) {
        const data = await requestJson(`/api/v1/social/leaders/${leaderId}`);
        return textResult(data);
      }

      const signed = getWalletSignatureArgs(args);
      if (!signed.signature) {
        return textResult(
          buildWalletSigningRequest({
            tool: 'get_leader_profile',
            action: 'social.leader-profile',
            address: viewerAddress,
            nonce: signed.nonce,
            timestamp: signed.timestamp,
            fields: {
              leaderId,
            },
          }),
        );
      }

      const query = toQuery({
        viewerAddress,
        nonce: signed.nonce,
        timestamp: signed.timestamp,
        signature: signed.signature,
      });
      const data = await requestJson(
        `/api/v1/social/leaders/${leaderId}${query}`,
      );
      return textResult(data);
    }
    case 'list_copytrade_vaults': {
      const data = await requestJson('/api/v1/copytrade/vaults');
      return textResult(data);
    }
    case 'get_copytrade_vault': {
      const leaderId = getRequiredString(args, 'leaderId');
      const data = await requestJson(`/api/v1/copytrade/vaults/${leaderId}`);
      return textResult(data);
    }
    case 'get_copytrade_positions': {
      const address = getRequiredString(args, 'address');
      const signed = getWalletSignatureArgs(args);

      if (!signed.signature) {
        return textResult(
          buildWalletSigningRequest({
            tool: 'get_copytrade_positions',
            action: 'copytrade.positions',
            address,
            nonce: signed.nonce,
            timestamp: signed.timestamp,
          }),
        );
      }

      const query = toQuery({
        address,
        nonce: signed.nonce,
        timestamp: signed.timestamp,
        signature: signed.signature,
      });
      const data = await requestJson(`/api/v1/copytrade/positions${query}`);
      return textResult(data);
    }
    case 'get_copytrade_activity': {
      const address = getRequiredString(args, 'address');
      const limit = getOptionalNumber(args, 'limit');
      const signed = getWalletSignatureArgs(args);

      if (!signed.signature) {
        return textResult(
          buildWalletSigningRequest({
            tool: 'get_copytrade_activity',
            action: 'copytrade.activity',
            address,
            nonce: signed.nonce,
            timestamp: signed.timestamp,
            fields: {
              limit: limit ?? 50,
            },
          }),
        );
      }

      const query = toQuery({
        address,
        limit,
        nonce: signed.nonce,
        timestamp: signed.timestamp,
        signature: signed.signature,
      });
      const data = await requestJson(`/api/v1/copytrade/activity${query}`);
      return textResult(data);
    }
    case 'get_vault_executions': {
      const leaderId = getRequiredString(args, 'leaderId');
      const limit = getOptionalNumber(args, 'limit');
      const query = toQuery({ limit });
      const data = await requestJson(
        `/api/v1/copytrade/vaults/${leaderId}/executions${query}`,
      );
      return textResult(data);
    }
    case 'create_leader_api_key_challenge': {
      const leaderId = getRequiredString(args, 'leaderId');
      const leaderAddress = getRequiredString(args, 'leaderAddress');
      const query = toQuery({ leaderAddress });
      const data = await requestJson(
        `/api/v1/copytrade/leaders/${leaderId}/api-key/challenge${query}`,
      );
      return textResult(data);
    }
    case 'rotate_leader_api_key': {
      const leaderId = getRequiredString(args, 'leaderId');
      const leaderAddress = getRequiredString(args, 'leaderAddress');
      const challengeId = getRequiredString(args, 'challengeId');
      const signature = getRequiredString(args, 'signature');
      const data = await requestJson(
        `/api/v1/copytrade/leaders/${leaderId}/api-key`,
        {
          method: 'POST',
          body: JSON.stringify({
            leaderAddress,
            challengeId,
            signature,
          }),
        },
      );
      return textResult(data);
    }
    case 'submit_copytrade_signal': {
      const leaderId = getRequiredString(args, 'leaderId');
      const pairSymbol = getRequiredString(args, 'pairSymbol');
      const side = getRequiredString(args, 'side');
      const positionEffect = getOptionalString(args, 'positionEffect');
      const signalMode = getOptionalString(args, 'signalMode');
      const amountIn = getRequiredString(args, 'amountIn');
      const amountOutMin = getRequiredString(args, 'amountOutMin');
      const strategyTag = getOptionalString(args, 'strategyTag');
      const route = getOptionalStringArray(args, 'route');
      const maxSlippageBps = getOptionalNumber(args, 'maxSlippageBps');
      const executionPrice = getOptionalString(args, 'executionPrice');
      const apiKey = getOptionalString(args, 'apiKey');

      if (!apiKey && !defaultLeaderApiKey) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'submit_copytrade_signal requires apiKey in input or LUNEX_LEADER_API_KEY in the MCP server environment',
        );
      }

      const data = await requestJson(
        `/api/v1/copytrade/vaults/${leaderId}/signals`,
        {
          method: 'POST',
          body: JSON.stringify({
            pairSymbol,
            side,
            positionEffect,
            signalMode,
            source: 'API',
            strategyTag,
            amountIn,
            amountOutMin,
            route,
            maxSlippageBps,
            executionPrice,
          }),
        },
        apiKey || defaultLeaderApiKey,
      );
      return textResult(data);
    }
    case 'list_pending_copytrade_wallet_signals': {
      const leaderId = getRequiredString(args, 'leaderId');
      const limit = getOptionalNumber(args, 'limit');
      const apiKey = getOptionalString(args, 'apiKey');

      if (!apiKey && !defaultLeaderApiKey) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'list_pending_copytrade_wallet_signals requires apiKey in input or LUNEX_LEADER_API_KEY in the MCP server environment',
        );
      }

      const query = toQuery({ limit: limit ?? 50 });
      const data = await requestJson(
        `/api/v1/copytrade/vaults/${leaderId}/signals/pending-wallet${query}`,
        undefined,
        apiKey || defaultLeaderApiKey,
      );
      return textResult(data);
    }
    case 'confirm_copytrade_wallet_signal': {
      const leaderId = getRequiredString(args, 'leaderId');
      const signalId = getRequiredString(args, 'signalId');
      const leaderAddress = getRequiredString(args, 'leaderAddress');
      const txHash = getRequiredString(args, 'txHash');
      const amountOut = getOptionalString(args, 'amountOut');
      const executionPrice = getOptionalString(args, 'executionPrice');
      const signed = getWalletSignatureArgs(args);

      if (!signed.signature) {
        return textResult(
          buildWalletSigningRequest({
            tool: 'confirm_copytrade_wallet_signal',
            action: 'copytrade.confirm-wallet-signal',
            address: leaderAddress,
            nonce: signed.nonce,
            timestamp: signed.timestamp,
            fields: {
              leaderId,
              signalId,
              txHash,
              amountOut: amountOut || '',
              executionPrice: executionPrice || '',
            },
          }),
        );
      }

      const data = await requestJson(
        `/api/v1/copytrade/vaults/${leaderId}/signals/${signalId}/wallet-confirmation`,
        {
          method: 'POST',
          body: JSON.stringify({
            leaderAddress,
            txHash,
            amountOut,
            executionPrice,
            nonce: signed.nonce,
            timestamp: signed.timestamp,
            signature: signed.signature,
          }),
        },
      );
      return textResult(data);
    }
    // ─── Agent Ecosystem Handlers ───────────────────────────────────
    case 'register_agent': {
      const walletAddress = getRequiredString(args, 'walletAddress');
      const agentType = getRequiredString(args, 'agentType');
      assertEnum(
        agentType,
        ['HUMAN', 'AI_AGENT', 'OPENCLAW_BOT', 'ALGO_BOT'],
        'agentType',
      );
      const framework = getOptionalString(args, 'framework');
      const strategyDescription = getOptionalString(
        args,
        'strategyDescription',
      );
      const linkLeaderId = getOptionalString(args, 'linkLeaderId');
      const signed = getWalletSignatureArgs(args);

      if (!signed.signature) {
        return textResult(
          buildWalletSigningRequest({
            tool: 'register_agent',
            action: 'agents.register',
            address: walletAddress,
            nonce: signed.nonce,
            timestamp: signed.timestamp,
            fields: {
              agentType,
              framework,
              strategyDescription,
              linkLeaderId,
            },
          }),
        );
      }

      const data = await requestJson('/api/v1/agents/register', {
        method: 'POST',
        body: JSON.stringify({
          walletAddress,
          agentType,
          framework,
          strategyDescription,
          linkLeaderId,
          nonce: signed.nonce,
          timestamp: signed.timestamp,
          signature: signed.signature,
        }),
      });
      return textResult(data);
    }
    case 'create_agent_api_key': {
      const agentId = getRequiredString(args, 'agentId');
      const explicitApiKey = getOptionalString(args, 'apiKey');
      const walletAddress = getOptionalString(args, 'walletAddress');
      const label = getOptionalString(args, 'label');
      const expiresInDays = getOptionalInteger(args, 'expiresInDays', 1, 365);
      const permissions = getOptionalStringArray(args, 'permissions');

      if (!permissions || permissions.length === 0) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'permissions must contain at least one permission',
        );
      }
      for (const permission of permissions) {
        assertEnum(
          permission,
          [
            'TRADE_SPOT',
            'TRADE_MARGIN',
            'SOCIAL_POST',
            'COPYTRADE_SIGNAL',
            'READ_ONLY',
            'MANAGE_ASYMMETRIC',
          ],
          'permissions',
        );
      }

      const apiKey =
        explicitApiKey || (!walletAddress ? defaultAgentApiKey : undefined);

      if (apiKey) {
        const data = await requestJson(
          `/api/v1/agents/${encodeURIComponent(agentId)}/api-keys`,
          {
            method: 'POST',
            body: JSON.stringify({
              label,
              permissions,
              expiresInDays,
            }),
          },
          apiKey,
        );
        return textResult(data);
      }

      if (!walletAddress) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'walletAddress is required when bootstrapping the first API key without an existing agent apiKey',
        );
      }

      const signed = getWalletSignatureArgs(args);
      if (!signed.signature) {
        return textResult(
          buildWalletSigningRequest({
            tool: 'create_agent_api_key',
            action: 'agents.create-api-key',
            address: walletAddress,
            nonce: signed.nonce,
            timestamp: signed.timestamp,
            fields: {
              agentId,
              label,
              permissions,
              expiresInDays,
            },
            note: 'This signing request is only needed for the first API key or other wallet-bootstrap flows. Subsequent key management can use an authenticated agent API key.',
          }),
        );
      }

      const data = await requestJson(
        `/api/v1/agents/${encodeURIComponent(agentId)}/api-keys`,
        {
          method: 'POST',
          body: JSON.stringify({
            walletAddress,
            label,
            permissions,
            expiresInDays,
            nonce: signed.nonce,
            timestamp: signed.timestamp,
            signature: signed.signature,
          }),
        },
      );
      return textResult(data);
    }
    case 'list_agents': {
      const agentType = getOptionalString(args, 'agentType');
      const sortBy = getOptionalString(args, 'sortBy');
      const limit = getOptionalNumber(args, 'limit');
      const query = toQuery({ agentType, sortBy, limit });
      const data = await requestJson(`/api/v1/agents${query}`);
      return textResult(data);
    }
    case 'agent_swap': {
      const pairSymbol = getRequiredString(args, 'pairSymbol');
      const side = getRequiredString(args, 'side');
      const amount = getRequiredString(args, 'amount');
      assertEnum(side, ['BUY', 'SELL'], 'side');
      assertPositiveNumberString(amount, 'amount');
      const apiKey = getOptionalString(args, 'apiKey') || defaultAgentApiKey;

      if (!apiKey) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'agent_swap requires apiKey in input or LUNEX_AGENT_API_KEY env',
        );
      }

      const data = await requestJson(
        '/api/v1/trade/swap',
        {
          method: 'POST',
          body: JSON.stringify({ pairSymbol, side, amount }),
        },
        apiKey,
      );
      return textResult(data);
    }
    case 'agent_limit_order': {
      const pairSymbol = getRequiredString(args, 'pairSymbol');
      const side = getRequiredString(args, 'side');
      const price = getRequiredString(args, 'price');
      const amount = getRequiredString(args, 'amount');
      assertEnum(side, ['BUY', 'SELL'], 'side');
      assertPositiveNumberString(price, 'price');
      assertPositiveNumberString(amount, 'amount');
      const apiKey = getOptionalString(args, 'apiKey') || defaultAgentApiKey;

      if (!apiKey) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'agent_limit_order requires apiKey in input or LUNEX_AGENT_API_KEY env',
        );
      }

      const data = await requestJson(
        '/api/v1/trade/limit',
        {
          method: 'POST',
          body: JSON.stringify({ pairSymbol, side, price, amount }),
        },
        apiKey,
      );
      return textResult(data);
    }
    case 'agent_portfolio': {
      const apiKey = getOptionalString(args, 'apiKey') || defaultAgentApiKey;

      if (!apiKey) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'agent_portfolio requires apiKey in input or LUNEX_AGENT_API_KEY env',
        );
      }

      const data = await requestJson('/api/v1/trade/portfolio', {}, apiKey);
      return textResult(data);
    }
    case 'agent_get_strategy_status': {
      const strategyId = getRequiredString(args, 'strategyId');
      const apiKey = getOptionalString(args, 'apiKey') || defaultAgentApiKey;
      if (!apiKey) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'agent_get_strategy_status requires MANAGE_ASYMMETRIC apiKey in input or LUNEX_AGENT_API_KEY env',
        );
      }
      const data = await requestJson(
        `/api/v1/asymmetric/agent/strategy-status/${encodeURIComponent(strategyId)}`,
        {},
        apiKey,
      );
      return textResult(data);
    }
    case 'agent_update_curve_parameters': {
      const strategyId = getRequiredString(args, 'strategyId');
      const apiKey = getOptionalString(args, 'apiKey') || defaultAgentApiKey;

      if (!apiKey) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'agent_update_curve_parameters requires MANAGE_ASYMMETRIC apiKey in input or LUNEX_AGENT_API_KEY env',
        );
      }

      const isBuySide = getRequiredBoolean(args, 'isBuySide');
      const newGamma = getOptionalInteger(args, 'newGamma', 1, 5);
      const newMaxCapacity = getOptionalString(args, 'newMaxCapacity');
      const newFeeTargetBps = getOptionalInteger(
        args,
        'newFeeTargetBps',
        1,
        10000,
      );

      const data = await requestJson(
        '/api/v1/asymmetric/agent/update-curve',
        {
          method: 'POST',
          body: JSON.stringify({
            strategyId,
            isBuySide,
            newGamma,
            newMaxCapacity,
            newFeeTargetBps,
          }),
        },
        apiKey,
      );
      return textResult(data);
    }
    case 'agent_get_asymmetric_delegation_context': {
      const apiKey = getOptionalString(args, 'apiKey') || defaultAgentApiKey;

      if (!apiKey) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'agent_get_asymmetric_delegation_context requires MANAGE_ASYMMETRIC apiKey in input or LUNEX_AGENT_API_KEY env',
        );
      }

      const data = await requestJson(
        '/api/v1/asymmetric/agent/delegation-context',
        {},
        apiKey,
      );
      return textResult(data);
    }
    case 'agent_link_asymmetric_strategy': {
      const strategyId = getRequiredString(args, 'strategyId');
      const pairAddress = getRequiredString(args, 'pairAddress');
      const apiKey = getOptionalString(args, 'apiKey') || defaultAgentApiKey;

      if (!apiKey) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'agent_link_asymmetric_strategy requires MANAGE_ASYMMETRIC apiKey in input or LUNEX_AGENT_API_KEY env',
        );
      }

      const data = await requestJson(
        '/api/v1/asymmetric/agent/link-strategy',
        {
          method: 'POST',
          body: JSON.stringify({ strategyId, pairAddress }),
        },
        apiKey,
      );
      return textResult(data);
    }
    case 'agent_create_asymmetric_strategy': {
      const pairAddress = getRequiredString(args, 'pairAddress');
      const apiKey = getOptionalString(args, 'apiKey') || defaultAgentApiKey;

      if (!apiKey) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'agent_create_asymmetric_strategy requires MANAGE_ASYMMETRIC apiKey in input or LUNEX_AGENT_API_KEY env',
        );
      }

      const buyK = getRequiredString(args, 'buyK');
      const buyGamma = getOptionalInteger(args, 'buyGamma', 1, 5) ?? 3;
      const buyMaxCapacity = getRequiredString(args, 'buyMaxCapacity');
      const sellGamma = getOptionalInteger(args, 'sellGamma', 1, 5) ?? 2;
      const sellMaxCapacity = getRequiredString(args, 'sellMaxCapacity');

      const data = await requestJson(
        '/api/v1/asymmetric/agent/create-strategy',
        {
          method: 'POST',
          body: JSON.stringify({
            pairAddress,
            isAutoRebalance: args.isAutoRebalance ?? true,
            buyK,
            buyGamma,
            buyMaxCapacity,
            buyFeeTargetBps: args.buyFeeTargetBps,
            sellGamma,
            sellMaxCapacity,
            sellFeeTargetBps: args.sellFeeTargetBps,
            sellProfitTargetBps: args.sellProfitTargetBps,
            leverageL: getOptionalString(args, 'leverageL'),
            allocationC: getOptionalString(args, 'allocationC'),
          }),
        },
        apiKey,
      );
      return textResult(data);
    }
    // ─── AI Trading Network: Execution Layer ────────────────────────
    case 'validate_trade': {
      const pairSymbol = getRequiredString(args, 'pairSymbol');
      const side = getRequiredString(args, 'side');
      const orderType = getRequiredString(args, 'orderType');
      const amount = getRequiredString(args, 'amount');
      const price = getOptionalString(args, 'price');
      const maxSlippageBps = getOptionalNumber(args, 'maxSlippageBps');
      const strategyId = getOptionalString(args, 'strategyId');
      const apiKey = getOptionalString(args, 'apiKey') || defaultAgentApiKey;

      if (!apiKey) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'validate_trade requires apiKey in input or LUNEX_AGENT_API_KEY env',
        );
      }

      assertEnum(side, ['BUY', 'SELL'], 'side');
      assertEnum(
        orderType,
        ['MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT'],
        'orderType',
      );
      assertPositiveNumberString(amount, 'amount');

      const body: Record<string, unknown> = {
        pairSymbol,
        side,
        orderType,
        amount,
      };
      if (price) body.price = price;
      if (maxSlippageBps) body.maxSlippageBps = maxSlippageBps;
      if (strategyId) body.strategyId = strategyId;

      const data = await requestJson(
        '/api/v1/execution/validate',
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
        apiKey,
      );
      return textResult(data);
    }
    case 'get_execution_history': {
      const strategyId = getOptionalString(args, 'strategyId');
      const status = getOptionalString(args, 'status');
      const pairSymbol = getOptionalString(args, 'pairSymbol');
      const since = getOptionalString(args, 'since');
      const limit = getOptionalNumber(args, 'limit');
      const apiKey = getOptionalString(args, 'apiKey') || defaultAgentApiKey;

      if (!apiKey) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'get_execution_history requires apiKey in input or LUNEX_AGENT_API_KEY env',
        );
      }

      const query = toQuery({ strategyId, status, pairSymbol, since, limit });
      const data = await requestJson(
        `/api/v1/execution/history${query}`,
        {},
        apiKey,
      );
      return textResult(data);
    }
    case 'get_execution_daily_summary': {
      const date = getOptionalString(args, 'date');
      const apiKey = getOptionalString(args, 'apiKey') || defaultAgentApiKey;

      if (!apiKey) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'get_execution_daily_summary requires apiKey in input or LUNEX_AGENT_API_KEY env',
        );
      }

      const query = toQuery({ date });
      const data = await requestJson(
        `/api/v1/execution/daily-summary${query}`,
        {},
        apiKey,
      );
      return textResult(data);
    }
    case 'get_execution_risk_params': {
      const strategyId = getOptionalString(args, 'strategyId');
      const apiKey = getOptionalString(args, 'apiKey') || defaultAgentApiKey;

      if (!apiKey) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'get_execution_risk_params requires apiKey in input or LUNEX_AGENT_API_KEY env',
        );
      }

      const query = toQuery({ strategyId });
      const data = await requestJson(
        `/api/v1/execution/risk-params${query}`,
        {},
        apiKey,
      );
      return textResult(data);
    }
    // ─── AI Trading Network: Strategy Layer ─────────────────────────
    case 'list_strategies_marketplace': {
      const strategyType = getOptionalString(args, 'strategyType');
      const riskLevel = getOptionalString(args, 'riskLevel');
      const search = getOptionalString(args, 'search');
      const sortBy = getOptionalString(args, 'sortBy');
      const limit = getOptionalNumber(args, 'limit');
      const offset = getOptionalNumber(args, 'offset');
      const query = toQuery({
        strategyType,
        riskLevel,
        search,
        sortBy,
        limit,
        offset,
      });
      const data = await requestJson(`/api/v1/strategies/marketplace${query}`);
      return textResult(data);
    }
    case 'get_strategy': {
      const strategyId = getRequiredString(args, 'strategyId');
      const data = await requestJson(
        `/api/v1/strategies/${encodeURIComponent(strategyId)}`,
      );
      return textResult(data);
    }
    case 'get_strategy_performance': {
      const strategyId = getRequiredString(args, 'strategyId');
      const days = getOptionalNumber(args, 'days') ?? 30;
      const data = await requestJson(
        `/api/v1/strategies/${encodeURIComponent(strategyId)}/performance?days=${days}`,
      );
      return textResult(data);
    }
    case 'follow_strategy': {
      const strategyId = getRequiredString(args, 'strategyId');
      const followerAddress = getRequiredString(args, 'followerAddress');
      const allocatedCapital = getOptionalNumber(args, 'allocatedCapital');
      const signed = getWalletSignatureArgs(args);

      if (!signed.signature) {
        return textResult(
          buildWalletSigningRequest({
            tool: 'follow_strategy',
            action: 'strategies.follow',
            address: followerAddress,
            nonce: signed.nonce,
            timestamp: signed.timestamp,
            fields: {
              strategyId,
              allocatedCapital,
            },
          }),
        );
      }

      const data = await requestJson(
        `/api/v1/strategies/${encodeURIComponent(strategyId)}/follow`,
        {
          method: 'POST',
          body: JSON.stringify({
            followerAddress,
            allocatedCapital,
            nonce: signed.nonce,
            timestamp: signed.timestamp,
            signature: signed.signature,
          }),
        },
      );
      return textResult(data);
    }
    case 'unfollow_strategy': {
      const strategyId = getRequiredString(args, 'strategyId');
      const followerAddress = getRequiredString(args, 'followerAddress');
      const signed = getWalletSignatureArgs(args);

      if (!signed.signature) {
        return textResult(
          buildWalletSigningRequest({
            tool: 'unfollow_strategy',
            action: 'strategies.unfollow',
            address: followerAddress,
            nonce: signed.nonce,
            timestamp: signed.timestamp,
            fields: {
              strategyId,
            },
          }),
        );
      }

      const data = await requestJson(
        `/api/v1/strategies/${encodeURIComponent(strategyId)}/follow`,
        {
          method: 'DELETE',
          body: JSON.stringify({
            followerAddress,
            nonce: signed.nonce,
            timestamp: signed.timestamp,
            signature: signed.signature,
          }),
        },
      );
      return textResult(data);
    }
    case 'get_followed_strategies': {
      const walletAddress = getRequiredString(args, 'walletAddress');
      const signed = getWalletSignatureArgs(args);

      if (!signed.signature) {
        return textResult(
          buildWalletSigningRequest({
            tool: 'get_followed_strategies',
            action: 'strategies.followed',
            address: walletAddress,
            nonce: signed.nonce,
            timestamp: signed.timestamp,
          }),
        );
      }

      const query = toQuery({
        nonce: signed.nonce,
        timestamp: signed.timestamp,
        signature: signed.signature,
      });
      const data = await requestJson(
        `/api/v1/strategies/followed/${encodeURIComponent(walletAddress)}${query}`,
      );
      return textResult(data);
    }
    case 'register_strategy': {
      const name = getRequiredString(args, 'name');
      const strategyType = getRequiredString(args, 'strategyType');
      const riskLevel = getRequiredString(args, 'riskLevel');
      const description = getOptionalString(args, 'description');
      const vaultAddress = getOptionalString(args, 'vaultAddress');
      const isPublic =
        typeof args['isPublic'] === 'boolean' ? args['isPublic'] : true;
      const apiKey = getOptionalString(args, 'apiKey') || defaultAgentApiKey;

      if (!apiKey) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'register_strategy requires apiKey in input or LUNEX_AGENT_API_KEY env',
        );
      }

      assertEnum(
        strategyType,
        [
          'COPYTRADE',
          'MARKET_MAKER',
          'ARBITRAGE',
          'MOMENTUM',
          'HEDGE',
          'CUSTOM',
        ],
        'strategyType',
      );
      assertEnum(
        riskLevel,
        ['LOW', 'MEDIUM', 'HIGH', 'AGGRESSIVE'],
        'riskLevel',
      );

      const body: Record<string, unknown> = {
        name,
        strategyType,
        riskLevel,
        isPublic,
      };
      if (description) body.description = description;
      if (vaultAddress) body.vaultAddress = vaultAddress;

      const data = await requestJson(
        '/api/v1/strategies',
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
        apiKey,
      );
      return textResult(data);
    }
    case 'update_strategy': {
      const strategyId = getRequiredString(args, 'strategyId');
      const name = getOptionalString(args, 'name');
      const description = getOptionalString(args, 'description');
      const strategyType = getOptionalString(args, 'strategyType');
      const riskLevel = getOptionalString(args, 'riskLevel');
      const status = getOptionalString(args, 'status');
      const vaultAddress = getOptionalString(args, 'vaultAddress');
      const isPublic =
        typeof args['isPublic'] === 'boolean' ? args['isPublic'] : undefined;
      const apiKey = getOptionalString(args, 'apiKey') || defaultAgentApiKey;

      if (!apiKey) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'update_strategy requires apiKey in input or LUNEX_AGENT_API_KEY env',
        );
      }

      if (strategyType)
        assertEnum(
          strategyType,
          [
            'COPYTRADE',
            'MARKET_MAKER',
            'ARBITRAGE',
            'MOMENTUM',
            'HEDGE',
            'CUSTOM',
          ],
          'strategyType',
        );
      if (riskLevel)
        assertEnum(
          riskLevel,
          ['LOW', 'MEDIUM', 'HIGH', 'AGGRESSIVE'],
          'riskLevel',
        );
      if (status)
        assertEnum(status, ['ACTIVE', 'PAUSED', 'ARCHIVED'], 'status');

      const body: Record<string, unknown> = {};
      if (name) body.name = name;
      if (description) body.description = description;
      if (strategyType) body.strategyType = strategyType;
      if (riskLevel) body.riskLevel = riskLevel;
      if (status) body.status = status;
      if (vaultAddress) body.vaultAddress = vaultAddress;
      if (isPublic !== undefined) body.isPublic = isPublic;

      const data = await requestJson(
        `/api/v1/strategies/${encodeURIComponent(strategyId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(body),
        },
        apiKey,
      );
      return textResult(data);
    }
    case 'list_agent_strategies': {
      const search = getOptionalString(args, 'search');
      const status = getOptionalString(args, 'status');
      const sortBy = getOptionalString(args, 'sortBy');
      const limit = getOptionalNumber(args, 'limit');
      const offset = getOptionalNumber(args, 'offset');
      const apiKey = getOptionalString(args, 'apiKey') || defaultAgentApiKey;

      if (!apiKey) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'list_agent_strategies requires apiKey in input or LUNEX_AGENT_API_KEY env',
        );
      }

      const agentRes = await requestJson('/api/v1/agents/me', {}, apiKey);
      const agentId = (agentRes as any)?.agent?.id;
      if (!agentId) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          'Could not resolve agent ID from API key',
        );
      }

      const query = toQuery({ agentId, search, status, sortBy, limit, offset });
      const data = await requestJson(`/api/v1/strategies${query}`, {}, apiKey);
      return textResult(data);
    }
    default:
      if (isOutOfScopeToolName(request.params.name)) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          buildOutOfScopeMessage(request.params.name),
        );
      }
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${request.params.name}`,
      );
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(`Failed to start ${serverName}:`, error);
  process.exit(1);
});
