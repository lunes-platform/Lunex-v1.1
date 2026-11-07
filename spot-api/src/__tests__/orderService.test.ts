import { Decimal } from '@prisma/client/runtime/library';

const mockPrisma = {
  pair: {
    findUnique: jest.fn(),
  },
  order: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
  trade: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
};

const mockBook = {
  addMarketOrder: jest.fn(),
  addLimitOrder: jest.fn(),
  cancelOrder: jest.fn(),
  createCheckpoint: jest.fn(),
  restoreCheckpoint: jest.fn(),
  getBestBid: jest.fn(),
  getBestAsk: jest.fn(),
};

const mockOrderbookManager = {
  getOrCreate: jest.fn(() => mockBook),
  get: jest.fn(() => mockBook),
};

const mockTradeService = {
  processMatches: jest.fn(),
};

const mockSettlementService = {
  isEnabled: jest.fn(),
  isNonceUsed: jest.fn(),
  isNonceCancelled: jest.fn(),
  getVaultBalance: jest.fn(),
  cancelOrderFor: jest.fn(),
};

const mockWalletRiskService = {
  assertWalletCanAct: jest.fn(),
};

const mockMatchingLockService = {
  withMatchingLock: jest.fn(async (_pairSymbol: string, callback: any) =>
    callback(),
  ),
};

const mockOrderbookBootstrapService = {
  rehydrateOrderbookForPair: jest.fn(),
};

jest.mock('../db', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../utils/orderbook', () => ({
  orderbookManager: mockOrderbookManager,
}));

jest.mock('../services/tradeService', () => ({
  tradeService: mockTradeService,
}));

jest.mock('../services/settlementService', () => ({
  settlementService: mockSettlementService,
}));

jest.mock('../services/walletRiskService', () => ({
  walletRiskService: mockWalletRiskService,
}));

jest.mock('../services/matchingLockService', () => mockMatchingLockService);

jest.mock(
  '../services/orderbookBootstrapService',
  () => mockOrderbookBootstrapService,
);

import { orderService } from '../services/orderService';

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
  isActive: true,
  makerFeeBps: 10,
  takerFeeBps: 25,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

