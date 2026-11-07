/**
 * Defense in depth (BE-03 follow-up): an agent may only emit copy-trade
 * signals for its OWN leader — the linked leader's address must equal the
 * agent's wallet address. Otherwise no signal is emitted.
 */
import express from 'express';
import request from 'supertest';

const mockCreateSignal = jest.fn();
let leaderAddress = 'agent-wallet';

jest.mock('../middleware/agentAuth', () => ({
  agentAuth: () => (req: any, _res: any, next: any) => {
    req.agent = {
      id: 'agent-1',
      walletAddress: 'agent-wallet',
      permissions: ['TRADE_SPOT'],
      maxPositionSize: 1_000_000,
      dailyTradeLimit: 1000,
    };
    next();
  },
}));

jest.mock('../services/botSandbox', () => ({
  botRateLimiter: () => (_req: any, _res: any, next: any) => next(),
  botAnomalyGuard: () => (_req: any, _res: any, next: any) => next(),
  keyRotationWarning: () => (_req: any, _res: any, next: any) => next(),
  recordLargeOrderPlaced: jest.fn(),
  recordOrderCancelled: jest.fn(),
}));

jest.mock('../services/settlementService', () => ({
  settlementService: { isEnabled: () => false },
}));

jest.mock('../services/orderService', () => ({
  orderService: { createOrder: jest.fn(async () => ({ id: 'ord-1' })) },
}));

jest.mock('../services/executionLayerService', () => ({
  executionLayerService: {
    validateAndLog: jest.fn(async () => ({
      logId: 'log-1',
      validation: { allowed: true, checks: {} },
    })),
    updateExecutionStatus: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock('../services/copytradeService', () => ({
  copytradeService: {
    createSignal: (...a: unknown[]) => mockCreateSignal(...a),
  },
}));

jest.mock('../db', () => ({
  __esModule: true,
  default: {
    agent: {
      findUnique: jest.fn(async (args: any) => {
        if (args?.include?.leader) {
          return {
            id: 'agent-1',
            walletAddress: 'agent-wallet',
            leader: {
              id: 'leader-1',
              address: leaderAddress,
              vault: { status: 'ACTIVE', maxSlippageBps: 50 },
            },
          };
        }
        return { totalTrades: 0 };
      }),
      update: jest.fn().mockResolvedValue({}),
    },
  },
}));

jest.mock('../utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import tradeApiRouter from '../routes/tradeApi';

const app = express();
app.use(express.json());
app.use('/api/v1/trade', tradeApiRouter);

const body = { pairSymbol: 'LUNES/USDT', side: 'BUY', amount: '10' };

describe('emitCopyTradeSignalIfLeader ownership', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateSignal.mockResolvedValue({ signalId: 's-1', slices: [] });
  });

  it('does not emit a signal for a leader the agent wallet does not own', async () => {
    leaderAddress = 'someone-else';

    const res = await request(app).post('/api/v1/trade/swap').send(body);

    expect(res.status).toBe(201);
    expect(res.body.copyTradeSignal).toBeNull();
    expect(mockCreateSignal).not.toHaveBeenCalled();
  });

  it("emits the signal for the agent's own leader", async () => {
    leaderAddress = 'agent-wallet';

    const res = await request(app).post('/api/v1/trade/swap').send(body);

    expect(res.status).toBe(201);
    expect(mockCreateSignal).toHaveBeenCalledTimes(1);
    expect(res.body.copyTradeSignal).toEqual({ signalId: 's-1', slices: 0 });
  });
});
