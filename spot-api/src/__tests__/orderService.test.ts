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
