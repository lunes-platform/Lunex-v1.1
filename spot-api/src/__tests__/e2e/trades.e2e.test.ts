import request from 'supertest';
import app from './testApp';
import { ADMIN_AUTH_HEADER, buildSignedQuery } from './authTestUtils';

jest.mock('../../db', () => ({
  __esModule: true,
  default: {
    pair: { findUnique: jest.fn().mockResolvedValue(null) },
    trade: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  },
}));

jest.mock('../../services/tradeService', () => ({
  tradeService: {
    getRecentTrades: jest.fn().mockResolvedValue([]),
    getUserTrades: jest.fn().mockResolvedValue([]),
    getTradesBySettlementStatus: jest.fn().mockResolvedValue([]),
    retryTradeSettlements: jest.fn().mockResolvedValue({
      processed: 0,
      settled: 0,
      failed: 0,
    }),
  },
}));

jest.mock('../../services/tradeSettlementService', () => ({
  tradeSettlementService: {
    retryPendingSettlements: jest
      .fn()
      .mockResolvedValue({ processed: 0, settled: 0, failed: 0 }),
  },
}));

jest.mock('../../middleware/auth', () => ({
  ...jest.requireActual('../../middleware/auth'),
  verifyWalletReadSignature: jest
    .fn()
    .mockResolvedValue({ ok: true, message: 'signed-read-message' }),
}));

describe('Trades API E2E', () => {
  describe('GET /api/v1/trades/:symbol', () => {
    it('should return 200 with empty trades', async () => {
      const res = await request(app).get('/api/v1/trades/LUNES-USDT');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('trades');
      expect(Array.isArray(res.body.trades)).toBe(true);
    });

    it('should respect limit query parameter', async () => {
      const res = await request(app).get('/api/v1/trades/LUNES-USDT?limit=10');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('trades');
    });
  });

  describe('GET /api/v1/trades', () => {
    it('should return 400 without address', async () => {
      const res = await request(app).get('/api/v1/trades');

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'Validation failed');
    });

    it('should return 200 with valid signed read', async () => {
      const res = await request(app)
        .get('/api/v1/trades')
        .query(buildSignedQuery('address', 'test-addr-123'));

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('trades');
    });
  });

  describe('GET /api/v1/trades/settlement/status', () => {
    it('should return 200 with default params', async () => {
      const res = await request(app)
        .get('/api/v1/trades/settlement/status')
        .set(ADMIN_AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('trades');
    });

    it('should return 200 with status filter', async () => {
      const res = await request(app)
        .get('/api/v1/trades/settlement/status?status=PENDING')
        .set(ADMIN_AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('trades');
    });
  });

  describe('POST /api/v1/trades/settlement/retry', () => {
    it('should return 200 on valid retry request', async () => {
      const res = await request(app)
        .post('/api/v1/trades/settlement/retry')
        .set(ADMIN_AUTH_HEADER)
        .send({ limit: 10 });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('processed');
    });
  });
});
