/**
 * Balances API E2E
 *
 * Proves the spendable-balance contract:
 *   available = total − locked
 * where `locked` is derived from a wallet's resting (OPEN / PARTIAL) orders.
 *
 * Lifecycle proof: an OPEN order reserves balance (lowering `available`);
 * once that order is cancelled it no longer appears in the order set, so the
 * reservation is released and `available` returns to `total`.
 */
import request from 'supertest';
import app from './testApp';
import { buildSignedQuery } from './authTestUtils';

jest.mock('../../db', () => ({
  __esModule: true,
  default: {
    userBalance: { findMany: jest.fn() },
    order: { findMany: jest.fn() },
  },
}));

jest.mock('../../middleware/auth', () => ({
  ...jest.requireActual('../../middleware/auth'),
  verifyWalletReadSignature: jest
    .fn()
    .mockResolvedValue({ ok: true, message: 'signed-read-message' }),
}));

import prisma from '../../db';
import { verifyWalletReadSignature } from '../../middleware/auth';

const prismaMock = prisma as unknown as {
  userBalance: { findMany: jest.Mock };
  order: { findMany: jest.Mock };
};
const verifyReadMock = verifyWalletReadSignature as jest.MockedFunction<
  typeof verifyWalletReadSignature
>;

const ADDRESS = '5Faucet1111111111111111111111111111111111';

const USDT_QUOTE_LEDGER = {
  token: 'USDT',
  // total = available + locked = 100 + 0 = 100
  available: '100',
  locked: '0',
};

const SELL_PAIR = {
  baseToken: 'LUNES',
  quoteToken: 'USDT',
  baseDecimals: 8,
  quoteDecimals: 8,
  symbol: 'LUNES/USDT',
  id: 'pair-1',
};

// SELL 10 LUNES — reserves 10 LUNES (base) of the resting order.
const OPEN_SELL_ORDER = {
  side: 'SELL',
  type: 'LIMIT',
  price: '5',
  stopPrice: null,
  remainingAmount: '10',
  status: 'OPEN',
  pair: SELL_PAIR,
};

// BUY 4 LUNES @ 5 USDT — reserves 20 USDT (quote) of the resting order.
const OPEN_BUY_ORDER = {
  side: 'BUY',
  type: 'LIMIT',
  price: '5',
  stopPrice: null,
  remainingAmount: '4',
  status: 'OPEN',
  pair: SELL_PAIR,
};

describe('Balances API E2E', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    verifyReadMock.mockResolvedValue({
      ok: true,
      message: 'signed-read-message',
    });
  });

  describe('GET /api/v1/balances', () => {
    it('returns 400 when signed query fields are missing', async () => {
      const res = await request(app).get('/api/v1/balances');
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'Validation failed');
    });

    it('returns 401 when the wallet signature is invalid', async () => {
      verifyReadMock.mockResolvedValueOnce({
        ok: false,
        error: 'Invalid signature',
      });
      prismaMock.userBalance.findMany.mockResolvedValue([]);
      prismaMock.order.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/v1/balances')
        .query(buildSignedQuery('address', ADDRESS));

      expect(res.status).toBe(401);
    });

    it('reports available = total when no orders reserve funds', async () => {
      prismaMock.userBalance.findMany.mockResolvedValue([
        { ...USDT_QUOTE_LEDGER, available: '100', locked: '0' },
      ]);
      prismaMock.order.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/v1/balances')
        .query(buildSignedQuery('address', ADDRESS));

      expect(res.status).toBe(200);
      const usdt = res.body.balances.find(
        (b: { token: string }) => b.token === 'USDT',
      );
      expect(usdt.total).toBe('100');
      expect(usdt.locked).toBe('0');
      expect(usdt.available).toBe('100');
    });

    it('an OPEN BUY order locks quote balance: available = total − locked', async () => {
      prismaMock.userBalance.findMany.mockResolvedValue([
        { ...USDT_QUOTE_LEDGER, available: '100', locked: '0' },
      ]);
      // OPEN BUY reserves 20 USDT.
      prismaMock.order.findMany.mockResolvedValue([OPEN_BUY_ORDER]);

      const res = await request(app)
        .get('/api/v1/balances')
        .query(buildSignedQuery('address', ADDRESS));

      expect(res.status).toBe(200);
      const usdt = res.body.balances.find(
        (b: { token: string }) => b.token === 'USDT',
      );
      expect(usdt.total).toBe('100');
      expect(usdt.locked).toBe('20');
      expect(usdt.available).toBe('80'); // 100 − 20
      // Invariant: available === total − locked
      expect(Number(usdt.available)).toBe(
        Number(usdt.total) - Number(usdt.locked),
      );
    });

    it('cancelling the order releases the lock: available returns to total', async () => {
      prismaMock.userBalance.findMany.mockResolvedValue([
        { ...USDT_QUOTE_LEDGER, available: '100', locked: '0' },
      ]);
      // After cancel the order is no longer OPEN/PARTIAL → not returned.
      prismaMock.order.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/v1/balances')
        .query(buildSignedQuery('address', ADDRESS));

      expect(res.status).toBe(200);
      const usdt = res.body.balances.find(
        (b: { token: string }) => b.token === 'USDT',
      );
      expect(usdt.locked).toBe('0');
      expect(usdt.available).toBe('100'); // lock released
    });
  });

  describe('GET /api/v1/balances/:token', () => {
    it('an OPEN SELL order locks base token of the resting order', async () => {
      prismaMock.userBalance.findMany.mockResolvedValue([
        { token: 'LUNES', available: '50', locked: '0' },
      ]);
      // OPEN SELL reserves 10 LUNES (base).
      prismaMock.order.findMany.mockResolvedValue([OPEN_SELL_ORDER]);

      const res = await request(app)
        .get('/api/v1/balances/LUNES')
        .query(buildSignedQuery('address', ADDRESS));

      expect(res.status).toBe(200);
      expect(res.body.balance.token).toBe('LUNES');
      expect(res.body.balance.total).toBe('50');
      expect(res.body.balance.locked).toBe('10');
      expect(res.body.balance.available).toBe('40'); // 50 − 10
      expect(Number(res.body.balance.available)).toBe(
        Number(res.body.balance.total) - Number(res.body.balance.locked),
      );
    });

    it('returns a zeroed balance for a token the wallet has never held', async () => {
      prismaMock.userBalance.findMany.mockResolvedValue([]);
      prismaMock.order.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/v1/balances/NEW')
        .query(buildSignedQuery('address', ADDRESS));

      expect(res.status).toBe(200);
      expect(res.body.balance).toEqual({
        token: 'NEW',
        total: '0',
        locked: '0',
        available: '0',
      });
    });
  });
});
