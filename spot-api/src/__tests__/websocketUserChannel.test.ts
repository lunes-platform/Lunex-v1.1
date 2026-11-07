/**
 * WebSocket private `user:<address>` channel:
 *  - refused without a read session
 *  - refused for another wallet's address
 *  - allowed for the session's own address, and receives broadcasts
 *  - tampered / revoked tokens are refused
 *  - public trades broadcast reaches public subscribers
 */
jest.mock('../utils/redis', () => {
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
import { createWebSocketServer, broadcast } from '../websocket/server';
import {
  issueReadSessionToken,
  revokeReadSession,
} from '../middleware/readSession';

const ALICE = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const BOB = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';
const PORT = 41000 + Math.floor(Math.random() * 1000);

type Msg = { type: string; channel?: string; message?: string; data?: any };

let wss: WebSocketServer;

beforeAll(() => {
  wss = createWebSocketServer(PORT);
});

afterAll(async () => {
  await new Promise<void>((resolve) => wss.close(() => resolve()));
});

function connect(): Promise<{ ws: WebSocket; next: () => Promise<Msg> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const queue: Msg[] = [];
    const waiters: Array<(m: Msg) => void> = [];
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString()) as Msg;
      const w = waiters.shift();
      if (w) w(m);
      else queue.push(m);
    });
    const next = () =>
      new Promise<Msg>((res) => {
        const m = queue.shift();
        if (m) res(m);
        else waiters.push(res);
      });
    ws.on('open', async () => {
      const hello = await next();
      expect(hello.type).toBe('connected');
      resolve({ ws, next });
    });
    ws.on('error', reject);
  });
}

const send = (ws: WebSocket, msg: unknown) => ws.send(JSON.stringify(msg));

describe('websocket user channel', () => {
  it('refuses user channel without a session', async () => {
    const { ws, next } = await connect();
    send(ws, { action: 'subscribe', channel: `user:${ALICE}` });
    const m = await next();
    expect(m).toMatchObject({ type: 'error', message: 'Channel not allowed' });
    ws.close();
  });

  it("refuses another wallet's channel and allows its own", async () => {
    const { ws, next } = await connect();
    const { token } = issueReadSessionToken(ALICE);
    send(ws, { action: 'auth', token });
    expect(await next()).toMatchObject({
      type: 'authenticated',
      address: ALICE,
    });

    send(ws, { action: 'subscribe', channel: `user:${BOB}` });
    expect(await next()).toMatchObject({ type: 'error' });

    send(ws, { action: 'subscribe', channel: `user:${ALICE}` });
    expect(await next()).toMatchObject({
      type: 'subscribed',
      channel: `user:${ALICE}`,
    });

    broadcast(`user:${ALICE}`, { type: 'fill', orderId: 'o1' });
    broadcast(`user:${BOB}`, { type: 'fill', orderId: 'leak' });
    const update = await next();
    expect(update).toMatchObject({
      type: 'update',
      channel: `user:${ALICE}`,
      data: { type: 'fill', orderId: 'o1' },
    });
    ws.close();
  });

  it('rejects tampered and revoked tokens', async () => {
    const { ws, next } = await connect();
    const { token, claims } = issueReadSessionToken(ALICE);
    send(ws, { action: 'auth', token: token.slice(0, -2) + 'xx' });
    expect(await next()).toMatchObject({ type: 'error' });

    await revokeReadSession(claims);
    send(ws, { action: 'auth', token });
    expect(await next()).toMatchObject({ type: 'error' });

    send(ws, { action: 'subscribe', channel: `user:${ALICE}` });
    expect(await next()).toMatchObject({ type: 'error' });
    ws.close();
  });

  it('delivers public trade broadcasts', async () => {
    const { ws, next } = await connect();
    send(ws, { action: 'subscribe', channel: 'trades:LUNES/USDT' });
    expect(await next()).toMatchObject({ type: 'subscribed' });
    broadcast('trades:LUNES/USDT', { id: 't1', price: '0.02' });
    expect(await next()).toMatchObject({
      type: 'update',
      channel: 'trades:LUNES/USDT',
      data: { id: 't1' },
    });
    ws.close();
  });
});
