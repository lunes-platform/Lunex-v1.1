import test from 'node:test';
import assert from 'node:assert/strict';
import { McpError } from '@modelcontextprotocol/sdk/types.js';

import { agentRouterSwapTool, getRouterQuoteTool } from './routerTools.js';

test('getRouterQuoteTool validates positive amountIn', async () => {
  await assert.rejects(
    () =>
      getRouterQuoteTool(
        { pairSymbol: 'LUNES/LUSDT', side: 'BUY', amountIn: 0 },
        { requestJson: async () => ({}) },
      ),
    (error: unknown) =>
      error instanceof McpError &&
      error.message.includes('amountIn must be a positive number'),
  );
});

test('getRouterQuoteTool forwards the quote query to the backend', async () => {
  const calls: Array<{ path: string; init?: RequestInit; apiKey?: string }> =
    [];

  const result = await getRouterQuoteTool(
    { pairSymbol: 'LUNES/LUSDT', side: 'SELL', amountIn: 250 },
    {
      requestJson: async (path, init, apiKey) => {
        calls.push({ path, init, apiKey });
        return { bestRoute: 'ORDERBOOK' };
      },
    },
  );

  assert.deepEqual(result, { bestRoute: 'ORDERBOOK' });
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0]?.path,
    '/api/v1/route/quote?pairSymbol=LUNES%2FLUSDT&side=SELL&amountIn=250',
  );
  assert.equal(calls[0]?.init, undefined);
  assert.equal(calls[0]?.apiKey, undefined);
});

test('agentRouterSwapTool requires an API key from input or runtime config', async () => {
  await assert.rejects(
    () =>
      agentRouterSwapTool(
        { pairSymbol: 'LUNES/LUSDT', side: 'BUY', amountIn: 100 },
        { requestJson: async () => ({}) },
      ),
    (error: unknown) =>
      error instanceof McpError &&
      error.message.includes(
        'apiKey is required and must be a non-empty string',
      ),
  );
});

test('agentRouterSwapTool preserves server-side execution responses', async () => {
  const calls: Array<{ path: string; init?: RequestInit; apiKey?: string }> =
    [];

  const result = await agentRouterSwapTool(
    {
      pairSymbol: 'LUNES/LUSDT',
      side: 'SELL',
      amountIn: 500,
      maxSlippageBps: 75,
    },
    {
      defaultAgentApiKey: 'agent-key-123',
      requestJson: async (path, init, apiKey) => {
        calls.push({ path, init, apiKey });
        return {
          executedVia: 'ORDERBOOK',
          success: true,
          order: { id: 'order-1' },
        };
      },
    },
  );

  assert.deepEqual(result, {
    executedVia: 'ORDERBOOK',
    success: true,
    order: { id: 'order-1' },
    executionMode: 'server-side',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.path, '/api/v1/route/swap');
  assert.equal(calls[0]?.apiKey, 'agent-key-123');
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    pairSymbol: 'LUNES/LUSDT',
    side: 'SELL',
    amountIn: 500,
    maxSlippageBps: 75,
  });
});

test('agentRouterSwapTool promotes ASYMMETRIC continuations to wallet-assisted mode', async () => {
  const result = await agentRouterSwapTool(
    {
      pairSymbol: 'LUNES/LUSDT',
      side: 'BUY',
      amountIn: 1000,
      apiKey: 'inline-key',
    },
    {
      requestJson: async () => ({
        executedVia: 'ASYMMETRIC',
        success: true,
        requiresWalletSignature: true,
        contractCallIntent: {
          contractAddress: '5Fcontract',
          method: 'swap',
        },
      }),
    },
  );

  assert.deepEqual(result, {
    executedVia: 'ASYMMETRIC',
    success: true,
    requiresWalletSignature: true,
    contractCallIntent: {
      contractAddress: '5Fcontract',
      method: 'swap',
    },
    executionMode: 'wallet-assisted',
    nextStep:
      'The best route resolved to ASYMMETRIC. Submit contractCallIntent with the user wallet to complete execution.',
  });
});
