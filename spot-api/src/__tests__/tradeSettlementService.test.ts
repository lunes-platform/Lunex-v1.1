type MockPrisma = {
  trade: {
    update: jest.Mock;
    updateMany: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
  };
  $transaction: jest.Mock;
};

const mockPrisma: MockPrisma = {
  trade: {
    update: jest.fn(),
    updateMany: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  // Pass-through transaction stub: hands the same mock to the callback so the
  // service code that calls `prisma.$transaction((tx) => ...)` exercises the
  // same `trade.update` mocks the tests assert against.
  $transaction: jest.fn(
    async (callback: (tx: MockPrisma) => unknown): Promise<unknown> =>
      callback(mockPrisma),
  ),
};

const mockSettlementService = {
  isEnabled: jest.fn(),
  settleTrades: jest.fn(),
};

jest.mock('../db', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../services/settlementService', () => ({
  settlementService: mockSettlementService,
}));

import { tradeSettlementService } from '../services/tradeSettlementService';

describe('tradeSettlementService', () => {
  const baseInput = {
    tradeId: 'trade-1',
    pair: {
      symbol: 'LUNES/USDT',
      baseToken: 'base-token',
      quoteToken: 'quote-token',
      isNativeBase: true,
      isNativeQuote: false,
      baseDecimals: 8,
    },
    makerOrder: {
      makerAddress: 'maker-1',
      side: 'SELL',
      type: 'LIMIT',
      price: '100',
      stopPrice: null,
      amount: '1',
      filledAmount: '0',
      nonce: '1700000000001',
      signature: 'agent:agent-1',
      expiresAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    takerOrder: {
      makerAddress: 'maker-2',
      side: 'BUY',
      type: 'MARKET',
      price: '100',
      stopPrice: null,
      amount: '1',
      filledAmount: '0',
      nonce: '1700000000002',
      signature: 'agent:agent-2',
      expiresAt: null,
    },
    fillAmount: '1',
    fillPrice: '100',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('marks new trades as skipped when on-chain settlement is disabled', async () => {
    mockSettlementService.isEnabled.mockReturnValue(false);
    mockPrisma.trade.update.mockResolvedValue({ id: 'trade-1' });

    const result = await tradeSettlementService.processNewTradeSettlements([
      baseInput,
    ]);

    expect(result).toEqual([
      {
        tradeId: 'trade-1',
        status: 'SKIPPED',
        error: 'On-chain settlement disabled for this environment',
      },
    ]);
    expect(mockPrisma.trade.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'trade-1' },
        data: expect.objectContaining({
          settlementStatus: 'SKIPPED',
          settlementError: null,
          nextSettlementRetryAt: null,
        }),
      }),
    );
  });

  it('persists settling then settled lifecycle for successful settlements', async () => {
    mockSettlementService.isEnabled.mockReturnValue(true);
    mockPrisma.trade.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.trade.findUnique.mockResolvedValue({
      id: 'trade-1',
      settlementAttempts: 1,
    });
    mockPrisma.trade.update.mockResolvedValue({ id: 'trade-1' });
    mockSettlementService.settleTrades.mockResolvedValue([
      {
        tradeId: 'trade-1',
        status: 'SETTLED',
        txHash: '0xabc',
      },
    ]);

    const result = await tradeSettlementService.processNewTradeSettlements([
      baseInput,
    ]);

    expect(result).toEqual([
      {
        tradeId: 'trade-1',
        status: 'SETTLED',
        txHash: '0xabc',
      },
    ]);
    expect(mockPrisma.trade.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'trade-1' }),
        data: expect.objectContaining({
          settlementStatus: 'SETTLING',
          settlementError: null,
          nextSettlementRetryAt: null,
        }),
      }),
    );
    expect(mockPrisma.trade.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'trade-1' },
        data: expect.objectContaining({
          settlementStatus: 'SETTLED',
          txHash: '0xabc',
          settlementError: null,
          nextSettlementRetryAt: null,
        }),
      }),
    );
  });

  it('persists failed settlements with retry scheduling', async () => {
    mockSettlementService.isEnabled.mockReturnValue(true);
    mockPrisma.trade.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.trade.findUnique.mockResolvedValue({
      id: 'trade-1',
      settlementAttempts: 1,
    });
    mockPrisma.trade.update.mockResolvedValue({ id: 'trade-1' });
    mockSettlementService.settleTrades.mockResolvedValue([
      {
        tradeId: 'trade-1',
        status: 'FAILED',
        error: 'temporary failure',
      },
    ]);

    await tradeSettlementService.processNewTradeSettlements([baseInput]);

    expect(mockPrisma.trade.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'trade-1' },
        data: expect.objectContaining({
          settlementStatus: 'FAILED',
          settlementError: 'temporary failure',
          nextSettlementRetryAt: expect.any(Date),
        }),
      }),
    );
  });

  it('retries persisted pending settlements from stored payloads', async () => {
    mockSettlementService.isEnabled.mockReturnValue(true);
    mockPrisma.trade.findMany.mockResolvedValue([
      {
        id: 'trade-1',
        settlementPayload: {
          ...baseInput,
          makerOrder: {
            ...baseInput.makerOrder,
            expiresAt: '2026-01-01T00:00:00.000Z',
          },
          takerOrder: {
            ...baseInput.takerOrder,
            expiresAt: null,
          },
        },
      },
    ]);
    mockPrisma.trade.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.trade.findUnique.mockResolvedValue({
      id: 'trade-1',
      settlementAttempts: 2,
    });
    mockPrisma.trade.update.mockResolvedValue({ id: 'trade-1' });
    mockSettlementService.settleTrades.mockResolvedValue([
      {
        tradeId: 'trade-1',
        status: 'SETTLED',
        txHash: '0xdef',
      },
    ]);

    const result = await tradeSettlementService.retryPendingSettlements();

    expect(result).toEqual({ processed: 1, settled: 1, failed: 0 });
    expect(mockPrisma.trade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          // Prisma.DbNull is a sentinel object — assert presence of the filter
          // without checking its identity (the test runs without the real client).
          settlementPayload: expect.objectContaining({ not: expect.anything() }),
          OR: expect.any(Array),
        }),
      }),
    );
    expect(mockSettlementService.settleTrades).toHaveBeenCalledWith([
      expect.objectContaining({
        tradeId: 'trade-1',
        makerOrder: expect.objectContaining({
          expiresAt: expect.any(Date),
        }),
      }),
    ]);
  });
});
