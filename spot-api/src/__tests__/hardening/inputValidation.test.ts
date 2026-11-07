/**
 * BE-19 — unvalidated params must not reach Prisma (operator injection / 500).
 */
jest.mock('../../services/tradeService', () => ({
  tradeService: {
    getRecentTrades: jest.fn(async () => []),
    getUserTrades: jest.fn(async () => []),
  },
}));
jest.mock('../../services/candleService', () => ({
  candleService: { getCandles: jest.fn(async () => []) },
}));
jest.mock('../../services/rewardDistributionService', () => ({
  rewardDistributionService: {
    getDistributedWeeks: jest.fn(async () => []),
    claimRewards: jest.fn(async () => ({ claimed: 0 })),
  },
}));
jest.mock('../../services/rewardScheduler', () => ({
  rewardScheduler: { forceDistribute: jest.fn() },
}));
jest.mock('../../middleware/auth', () => ({
  ...jest.requireActual('../../middleware/auth'),
  verifyWalletActionSignature: jest.fn(async () => ({ ok: true, message: 'm' })),
}));

import express from 'express';
import request from 'supertest';
import tradesRouter from '../../routes/trades';
import candlesRouter from '../../routes/candles';
import orderbookRouter from '../../routes/orderbook';
import rewardsRouter from '../../routes/rewards';
import { tradeService } from '../../services/tradeService';
import { candleService } from '../../services/candleService';
import { rewardDistributionService } from '../../services/rewardDistributionService';

const app = express();
app.use(express.json());
app.use('/api/v1/trades', tradesRouter);
app.use('/api/v1/candles', candlesRouter);
app.use('/api/v1/orderbook', orderbookRouter);
app.use('/api/v1/rewards', rewardsRouter);

beforeEach(() => jest.clearAllMocks());

describe('BE-19 symbol params are plain validated strings', () => {
  it.each([
    '/api/v1/trades/LUNES-USDT?symbol[not]=x',
    '/api/v1/trades?symbol[contains]=L',
    '/api/v1/candles/LUNES-USDT?symbol[in][]=a',
    '/api/v1/orderbook/LUNES-USDT?symbol[0]=a&symbol[1]=b',
    `/api/v1/trades/${'A'.repeat(64)}`,
  ])('GET %s → 400', async (url) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(400);
    expect(tradeService.getRecentTrades).not.toHaveBeenCalled();
    expect(candleService.getCandles).not.toHaveBeenCalled();
  });

  it('valid symbols still work', async () => {
    expect((await request(app).get('/api/v1/trades/LUNES-USDT')).status).toBe(
      200,
    );
    expect(
      (await request(app).get('/api/v1/candles?symbol=LUNES/USDT')).status,
    ).toBe(200);
  });
});

describe('BE-19 rewards', () => {
  it('/weeks?limit=abc → 400 (not a Prisma 500); limit is capped', async () => {
    expect(
      (await request(app).get('/api/v1/rewards/weeks?limit=abc')).status,
    ).toBe(400);
    expect(
      (await request(app).get('/api/v1/rewards/weeks?limit=100000')).status,
    ).toBe(400);
    expect(rewardDistributionService.getDistributedWeeks).not.toHaveBeenCalled();
  });

  it('/claim rejects arrays/objects instead of strings', async () => {
    const res = await request(app)
      .post('/api/v1/rewards/claim')
      .send({
        address: ['5Grwva', 'x'],
        nonce: { $gt: '' },
        timestamp: Date.now(),
        signature: 'signature-123',
      });
    expect(res.status).toBe(400);
    expect(rewardDistributionService.claimRewards).not.toHaveBeenCalled();
  });
});
