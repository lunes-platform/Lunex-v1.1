jest.mock('../db', () => ({
  __esModule: true,
  default: {
    pair: {
      findUnique: jest.fn(),
    },
    trade: {
      findMany: jest.fn(),
    },
    asymmetricStrategy: {
      findFirst: jest.fn(),
    },
  },
}));

jest.mock('../utils/orderbook', () => ({
  orderbookManager: {
    get: jest.fn(),
  },
}));

jest.mock('../services/rebalancerService', () => ({
  rebalancerService: {
    getCurveState: jest.fn(),
  },
}));

const mockOrderService = {
  createOrder: jest.fn(),
};

jest.mock('../services/orderService', () => ({
  orderService: mockOrderService,
}));

import prisma from '../db';
import { orderbookManager } from '../utils/orderbook';
import { rebalancerService } from '../services/rebalancerService';
import { routerService } from '../services/routerService';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockOrderbookManager = orderbookManager as jest.Mocked<
  typeof orderbookManager
>;
const mockRebalancerService = rebalancerService as jest.Mocked<
  typeof rebalancerService
>;

function decimalLike(value: number | string) {
  return {
    toString: () => value.toString(),
  };
}

describe('routerService.getQuote', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (mockPrisma.pair.findUnique as jest.Mock).mockResolvedValue({
      id: 'pair-1',
      symbol: 'LUNES/LUSDT',
      reserveBase: decimalLike(1000),
      reserveQuote: decimalLike(4000),
      takerFeeBps: 20,
      makerFeeBps: 10,
      pairAddress: '5Fpair',
    });
    (mockPrisma.asymmetricStrategy.findFirst as jest.Mock).mockResolvedValue({
      pairAddress: '5Fpair',
    });
    (mockOrderbookManager.get as jest.Mock).mockReturnValue(null);
  });

  it('keeps ASYMMETRIC unavailable when live curve state cannot be fetched', async () => {
    mockRebalancerService.getCurveState.mockResolvedValue(null);

    const quote = await routerService.getQuote({
      pairSymbol: 'LUNES/LUSDT',
      side: 'BUY',
      amountIn: 100,
    });

    const asymmetric = quote.routes.find(
      (route) => route.source === 'ASYMMETRIC',
    );
    expect(asymmetric).toBeDefined();
    expect(asymmetric?.available).toBe(false);
    expect(asymmetric?.unavailableReason).toBe('LIVE_CURVE_UNAVAILABLE');
  });

  it('exposes ASYMMETRIC when live curve state is available and has capacity', async () => {
    mockRebalancerService.getCurveState.mockResolvedValue({
      k: 5000,
      gamma: 1,
      maxCapacity: 10000,
      feeBps: 30,
      currentVolume: 0,
    } as any);

    const quote = await routerService.getQuote({
      pairSymbol: 'LUNES/LUSDT',
      side: 'BUY',
      amountIn: 100,
    });

    const asymmetric = quote.routes.find(
      (route) => route.source === 'ASYMMETRIC',
    );
    expect(asymmetric?.available).toBe(true);
    expect(asymmetric?.unavailableReason).toBeUndefined();
    expect(quote.bestRoute).toBe('ASYMMETRIC');
  });
});