function makeOrder(overrides: Record<string, any> = {}) {
  return {
    id: 'order-1',
    pairId: pair.id,
    makerAddress: 'maker-1',
    side: 'BUY',
    type: 'STOP',
    price: new Decimal('0'),
    stopPrice: new Decimal('120'),
    amount: new Decimal('1'),
    filledAmount: new Decimal('0'),
    remainingAmount: new Decimal('1'),
    status: 'PENDING_TRIGGER',
    signature: 'sig',
    nonce: '1700000000001',
    orderHash: '0xhash',
    timeInForce: 'GTC',
    expiresAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('orderService stop orders', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.pair.findUnique.mockResolvedValue(pair);
    mockPrisma.order.findUnique.mockReset();
    mockPrisma.order.findFirst.mockReset();
    mockPrisma.order.create.mockReset();
    mockPrisma.order.update.mockReset();
    mockPrisma.order.findMany.mockReset();
    mockPrisma.order.findMany.mockResolvedValue([]);
    mockPrisma.trade.findFirst.mockReset();
    mockPrisma.trade.findMany.mockReset();
    mockPrisma.trade.findMany.mockResolvedValue([]);
    mockBook.addMarketOrder.mockReset();
    mockBook.addLimitOrder.mockReset();
    mockBook.cancelOrder.mockReset();
    mockBook.createCheckpoint.mockReset();
    mockBook.restoreCheckpoint.mockReset();
    mockBook.getBestBid.mockReset();
    mockBook.getBestAsk.mockReset();
    mockBook.getBestBid.mockReturnValue(null);
    mockBook.getBestAsk.mockReturnValue(null);
    mockTradeService.processMatches.mockReset();
    mockSettlementService.isEnabled.mockReturnValue(true);
    mockSettlementService.isNonceUsed.mockResolvedValue(false);
    mockSettlementService.isNonceCancelled.mockResolvedValue(false);
    mockSettlementService.getVaultBalance.mockResolvedValue(
      10_000_000_000_000n,
    );
    mockSettlementService.cancelOrderFor.mockResolvedValue(null);
    mockWalletRiskService.assertWalletCanAct.mockResolvedValue(undefined);
    mockMatchingLockService.withMatchingLock.mockClear();
    mockMatchingLockService.withMatchingLock.mockImplementation(
      async (_pairSymbol: string, callback: any) => callback(),
    );
    mockOrderbookBootstrapService.rehydrateOrderbookForPair.mockReset();
    mockOrderbookBootstrapService.rehydrateOrderbookForPair.mockResolvedValue({
      restoredOrders: 0,
      pairSymbol: pair.symbol,
    });
    mockOrderbookManager.getOrCreate.mockReturnValue(mockBook);
    mockOrderbookManager.get.mockReturnValue(mockBook);
    mockBook.createCheckpoint.mockReturnValue({ bids: [], asks: [] });
  });

  it.each(['BUY', 'SELL'] as const)(
    'rejects an unfunded %s with400 before persisting or matching',
    async (side) => {
      mockSettlementService.getVaultBalance.mockResolvedValue(0n);
      await expect(
        orderService.createOrder({
          makerAddress: 'maker-1',
          pairSymbol: pair.symbol,
          side,
          type: 'LIMIT',
          price: '2',
          amount: '1',
          timeInForce: 'GTC',
          nonce: '123',
          signature: 'sig',
          timestamp: Date.now(),
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(mockPrisma.order.create).not.toHaveBeenCalled();
      expect(mockBook.addLimitOrder).not.toHaveBeenCalled();
    },
  );

  it('rejects a SELL backed only by vault funds an unsettled trade still owes', async () => {
    // Vault holds exactly 1 base (8 decimals) but a matched, not-yet-settled
    // trade already sold 1 base: nothing is available for a new SELL.
    mockSettlementService.getVaultBalance.mockResolvedValue(100_000_000n);
    mockPrisma.trade.findMany.mockResolvedValue([
      {
        side: 'BUY',
        makerAddress: 'maker-1',
        takerAddress: 'taker-9',
        price: '2',
        amount: '1',
        pair,
      },
    ]);
    await expect(
      orderService.createOrder({
        makerAddress: 'maker-1',
        pairSymbol: pair.symbol,
        side: 'SELL',
        type: 'LIMIT',
        price: '2',
        amount: '1',
        timeInForce: 'GTC',
        nonce: '124',
        signature: 'sig',
        timestamp: Date.now(),
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'Insufficient base token balance in Spot vault',
    });
    expect(mockPrisma.order.create).not.toHaveBeenCalled();
  });

  it('rejects a BUY whose vault quote does not cover principal plus fee', async () => {
    // 2 quote units * 1e8 = exactly the principal, but the 0.25% max fee
    // is not covered.
    mockSettlementService.getVaultBalance.mockResolvedValue(200_000_000n);
    await expect(
      orderService.createOrder({
        makerAddress: 'maker-1',
        pairSymbol: pair.symbol,
        side: 'BUY',
        type: 'LIMIT',
        price: '2',
        amount: '1',
        timeInForce: 'GTC',
        nonce: '125',
        signature: 'sig',
        timestamp: Date.now(),
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockPrisma.order.create).not.toHaveBeenCalled();
  });

  it('serializes order admission per maker (outer lock) before the pair lock', async () => {
    const calls: string[] = [];
    mockMatchingLockService.withMatchingLock.mockImplementation(
      async (key: string, callback: any) => {
        calls.push(key);
        return callback();
      },
    );
    const createdOrder = makeOrder({
      id: 'limit-order-2',
      type: 'LIMIT',
      side: 'SELL',
      price: new Decimal('100'),
      stopPrice: null,
      status: 'OPEN',
    });
    mockPrisma.order.findFirst.mockResolvedValueOnce(null);
    mockPrisma.order.create.mockResolvedValue(createdOrder);
    mockPrisma.order.findUnique.mockResolvedValue(createdOrder);
    mockBook.addLimitOrder.mockReturnValue([]);

    await orderService.createOrder({
      pairSymbol: pair.symbol,
      side: 'SELL',
      type: 'LIMIT',
      price: '100',
      amount: '1',
      nonce: '1700000000099',
      timestamp: Date.now(),
      signature: 'sig',
      makerAddress: 'maker-1',
      timeInForce: 'GTC',
    });

    // Two pairs sharing a token (e.g. LUNES as base and as quote) would
    // otherwise both admit orders against the same vault balance.
    expect(calls).toEqual(['maker:maker-1', pair.symbol]);
  });

  it('keeps accepting orders without vault checks when settlement is disabled', async () => {
    mockSettlementService.isEnabled.mockReturnValue(false);
    mockSettlementService.isNonceUsed.mockResolvedValue(null);
    mockSettlementService.isNonceCancelled.mockResolvedValue(null);
    mockSettlementService.getVaultBalance.mockResolvedValue(null);
    const createdOrder = makeOrder({
      id: 'limit-order-3',
      type: 'LIMIT',
      side: 'BUY',
      price: new Decimal('2'),
      stopPrice: null,
      status: 'OPEN',
    });
    mockPrisma.order.findFirst.mockResolvedValueOnce(null);
    mockPrisma.order.create.mockResolvedValue(createdOrder);
    mockPrisma.order.findUnique.mockResolvedValue(createdOrder);
    mockBook.addLimitOrder.mockReturnValue([]);

    await expect(
      orderService.createOrder({
        pairSymbol: pair.symbol,
        side: 'BUY',
        type: 'LIMIT',
        price: '2',
        amount: '1',
        nonce: '1700000000100',
        timestamp: Date.now(),
        signature: 'sig',
        makerAddress: 'maker-1',
        timeInForce: 'GTC',
      }),
    ).resolves.toBeTruthy();
    expect(mockPrisma.order.create).toHaveBeenCalled();
  });

  it.each(['agent:agent-7', 'manual:maker-1'])(
    'rejects synthetic signature %s with 409 before any side effect when settlement is on',
    async (signature) => {
      await expect(
        orderService.createOrder({
          makerAddress: 'maker-1',
          pairSymbol: pair.symbol,
          side: 'BUY',
          type: 'LIMIT',
          price: '2',
          amount: '1',
          timeInForce: 'GTC',
          nonce: '126',
          signature,
          timestamp: Date.now(),
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'SYNTHETIC_SIGNATURE_SETTLEMENT_BLOCKED',
      });
      expect(mockPrisma.pair.findUnique).not.toHaveBeenCalled();
      expect(mockMatchingLockService.withMatchingLock).not.toHaveBeenCalled();
      expect(mockPrisma.order.create).not.toHaveBeenCalled();
    },
  );

  it('still accepts synthetic signatures in off-chain mode (settlement disabled)', async () => {
    mockSettlementService.isEnabled.mockReturnValue(false);
    mockSettlementService.isNonceUsed.mockResolvedValue(null);
    mockSettlementService.isNonceCancelled.mockResolvedValue(null);
    const createdOrder = makeOrder({
      id: 'agent-order',
      type: 'LIMIT',
      side: 'BUY',
      price: new Decimal('2'),
      stopPrice: null,
      status: 'OPEN',
    });
    mockPrisma.order.findFirst.mockResolvedValueOnce(null);
    mockPrisma.order.create.mockResolvedValue(createdOrder);
    mockPrisma.order.findUnique.mockResolvedValue(createdOrder);
    mockBook.addLimitOrder.mockReturnValue([]);
    await expect(
      orderService.createOrder({
        makerAddress: 'maker-1',
        pairSymbol: pair.symbol,
        side: 'BUY',
        type: 'LIMIT',
        price: '2',
        amount: '1',
        timeInForce: 'GTC',
        nonce: '127',
        signature: 'agent:agent-7',
        timestamp: Date.now(),
      }),
    ).resolves.toBeTruthy();
  });

  it('rejects an already expired order before persistence or matching', async () => {
    await expect(
      orderService.createOrder({
        makerAddress: 'maker-1',
        pairSymbol: pair.symbol,
        side: 'SELL',
        type: 'LIMIT',
        price: '2',
        amount: '1',
        timeInForce: 'GTC',
        nonce: '123',
        signature: 'sig',
        timestamp: Date.now(),
        expiresAt: new Date(Date.now() - 10000).toISOString(),
      }),
    ).rejects.toThrow('expired');
    expect(mockPrisma.order.create).not.toHaveBeenCalled();
    expect(mockBook.addLimitOrder).not.toHaveBeenCalled();
  });

  it.each([0, 0.5])(
    'cancels IOC remainder after matching %s without resting',
    async (fill) => {
      const order = makeOrder({
        type: 'LIMIT',
        price: new Decimal(100),
        stopPrice: null,
        status: 'OPEN',
        timeInForce: 'IOC',
      });
      mockPrisma.order.create.mockResolvedValue(order);
      mockPrisma.order.findUnique.mockResolvedValue({
        ...order,
        filledAmount: new Decimal(fill),
        remainingAmount: new Decimal(1).minus(fill),
        status: fill ? 'PARTIAL' : 'OPEN',
      });
      mockPrisma.order.update.mockImplementation(async () => {
        const cancelled = { ...order, status: 'CANCELLED' };
        mockPrisma.order.findUnique.mockResolvedValue(cancelled);
        return cancelled;
      });
      mockPrisma.trade.findFirst.mockResolvedValue(null);
      mockBook.addLimitOrder.mockReturnValue(
        fill
          ? [
              {
                makerOrderId: 'other',
                takerOrderId: order.id,
                fillAmount: fill,
                fillPrice: 100,
                makerAddress: 'other-wallet',
                takerAddress: order.makerAddress,
              },
            ]
          : [],
      );
      const result = await orderService.createOrder({
        makerAddress: 'maker-1',
        pairSymbol: pair.symbol,
        side: 'BUY',
        type: 'LIMIT',
        price: '100',
        amount: '1',
        timeInForce: 'IOC',
        nonce: '123',
        signature: 'sig',
        timestamp: Date.now(),
      });
      expect(result?.status).toBe('CANCELLED');
      expect(mockBook.cancelOrder).toHaveBeenCalledWith(order.id);
    },
  );

  it('kills insufficient FOK before persisting any partial match', async () => {
    const order = makeOrder({
      type: 'LIMIT',
      price: new Decimal(100),
      stopPrice: null,
      status: 'OPEN',
      timeInForce: 'FOK',
    });
    mockPrisma.order.create.mockResolvedValue(order);
    mockPrisma.order.findUnique.mockResolvedValue(order);
    mockPrisma.order.update.mockResolvedValue({
      ...order,
      status: 'CANCELLED',
    });
    mockBook.addLimitOrder.mockReturnValue([
      {
        makerOrderId: 'other',
        takerOrderId: order.id,
        fillAmount: 0.5,
        fillPrice: 100,
        makerAddress: 'other-wallet',
        takerAddress: order.makerAddress,
      },
    ]);
    mockPrisma.trade.findFirst.mockResolvedValue(null);
    await orderService.createOrder({
      makerAddress: 'maker-1',
      pairSymbol: pair.symbol,
      side: 'BUY',
      type: 'LIMIT',
      price: '100',
      amount: '1',
      timeInForce: 'FOK',
      nonce: '123',
      signature: 'sig',
      timestamp: Date.now(),
    });
    expect(mockTradeService.processMatches).not.toHaveBeenCalled();
    expect(mockBook.restoreCheckpoint).toHaveBeenCalled();
    expect(mockPrisma.order.update).toHaveBeenCalledWith({
      where: { id: order.id },
      data: { status: 'CANCELLED' },
    });
  });

  it('redacts signatures, nonces and order hashes from user order reads', async () => {
    mockPrisma.order.findMany.mockResolvedValue([
      {
        ...makeOrder(),
        pair: { symbol: pair.symbol },
      },
    ]);

    const result = await orderService.getUserOrders('maker-1');

    expect(result).toEqual([
      expect.objectContaining({
        id: 'order-1',
        makerAddress: 'maker-1',
        pair: { symbol: pair.symbol },
      }),
    ]);
    expect(result[0]).not.toHaveProperty('signature');
    expect(result[0]).not.toHaveProperty('nonce');
    expect(result[0]).not.toHaveProperty('orderHash');
  });

  it('keeps a STOP order in PENDING_TRIGGER when the trigger price has not been reached', async () => {
    const createdOrder = makeOrder();

    mockPrisma.order.findFirst.mockResolvedValueOnce(null);
    mockPrisma.order.findUnique.mockResolvedValueOnce(createdOrder);

    mockPrisma.order.create.mockResolvedValue(createdOrder);
    mockPrisma.order.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([createdOrder]);
    mockPrisma.trade.findFirst.mockResolvedValue({ price: new Decimal('100') });

    const result = await orderService.createOrder({
      pairSymbol: pair.symbol,
      side: 'BUY',
      type: 'STOP',
      amount: '1',
      stopPrice: '120',
      nonce: '1700000000001',
      timestamp: Date.now(),
      signature: 'sig',
      makerAddress: 'maker-1',
      timeInForce: 'GTC',
    });

    expect(result).toEqual(createdOrder);
    expect(mockPrisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING_TRIGGER',
        }),
      }),
    );
    expect(mockPrisma.order.update).not.toHaveBeenCalled();
    expect(mockBook.addMarketOrder).not.toHaveBeenCalled();
    expect(mockTradeService.processMatches).not.toHaveBeenCalled();
  });

  it('activates and executes a STOP order when the trigger price is reached', async () => {
    const createdOrder = makeOrder();
    const activatedOrder = makeOrder({ status: 'OPEN' });
    const filledOrder = makeOrder({
      status: 'FILLED',
      filledAmount: new Decimal('1'),
      remainingAmount: new Decimal('0'),
    });

    mockPrisma.order.findFirst.mockResolvedValueOnce(null);
    mockPrisma.order.findUnique
      .mockResolvedValueOnce(filledOrder)
      .mockResolvedValueOnce(filledOrder);

    mockPrisma.order.create.mockResolvedValue(createdOrder);
    mockPrisma.order.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([createdOrder])
      .mockResolvedValueOnce([]);
    mockPrisma.trade.findFirst.mockResolvedValue({ price: new Decimal('125') });
    mockPrisma.order.update.mockResolvedValue(activatedOrder);

    const matches = [
      {
        makerOrderId: 'maker-order-1',
        takerOrderId: createdOrder.id,
        fillAmount: 1,
        fillPrice: 125,
        makerAddress: 'maker-2',
        takerAddress: createdOrder.makerAddress,
      },
    ];

    mockBook.addMarketOrder.mockReturnValue(matches);
    mockTradeService.processMatches.mockResolvedValue([]);

    const result = await orderService.createOrder({
      pairSymbol: pair.symbol,
      side: 'BUY',
      type: 'STOP',
      amount: '1',
      stopPrice: '120',
      nonce: '1700000000002',
      timestamp: Date.now(),
      signature: 'sig',
      makerAddress: 'maker-1',
      timeInForce: 'GTC',
    });

    expect(result).toEqual(filledOrder);
    expect(mockPrisma.order.update).toHaveBeenCalledWith({
      where: { id: createdOrder.id },
      data: { status: 'OPEN' },
    });
    expect(mockBook.addMarketOrder).toHaveBeenCalledWith(
      createdOrder.id,
      'BUY',
      1,
      'maker-1',
    );
    expect(mockTradeService.processMatches).toHaveBeenCalledWith(
      pair.id,
      matches,
    );
  });

  it('activates a STOP_LIMIT order and places it on the book as a limit order', async () => {
    const openOrder = makeOrder({
      id: 'order-2',
      side: 'SELL',
      type: 'STOP_LIMIT',
      price: new Decimal('88'),
      stopPrice: new Decimal('90'),
      amount: new Decimal('2'),
      remainingAmount: new Decimal('2'),
      nonce: '1700000000003',
    });
    const activatedOrder = makeOrder({
      ...openOrder,
      status: 'OPEN',
    });

    mockPrisma.order.findFirst.mockResolvedValueOnce(null);
    mockPrisma.order.findUnique
      .mockResolvedValueOnce(openOrder)
      .mockResolvedValueOnce(openOrder);

    mockPrisma.order.create.mockResolvedValue(openOrder);
    mockPrisma.order.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([openOrder])
      .mockResolvedValueOnce([]);
    mockPrisma.trade.findFirst.mockResolvedValue({ price: new Decimal('89') });
    mockPrisma.order.update.mockResolvedValue(activatedOrder);
    mockBook.addLimitOrder.mockReturnValue([]);

    const result = await orderService.createOrder({
      pairSymbol: pair.symbol,
      side: 'SELL',
      type: 'STOP_LIMIT',
      price: '88',
      stopPrice: '90',
      amount: '2',
      nonce: '1700000000003',
      timestamp: Date.now(),
      signature: 'sig',
      makerAddress: 'maker-1',
      timeInForce: 'GTC',
    });

    expect(result).toEqual(openOrder);
    expect(mockBook.addLimitOrder).toHaveBeenCalledWith(
      openOrder.id,
      'SELL',
      88,
      2,
      'maker-1',
    );
    expect(mockBook.addMarketOrder).not.toHaveBeenCalled();
    expect(mockTradeService.processMatches).not.toHaveBeenCalled();
  });

  it('fails closed when settlement is enabled but on-chain nonce validation is unavailable', async () => {
    mockSettlementService.isNonceUsed.mockResolvedValue(null);

    await expect(
      orderService.createOrder({
        pairSymbol: pair.symbol,
        side: 'BUY',
        type: 'LIMIT',
        price: '100',
        amount: '1',
        nonce: '1700000000004',
        timestamp: Date.now(),
        signature: 'sig',
        makerAddress: 'maker-1',
        timeInForce: 'GTC',
      }),
    ).rejects.toThrow('On-chain nonce validation unavailable');
  });

  it('rejects banned wallets before persisting a new order', async () => {
    mockWalletRiskService.assertWalletCanAct.mockRejectedValueOnce(
      new Error('Wallet is banned: market abuse'),
    );

    await expect(
      orderService.createOrder({
        pairSymbol: pair.symbol,
        side: 'BUY',
        type: 'LIMIT',
        price: '100',
        amount: '1',
        nonce: '1700000000005',
        timestamp: Date.now(),
        signature: 'sig',
        makerAddress: 'maker-1',
        timeInForce: 'GTC',
      }),
    ).rejects.toThrow('Wallet is banned: market abuse');

    expect(mockPrisma.order.create).not.toHaveBeenCalled();
  });

  it('restores the in-memory book when match persistence fails', async () => {
    const createdOrder = makeOrder({
      id: 'market-order-1',
      type: 'MARKET',
      side: 'BUY',
      status: 'OPEN',
      stopPrice: null,
    });
    const checkpoint = { bids: ['before'], asks: ['before'] };
    const matches = [
      {
        makerOrderId: 'maker-order-1',
        takerOrderId: createdOrder.id,
        fillAmount: 1,
        fillPrice: 100,
        makerAddress: 'maker-2',
        takerAddress: createdOrder.makerAddress,
      },
    ];

    mockPrisma.order.findFirst.mockResolvedValueOnce(null);
    mockPrisma.order.create.mockResolvedValue(createdOrder);
    mockBook.createCheckpoint.mockReturnValue(checkpoint);
    mockBook.getBestAsk.mockReturnValue(100);
    mockBook.addMarketOrder.mockReturnValue(matches);
    mockTradeService.processMatches.mockRejectedValueOnce(
      new Error('database unavailable'),
    );

    await expect(
      orderService.createOrder({
        pairSymbol: pair.symbol,
        side: 'BUY',
        type: 'MARKET',
        amount: '1',
        nonce: '1700000000006',
        timestamp: Date.now(),
        signature: 'sig',
        makerAddress: 'maker-1',
        timeInForce: 'IOC',
      }),
    ).rejects.toThrow('database unavailable');

    expect(mockBook.restoreCheckpoint).toHaveBeenCalledWith(checkpoint);
  });

  it('serializes matching with a pair lock and rehydrates the pair book before mutation', async () => {
    const createdOrder = makeOrder({
      id: 'limit-order-1',
      type: 'LIMIT',
      side: 'SELL',
      price: new Decimal('100'),
      stopPrice: null,
      status: 'OPEN',
    });

    mockPrisma.order.findFirst.mockResolvedValueOnce(null);
    mockPrisma.order.create.mockResolvedValue(createdOrder);
    mockPrisma.order.findUnique.mockResolvedValue(createdOrder);
    mockBook.addLimitOrder.mockReturnValue([]);

    await orderService.createOrder({
      pairSymbol: pair.symbol,
      side: 'SELL',
      type: 'LIMIT',
      price: '100',
      amount: '1',
      nonce: '1700000000007',
      timestamp: Date.now(),
      signature: 'sig',
      makerAddress: 'maker-1',
      timeInForce: 'GTC',
    });

    expect(mockMatchingLockService.withMatchingLock).toHaveBeenCalledWith(
      pair.symbol,
      expect.any(Function),
    );
    expect(
      mockOrderbookBootstrapService.rehydrateOrderbookForPair,
    ).toHaveBeenCalledWith(pair.id, pair.symbol);
    expect(mockBook.addLimitOrder).toHaveBeenCalledWith(
      createdOrder.id,
      'SELL',
      100,
      1,
      'maker-1',
    );
  });

  it('does not mutate DB or book when on-chain cancellation fails', async () => {
    const openOrder = makeOrder({
      id: 'order-cancel-1',
      type: 'LIMIT',
      side: 'SELL',
      price: new Decimal('100'),
      stopPrice: null,
      status: 'OPEN',
      nonce: 'cancel-nonce-1',
    });

    mockPrisma.order.findUnique.mockResolvedValue(openOrder);
    mockSettlementService.cancelOrderFor.mockRejectedValueOnce(
      new Error('chain unavailable'),
    );

    await expect(
      orderService.cancelOrder(openOrder.id, openOrder.makerAddress),
    ).rejects.toThrow('chain unavailable');

    expect(mockMatchingLockService.withMatchingLock).toHaveBeenCalledWith(
      pair.symbol,
      expect.any(Function),
    );
    expect(
      mockOrderbookBootstrapService.rehydrateOrderbookForPair,
    ).toHaveBeenCalledWith(pair.id, pair.symbol);
    expect(mockBook.cancelOrder).not.toHaveBeenCalled();
    expect(mockPrisma.order.update).not.toHaveBeenCalled();
  });

  it('fails closed when settlement is enabled but on-chain cancellation is unavailable', async () => {
    const openOrder = makeOrder({
      id: 'order-cancel-2',
      type: 'LIMIT',
      side: 'SELL',
      price: new Decimal('100'),
      stopPrice: null,
      status: 'OPEN',
      nonce: 'cancel-nonce-2',
    });

    mockPrisma.order.findUnique.mockResolvedValue(openOrder);
    mockSettlementService.cancelOrderFor.mockResolvedValueOnce(null);

    await expect(
      orderService.cancelOrder(openOrder.id, openOrder.makerAddress),
    ).rejects.toThrow('On-chain cancellation unavailable');

    expect(mockBook.cancelOrder).not.toHaveBeenCalled();
    expect(mockPrisma.order.update).not.toHaveBeenCalled();
  });
});
