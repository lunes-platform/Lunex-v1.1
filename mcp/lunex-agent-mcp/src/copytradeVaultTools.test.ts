// BE-01/BE-02: vault deposits/withdrawals are signed ON CHAIN by the follower
// wallet; the API only journals a finalized tx it can prove. The MCP tools must
// carry the tx proof (txHash + finalized blockHash) and sign it into the API
// message exactly like spot-api/src/routes/copytrade.ts verifies it.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const TX = `0x${'11'.repeat(32)}`;
const BLOCK = `0x${'22'.repeat(32)}`;
const FOLLOWER = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';

type Captured = { url?: string; body?: Record<string, unknown> };

async function withServer(
  run: (client: Client, captured: Captured) => Promise<void>,
) {
  const captured: Captured = {};
  const api = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      captured.url = req.url;
      captured.body = raw ? JSON.parse(raw) : undefined;
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
  const port = (api.address() as AddressInfo).port;

  const client = new Client({ name: 'copytrade-vault-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', 'src/index.ts'],
    stderr: 'pipe',
    env: {
      ...(process.env as Record<string, string>),
      LUNEX_SPOT_API_URL: `http://127.0.0.1:${port}`,
      LUNEX_SIGNING_DOMAIN: '',
      LUNEX_GENESIS_HASH: '',
    },
  });
  await client.connect(transport);
  try {
    await run(client, captured);
  } finally {
    await client.close();
    await new Promise<void>((resolve) => api.close(() => resolve()));
  }
}

function parse(result: unknown) {
  const content = (result as { content: Array<{ type: string; text: string }> })
    .content;
  return JSON.parse(content.find((item) => item.type === 'text')!.text);
}

test('deposit tool returns a signing request that binds the on-chain proof', async () => {
  await withServer(async (client, captured) => {
    const response = parse(
      await client.callTool({
        name: 'submit_copytrade_vault_deposit',
        arguments: {
          leaderId: 'leader-1',
          followerAddress: FOLLOWER,
          token: 'LUNES',
          amount: '15',
          txHash: TX,
          blockHash: BLOCK,
          stopLossPct: 20,
          nonce: 'n1',
          timestamp: 1,
        },
      }),
    );
    assert.equal(response.requiresExternalSignature, true);
    assert.equal(
      response.signingRequest.message,
      [
        'lunex-auth:copytrade.deposit',
        `address:${FOLLOWER}`,
        'amount:15',
        `blockHash:${BLOCK}`,
        'leaderId:leader-1',
        'stopLossPct:20',
        'token:LUNES',
        `txHash:${TX}`,
        'nonce:n1',
        'timestamp:1',
      ].join('\n'),
    );
    assert.equal(captured.url, undefined, 'must not call the API unsigned');
  });
});

test('deposit tool posts the proof with the signature', async () => {
  await withServer(async (client, captured) => {
    await client.callTool({
      name: 'submit_copytrade_vault_deposit',
      arguments: {
        leaderId: 'leader-1',
        followerAddress: FOLLOWER,
        token: 'LUNES',
        amount: '15',
        txHash: TX,
        blockHash: BLOCK,
        nonce: 'n1',
        timestamp: 1,
        signature: '0xsig',
      },
    });
    assert.equal(captured.url, '/api/v1/copytrade/vaults/leader-1/deposit');
    assert.equal(captured.body?.txHash, TX);
    assert.equal(captured.body?.blockHash, BLOCK);
    assert.equal(captured.body?.signature, '0xsig');
  });
});

test('withdraw tool signs and posts the proof', async () => {
  await withServer(async (client, captured) => {
    const request = parse(
      await client.callTool({
        name: 'submit_copytrade_vault_withdrawal',
        arguments: {
          leaderId: 'leader-1',
          followerAddress: FOLLOWER,
          shares: '5',
          txHash: TX,
          blockHash: BLOCK,
          nonce: 'n2',
          timestamp: 2,
        },
      }),
    );
    assert.equal(
      request.signingRequest.message,
      [
        'lunex-auth:copytrade.withdraw',
        `address:${FOLLOWER}`,
        `blockHash:${BLOCK}`,
        'leaderId:leader-1',
        'shares:5',
        `txHash:${TX}`,
        'nonce:n2',
        'timestamp:2',
      ].join('\n'),
    );

    await client.callTool({
      name: 'submit_copytrade_vault_withdrawal',
      arguments: {
        leaderId: 'leader-1',
        followerAddress: FOLLOWER,
        shares: '5',
        txHash: TX,
        blockHash: BLOCK,
        nonce: 'n2',
        timestamp: 2,
        signature: '0xsig',
      },
    });
    assert.equal(captured.url, '/api/v1/copytrade/vaults/leader-1/withdraw');
    assert.equal(captured.body?.blockHash, BLOCK);
  });
});

test('tools reject a malformed tx proof', async () => {
  await withServer(async (client, captured) => {
    const result = await client
      .callTool({
        name: 'submit_copytrade_vault_deposit',
        arguments: {
          leaderId: 'leader-1',
          followerAddress: FOLLOWER,
          token: 'LUNES',
          amount: '15',
          txHash: '0x1234',
          blockHash: BLOCK,
          nonce: 'n1',
          timestamp: 1,
          signature: '0xsig',
        },
      })
      .then(
        (r) => ({ error: (r as { isError?: boolean }).isError ? r : null }),
        (err: unknown) => ({ error: err }),
      );
    assert.ok(result.error, 'expected a tool error');
    assert.match(
      JSON.stringify(
        result.error,
        Object.getOwnPropertyNames(result.error as object),
      ),
      /txHash/,
    );
    assert.equal(captured.url, undefined);
  });
});
