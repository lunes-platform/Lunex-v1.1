/**
 * M-09 (R4) — a read session issued to a wallet that displays prefix 57 keeps
 * working now that read routes canonicalize the requested address to 42.
 * The token `sub` stays as issued (client contract); the comparison is by
 * account id.
 */
jest.mock('../../utils/redis', () => {
  const store = new Map<string, string>();
  return {
    getRedis: jest.fn(() => ({
      get: jest.fn(async (key: string) => store.get(key) ?? null),
      set: jest.fn(async (key: string, value: string) => {
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

import express, { type Request } from 'express';
import request from 'supertest';
import {
  attachReadSession,
  issueReadSessionToken,
  verifyWalletReadAccess,
} from '../../middleware/readSession';
import ordersRouter from '../../routes/orders';
import { orderService } from '../../services/orderService';

// Alice in prefix 42 (canonical) and 57 (Lunes); Bob in both.
const ALICE_42 = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const ALICE_57 = '6mfqoTMHrMeVMyKwjqomUjVomPMJ4AjdCm1VReFtk7Be8wqr';
const BOB_42 = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';
const BOB_57 = '6k6gXPB9idebCxqSJuqpjPaqfYLQbdLHhvsANH8Dg8GQN3tT';

const getUserOrders = orderService.getUserOrders as jest.Mock;

const app = express();
app.use(express.json());
app.use(attachReadSession());
app.use('/api/v1/orders', ordersRouter);

function bearerRequest(token: string) {
  return {
    headers: { authorization: `Bearer ${token}` },
    path: '/test',
  } as unknown as Request;
}

beforeEach(() => {
  getUserOrders.mockReset();
  getUserOrders.mockImplementation(async (address: string) =>
    address === ALICE_42 ? [{ id: 'order-1' }] : [],
  );
});

describe('verifyWalletReadAccess with a bearer session', () => {
  it('a session issued in prefix 57 authorizes a read for the canonical 42', async () => {
    const { token } = issueReadSessionToken(ALICE_57);
    await expect(
      verifyWalletReadAccess(bearerRequest(token), {
        action: 'orders.list',
        address: ALICE_42,
      }),
    ).resolves.toEqual({ ok: true, via: 'session' });
  });

  it.each([
    ['42', BOB_42],
    ['57', BOB_57],
  ])('a session of another account (%s) is still rejected', async (_l, sub) => {
    const { token } = issueReadSessionToken(sub);
    await expect(
      verifyWalletReadAccess(bearerRequest(token), {
        action: 'orders.list',
        address: ALICE_42,
      }),
    ).resolves.toEqual({
      ok: false,
      error: 'Session not valid for this address',
    });
  });
});

describe('GET /api/v1/orders with a bearer session', () => {
  it('sub in 57 and makerAddress in 57 → 200 with the canonical rows', async () => {
    const { token } = issueReadSessionToken(ALICE_57);
    const res = await request(app)
      .get('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .query({ makerAddress: ALICE_57 });
    expect(res.status).toBe(200);
    expect(res.body.orders).toEqual([{ id: 'order-1' }]);
    expect(getUserOrders).toHaveBeenCalledWith(ALICE_42, undefined, 50, 0);
  });

  it.each([
    ['42', BOB_42],
    ['57', BOB_57],
  ])('a session of another account (%s) gets 401', async (_l, sub) => {
    const { token } = issueReadSessionToken(sub);
    const res = await request(app)
      .get('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .query({ makerAddress: ALICE_57 });
    expect(res.status).toBe(401);
    expect(getUserOrders).not.toHaveBeenCalled();
  });
});
