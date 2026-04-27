const mockPrisma = {
  $transaction: jest.fn(),
  pair: {
    findUnique: jest.fn(),
  },
  order: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  trade: {
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
};

const mockTradeSettlementService = {
  processNewTradeSettlements: jest.fn(),
  retryPendingSettlements: jest.fn(),
};

jest.mock('../db', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../services/candleService', () => ({
  candleService: {
    updateCandle: jest.fn(),
  },
}));

jest.mock('../services/tradeSettlementService', () => ({
  serializeSettlementInput: jest.fn((input) => input),
  tradeSettlementService: mockTradeSettlementService,
}));

jest.mock('../services/affiliateService', () => ({
  affiliateService: {
    distributeCommissions: jest.fn(),
  },
}));

jest.mock('../utils/logger', () => ({
  log: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

import { tradeService } from '../services/tradeService';
import { Decimal } from '@prisma/client/runtime/library';

describe('tradeService operational settlement methods', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists trades filtered by settlement status', async () => {
    const trades = [
      {
        id: 'trade-1',
        settlementStatus: 'FAILED',
        pair: { symbol: 'LUNES/USDT' },
      },
    ];
    mockPrisma.trade.findMany.mockResolvedValue(trades);

    const result = await tradeService.getTradesBySettlementStatus(
      'FAILED',
      10,
      5,
    );

    expect(result).toBe(trades);
    expect(mockPrisma.trade.findMany).toHaveBeenCalledWith({
      where: { settlementStatus: 'FAILED' },
      orderBy: [{ createdAt: 'desc' }],
      take: 10,
      skip: 5,
      include: {
        pair: { select: { symbol: true } },
      },
    });
  });

  it('lists trades without settlement filter when status is omitted', async () => {
    mockPrisma.trade.findMany.mockResolvedValue([]);

    await tradeService.getTradesBySettlementStatus(undefined, 20, 0);

    expect(mockPrisma.trade.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: [{ createdAt: 'desc' }],
      take: 20,
      skip: 0,
      include: {
        pair: { select: { symbol: true } },
      },
    });
  });

  it('delegates manual settlement retry to tradeSettlementService', async () => {
    mockTradeSettlementService.retryPendingSettlements.mockResolvedValue({
      processed: 2,
      settled: 1,
      failed: 1,
    });

    const result = await tradeService.retryTradeSettlements(12);

    expect(result).toEqual({ processed: 2, settled: 1, failed: 1 });
    expect(
      mockTradeSettlementService.retryPendingSettlements,
    ).toHaveBeenCalledWith(12);
  });
});

describe('tradeService response sanitization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const tradeWithSettlementInternals = {
    id: 'trade-1',
    pairId: 'pair-1',
    makerOrderId: 'maker-order',
    takerOrderId: 'taker-order',
    makerAddress: 'maker-address',
    takerAddress: 'taker-address',
    side: 'BUY',
    price: '1.2',
    amount: '3',
    quoteAmount: '3.6',
    makerFee: '0.01',
    takerFee: '0.02',
    settlementStatus: 'FAILED',
    settlementAttempts: 3,
    settlementPayload: { relayerSeed: 'must-not-leak' },
    settlementError: 'internal RPC failure with node URL',
    lastSettlementAttemptAt: new Date('2026-01-01T00:00:00Z'),
    nextSettlementRetryAt: new Date('2026-01-01T00:01:00Z'),
    txHash: null,
    settledAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    pair: { symbol: 'LUNES/USDT' },
  };

  it('redacts settlement internals from public recent trades', async () => {
    mockPrisma.pair.findUnique.mockResolvedValue({ id: 'pair-1' });
    mockPrisma.trade.findMany.mockResolvedValue([tradeWithSettlementInternals]);

    const result = await tradeService.getRecentTrades('LUNES/USDT');

    expect(result[0]).not.toHaveProperty('settlementPayload');
    expect(result[0]).not.toHaveProperty('settlementError');
    expect(result[0]).not.toHaveProperty('settlementAttempts');
    expect(result[0]).toHaveProperty('settlementStatus', 'FAILED');
  });

  it('redacts settlement internals from signed user trade reads', async () => {
    mockPrisma.trade.findMany.mockResolvedValue([tradeWithSettlementInternals]);

    const result = await tradeService.getUserTrades('maker-address');

    expect(result[0]).not.toHaveProperty('settlementPayload');
    expect(result[0]).not.toHaveProperty('settlementError');
    expect(result[0]).not.toHaveProperty('settlementAttempts');
    expect(result[0]).toHaveProperty('pair', { symbol: 'LUNES/USDT' });
  });
});

