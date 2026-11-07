/**
 * BE-05: agent orders carry a synthetic `agent:<id>` signature that
 * settlementService.assertOrderTrustedSource always rejects. With on-chain
 * settlement enabled, POST /trade/limit must refuse them (parity with /swap),
 * otherwise agents mint DB trades that can never settle (fake volume/fees,
 * consumed counterparty orders).
 */
import express from 'express';
import request from 'supertest';

const mockIsEnabled = jest.fn();
const mockCreateOrder = jest.fn();
const mockValidateAndLog = jest.fn();

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
  settlementService: { isEnabled: () => mockIsEnabled() },
}));

jest.mock('../services/orderService', () => ({
  orderService: { createOrder: (...a: unknown[]) => mockCreateOrder(...a) },
}));

jest.mock('../services/executionLayerService', () => ({
  executionLayerService: {
    validateAndLog: (...a: unknown[]) => mockValidateAndLog(...a),
    updateExecutionStatus: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock('../services/copytradeService', () => ({
  copytradeService: { createSignal: jest.fn() },
}));

jest.mock('../db', () => ({
  __esModule: true,
  default: {
    agent: {
      findUnique: jest.fn().mockResolvedValue(null),
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

const body = {
  pairSymbol: 'LUNES/USDT',
  side: 'BUY',
  price: '0.1',
  amount: '10',
};

describe('POST /trade/limit with on-chain settlement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateAndLog.mockResolvedValue({
      logId: 'log-1',
      validation: { allowed: true, checks: {} },
    });
    mockCreateOrder.mockResolvedValue({ id: 'ord-1' });
  });

  it('returns 409 and creates no order when settlement is enabled', async () => {
    mockIsEnabled.mockReturnValue(true);

    const res = await request(app).post('/api/v1/trade/limit').send(body);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SYNTHETIC_SIGNATURE_SETTLEMENT_BLOCKED');
    expect(mockCreateOrder).not.toHaveBeenCalled();
    expect(mockValidateAndLog).not.toHaveBeenCalled();
  });

  it('still accepts agent limit orders when settlement is disabled', async () => {
    mockIsEnabled.mockReturnValue(false);

    const res = await request(app).post('/api/v1/trade/limit').send(body);

    expect(res.status).toBe(201);
    expect(mockCreateOrder).toHaveBeenCalledTimes(1);
  });
});
