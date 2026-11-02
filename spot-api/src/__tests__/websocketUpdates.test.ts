import { EventEmitter } from 'events';
jest.mock('ws', () => {
  const { EventEmitter } = require('events');
  return {
    WebSocket: { OPEN: 1 },
    WebSocketServer: class extends EventEmitter {},
  };
});
import * as server from '../websocket/server';
import { orderbookManager } from '../utils/orderbook';
let ws: EventEmitter & {
  readyState: number;
  send: jest.Mock;
  ping: jest.Mock;
  terminate: jest.Mock;
  close: jest.Mock;
};
let wss: EventEmitter;
function frames() {
  return ws.send.mock.calls.map(([s]) => JSON.parse(s));
}
function subscribe(channel: string) {
  ws.emit(
    'message',
    Buffer.from(JSON.stringify({ action: 'subscribe', channel })),
  );
}
beforeEach(() => {
  orderbookManager.clearAll();
  wss = server.createWebSocketServer(0);
  ws = Object.assign(new EventEmitter(), {
    readyState: 1,
    send: jest.fn(),
    ping: jest.fn(),
    terminate: jest.fn(),
    close: jest.fn(),
  });
  wss.emit('connection', ws, {
    headers: { origin: 'http://localhost:3100' },
    socket: { remoteAddress: '127.0.0.1' },
  });
});
afterEach(() => {
  ws.emit('close');
  wss.emit('close');
});
it('publishes current aggregated depth after book changes, with public depth capped at10', () => {
  const book = orderbookManager.getOrCreate('QAX/QUSD');
  subscribe('orderbook:QAX/QUSD');
  for (let i = 0; i < 12; i++)
    book.addLimitOrder('order' + i, 'SELL', i + 1, 1, 'maker');
  (server as any).broadcastOrderbook('QAX/QUSD');
  const message = frames().at(-1);
  expect(message.channel).toBe('orderbook:QAX/QUSD');
  expect(message.data.asks).toHaveLength(10);
  expect(message.data.asks[0]).toEqual({ price: 1, amount: 1, total: 1 });
  expect(JSON.stringify(message)).not.toContain('maker');
});
it('publishes only public trade fields, without settlement payload or signatures', () => {
  subscribe('trades:QAX/QUSD');
  (server as any).broadcastTrade('QAX/QUSD', {
    id: 'trade',
    side: 'BUY',
    price: '2',
    amount: '1',
    quoteAmount: '2',
    makerFee: '0.002',
    takerFee: '0.005',
    settlementStatus: 'PENDING',
    createdAt: new Date(0),
    signature: 'secret-signature',
    nonce: '123',
    settlementPayload: { internal: true },
  });
  const message = frames().at(-1);
  expect(message.channel).toBe('trades:QAX/QUSD');
  expect(message.data.id).toBe('trade');
  expect(message.data).not.toHaveProperty('signature');
  expect(message.data).not.toHaveProperty('nonce');
  expect(message.data).not.toHaveProperty('settlementPayload');
});
it('keeps private user channels forbidden', () => {
  subscribe('user:victim');
  expect(frames().at(-1)).toEqual({
    type: 'error',
    message: 'Channel not allowed',
  });
});