describe('tradeService.processMatches consistency', () => {
  const pair = {
    id: 'pair-1',
    symbol: 'LUNES/USDT',
    baseToken: 'base-token',
    quoteToken: 'quote-token',
    baseName: 'LUNES',
    quoteName: 'USDT',
    baseDecimals: 8,
    quoteDecimals: 8,
    isNativeBase: false,
    isNativeQuote: false,
    makerFeeBps: 10,
    takerFeeBps: 25,
  };

  function makeOrder(id: string, overrides: Record<string, any> = {}) {
    return {
      id,
      makerAddress: `${id}-maker`,
      side: id.startsWith('maker') ? 'SELL' : 'BUY',
      type: 'LIMIT',
      price: new Decimal('100'),
      stopPrice: null,
      amount: new Decimal('10'),
      filledAmount: new Decimal('0'),
      remainingAmount: new Decimal('10'),
      nonce: `${id}-nonce`,
      signature: `agent:${id}`,
      signatureTimestamp: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (callback) =>
      callback({
        order: mockPrisma.order,
        pair: mockPrisma.pair,
        trade: mockPrisma.trade,
      }),
    );
    mockPrisma.pair.findUnique.mockResolvedValue(pair);
    mockPrisma.order.findUnique.mockImplementation(({ where }) => {
      const id = where.id as string;
      return Promise.resolve(
        makeOrder(id, {
          side: id.startsWith('maker') ? 'SELL' : 'BUY',
          makerAddress: id.startsWith('maker')
            ? 'maker-wallet'
            : 'taker-wallet',
        }),
      );
    });
    mockPrisma.order.update.mockResolvedValue({});
    mockPrisma.trade.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: `trade-${data.makerOrderId}-${data.takerOrderId}`,
        pairId: data.pairId,
        makerAddress: data.makerAddress,
        takerAddress: data.takerAddress,
        makerFee: data.makerFee,
        takerFee: data.takerFee,
      }),
    );
    mockPrisma.trade.update.mockResolvedValue({});
    mockTradeSettlementService.processNewTradeSettlements.mockResolvedValue([]);
  });

  it('persists all matches inside one database transaction', async () => {
    await tradeService.processMatches('pair-1', [
      {
        makerOrderId: 'maker-order-1',
        takerOrderId: 'taker-order-1',
        makerAddress: 'maker-wallet',
        takerAddress: 'taker-wallet',
        fillAmount: 1,
        fillPrice: 100,
      },
      {
        makerOrderId: 'maker-order-2',
        takerOrderId: 'taker-order-2',
        makerAddress: 'maker-wallet',
        takerAddress: 'taker-wallet',
        fillAmount: 2,
        fillPrice: 101,
      },
    ]);

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.trade.create).toHaveBeenCalledTimes(2);
    expect(
      mockTradeSettlementService.processNewTradeSettlements,
    ).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          tradeId: 'trade-maker-order-1-taker-order-1',
        }),
        expect.objectContaining({
          tradeId: 'trade-maker-order-2-taker-order-2',
        }),
      ]),
    );
  });

  it('leaves persisted trades retryable when immediate settlement processing fails', async () => {
    mockTradeSettlementService.processNewTradeSettlements.mockRejectedValueOnce(
      new Error('settlement queue unavailable'),
    );

    await expect(
      tradeService.processMatches('pair-1', [
        {
          makerOrderId: 'maker-order-1',
          takerOrderId: 'taker-order-1',
          makerAddress: 'maker-wallet',
          takerAddress: 'taker-wallet',
          fillAmount: 1,
          fillPrice: 100,
        },
      ]),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'trade-maker-order-1-taker-order-1',
      }),
    ]);

    expect(mockPrisma.trade.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.trade.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'trade-maker-order-1-taker-order-1' },
        data: expect.objectContaining({
          settlementPayload: expect.objectContaining({
            tradeId: 'trade-maker-order-1-taker-order-1',
          }),
        }),
      }),
    );
  });
});
