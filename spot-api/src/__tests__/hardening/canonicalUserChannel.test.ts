/**
 * M-09 (R4) — private `user:` updates are published under the canonical
 * address (42) while a wallet that displays prefix 57 authenticates and
 * subscribes with its own encoding. Delivery is by account id; the payload
 * carries the channel name the client subscribed to.
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
import { issueReadSessionToken } from '../../middleware/readSession';

const ALICE_42 = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const ALICE_57 = '6mfqoTMHrMeVMyKwjqomUjVomPMJ4AjdCm1VReFtk7Be8wqr';
const BOB_57 = '6k6gXPB9idebCxqSJuqpjPaqfYLQbdLHhvsANH8Dg8GQN3tT';
const PORT = 44000 + Math.floor(Math.random() * 1000);

type Msg = { type: string; channel?: string; data?: unknown };

let wss: WebSocketServer;

beforeAll(() => {
  config.trustProxy = false;
  wss = createWebSocketServer(PORT, { sessionRecheckMs: 60_000 });
});

afterAll(async () => {
  for (const c of wss.clients) c.terminate();
  await new Promise<void>((resolve) => wss.close(() => resolve()));
});

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

async function connect(sub: string, subscribe: boolean) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  const queue: Msg[] = [];
  await new Promise<void>((resolve) => ws.once('open', () => resolve()));
  ws.on('message', (raw) => queue.push(JSON.parse(raw.toString())));
  const { token } = issueReadSessionToken(sub);
  ws.send(JSON.stringify({ action: 'auth', token }));
  await tick();
  if (subscribe) {
    ws.send(JSON.stringify({ action: 'subscribe', channel: `user:${sub}` }));
    await tick();
  }
  return { ws, queue };
}

const updates = (queue: Msg[]) => queue.filter((m) => m.type === 'update');

it('delivers a canonical user: broadcast to the 57 subscriber under its own channel name', async () => {
  const alice = await connect(ALICE_57, true);
  const bob = await connect(BOB_57, true);
  const aliceIdle = await connect(ALICE_57, false);

  // Authentication still echoes the address exactly as issued.
  expect(alice.queue.find((m) => m.type === 'authenticated')).toEqual({
    type: 'authenticated',
    address: ALICE_57,
  });

  broadcast(`user:${ALICE_42}`, { fill: 1 });
  await tick();

  expect(updates(alice.queue)).toEqual([
    { type: 'update', channel: `user:${ALICE_57}`, data: { fill: 1 } },
  ]);
  expect(updates(bob.queue)).toEqual([]);
  expect(updates(aliceIdle.queue)).toEqual([]);

  for (const c of [alice, bob, aliceIdle]) c.ws.terminate();
});

it('still delivers an exact-match user: broadcast', async () => {
  const alice = await connect(ALICE_42, true);
  broadcast(`user:${ALICE_42}`, { fill: 2 });
  await tick();
  expect(updates(alice.queue)).toEqual([
    { type: 'update', channel: `user:${ALICE_42}`, data: { fill: 2 } },
  ]);
  alice.ws.terminate();
});
