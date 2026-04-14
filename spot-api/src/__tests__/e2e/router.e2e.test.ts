import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import request from 'supertest';

jest.mock('../../middleware/agentAuth', () => ({
  agentAuth: () => (req: any, res: any, next: any) => {
    const apiKey = req.headers['x-api-key'] as string | undefined;

    if (!apiKey) {
      return res.status(401).json({ error: 'Missing X-API-Key header' });
    }

    req.agent = {
      id: 'agent-1',
      walletAddress: 'agent-wallet-123',
      agentType: 'AI_AGENT',
      permissions: ['TRADE_SPOT'],
      keyId: 'key-1',
      stakingTier: 3,
      dailyTradeLimit: 100,
      maxPositionSize: 100_000,
      maxOpenOrders: 50,
    };

    next();
  },
}));

jest.mock('../../services/routerService', () => ({
  routerService: {
    getQuote: jest.fn(),
    executeViaRouter: jest.fn(),
  },
}));

import router from '../../routes/router';
import { routerService } from '../../services/routerService';

const routerServiceMock = routerService as jest.Mocked<typeof routerService>;

function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use('/api/v1/route', router);

  return app;
}

const app = createApp();

describe('Smart Router API E2E', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/v1/route/quote', () => {
    it('should return 400 on invalid query', async () => {
      const res = await request(app).get('/api/v1/route/quote');

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'Validation failed');
      expect(routerServiceMock.getQuote).not.toHaveBeenCalled();
    });

    it('should return a public Smart Router quote', async () => {
      routerServiceMock.getQuote.mockResolvedValueOnce({
        pairSymbol: 'LUNES/LUSDT',
        side: 'BUY',
        amountIn: 1000,
        bestRoute: 'ORDERBOOK',
        bestAmountOut: 241.5,
        bestEffectivePrice: 4.14,
        routes: [],
        computedAt: '2026-04-13T15:00:00.000Z',
      });

      const res = await request(app)
        .get('/api/v1/route/quote')
        .query({ pairSymbol: 'LUNES/LUSDT', side: 'BUY', amountIn: '1000' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('bestRoute', 'ORDERBOOK');
      expect(routerServiceMock.getQuote).toHaveBeenCalledWith({
        pairSymbol: 'LUNES/LUSDT',
        side: 'BUY',
        amountIn: 1000,
      });
    });
  });

  describe('POST /api/v1/route/swap', () => {
    it('should require agent authentication', async () => {
      const res = await request(app).post('/api/v1/route/swap').send({
        pairSymbol: 'LUNES/LUSDT',
        side: 'BUY',
        amountIn: 1000,
      });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error', 'Missing X-API-Key header');
      expect(routerServiceMock.executeViaRouter).not.toHaveBeenCalled();
    });

    it('should return 400 on invalid swap payload', async () => {
      const res = await request(app)
        .post('/api/v1/route/swap')
        .set('x-api-key', 'test-key')
        .send({
          pairSymbol: 'LUNES/LUSDT',
          side: 'BUY',
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'Validation failed');
      expect(routerServiceMock.executeViaRouter).not.toHaveBeenCalled();
    });

    it('should execute a server-side routed swap for an authenticated agent', async () => {
      routerServiceMock.executeViaRouter.mockResolvedValueOnce({
        quote: {
          pairSymbol: 'LUNES/LUSDT',
          side: 'SELL',
          amountIn: 500,
          bestRoute: 'ORDERBOOK',
          bestAmountOut: 2100,
          bestEffectivePrice: 4.2,
          routes: [],
          computedAt: '2026-04-13T15:00:00.000Z',
        },
        executedVia: 'ORDERBOOK',
        success: true,
        order: { id: 'order-1' },
        minAmountOut: 2084.25,
      } as any);

      const res = await request(app)
        .post('/api/v1/route/swap')
        .set('x-api-key', 'test-key')
        .send({
          pairSymbol: 'LUNES/LUSDT',
          side: 'SELL',
          amountIn: 500,
          maxSlippageBps: 75,
        });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        executedVia: 'ORDERBOOK',
        success: true,
        agentId: 'agent-1',
        order: { id: 'order-1' },
      });

      expect(routerServiceMock.executeViaRouter).toHaveBeenCalledTimes(1);

      const call = routerServiceMock.executeViaRouter.mock.calls[0]?.[0];
      expect(call).toMatchObject({
        pairSymbol: 'LUNES/LUSDT',
        side: 'SELL',
        amountIn: 500,
        maxSlippageBps: 75,
        makerAddress: 'agent-wallet-123',
        agentId: 'agent-1',
      });
      expect(call?.nonce).toMatch(/^router_agent-1_\d+$/);
    });

    it('should preserve wallet-assisted ASYMMETRIC continuations', async () => {
      routerServiceMock.executeViaRouter.mockResolvedValueOnce({
        quote: {
          pairSymbol: 'LUNES/LUSDT',
          side: 'BUY',
          amountIn: 1000,
          bestRoute: 'ASYMMETRIC',
          bestAmountOut: 238.1,
          bestEffectivePrice: 4.2,
          routes: [],
          computedAt: '2026-04-13T15:00:00.000Z',
        },
        executedVia: 'ASYMMETRIC',
        success: true,
        requiresWalletSignature: true,
        contractCallIntent: {
          contractAddress: '5Fcontract',
          method: 'swap',
          side: 'BUY',
          amountIn: 1000,
          minAmountOut: 235.7,
          makerAddress: 'agent-wallet-123',
          nonce: 'router_agent-1_1700000000000',
          agentId: 'agent-1',
        },
        message:
          'Route selected: ASYMMETRIC pool. Submit via wallet signature using contractCallIntent.',
      } as any);

      const res = await request(app)
        .post('/api/v1/route/swap')
        .set('x-api-key', 'test-key')
        .send({
          pairSymbol: 'LUNES/LUSDT',
          side: 'BUY',
          amountIn: 1000,
        });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        executedVia: 'ASYMMETRIC',
        success: true,
        requiresWalletSignature: true,
        agentId: 'agent-1',
        contractCallIntent: {
          contractAddress: '5Fcontract',
          method: 'swap',
          side: 'BUY',
          amountIn: 1000,
          agentId: 'agent-1',
        },
      });

      const call = routerServiceMock.executeViaRouter.mock.calls[0]?.[0];
      expect(call).toMatchObject({
        pairSymbol: 'LUNES/LUSDT',
        side: 'BUY',
        amountIn: 1000,
        maxSlippageBps: 100,
        makerAddress: 'agent-wallet-123',
        agentId: 'agent-1',
      });
    });
  });
});
