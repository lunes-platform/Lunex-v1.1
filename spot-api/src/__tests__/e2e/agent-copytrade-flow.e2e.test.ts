import express from 'express';
import request from 'supertest';
import { buildSignedQuery } from './authTestUtils';

const activityStore: Array<Record<string, unknown>> = [];

jest.mock('../../middleware/agentAuth', () => ({
  agentAuth: () => (req: any, _res: any, next: any) => {
    req.agent = {
      id: 'agent-1',
      walletAddress: 'agent-wallet-123',
      agentType: 'AI_AGENT',
      permissions: ['TRADE_SPOT'],
      keyId: 'key-1',
      stakingTier: 1,
      dailyTradeLimit: 100,
      maxPositionSize: 100_000,
      maxOpenOrders: 10,
    };
    next();
  },
}));

jest.mock('../../middleware/auth', () => ({
  ...jest.requireActual('../../middleware/auth'),
  verifyWalletReadSignature: jest
    .fn()
    .mockResolvedValue({ ok: true, message: 'signed-read-message' }),
  verifyWalletActionSignature: jest
    .fn()
    .mockResolvedValue({ ok: true, message: 'signed-action-message' }),
}));

jest.mock('../../services/botSandbox', () => ({
  botRateLimiter: () => (_req: any, _res: any, next: any) => next(),
  botAnomalyGuard: () => (_req: any, _res: any, next: any) => next(),
  keyRotationWarning: () => (_req: any, _res: any, next: any) => next(),
  recordLargeOrderPlaced: jest.fn(),
  recordOrderCancelled: jest.fn(),
}));

jest.mock('../../db', () => ({
  __esModule: true,
  default: {
    agent: {
      findUnique: jest.fn(async (args: any) => {
        if (args?.include?.leader) {
          return {
            id: args.where.id,
            walletAddress: 'agent-wallet-123',
            leader: {
              id: 'leader-1',
              vault: {
                status: 'ACTIVE',
                maxSlippageBps: 75,
              },
            },
          };
        }

        if (args?.select?.totalTrades) {
          return { totalTrades: 0 };
        }

        return null;
      }),
      update: jest.fn().mockResolvedValue({}),
    },
  },
}));

jest.mock('../../services/orderService', () => ({
  orderService: {
    createOrder: jest.fn(async (input: any) => ({
      id: 'ord-1',
      pairSymbol: input.pairSymbol,
      side: input.side,
      type: input.type,
      amount: input.amount,
      makerAddress: input.makerAddress,
      status: 'FILLED',
    })),
  },
}));