describe('routerService.executeViaRouter', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (mockPrisma.pair.findUnique as jest.Mock).mockResolvedValue({
      id: 'pair-1',
      symbol: 'LUNES/LUSDT',
      reserveBase: decimalLike(1000),
      reserveQuote: decimalLike(4000),
      takerFeeBps: 20,
      makerFeeBps: 10,
      pairAddress: '5Fpair',
    });
    (mockPrisma.asymmetricStrategy.findFirst as jest.Mock).mockResolvedValue({
      pairAddress: '5Fpair',
    });
    (mockOrderbookManager.get as jest.Mock).mockReturnValue(null);
    (mockPrisma.trade.findMany as jest.Mock).mockResolvedValue([]);
    mockRebalancerService.getCurveState.mockResolvedValue(null);
    mockOrderService.createOrder.mockReset();
  });

  it('rejects execution when best quote is below amountOutMin', async () => {
    await expect(
      routerService.executeViaRouter({
        pairSymbol: 'LUNES/LUSDT',
        side: 'BUY',
        amountIn: 100,
        amountOutMin: 30,
        maxSlippageBps: 500,
        makerAddress: '5Fmaker',
        nonce: 'router-test-1',
      }),
    ).rejects.toThrow('below amountOutMin');
  });

  it('rejects stale orderbook execution before creating an order when amountOutMin cannot be met', async () => {
    (mockPrisma.pair.findUnique as jest.Mock).mockResolvedValue({
      id: 'pair-1',
      symbol: 'LUNES/LUSDT',
      reserveBase: decimalLike(0),
      reserveQuote: decimalLike(0),
      takerFeeBps: 20,
      makerFeeBps: 10,
      pairAddress: null,
    });
    (mockPrisma.asymmetricStrategy.findFirst as jest.Mock).mockResolvedValue(
      null,
    );

    const freshBook = {
      getSnapshot: jest.fn(() => ({
        bids: [],
        asks: [{ price: 4, amount: 25, total: 25 }],
      })),
    };
    const staleBook = {
      getSnapshot: jest.fn(() => ({
        bids: [],
        asks: [{ price: 4, amount: 5, total: 5 }],
      })),
    };
    (mockOrderbookManager.get as jest.Mock)
      .mockReturnValueOnce(freshBook)
      .mockReturnValueOnce(staleBook);

    await expect(
      routerService.executeViaRouter({
        pairSymbol: 'LUNES/LUSDT',
        side: 'BUY',
        amountIn: 100,
        amountOutMin: 20,
        maxSlippageBps: 500,
        makerAddress: '5Fmaker',
        nonce: 'router-test-2',
      }),
    ).rejects.toThrow('below amountOutMin');

    expect(mockOrderService.createOrder).not.toHaveBeenCalled();
  });

  it('rejects stale orderbook execution before creating an order when maxSlippageBps cannot be met', async () => {
    (mockPrisma.pair.findUnique as jest.Mock).mockResolvedValue({
      id: 'pair-1',
      symbol: 'LUNES/LUSDT',
      reserveBase: decimalLike(0),
      reserveQuote: decimalLike(0),
      takerFeeBps: 20,
      makerFeeBps: 10,
      pairAddress: null,
    });
    (mockPrisma.asymmetricStrategy.findFirst as jest.Mock).mockResolvedValue(
      null,
    );

    const quotedBook = {
      getSnapshot: jest.fn(() => ({
        bids: [],
        asks: [{ price: 4, amount: 25, total: 25 }],
      })),
    };
    const staleBook = {
      getSnapshot: jest.fn(() => ({
        bids: [],
        asks: [{ price: 100 / 24, amount: 24, total: 24 }],
      })),
    };
    (mockOrderbookManager.get as jest.Mock)
      .mockReturnValueOnce(quotedBook)
      .mockReturnValueOnce(staleBook);
    mockOrderService.createOrder.mockResolvedValue({ id: 'order-1' });
    (mockPrisma.trade.findMany as jest.Mock).mockResolvedValue([
      { amount: decimalLike(24), quoteAmount: decimalLike(100) },
    ]);

    await expect(
      routerService.executeViaRouter({
        pairSymbol: 'LUNES/LUSDT',
        side: 'BUY',
        amountIn: 100,
        amountOutMin: 20,
        maxSlippageBps: 100,
        makerAddress: '5Fmaker',
        nonce: 'router-test-3',
      }),
    ).rejects.toThrow('below slippage-protected minimum');

    expect(mockOrderService.createOrder).not.toHaveBeenCalled();
  });

  it('rejects AMM_V1 execution before creating an order because backend execution is not implemented', async () => {
    await expect(
      routerService.executeViaRouter({
        pairSymbol: 'LUNES/LUSDT',
        side: 'BUY',
        amountIn: 100,
        amountOutMin: 20,
        maxSlippageBps: 500,
        makerAddress: '5Fmaker',
        nonce: 'router-test-4',
      }),
    ).rejects.toThrow('AMM_V1 execution is not implemented');

    expect(mockOrderService.createOrder).not.toHaveBeenCalled();
  });
});
