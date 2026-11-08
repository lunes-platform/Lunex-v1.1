/**
 * BE-05 (router path): ORDERBOOK router execution creates an order with a
 * synthetic `agent:` / `manual:` signature that on-chain settlement always
 * rejects. With settlement enabled it must be refused before any order exists
 * (parity with POST /trade/swap and /trade/limit). Regression guard.
 */
const mockIsEnabled = jest.fn();
const mockCreateOrder = jest.fn();

jest.mock('../db', () => ({
  __esModule: true,
  default: { trade: { findMany: jest.fn(async () => []) } },
}));
jest.mock('../utils/orderbook', () => ({
  orderbookManager: { get: jest.fn() },
}));
jest.mock('../services/rebalancerService', () => ({
  rebalancerService: { getCurveState: jest.fn() },
}));
jest.mock('../services/settlementService', () => ({
  settlementService: { isEnabled: () => mockIsEnabled() },
}));
jest.mock('../services/orderService', () => ({
  orderService: { createOrder: (...a: unknown[]) => mockCreateOrder(...a) },
}));
jest.mock('../utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { routerService } from '../services/routerService';

describe('routerService.executeViaRouter synthetic-signature gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(routerService, 'getQuote').mockResolvedValue({
      bestRoute: 'ORDERBOOK',
      bestAmountOut: 10,
      bestEffectivePrice: 1,
      routes: [{ source: 'ORDERBOOK', priceImpactBps: 0 }],
    } as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it.each([['agent-1'], [undefined]])(
    'refuses ORDERBOOK execution with settlement enabled (agentId=%s)',
    async (agentId) => {
      mockIsEnabled.mockReturnValue(true);

      await expect(
        routerService.executeViaRouter({
          pairSymbol: 'LUNES/USDT',
          side: 'SELL',
          amountIn: 10,
          makerAddress: 'maker',
          nonce: 'n-1',
          agentId,
        }),
      ).rejects.toThrow('wallet-signed order authorization');
      expect(mockCreateOrder).not.toHaveBeenCalled();
    },
  );
});
