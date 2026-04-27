import request from 'supertest';
import app from './testApp';
import { buildSignedQuery } from './authTestUtils';

jest.mock('../../db', () => ({
  __esModule: true,
  default: {
    pair: { findUnique: jest.fn().mockResolvedValue(null) },
    order: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
    trade: { findFirst: jest.fn() },
  },
}));

jest.mock('../../utils/orderbook', () => ({
  orderbookManager: {
    getOrCreate: jest.fn().mockReturnValue({
      addLimitOrder: jest.fn().mockReturnValue([]),
      addMarketOrder: jest.fn().mockReturnValue([]),
      cancelOrder: jest.fn(),
    }),
    get: jest.fn(),
  },
}));

jest.mock('../../services/tradeService', () => ({
  tradeService: { processMatches: jest.fn() },
}));

jest.mock('../../services/settlementService', () => ({
  settlementService: {
    isEnabled: jest.fn().mockReturnValue(false),
    isNonceUsed: jest.fn(),
    isNonceCancelled: jest.fn(),
    getVaultBalance: jest.fn(),
    cancelOrderFor: jest.fn(),
  },
}));

jest.mock('../../middleware/auth', () => ({
  ...jest.requireActual('../../middleware/auth'),
  verifyAddressSignature: jest.fn().mockResolvedValue(true),
  verifyWalletActionSignature: jest
    .fn()
    .mockResolvedValue({ ok: true, message: 'signed-action-message' }),
  verifyWalletReadSignature: jest
    .fn()
    .mockResolvedValue({ ok: true, message: 'signed-read-message' }),
}));

import prisma from '../../db';
import { verifyWalletActionSignature } from '../../middleware/auth';

const prismaMock = prisma as unknown as {
  order: {
    update: jest.Mock;
  };
};
const verifyWalletActionSignatureMock =
  verifyWalletActionSignature as jest.MockedFunction<
    typeof verifyWalletActionSignature
  >;

describe('Orders API E2E', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    verifyWalletActionSignatureMock.mockResolvedValue({
      ok: true,
      message: 'signed-action-message',
    });
  });

  describe('POST /api/v1/orders', () => {
    it('should return 400 on invalid payload', async () => {
      const res = await request(app).post('/api/v1/orders').send({});

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('should return 400 with missing required fields', async () => {
      const res = await request(app).post('/api/v1/orders').send({
        pairSymbol: 'LUNES/USDT',
        side: 'BUY',
      });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'Validation failed');
    });

    it('should return 400 on invalid side enum', async () => {
      const res = await request(app).post('/api/v1/orders').send({
        pairSymbol: 'LUNES/USDT',
        side: 'INVALID',
        type: 'LIMIT',
        price: '100',
        amount: '1',
        nonce: '123456',
        signature: 'sig123',
        makerAddress: 'addr123',
      });

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/v1/orders/:id', () => {
    it('should return 400 on empty body', async () => {
      const res = await request(app)
        .delete('/api/v1/orders/some-order-id')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'Validation failed');
    });

    it('should return 400 when signed cancel nonce and timestamp are missing', async () => {
      const res = await request(app)
        .delete('/api/v1/orders/some-order-id')
        .send({
          makerAddress: 'test-maker-123',
          signature: 'signed-payload',
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'Validation failed');
    });

    it('rejects cancel replay before mutating order state', async () => {
      verifyWalletActionSignatureMock.mockResolvedValueOnce({
        ok: false,
        error: 'Signature nonce already used',
      });

      const res = await request(app)
        .delete('/api/v1/orders/some-order-id')
        .send({
          makerAddress: 'test-maker-123',
          nonce: 'cancel-nonce-123',
          timestamp: Date.now(),
          signature: 'signed-payload',
        });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error', 'Signature nonce already used');
      expect(prismaMock.order.update).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/orders', () => {
    it('should return 400 without makerAddress', async () => {
      const res = await request(app).get('/api/v1/orders');

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'Validation failed');
    });

    it('should return 200 with empty orders for valid signed read', async () => {
      const res = await request(app)
        .get('/api/v1/orders')
        .query(buildSignedQuery('makerAddress', 'test-addr-123'));

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('orders');
      expect(Array.isArray(res.body.orders)).toBe(true);
    });
  });
});
