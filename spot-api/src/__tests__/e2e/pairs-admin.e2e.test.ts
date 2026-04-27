import express from 'express';
import request from 'supertest';

const mockPrisma = {
  pair: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  trade: {
    count: jest.fn(),
  },
  order: {
    count: jest.fn(),
  },
};

jest.mock('../../db', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../services/factoryService', () => ({
  factoryService: {
    getPair: jest.fn(),
    getAllPairs: jest.fn(),
    getAllPairsLength: jest.fn(),
  },
}));

jest.mock('../../utils/orderbook', () => ({
  orderbookManager: {
    get: jest.fn().mockReturnValue(null),
  },
}));

jest.mock('../../utils/logger', () => ({
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../config', () => ({
  config: {
    isProd: true,
    adminSecret: 'test-admin-secret-local-only-000000000001',
    blockchain: {
      factoryContractAddress: '',
    },
  },
}));

import pairsRouter from '../../routes/pairs';

const app = express();
app.use(express.json());
app.use('/api/v1/pairs', pairsRouter);

describe('Pairs admin API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.pair.findUnique.mockResolvedValue(null);
    mockPrisma.pair.update.mockReset();
    mockPrisma.pair.delete.mockReset();
    mockPrisma.trade.count.mockReset();
    mockPrisma.order.count.mockReset();
  });

  it('rejects production pair registration when on-chain factory validation is not configured', async () => {
    const res = await request(app)
      .post('/api/v1/pairs/register')
      .set('Authorization', 'Bearer test-admin-secret-local-only-000000000001')
      .send({
        symbol: 'WLUNES/LUSDT',
        baseToken: '5BaseToken',
        quoteToken: '5QuoteToken',
        baseName: 'Wrapped LUNES',
        quoteName: 'LUSDT',
      });

    expect(res.status).toBe(503);
    expect(res.body.error).toContain('FACTORY_CONTRACT_ADDRESS');
    expect(mockPrisma.pair.create).not.toHaveBeenCalled();
  });

  it('updates pair status through an audited admin endpoint', async () => {
    mockPrisma.pair.findUnique.mockResolvedValue({
      id: 'pair-1',
      symbol: 'WLUNES/LUSDT',
      isActive: true,
    });
    mockPrisma.pair.update.mockResolvedValue({
      id: 'pair-1',
      symbol: 'WLUNES/LUSDT',
      isActive: false,
    });

    const res = await request(app)
      .patch('/api/v1/pairs/id/pair-1/status')
      .set('Authorization', 'Bearer test-admin-secret-local-only-000000000001')
      .send({ isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.pair).toEqual({
      id: 'pair-1',
      symbol: 'WLUNES/LUSDT',
      isActive: false,
    });
    expect(mockPrisma.pair.update).toHaveBeenCalledWith({
      where: { id: 'pair-1' },
      data: { isActive: false },
    });
  });

  it('rejects pair deletion when trades or open orders exist', async () => {
    mockPrisma.pair.findUnique.mockResolvedValue({
      id: 'pair-1',
      symbol: 'WLUNES/LUSDT',
    });
    mockPrisma.trade.count.mockResolvedValue(0);
    mockPrisma.order.count.mockResolvedValue(2);

    const res = await request(app)
      .delete('/api/v1/pairs/id/pair-1')
      .set('Authorization', 'Bearer test-admin-secret-local-only-000000000001');

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('open orders');
    expect(mockPrisma.pair.delete).not.toHaveBeenCalled();
  });
});