jest.mock('../../services/executionLayerService', () => ({
  executionLayerService: {
    validateAndLog: jest.fn().mockResolvedValue({
      logId: 'exec-log-1',
      validation: { allowed: true, checks: {} },
    }),
    updateExecutionStatus: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock('../../services/copytradeService', () => ({
  copytradeService: {
    createApiKeyChallenge: jest.fn(),
    listVaults: jest.fn().mockResolvedValue([]),
    getVaultByLeader: jest.fn(),
    getUserPositions: jest.fn().mockResolvedValue([]),
    getVaultExecutions: jest.fn().mockResolvedValue([]),
    createOrRotateApiKey: jest.fn(),
    depositToVault: jest.fn(),
    withdrawFromVault: jest.fn(),
    validateLeaderApiKey: jest.fn().mockResolvedValue(true),
    createSignal: jest.fn(async (leaderId: string, input: any) => {
      const resolvedPositionEffect =
        input.positionEffect === 'CLOSE' ? 'CLOSE' : 'OPEN';
      const signalId = `signal-${activityStore.length + 1}`;

      activityStore.unshift({
        type: 'SIGNAL',
        createdAt: new Date(),
        leaderId,
        leaderName: 'Leader One',
        pairSymbol: input.pairSymbol,
        side: input.side,
        positionEffect: resolvedPositionEffect,
        amountIn: Number(input.amountIn),
        executionPrice: Number(input.executionPrice || '0'),
        realizedPnlPct: resolvedPositionEffect === 'CLOSE' ? 12.5 : 0,
        slices: 1,
      });

      return {
        signalId,
        pairSymbol: input.pairSymbol,
        side: input.side,
        positionEffect: resolvedPositionEffect,
        amountIn: Number(input.amountIn),
        totalAmountOut: 0,
        executionPrice: Number(input.executionPrice || '0'),
        realizedPnlPct: resolvedPositionEffect === 'CLOSE' ? 12.5 : 0,
        slices: [
          {
            id: `${signalId}-slice-1`,
            sliceIndex: 1,
            totalSlices: 1,
            amountIn: Number(input.amountIn),
            amountOut: 0,
            executionPrice: Number(input.executionPrice || '0'),
            realizedPnl: 0,
          },
        ],
      };
    }),
    getActivity: jest.fn(async (_address?: string, limit = 50) =>
      activityStore.slice(0, limit),
    ),
  },
}));

import tradeApiRouter from '../../routes/tradeApi';
import copytradeRouter from '../../routes/copytrade';
import prisma from '../../db';
import { copytradeService } from '../../services/copytradeService';
import { orderService } from '../../services/orderService';
import { executionLayerService } from '../../services/executionLayerService';

const mockedPrisma = prisma as jest.Mocked<typeof prisma>;
const mockedCopytradeService = copytradeService as jest.Mocked<
  typeof copytradeService
>;
const mockedOrderService = orderService as jest.Mocked<typeof orderService>;
const mockedExecutionLayerService = executionLayerService as jest.Mocked<
  typeof executionLayerService
>;

const app = express();
app.use(express.json());
app.use('/api/v1/trade', tradeApiRouter);
app.use('/api/v1/copytrade', copytradeRouter);

describe('Agent trade to copytrade activity flow', () => {
  beforeEach(() => {
    activityStore.length = 0;
    jest.clearAllMocks();
  });

  it('emits a copytrade signal from an agent trade and surfaces it in copytrade activity', async () => {
    const tradeRes = await request(app)
      .post('/api/v1/trade/swap')
      .set('x-api-key', 'agent-api-key')
      .send({
        pairSymbol: 'LUNES/USDT',
        side: 'BUY',
        amount: '100',
      });

    expect(tradeRes.status).toBe(201);
    expect(tradeRes.body.copyTradeSignal).toEqual({
      signalId: 'signal-1',
      slices: 1,
    });
    expect(mockedCopytradeService.createSignal).toHaveBeenCalledWith(
      'leader-1',
      expect.objectContaining({
        pairSymbol: 'LUNES/USDT',
        side: 'BUY',
        positionEffect: 'AUTO',
        signalMode: 'JOURNAL',
        source: 'API',
        amountIn: '100',
      }),
    );
    expect(mockedOrderService.createOrder).toHaveBeenCalled();
    expect(
      mockedExecutionLayerService.updateExecutionStatus,
    ).toHaveBeenCalledWith(
      'exec-log-1',
      expect.objectContaining({
        status: 'EXECUTED',
        orderId: 'ord-1',
      }),
    );
    expect(mockedPrisma.agent.update).toHaveBeenCalled();

    const activityRes = await request(app)
      .get('/api/v1/copytrade/activity')
      .query(buildSignedQuery('address', 'viewer-addr-123'));

    expect(activityRes.status).toBe(200);
    expect(activityRes.body.activity).toHaveLength(1);
    expect(activityRes.body.activity[0]).toEqual(
      expect.objectContaining({
        type: 'SIGNAL',
        leaderId: 'leader-1',
        pairSymbol: 'LUNES/USDT',
        side: 'BUY',
        positionEffect: 'OPEN',
        amountIn: 100,
        slices: 1,
      }),
    );
  });

  it('keeps trade execution alive when copytrade signal emission fails', async () => {
    mockedCopytradeService.createSignal.mockRejectedValueOnce(
      new Error('copytrade unavailable'),
    );

    const tradeRes = await request(app)
      .post('/api/v1/trade/swap')
      .set('x-api-key', 'agent-api-key')
      .send({
        pairSymbol: 'LUNES/USDT',
        side: 'BUY',
        amount: '100',
      });

    expect(tradeRes.status).toBe(201);
    expect(tradeRes.body.order).toEqual(
      expect.objectContaining({
        id: 'ord-1',
        pairSymbol: 'LUNES/USDT',
      }),
    );
    expect(tradeRes.body.copyTradeSignal).toBeNull();
  });
});
