/**
 * BE-08 — the per-wallet cancel quota must only count AUTHENTICATED cancels.
 * Before the fix, 20 unsigned DELETEs carrying the victim's makerAddress
 * exhausted the victim's quota (401 ×20 then 429 for everyone).
 */
const counters = new Map<string, number>();
jest.mock('../../utils/redisRateLimit', () => ({
  checkRedisRateLimit: jest.fn(
    async ({ key, limit }: { key: string; limit: number }) => {
      const used = counters.get(key) ?? 0;
      if (used >= limit) {
        return { allowed: false, remaining: 0, retryAfterMs: 1000 };
      }
      counters.set(key, used + 1);
      return { allowed: true, remaining: limit - used - 1, retryAfterMs: 0 };
    },
  ),
}));

jest.mock('../../services/orderService', () => ({
  orderService: {
    cancelOrder: jest.fn(async (id: string) => ({ id, status: 'CANCELLED' })),
    createOrder: jest.fn(),
    getUserOrders: jest.fn(),
  },
}));

jest.mock('../../middleware/auth', () => ({
  ...jest.requireActual('../../middleware/auth'),
  verifyWalletActionSignature: jest.fn(),
}));

import express from 'express';
import request from 'supertest';
import ordersRouter from '../../routes/orders';
import { verifyWalletActionSignature } from '../../middleware/auth';

const verifyMock = verifyWalletActionSignature as jest.MockedFunction<
  typeof verifyWalletActionSignature
>;

const app = express();
app.use(express.json());
app.use('/api/v1/orders', ordersRouter);

const VICTIM = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';

function cancel(nonce: string) {
  return request(app)
    .delete('/api/v1/orders/11111111-1111-4111-8111-111111111111')
    .send({
      makerAddress: VICTIM,
      nonce,
      timestamp: Date.now(),
      signature: '0xdeadbeefdeadbeef',
    });
}

describe('BE-08 cancel rate limit', () => {
  beforeEach(() => counters.clear());

  it('unsigned attempts do not consume the victim cancel quota', async () => {
    verifyMock.mockResolvedValue({ ok: false, error: 'Invalid signature' });
    for (let i = 0; i < 25; i++) {
      const res = await cancel(`attacker-nonce-${i}`);
      expect(res.status).toBe(401);
    }

    verifyMock.mockResolvedValue({ ok: true, message: 'signed' });
    const res = await cancel('victim-nonce-1');
    expect(res.status).toBe(200);
  });

  it('still limits authenticated cancels per wallet', async () => {
    verifyMock.mockResolvedValue({ ok: true, message: 'signed' });
    for (let i = 0; i < 20; i++) {
      expect((await cancel(`ok-nonce-${i}`)).status).toBe(200);
    }
    const res = await cancel('ok-nonce-21');
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('RATE_LIMITED');
  });
});
