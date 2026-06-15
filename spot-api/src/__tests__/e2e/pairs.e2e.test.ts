import request from 'supertest';
import app from './testApp';

jest.mock('../../db', () => ({
  __esModule: true,
  default: {
    pair: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    trade: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      aggregate: jest.fn().mockResolvedValue({
        _count: { _all: 0 },
        _max: { price: null },
        _min: { price: null },
        _sum: { amount: null, quoteAmount: null },
      }),
    },
  },
}));

jest.mock('../../utils/orderbook', () => ({
  orderbookManager: {
    get: jest.fn().mockReturnValue(null),
  },
}));

describe('Pairs API E2E', () => {
  describe('GET /api/v1/pairs', () => {
    it('should return empty pairs list', async () => {
      const res = await request(app).get('/api/v1/pairs');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('pairs');
      expect(Array.isArray(res.body.pairs)).toBe(true);
    });
  });

  describe('GET /api/v1/pairs/:symbol/ticker', () => {
    it('should return 404 when pair not found', async () => {
      const res = await request(app).get('/api/v1/pairs/FAKE-PAIR/ticker');

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error', 'Pair not found');
    });

    it('should return ticker data when pair exists', async () => {
      const { default: mockPrisma } = require('../../db');
      mockPrisma.pair.findUnique.mockResolvedValueOnce({
        id: 'pair-1',
        symbol: 'LUNES/USDT',
        isActive: true,
      });
      mockPrisma.trade.aggregate.mockResolvedValueOnce({
        _count: { _all: 0 },
        _max: { price: null },
        _min: { price: null },
        _sum: { amount: null, quoteAmount: null },
      });
      mockPrisma.trade.findFirst.mockResolvedValue(null);

      const res = await request(app).get('/api/v1/pairs/LUNES%2FUSDT/ticker');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('symbol', 'LUNES/USDT');
      expect(res.body).toHaveProperty('lastPrice');
      expect(res.body).toHaveProperty('volume24h');
      expect(res.body).toHaveProperty('change24h');
    });

    it('should compute 24h stats from aggregate when trades exist', async () => {
      const { default: mockPrisma } = require('../../db');
      mockPrisma.pair.findUnique.mockResolvedValueOnce({
        id: 'pair-1',
        symbol: 'LUNES/USDT',
        isActive: true,
      });
      mockPrisma.trade.aggregate.mockResolvedValueOnce({
        _count: { _all: 3 },
        _max: { price: '102' },
        _min: { price: '85' },
        _sum: { amount: '300', quoteAmount: '28000' },
      });
      mockPrisma.trade.findFirst
        .mockResolvedValueOnce({ price: '100' }) // newest (last)
        .mockResolvedValueOnce({ price: '90' }); // oldest (first)

      const res = await request(app).get('/api/v1/pairs/LUNES%2FUSDT/ticker');

      expect(res.status).toBe(200);
      expect(res.body.lastPrice).toBe(100);
      expect(res.body.high24h).toBe(102);
      expect(res.body.low24h).toBe(85);
      expect(res.body.volume24h).toBe(300);
      expect(res.body.quoteVolume24h).toBe(28000);
      expect(res.body.tradeCount).toBe(3);
      // change = (100 - 90) / 90 * 100 ≈ 11.11
      expect(res.body.change24h).toBeCloseTo(11.11, 1);
      expect(res.body.degraded).toBe(false);
    });
  });
});
