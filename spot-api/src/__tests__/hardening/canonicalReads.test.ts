/**
 * M-09 (second pass) — signed reads look rows up by the canonical address.
 * A wallet that displays prefix 57 signs and queries in 57; new rows are
 * stored in 42, so the read must normalize or the list comes back empty.
 */
jest.mock('../../utils/redis', () => {
  const store = new Map<string, string>();
  return {
    getRedis: jest.fn(() => ({
      get: jest.fn(async (key: string) => store.get(key) ?? null),
      set: jest.fn(async (key: string, value: string) => {
        if (store.has(key)) return null;
        store.set(key, value);
        return 'OK';
      }),
    })),
    disconnectRedis: jest.fn(async () => undefined),
  };
});

jest.mock('../../services/orderService', () => ({
  orderService: {
    createOrder: jest.fn(),
    cancelOrder: jest.fn(),
    getUserOrders: jest.fn(),
  },
}));

import express from 'express';
import request from 'supertest';
import { Keyring } from '@polkadot/keyring';
import { u8aToHex } from '@polkadot/util';
import { cryptoWaitReady, encodeAddress } from '@polkadot/util-crypto';
import { config } from '../../config';
import { buildWalletActionMessage } from '../../middleware/auth';
import ordersRouter from '../../routes/orders';
import { orderService } from '../../services/orderService';

const getUserOrders = orderService.getUserOrders as jest.Mock;

const app = express();
app.use(express.json());
app.use('/api/v1/orders', ordersRouter);

let pair: ReturnType<Keyring['addFromUri']>;
let generic: string;
let lunes: string;
const originalSigning = { ...config.signing };

beforeAll(async () => {
  await cryptoWaitReady();
  pair = new Keyring({ type: 'sr25519' }).addFromUri('//CanonicalReads');
  generic = encodeAddress(pair.publicKey, 42);
  lunes = encodeAddress(pair.publicKey, 57);
});

beforeEach(() => {
  config.signing.domain = 'lunex.lunes.io';
  config.signing.genesisHash = `0x${'ab'.repeat(32)}`;
  config.signing.acceptLegacy = false;
  getUserOrders.mockReset();
  // Rows exist only under the canonical (42) encoding.
  getUserOrders.mockImplementation(async (address: string) =>
    address === generic ? [{ id: 'order-1', makerAddress: generic }] : [],
  );
});

afterAll(() => {
  Object.assign(config.signing, originalSigning);
});

it('a query signed and sent in prefix 57 returns rows stored in 42', async () => {
  const nonce = 'read-nonce-57-1';
  const timestamp = Date.now();
  const signature = u8aToHex(
    pair.sign(
      buildWalletActionMessage({
        action: 'orders.list',
        address: lunes,
        nonce,
        timestamp,
        fields: { limit: 50, offset: 0 },
      }),
    ),
  );

  const res = await request(app)
    .get('/api/v1/orders')
    .query({ makerAddress: lunes, nonce, timestamp, signature });

  expect(res.status).toBe(200);
  expect(getUserOrders).toHaveBeenCalledWith(generic, undefined, 50, 0);
  expect(res.body.orders).toEqual([{ id: 'order-1', makerAddress: generic }]);
});

it('an undecodable address on a signed read is still a 400', async () => {
  const res = await request(app).get('/api/v1/orders').query({
    makerAddress: 'not-an-address',
    nonce: 'read-nonce-bad-1',
    timestamp: Date.now(),
    signature: '0x12345678',
  });
  expect(res.status).toBe(400);
  expect(getUserOrders).not.toHaveBeenCalled();
});
