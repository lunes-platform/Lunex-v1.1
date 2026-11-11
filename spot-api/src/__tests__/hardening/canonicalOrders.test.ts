/**
 * M-09 (second pass) — orderService is the choke point for every order
 * (signed route and agent API-key trading), so it canonicalizes the maker
 * itself and compares owners as account ids.
 */
import { Decimal } from '@prisma/client/runtime/library';

const mockPrisma = {
  pair: { findUnique: jest.fn() },
  order: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
  trade: { findFirst: jest.fn(), findMany: jest.fn() },
};

const mockBook = {
  addMarketOrder: jest.fn(),
  addLimitOrder: jest.fn(() => []),
  cancelOrder: jest.fn(),
  createCheckpoint: jest.fn(() => ({ bids: [], asks: [] })),
  restoreCheckpoint: jest.fn(),
  getBestBid: jest.fn(() => null),
  getBestAsk: jest.fn(() => null),
};

const mockSettlementService = {
  isEnabled: jest.fn(() => false),
  isNonceUsed: jest.fn(async () => null),
  isNonceCancelled: jest.fn(async () => null),
  getVaultBalance: jest.fn(async () => null),
  cancelOrderFor: jest.fn(async () => null),
};

const mockWalletRiskService = { assertWalletCanAct: jest.fn() };

jest.mock('../../db', () => ({ __esModule: true, default: mockPrisma }));
jest.mock('../../utils/orderbook', () => ({
  orderbookManager: { getOrCreate: () => mockBook, get: () => mockBook },
}));
jest.mock('../../services/tradeService', () => ({
  tradeService: { processMatches: jest.fn() },
}));
jest.mock('../../services/settlementService', () => ({
  settlementService: mockSettlementService,
}));
jest.mock('../../services/walletRiskService', () => ({
  walletRiskService: mockWalletRiskService,
}));
jest.mock('../../services/matchingLockService', () => ({
  withMatchingLock: jest.fn(async (_key: string, fn: () => unknown) => fn()),
}));
jest.mock('../../services/orderbookBootstrapService', () => ({
  rehydrateOrderbookForPair: jest.fn(async () => ({ restoredOrders: 0 })),
}));

import { orderService } from '../../services/orderService';

// Same key (Alice) in prefix 42 (canonical) and 57 (Lunes).
const GENERIC = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const LUNES = '6mfqoTMHrMeVMyKwjqomUjVomPMJ4AjdCm1VReFtk7Be8wqr';
const OTHER = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';

const pair = {
  id: 'pair-1',
  symbol: 'LUNES/USDT',
  baseToken: 'base-token',
  quoteToken: 'quote-token',
  baseDecimals: 8,
  quoteDecimals: 8,
  isNativeBase: false,
  isNativeQuote: false,
  isActive: true,
  makerFeeBps: 10,
  takerFeeBps: 25,
};

function storedOrder(makerAddress: string) {
  return {
    id: 'order-1',
    pairId: pair.id,
    makerAddress,
    side: 'BUY',
    type: 'LIMIT',
    price: new Decimal('2'),
    stopPrice: null,
    amount: new Decimal('1'),
    filledAmount: new Decimal('0'),
    remainingAmount: new Decimal('1'),
    status: 'OPEN',
    signature: 'sig',
    nonce: 'nonce-1',
    orderHash: '0xhash',
    timeInForce: 'GTC',
    expiresAt: null,
  };
}

function orderInput(makerAddress: string) {
  return {
    makerAddress,
    pairSymbol: pair.symbol,
    side: 'BUY' as const,
    type: 'LIMIT' as const,
    price: '2',
    amount: '1',
    timeInForce: 'GTC' as const,
    nonce: '1700000000100',
    signature: 'sig',
    timestamp: Date.now(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.pair.findUnique.mockResolvedValue(pair);
  mockPrisma.order.findFirst.mockResolvedValue(null);
  mockPrisma.order.findMany.mockResolvedValue([]);
  mockPrisma.trade.findMany.mockResolvedValue([]);
  mockWalletRiskService.assertWalletCanAct.mockResolvedValue(undefined);
});

describe('createOrder canonicalizes the maker', () => {
  it('stores a prefix-57 maker under the canonical address and checks the ban on it', async () => {
    const created = storedOrder(GENERIC);
    mockPrisma.order.create.mockResolvedValue(created);
    mockPrisma.order.findUnique.mockResolvedValue(created);

    await orderService.createOrder(orderInput(LUNES));

    expect(mockWalletRiskService.assertWalletCanAct).toHaveBeenCalledWith(
      GENERIC,
    );
    expect(mockPrisma.order.findFirst).toHaveBeenCalledWith({
      where: { makerAddress: GENERIC, nonce: '1700000000100' },
    });
    expect(mockPrisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ makerAddress: GENERIC }),
      }),
    );
  });

  it('a banned key is refused whatever prefix the maker uses', async () => {
    mockWalletRiskService.assertWalletCanAct.mockImplementation(
      async (address: string) => {
        if (address === GENERIC) throw new Error('Wallet is banned');
      },
    );
    await expect(orderService.createOrder(orderInput(LUNES))).rejects.toThrow(
      'Wallet is banned',
    );
    expect(mockPrisma.order.create).not.toHaveBeenCalled();
  });

  it('an undecodable maker is a 400 before any side effect', async () => {
    await expect(
      orderService.createOrder(orderInput('agent-wallet-123')),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockPrisma.pair.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.order.create).not.toHaveBeenCalled();
  });
});

describe('cancelOrder compares owners as account ids', () => {
  it('the owner cancels an order stored under prefix 57 while presenting 42', async () => {
    const order = storedOrder(LUNES);
    mockPrisma.order.findUnique.mockResolvedValue(order);
    mockPrisma.order.update.mockResolvedValue({
      ...order,
      status: 'CANCELLED',
    });

    const updated = await orderService.cancelOrder(order.id, GENERIC);

    expect(updated.status).toBe('CANCELLED');
    expect(mockPrisma.order.update).toHaveBeenCalledWith({
      where: { id: order.id },
      data: { status: 'CANCELLED' },
    });
  });

  it('a different key still gets 403', async () => {
    mockPrisma.order.findUnique.mockResolvedValue(storedOrder(LUNES));
    await expect(
      orderService.cancelOrder('order-1', OTHER),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockPrisma.order.update).not.toHaveBeenCalled();
  });

  it('the in-lock re-check also compares account ids', async () => {
    // First read stored as 42, second (inside the lock) as 57: both are the
    // owner, neither may be rejected as a different wallet.
    mockPrisma.order.findUnique
      .mockResolvedValueOnce(storedOrder(GENERIC))
      .mockResolvedValueOnce(storedOrder(LUNES));
    mockPrisma.order.update.mockResolvedValue({
      ...storedOrder(LUNES),
      status: 'CANCELLED',
    });
    await expect(
      orderService.cancelOrder('order-1', GENERIC),
    ).resolves.toMatchObject({ status: 'CANCELLED' });
  });
});
