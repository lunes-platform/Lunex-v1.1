/**
 * BE-09 — spoofed X-Forwarded-For must not bypass the per-IP limit.
 * BE-21 — revoked sessions stop receiving `user:` updates; per-message
 *         token bucket closes flooding clients.
 */
jest.mock('../../utils/redis', () => {
  const store = new Map<string, string>();
  const mockRedis = {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
  };
  return {
    getRedis: jest.fn(() => mockRedis),
    disconnectRedis: jest.fn(async () => undefined),
  };
});

import WebSocket from 'ws';
import type { WebSocketServer } from 'ws';
import { createWebSocketServer, broadcast } from '../../websocket/server';
import { config } from '../../config';
import {
  issueReadSessionToken,
  revokeReadSession,
} from '../../middleware/readSession';

const ALICE = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const PORT = 43000 + Math.floor(Math.random() * 1000);

type Msg = { type: string; channel?: string; data?: unknown };

let wss: WebSocketServer;

beforeAll(() => {
  config.trustProxy = false;
  wss = createWebSocketServer(PORT, {
    messageBucket: { capacity: 10, refillPerSec: 1 },
    sessionRecheckMs: 60_000,
  });
});

afterAll(async () => {
  for (const c of wss.clients) c.terminate();
  await new Promise<void>((resolve) => wss.close(() => resolve()));
});

function open(headers: Record<string, string> = {}) {
  return new Promise<{ ws: WebSocket; closeCode: Promise<number> }>(
    (resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers });
      const closeCode = new Promise<number>((r) =>
        ws.on('close', (code) => r(code)),
      );
      ws.once('message', () => resolve({ ws, closeCode }));
      ws.on('error', () => undefined);
      // rejected sockets are closed right after the handshake
      ws.once('close', () => resolve({ ws, closeCode }));
    },
  );
}

function collect(ws: WebSocket) {
  const queue: Msg[] = [];
  ws.on('message', (raw) => queue.push(JSON.parse(raw.toString())));
  return queue;
}

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

describe('BE-09 per-IP limit with spoofed XFF', () => {
  it('25 sockets from one host with distinct XFF → only 20 accepted', async () => {
    const sockets = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        open({ 'X-Forwarded-For': `198.51.100.${i + 1}` }),
      ),
    );
    await tick(100);
    const openCount = sockets.filter(
      (s) => s.ws.readyState === WebSocket.OPEN,
    ).length;
    expect(openCount).toBe(20);
    const rejected = await Promise.all(
      sockets
        .filter((s) => s.ws.readyState !== WebSocket.OPEN)
        .map((s) => s.closeCode),
    );
    expect(rejected.every((code) => code === 1013)).toBe(true);
    for (const s of sockets) s.ws.terminate();
    await tick(100);
  });
});

describe('BE-21 session revocation and message rate limit', () => {
  it('a revoked session stops receiving user-channel updates', async () => {
    const { ws } = await open();
    const queue = collect(ws);
    const { token, claims } = issueReadSessionToken(ALICE);
    ws.send(JSON.stringify({ action: 'auth', token }));
    await tick();
    ws.send(JSON.stringify({ action: 'subscribe', channel: `user:${ALICE}` }));
    await tick();
    expect(queue.map((m) => m.type)).toEqual(['authenticated', 'subscribed']);

    broadcast(`user:${ALICE}`, { n: 1 });
    await tick();
    expect(queue.filter((m) => m.type === 'update')).toHaveLength(1);

    await revokeReadSession(claims);
    broadcast(`user:${ALICE}`, { n: 2 });
    await tick();
    expect(queue.filter((m) => m.type === 'update')).toHaveLength(1);
    expect(queue.some((m) => m.type === 'session_revoked')).toBe(true);
    ws.terminate();
  });

  it('closes a client that floods messages (1008)', async () => {
    const { ws, closeCode } = await open();
    for (let i = 0; i < 50; i++) ws.send(JSON.stringify({ action: 'ping' }));
    expect(await closeCode).toBe(1008);
  });
});
