/**
 * The admin settlement-status filter must accept every TradeSettlementStatus,
 * including RECONCILE_REQUIRED (ambiguous settle_trade outcomes). ts-jest
 * type-checks this call, so a narrowed signature fails the suite.
 */
jest.mock('../db', () => ({
  __esModule: true,
  default: { trade: { findMany: jest.fn(async () => []) } },
}));
jest.mock('../websocket/server', () => ({
  broadcast: jest.fn(),
  broadcastTrade: jest.fn(),
}));
jest.mock('../utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import prisma from '../db';
import { tradeService } from '../services/tradeService';

describe('tradeService.getTradesBySettlementStatus', () => {
  it('filters by RECONCILE_REQUIRED', async () => {
    await tradeService.getTradesBySettlementStatus('RECONCILE_REQUIRED', 10, 0);
    expect(prisma.trade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { settlementStatus: 'RECONCILE_REQUIRED' },
        take: 10,
        skip: 0,
      }),
    );
  });
});
