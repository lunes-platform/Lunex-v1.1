import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

type JsonObject = Record<string, unknown>;

function parseBooleanEnv(value: string | undefined) {
  return value === '1' || value === 'true' || value === 'yes';
}

function readStringEnv(name: string) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : '';
}

function readPositiveNumberEnv(name: string, fallback: number) {
  const raw = readStringEnv(name);
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }

  return parsed;
}

function assertJsonObject(value: unknown, context: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} did not return a JSON object`);
  }
  return value as JsonObject;
}

function parseToolJson(result: unknown, context: string) {
  const payload = assertJsonObject(result, `${context} result`);
  const content = Array.isArray(payload.content) ? payload.content : [];
  const textPart = content.find((part) => {
    if (!part || typeof part !== 'object') return false;
    const item = part as JsonObject;
    return item.type === 'text' && typeof item.text === 'string';
  }) as JsonObject | undefined;

  if (!textPart?.text) {
    throw new Error(`${context} did not return text content`);
  }

  try {
    return JSON.parse(String(textPart.text));
  } catch (error) {
    throw new Error(
      `${context} returned invalid JSON: ${(error as Error).message}`,
    );
  }
}

function buildChildEnv(baseUrl: string, agentApiKey: string) {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      env[key] = value;
    }
  }

  env.LUNEX_SPOT_API_URL = baseUrl;

  if (agentApiKey) {
    env.LUNEX_AGENT_API_KEY = agentApiKey;
  }

  return env;
}

async function main() {
  const currentFile = fileURLToPath(import.meta.url);
  const packageRoot = path.resolve(path.dirname(currentFile), '..');
  const distEntrypoint = path.resolve(packageRoot, 'dist/index.js');

  if (!existsSync(distEntrypoint)) {
    throw new Error(
      `MCP build not found at ${distEntrypoint}. Run "npm run build" first.`,
    );
  }

  const baseUrl =
    readStringEnv('LUNEX_SPOT_API_URL') || 'http://127.0.0.1:4010';
  const requestedPairSymbol = readStringEnv('LUNEX_SMOKE_PAIR_SYMBOL');
  const side = readStringEnv('LUNEX_SMOKE_SIDE') || 'BUY';
  const amountIn = readPositiveNumberEnv('LUNEX_SMOKE_AMOUNT_IN', 1);
  const executeRouterSwap = parseBooleanEnv(
    process.env.LUNEX_MCP_SMOKE_EXECUTE_ROUTER_SWAP,
  );
  const agentApiKey =
    readStringEnv('LUNEX_SMOKE_AGENT_API_KEY') ||
    readStringEnv('LUNEX_AGENT_API_KEY');

  if (side !== 'BUY' && side !== 'SELL') {
    throw new Error('LUNEX_SMOKE_SIDE must be BUY or SELL');
  }

  const transport = new StdioClientTransport({
    command: 'node',
    args: [distEntrypoint],
    cwd: packageRoot,
    env: buildChildEnv(baseUrl, agentApiKey),
    stderr: 'pipe',
  });

  const stderrTail: string[] = [];
  transport.stderr?.on('data', (chunk) => {
    const text = chunk.toString();
    stderrTail.push(text);
    if (stderrTail.length > 20) stderrTail.shift();
  });

  const client = new Client(
    { name: 'lunex-router-smoke', version: '0.1.0' },
    { capabilities: {} },
  );

  try {
    console.log(`[smoke] Connecting to Lunex MCP via ${distEntrypoint}`);
    await client.connect(transport);

    const tools = await client.listTools();
    const toolNames = new Set(tools.tools.map((tool) => tool.name));
    for (const requiredTool of [
      'get_server_scope',
      'get_lunex_health',
      'list_pairs',
      'get_router_quote',
      'agent_router_swap',
    ]) {
      if (!toolNames.has(requiredTool)) {
        throw new Error(`Required MCP tool missing: ${requiredTool}`);
      }
    }

    const scope = assertJsonObject(
      parseToolJson(
        await client.callTool({ name: 'get_server_scope', arguments: {} }),
        'get_server_scope',
      ),
      'get_server_scope',
    );
    const supports = Array.isArray(scope.supports) ? scope.supports : [];
    if (!supports.includes('smart-router')) {
      throw new Error('MCP scope does not advertise smart-router support');
    }

    let health: JsonObject;
    try {
      health = assertJsonObject(
        parseToolJson(
          await client.callTool({ name: 'get_lunex_health', arguments: {} }),
          'get_lunex_health',
        ),
        'get_lunex_health',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `spot-api is not reachable at ${baseUrl}. Start the backend and retry. Cause: ${message}`,
      );
    }
    if (health.status !== 'ok') {
      throw new Error(
        `spot-api health check failed: ${JSON.stringify(health)}`,
      );
    }

    const pairsPayload = assertJsonObject(
      parseToolJson(
        await client.callTool({ name: 'list_pairs', arguments: {} }),
        'list_pairs',
      ),
      'list_pairs',
    );
    const pairs = Array.isArray(pairsPayload.pairs) ? pairsPayload.pairs : [];
    const discoveredPairSymbol = pairs.find(
      (pair) =>
        pair &&
        typeof pair === 'object' &&
        typeof (pair as JsonObject).symbol === 'string',
    );
    const pairSymbol =
      requestedPairSymbol ||
      ((discoveredPairSymbol as JsonObject | undefined)?.symbol as
        | string
        | undefined) ||
      '';

    if (!pairSymbol) {
      throw new Error(
        'No active pair found. Seed the backend or set LUNEX_SMOKE_PAIR_SYMBOL to a known pair symbol.',
      );
    }

    const quote = assertJsonObject(
      parseToolJson(
        await client.callTool({
          name: 'get_router_quote',
          arguments: { pairSymbol, side, amountIn },
        }),
        'get_router_quote',
      ),
      'get_router_quote',
    );

    const summary: JsonObject = {
      baseUrl,
      pairSymbol,
      side,
      amountIn,
      scopeVerified: true,
      healthStatus: health.status,
      bestRoute: quote.bestRoute,
      routeCount: Array.isArray(quote.routes) ? quote.routes.length : 0,
      routerSwap: 'skipped',
    };

    if (executeRouterSwap) {
      if (!agentApiKey) {
        throw new Error(
          'LUNEX_MCP_SMOKE_EXECUTE_ROUTER_SWAP=true requires LUNEX_SMOKE_AGENT_API_KEY or LUNEX_AGENT_API_KEY.',
        );
      }

      console.log(
        '[smoke] Running opt-in agent_router_swap. This may execute a real trade.',
      );
      const swap = assertJsonObject(
        parseToolJson(
          await client.callTool({
            name: 'agent_router_swap',
            arguments: { pairSymbol, side, amountIn },
          }),
          'agent_router_swap',
        ),
        'agent_router_swap',
      );

      summary.routerSwap = {
        executedVia: swap.executedVia,
        executionMode: swap.executionMode,
        success: swap.success,
        requiresWalletSignature: swap.requiresWalletSignature === true,
      };
    } else {
      console.log(
        '[smoke] Skipping agent_router_swap. Set LUNEX_MCP_SMOKE_EXECUTE_ROUTER_SWAP=true for live execution.',
      );
    }

    console.log('[smoke] Smart Router MCP smoke passed');
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    if (stderrTail.length > 0) {
      console.error('[smoke] MCP stderr tail:');
      console.error(stderrTail.join(''));
    }
    throw error;
  } finally {
    await client.close().catch(() => null);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[smoke] Failed: ${message}`);
  process.exitCode = 1;
});
