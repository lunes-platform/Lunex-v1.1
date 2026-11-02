import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('prepare_spot_order_signature binds canonical values, TIF and expiry with the API v2 golden vector', async () => {
  const client = new Client({
    name: 'lunex-order-signing-test',
    version: '1.0.0',
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', 'src/index.ts'],
    stderr: 'pipe',
  });
  await client.connect(transport);
  try {
    const result = await client.callTool({
      name: 'prepare_spot_order_signature',
      arguments: {
        pairSymbol: 'QAX/QUSD',
        side: 'BUY',
        type: 'LIMIT',
        makerAddress: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
        price: '2.0000',
        amount: '1e0',
        nonce: '123456789',
        timestamp: 1700000000000,
        timeInForce: 'FOK',
        expiresAt: '2026-10-18T18:00:00.000Z',
      },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const response = JSON.parse(
      content.find((item) => item.type === 'text')!.text,
    );
    assert.equal(
      response.message,
      'lunex-order-v2:QAX/QUSD:BUY:LIMIT:2:0:1:123456789:1700000000000:FOK:1792346400000',
    );
    assert.equal(response.order.timeInForce, 'FOK');
    assert.equal(response.order.expiresAt, '2026-10-18T18:00:00.000Z');
  } finally {
    await client.close();
  }
});
