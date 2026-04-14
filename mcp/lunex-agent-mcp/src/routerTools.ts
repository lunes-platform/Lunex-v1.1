import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

type JsonObject = Record<string, unknown>;

type RequestJson = (
  path: string,
  init?: RequestInit,
  apiKey?: string,
) => Promise<unknown>;

function asObject(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as JsonObject;
}

function getRequiredString(args: JsonObject, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new McpError(
      ErrorCode.InvalidParams,
      `${key} is required and must be a non-empty string`,
    );
  }
  return value;
}

function getOptionalNumber(args: JsonObject, key: string): number | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === '') return undefined;

  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `${key} must be a valid number`,
    );
  }

  return parsed;
}

function assertEnum(value: string, allowed: readonly string[], field: string) {
  if (!allowed.includes(value)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `${field} must be one of: ${allowed.join(', ')}`,
    );
  }
}

function toQuery(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

export async function getRouterQuoteTool(
  args: JsonObject,
  deps: { requestJson: RequestJson },
) {
  const pairSymbol = getRequiredString(args, 'pairSymbol');
  const side = getRequiredString(args, 'side');
  const amountIn = getOptionalNumber(args, 'amountIn');

  if (amountIn === undefined || amountIn <= 0) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'amountIn must be a positive number',
    );
  }
  assertEnum(side, ['BUY', 'SELL'], 'side');

  const query = toQuery({ pairSymbol, side, amountIn });
  return deps.requestJson(`/api/v1/route/quote${query}`);
}

export async function agentRouterSwapTool(
  args: JsonObject,
  deps: { requestJson: RequestJson; defaultAgentApiKey?: string },
) {
  const pairSymbol = getRequiredString(args, 'pairSymbol');
  const side = getRequiredString(args, 'side');
  const amountIn = getOptionalNumber(args, 'amountIn');
  const maxSlippageBps = getOptionalNumber(args, 'maxSlippageBps');
  const apiKey = getRequiredString(
    {
      apiKey:
        typeof args.apiKey === 'string' && args.apiKey.trim()
          ? args.apiKey
          : deps.defaultAgentApiKey,
    },
    'apiKey',
  );

  if (amountIn === undefined || amountIn <= 0) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'amountIn must be a positive number',
    );
  }
  assertEnum(side, ['BUY', 'SELL'], 'side');

  const payload: Record<string, unknown> = { pairSymbol, side, amountIn };
  if (maxSlippageBps !== undefined) payload.maxSlippageBps = maxSlippageBps;

  const data = await deps.requestJson(
    '/api/v1/route/swap',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    apiKey,
  );

  const response = asObject(data);
  if (response.requiresWalletSignature === true) {
    return {
      ...response,
      executionMode: 'wallet-assisted',
      nextStep:
        'The best route resolved to ASYMMETRIC. Submit contractCallIntent with the user wallet to complete execution.',
    };
  }

  return {
    ...response,
    executionMode: 'server-side',
  };
}
