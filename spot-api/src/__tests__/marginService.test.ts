import { Decimal } from '@prisma/client/runtime/library';

const mockTx = {
  pair: {
    findUnique: jest.fn(),
  },
  trade: {
    findFirst: jest.fn(),
  },
  marginAccount: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  marginPosition: {
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    findUnique: jest.fn(),
  },
  marginCollateralTransfer: {
    create: jest.fn(),
  },
  marginLiquidation: {
    create: jest.fn(),
  },
};

const mockPrisma = {
  $transaction: jest.fn(async (callback: (tx: typeof mockTx) => unknown) =>
    callback(mockTx),
  ),
  pair: {
    findUnique: jest.fn(),
  },
  trade: {
    findFirst: jest.fn(),
  },
  marginAccount: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  marginPosition: {
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
  },
  marginCollateralTransfer: {
    create: jest.fn(),
  },
  marginLiquidation: {
    create: jest.fn(),
  },
};

const mockOrderbookManager = {
  get: jest.fn(),
};

jest.mock('../db', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../utils/orderbook', () => ({
  orderbookManager: mockOrderbookManager,
}));

const mockLog = {
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};
jest.mock('../utils/logger', () => ({ log: mockLog }));

import { marginService } from '../services/marginService';

describe('marginService hardening', () => {
  const baseAccount = {
    id: 'account-1',
    address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
    collateralToken: 'USDT',
    collateralAvailable: new Decimal('100'),
    collateralLocked: new Decimal('50'),
    totalRealizedPnl: new Decimal('0'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    marginService.resetPriceHealthMonitor();
    mockPrisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mockTx) => unknown) => callback(mockTx),
    );

    mockPrisma.trade.findFirst.mockReset();
    mockPrisma.marginAccount.findUnique.mockReset();
    mockPrisma.marginAccount.create.mockReset();
    mockPrisma.marginAccount.update.mockReset();
    mockPrisma.marginPosition.findMany.mockReset();
    mockPrisma.marginPosition.create.mockReset();
    mockPrisma.marginPosition.update.mockReset();
    mockPrisma.marginPosition.findUnique.mockReset();
    mockPrisma.marginCollateralTransfer.create.mockReset();
    mockPrisma.marginLiquidation.create.mockReset();

    mockTx.pair.findUnique.mockReset();
    mockTx.trade.findFirst.mockReset();
    mockTx.marginAccount.findUnique.mockReset();
    mockTx.marginAccount.create.mockReset();
    mockTx.marginAccount.update.mockReset();
    mockTx.marginPosition.findMany.mockReset();
    mockTx.marginPosition.create.mockReset();
    mockTx.marginPosition.update.mockReset();
    mockTx.marginPosition.updateMany.mockReset();
    mockTx.marginPosition.findUnique.mockReset();
    mockTx.marginCollateralTransfer.create.mockReset();
    mockTx.marginLiquidation.create.mockReset();

    mockOrderbookManager.get.mockReset();

    // openPosition now resolves pair + mark price OUTSIDE the interactive
    // transaction (via the top-level prisma client) to avoid holding the
    // transaction open on I/O. Delegate those read-only lookups to the
    // tx-level mocks so existing tests that configure `mockTx.pair.findUnique`
    // / `mockTx.trade.findFirst` keep working without per-test changes.
    mockPrisma.pair.findUnique.mockReset();
    mockPrisma.pair.findUnique.mockImplementation((...args: unknown[]) =>
      mockTx.pair.findUnique(...args),
    );
    mockPrisma.trade.findFirst.mockImplementation((...args: unknown[]) =>
      mockTx.trade.findFirst(...args),
    );
  });

  function createFreshBook(
    bestBid: number,
    bestAsk: number,
    lastUpdatedAt = Date.now() - 1_000,
  ) {
    return {
      getBestBid: jest.fn().mockReturnValue(bestBid),
      getBestAsk: jest.fn().mockReturnValue(bestAsk),
      getLastUpdatedAt: jest.fn().mockReturnValue(lastUpdatedAt),
    };
  }

  it('blocks withdrawals that would breach maintenance margin requirements', async () => {
    mockTx.marginAccount.findUnique.mockResolvedValue(baseAccount);
    mockTx.marginPosition.findMany.mockResolvedValue([
      {
        id: 'position-1',
        accountId: baseAccount.id,
        pairId: 'pair-1',
        pairSymbol: 'LUNES/USDT',
        side: 'BUY',
        status: 'OPEN',
        collateralAmount: new Decimal('50'),
        leverage: new Decimal('2'),
        notional: new Decimal('100'),
        quantity: new Decimal('1000'),
        entryPrice: new Decimal('0.1'),
        markPrice: new Decimal('0.1'),
        borrowedAmount: new Decimal('50'),
        maintenanceMargin: new Decimal('40'),
        liquidationPrice: new Decimal('0.09'),
        unrealizedPnl: new Decimal('-70'),
        realizedPnl: new Decimal('0'),
        openedAt: new Date('2026-01-01T00:00:00.000Z'),
        closedAt: null,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    mockTx.trade.findFirst.mockResolvedValue({ price: new Decimal('0.03') });
    mockTx.marginPosition.update.mockImplementation(
      async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        accountId: baseAccount.id,
        pairId: 'pair-1',
        pairSymbol: 'LUNES/USDT',
        side: 'BUY',
        status: 'OPEN',
        collateralAmount: new Decimal('50'),
        leverage: new Decimal('2'),
        notional: new Decimal('100'),
        quantity: new Decimal('1000'),
        entryPrice: new Decimal('0.1'),
        markPrice: new Decimal('0.03'),
        borrowedAmount: new Decimal('50'),
        maintenanceMargin: new Decimal('40'),
        liquidationPrice: new Decimal('0.09'),
        unrealizedPnl: new Decimal('-100'),
        realizedPnl: new Decimal('0'),
        openedAt: new Date('2026-01-01T00:00:00.000Z'),
        closedAt: null,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    );

    await expect(
      marginService.withdrawCollateral({
        address: baseAccount.address,
        amount: '45',
        token: 'USDT',
        signature: 'sig',
      }),
    ).rejects.toThrow(
      'Withdrawal would breach maintenance margin requirements',
    );

    expect(mockTx.marginAccount.update).not.toHaveBeenCalled();
    expect(mockTx.marginCollateralTransfer.create).not.toHaveBeenCalled();
  });

  it('rejects leverage above the safe initial cap', async () => {
    await expect(
      marginService.openPosition({
        address: baseAccount.address,
        pairSymbol: 'LUNES/USDT',
        side: 'BUY',
        collateralAmount: '100',
        leverage: '7.95',
        signature: 'sig',
      }),
    ).rejects.toThrow('Leverage must be between 1x and 7.90x');

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects opening a position when aggregate account equity is not enough for added maintenance margin', async () => {
    mockTx.pair.findUnique.mockResolvedValue({
      id: 'pair-1',
      symbol: 'LUNES/USDT',
      isActive: true,
    });
    mockTx.marginAccount.findUnique.mockResolvedValue(baseAccount);
    mockTx.marginPosition.findMany.mockResolvedValue([
      {
        id: 'position-1',
        accountId: baseAccount.id,
        pairId: 'pair-1',
        pairSymbol: 'LUNES/USDT',
        side: 'BUY',
        status: 'OPEN',
        collateralAmount: new Decimal('50'),
        leverage: new Decimal('2'),
        notional: new Decimal('100'),
        quantity: new Decimal('1000'),
        entryPrice: new Decimal('0.1'),
        markPrice: new Decimal('0.03'),
        borrowedAmount: new Decimal('50'),
        maintenanceMargin: new Decimal('40'),
        liquidationPrice: new Decimal('0.09'),
        unrealizedPnl: new Decimal('-100'),
        realizedPnl: new Decimal('0'),
        openedAt: new Date('2026-01-01T00:00:00.000Z'),
        closedAt: null,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    mockTx.trade.findFirst.mockResolvedValue({ price: new Decimal('0.03') });
    mockTx.marginPosition.update.mockImplementation(
      async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        accountId: baseAccount.id,
        pairId: 'pair-1',
        pairSymbol: 'LUNES/USDT',
        side: 'BUY',
        status: 'OPEN',
        collateralAmount: new Decimal('50'),
        leverage: new Decimal('2'),
        notional: new Decimal('100'),
        quantity: new Decimal('1000'),
        entryPrice: new Decimal('0.1'),
        markPrice: new Decimal('0.03'),
        borrowedAmount: new Decimal('50'),
        maintenanceMargin: new Decimal('40'),
        liquidationPrice: new Decimal('0.09'),
        unrealizedPnl: new Decimal('-100'),
        realizedPnl: new Decimal('0'),
        openedAt: new Date('2026-01-01T00:00:00.000Z'),
        closedAt: null,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    );

    await expect(
      marginService.openPosition({
        address: baseAccount.address,
        pairSymbol: 'LUNES/USDT',
        side: 'BUY',
        collateralAmount: '100',
        leverage: '2',
        signature: 'sig',
      }),
    ).rejects.toThrow(
      'Insufficient account equity for requested margin exposure',
    );

    expect(mockTx.marginAccount.update).not.toHaveBeenCalled();
    expect(mockTx.marginPosition.create).not.toHaveBeenCalled();
  });

  it('rejects stale mark price when there is no fresh safe fallback', async () => {
    mockTx.pair.findUnique.mockResolvedValue({
      id: 'pair-1',
      symbol: 'LUNES/USDT',
      isActive: true,
    });
    mockTx.marginAccount.findUnique.mockResolvedValue(baseAccount);
    mockTx.marginPosition.findMany.mockResolvedValue([]);
    mockTx.trade.findFirst.mockResolvedValue({
      price: new Decimal('0.03'),
      createdAt: new Date(Date.now() - 300_000),
    });
    mockOrderbookManager.get.mockReturnValue(undefined);

    await expect(
      marginService.openPosition({
        address: baseAccount.address,
        pairSymbol: 'LUNES/USDT',
        side: 'BUY',
        collateralAmount: '100',
        leverage: '2',
        signature: 'sig',
      }),
    ).rejects.toThrow('Mark price unavailable for LUNES/USDT');

    // Stale mark price must degrade to a CLIENT (4xx) error, never an opaque
    // 500 / transaction timeout. Assert the thrown error is an ApiError 400.
    await expect(
      marginService.openPosition({
        address: baseAccount.address,
        pairSymbol: 'LUNES/USDT',
        side: 'BUY',
        collateralAmount: '100',
        leverage: '2',
        signature: 'sig',
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'BAD_REQUEST' });

    expect(marginService.getPriceHealth('LUNES/USDT')).toEqual(
      expect.objectContaining({
        summary: expect.objectContaining({
          trackedPairs: 1,
          unhealthyPairs: 1,
          hasActiveAlerts: true,
        }),
        pairs: [
          expect.objectContaining({
            pairSymbol: 'LUNES/USDT',
            status: 'UNHEALTHY',
            totalFailures: 2,
            consecutiveFailures: 2,
            lastFailureReason: expect.stringContaining(
              'Mark price unavailable for LUNES/USDT',
            ),
          }),
        ],
      }),
    );

    expect(mockTx.marginPosition.create).not.toHaveBeenCalled();
  });

  it('falls back to fresh book midpoint when last trade is stale', async () => {
    const freshBook = createFreshBook(95, 105);
    const createdPosition = {
      id: 'position-new',
      accountId: baseAccount.id,
      pairId: 'pair-1',
      pairSymbol: 'LUNES/USDT',
      side: 'BUY',
      status: 'OPEN',
      collateralAmount: new Decimal('100'),
      leverage: new Decimal('2'),
      notional: new Decimal('200'),
      quantity: new Decimal('2'),
      entryPrice: new Decimal('100'),
      markPrice: new Decimal('100'),
      borrowedAmount: new Decimal('100'),
      maintenanceMargin: new Decimal('20'),
      liquidationPrice: new Decimal('60'),
      unrealizedPnl: new Decimal('0'),
      realizedPnl: new Decimal('0'),
      openedAt: new Date('2026-01-01T00:00:00.000Z'),
      closedAt: null,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    mockTx.pair.findUnique.mockResolvedValue({
      id: 'pair-1',
      symbol: 'LUNES/USDT',
      isActive: true,
    });
    mockTx.marginAccount.findUnique.mockResolvedValue(baseAccount);
    mockTx.marginPosition.findMany.mockResolvedValue([]);
    mockTx.trade.findFirst.mockResolvedValue({
      price: new Decimal('90'),
      createdAt: new Date(Date.now() - 300_000),
    });
    mockPrisma.trade.findFirst.mockResolvedValue({
      price: new Decimal('90'),
      createdAt: new Date(Date.now() - 300_000),
    });
    mockOrderbookManager.get.mockReturnValue(freshBook);
    mockTx.marginAccount.update.mockResolvedValue(undefined);
    mockTx.marginPosition.create.mockResolvedValue(createdPosition);
    mockPrisma.marginPosition.update.mockResolvedValue(createdPosition);
    mockPrisma.marginAccount.findUnique.mockResolvedValue(baseAccount);
    mockPrisma.marginPosition.findMany.mockResolvedValue([]);

    const result = await marginService.openPosition({
      address: baseAccount.address,
      pairSymbol: 'LUNES/USDT',
      side: 'BUY',
      collateralAmount: '100',
      leverage: '2',
      signature: 'sig',
    });

    expect(result.position.entryPrice).toBe(100);
    expect((result.position as any).markPriceMeta).toEqual(
      expect.objectContaining({
        source: 'BOOK_MID',
      }),
    );
    expect(result.overview.risk).toBeDefined();
    expect(result.overview.risk).toHaveProperty('markPriceHealth');
    expect(mockTx.marginPosition.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entryPrice: expect.any(Decimal),
          markPrice: expect.any(Decimal),
        }),
      }),
    );

    const createCall = mockTx.marginPosition.create.mock.calls[0][0];
    expect(createCall.data.entryPrice.toString()).toBe('100');
    expect(createCall.data.markPrice.toString()).toBe('100');
  });

  it('triggers circuit breaker when fresh trade price deviates too much from book midpoint', async () => {
    mockTx.pair.findUnique.mockResolvedValue({
      id: 'pair-1',
      symbol: 'LUNES/USDT',
      isActive: true,
    });
    mockTx.marginAccount.findUnique.mockResolvedValue(baseAccount);
    mockTx.marginPosition.findMany.mockResolvedValue([]);
    mockTx.trade.findFirst.mockResolvedValue({
      price: new Decimal('200'),
      createdAt: new Date(Date.now() - 1_000),
    });
    mockOrderbookManager.get.mockReturnValue(createFreshBook(95, 105));

    await expect(
      marginService.openPosition({
        address: baseAccount.address,
        pairSymbol: 'LUNES/USDT',
        side: 'BUY',
        collateralAmount: '100',
        leverage: '2',
        signature: 'sig',
      }),
    ).rejects.toThrow('Mark price unavailable for LUNES/USDT');

    expect(mockTx.marginPosition.create).not.toHaveBeenCalled();
  });

  it('logs an operational alert when safe mark price becomes unavailable', async () => {
    mockLog.error.mockClear();

    mockTx.pair.findUnique.mockResolvedValue({
      id: 'pair-1',
      symbol: 'LUNES/USDT',
      isActive: true,
    });
    mockTx.marginAccount.findUnique.mockResolvedValue(baseAccount);
    mockTx.marginPosition.findMany.mockResolvedValue([]);
    mockTx.trade.findFirst.mockResolvedValue({
      price: new Decimal('200'),
      createdAt: new Date(Date.now() - 1_000),
    });
    mockOrderbookManager.get.mockReturnValue(createFreshBook(95, 105));

    await expect(
      marginService.openPosition({
        address: baseAccount.address,
        pairSymbol: 'LUNES/USDT',
        side: 'BUY',
        collateralAmount: '100',
        leverage: '2',
        signature: 'sig',
      }),
    ).rejects.toThrow('Mark price unavailable for LUNES/USDT');

    expect(mockLog.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'margin.safe_mark_price_unavailable' }),
      expect.any(String),
    );
  });

  it('logs restoration and resets consecutive failures after price health recovers', async () => {
    mockLog.error.mockClear();
    mockLog.info.mockClear();
    const consoleInfoSpy = jest
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);
    const freshBook = createFreshBook(95, 105);
    const createdPosition = {
      id: 'position-new',
      accountId: baseAccount.id,
      pairId: 'pair-1',
      pairSymbol: 'LUNES/USDT',
      side: 'BUY',
      status: 'OPEN',
      collateralAmount: new Decimal('100'),
      leverage: new Decimal('2'),
      notional: new Decimal('200'),
      quantity: new Decimal('2'),
      entryPrice: new Decimal('100'),
      markPrice: new Decimal('100'),
      borrowedAmount: new Decimal('100'),
      maintenanceMargin: new Decimal('20'),
      liquidationPrice: new Decimal('60'),
      unrealizedPnl: new Decimal('0'),
      realizedPnl: new Decimal('0'),
      openedAt: new Date('2026-01-01T00:00:00.000Z'),
      closedAt: null,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    mockTx.pair.findUnique.mockResolvedValue({
      id: 'pair-1',
      symbol: 'LUNES/USDT',
      isActive: true,
    });
    mockTx.marginAccount.findUnique.mockResolvedValue(baseAccount);
    mockTx.marginPosition.findMany.mockResolvedValue([]);
    // Mark price is now resolved OUTSIDE the transaction via the top-level
    // prisma client; drive the stale→fresh recovery sequence through it.
    // Override the beforeEach delegation for this scenario.
    mockPrisma.trade.findFirst.mockReset();
    mockPrisma.trade.findFirst.mockResolvedValueOnce({
      price: new Decimal('90'),
      createdAt: new Date(Date.now() - 300_000),
    });
    mockPrisma.trade.findFirst.mockResolvedValueOnce({
      price: new Decimal('100'),
      createdAt: new Date(Date.now() - 1_000),
    });
    mockTx.marginAccount.update.mockResolvedValue(undefined);
    mockTx.marginPosition.create.mockResolvedValue(createdPosition);
    mockPrisma.marginPosition.update.mockResolvedValue(createdPosition);
    mockPrisma.marginAccount.findUnique.mockResolvedValue(baseAccount);
    mockPrisma.marginPosition.findMany.mockResolvedValue([]);

    // First open: stale trade + no fresh book → degrade to a clear 4xx.
    mockOrderbookManager.get.mockReturnValueOnce(undefined);

    await expect(
      marginService.openPosition({
        address: baseAccount.address,
        pairSymbol: 'LUNES/USDT',
        side: 'BUY',
        collateralAmount: '100',
        leverage: '2',
        signature: 'sig',
      }),
    ).rejects.toThrow('Mark price unavailable for LUNES/USDT');

    // Second open: fresh trade resolves → price health restores.
    mockOrderbookManager.get.mockReturnValue(freshBook);

    await marginService.openPosition({
      address: baseAccount.address,
      pairSymbol: 'LUNES/USDT',
      side: 'BUY',
      collateralAmount: '100',
      leverage: '2',
      signature: 'sig',
    });

    expect(mockLog.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'margin.safe_mark_price_unavailable' }),
      expect.any(String),
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('margin.safe_mark_price_restored'),
    );
    consoleInfoSpy.mockRestore();
    expect(marginService.getPriceHealth('LUNES/USDT')).toEqual(
      expect.objectContaining({
        summary: expect.objectContaining({
          trackedPairs: 1,
          healthyPairs: 1,
          unhealthyPairs: 0,
          hasActiveAlerts: false,
        }),
        pairs: [
          expect.objectContaining({
            pairSymbol: 'LUNES/USDT',
            status: 'HEALTHY',
            totalSuccesses: 2,
            totalFailures: 1,
            consecutiveFailures: 0,
            lastResolvedSource: 'BOOK_MID',
          }),
        ],
      }),
    );
  });

  it('operationally blocks new openings after repeated safe mark price failures', async () => {
    mockTx.pair.findUnique.mockResolvedValue({
      id: 'pair-1',
      symbol: 'LUNES/USDT',
      isActive: true,
    });
    mockTx.marginAccount.findUnique.mockResolvedValue(baseAccount);
    mockTx.marginPosition.findMany.mockResolvedValue([]);
    mockTx.trade.findFirst.mockResolvedValue({
      price: new Decimal('0.03'),
      createdAt: new Date(Date.now() - 300_000),
    });
    mockOrderbookManager.get.mockReturnValue(undefined);

    await expect(
      marginService.openPosition({
        address: baseAccount.address,
        pairSymbol: 'LUNES/USDT',
        side: 'BUY',
        collateralAmount: '100',
        leverage: '2',
        signature: 'sig',
      }),
    ).rejects.toThrow('Mark price unavailable for LUNES/USDT');

    await expect(
      marginService.openPosition({
        address: baseAccount.address,
        pairSymbol: 'LUNES/USDT',
        side: 'BUY',
        collateralAmount: '100',
        leverage: '2',
        signature: 'sig',
      }),
    ).rejects.toThrow('Mark price unavailable for LUNES/USDT');

    await expect(
      marginService.openPosition({
        address: baseAccount.address,
        pairSymbol: 'LUNES/USDT',
        side: 'BUY',
        collateralAmount: '100',
        leverage: '2',
        signature: 'sig',
      }),
    ).rejects.toThrow('Mark price unavailable for LUNES/USDT');

    expect(marginService.getPriceHealth('LUNES/USDT')).toEqual(
      expect.objectContaining({
        summary: expect.objectContaining({
          blockedPairs: 1,
          operationalBlockAfterFailures: 3,
        }),
        pairs: [
          expect.objectContaining({
            pairSymbol: 'LUNES/USDT',
            isOperationallyBlocked: true,
            consecutiveFailures: 3,
          }),
        ],
      }),
    );

    await expect(
      marginService.openPosition({
        address: baseAccount.address,
        pairSymbol: 'LUNES/USDT',
        side: 'BUY',
        collateralAmount: '100',
        leverage: '2',
        signature: 'sig',
      }),
    ).rejects.toThrow(
      'Margin price health is operationally blocked for LUNES/USDT',
    );

    expect(mockTx.trade.findFirst).toHaveBeenCalledTimes(3);
  });

  it('resets price health monitor state for a specific pair', async () => {
    mockTx.pair.findUnique.mockResolvedValue({
      id: 'pair-1',
      symbol: 'LUNES/USDT',
      isActive: true,
    });
    mockTx.marginAccount.findUnique.mockResolvedValue(baseAccount);
    mockTx.marginPosition.findMany.mockResolvedValue([]);
    mockTx.trade.findFirst.mockResolvedValue({
      price: new Decimal('0.03'),
      createdAt: new Date(Date.now() - 300_000),
    });
    mockOrderbookManager.get.mockReturnValue(undefined);

    await expect(
      marginService.openPosition({
        address: baseAccount.address,
        pairSymbol: 'LUNES/USDT',
        side: 'BUY',
        collateralAmount: '100',
        leverage: '2',
        signature: 'sig',
      }),
    ).rejects.toThrow('Mark price unavailable for LUNES/USDT');

    expect(
      marginService.getPriceHealth('LUNES/USDT').summary.trackedPairs,
    ).toBe(1);

    const resetResult = marginService.resetPriceHealthMonitor('LUNES/USDT');

    expect(resetResult).toEqual(
      expect.objectContaining({
        summary: expect.objectContaining({
          trackedPairs: 0,
          blockedPairs: 0,
        }),
        pairs: [],
      }),
    );
    expect(
      marginService.getPriceHealth('LUNES/USDT').summary.trackedPairs,
    ).toBe(0);
  });

  // ───────────────────────────────────────────────────────────────
  // Liquidation authorization (permissionless keeper, by design)
  //
  // `POST /margin/positions/:id/liquidate` intentionally has NO
  // `requireAdmin` guard: any authenticated (sr25519) address may act
  // as a liquidator — the standard permissionless-keeper model used by
  // perps venues. Safety does NOT come from authorization; it comes
  // from the server-side, in-transaction re-check that the position is
  // actually eligible (`equity <= maintenanceMargin`). The
  // `liquidatorAddress` in the request never feeds the eligibility math,
  // so a third party cannot forge liquidatability. The liquidator earns
  // NO reward: the 2.5% penalty is only debited from the owner's
  // realizedPnl (it is not credited to the liquidator), and the residual
  // equity (`releasedCollateral`) is returned to the position OWNER.
  // These tests are the regression guard for that contract.
  // ───────────────────────────────────────────────────────────────

  const liquidationOwner = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
  const thirdPartyLiquidator =
    '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';

  function buildLiquidationPosition(overrides: {
    markPrice: string;
    unrealizedPnl: string;
    maintenanceMargin: string;
    collateralAmount: string;
  }) {
    return {
      id: 'position-liq',
      accountId: 'account-1',
      pairId: 'pair-1',
      pairSymbol: 'LUNES/USDT',
      side: 'BUY',
      status: 'OPEN',
      collateralAmount: new Decimal(overrides.collateralAmount),
      leverage: new Decimal('5'),
      notional: new Decimal('500'),
      quantity: new Decimal('5000'),
      entryPrice: new Decimal('0.1'),
      markPrice: new Decimal(overrides.markPrice),
      borrowedAmount: new Decimal('400'),
      maintenanceMargin: new Decimal(overrides.maintenanceMargin),
      liquidationPrice: new Decimal('0.09'),
      unrealizedPnl: new Decimal(overrides.unrealizedPnl),
      realizedPnl: new Decimal('0'),
      openedAt: new Date('2026-01-01T00:00:00.000Z'),
      closedAt: null,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      account: { ...baseAccount },
    };
  }

  it('refuses to liquidate a HEALTHY position even for a third-party liquidator (equity > maintenanceMargin)', async () => {
    // Healthy: equity = collateral(100) + unrealizedPnl(+10) = 110 > maint(40).
    const healthy = buildLiquidationPosition({
      markPrice: '0.11',
      unrealizedPnl: '10',
      maintenanceMargin: '40',
      collateralAmount: '100',
    });

    mockTx.marginPosition.findUnique.mockResolvedValue(healthy);
    mockTx.marginAccount.findUnique.mockResolvedValue(baseAccount);
    // Fresh last trade => no stale / circuit-breaker path; mark stays > entry.
    mockTx.trade.findFirst.mockResolvedValue({
      price: new Decimal('0.11'),
      createdAt: new Date(),
    });
    mockOrderbookManager.get.mockReturnValue(undefined);
    // refreshPositionWithClient persists recomputed mark/pnl; echo a healthy
    // record so formatPosition derives equity(110) > maintenanceMargin(40).
    mockTx.marginPosition.update.mockResolvedValue({
      ...healthy,
      markPrice: new Decimal('0.11'),
      unrealizedPnl: new Decimal('50'),
    });

    await expect(
      marginService.liquidatePosition('position-liq', thirdPartyLiquidator),
    ).rejects.toThrow('Position is not liquidatable');

    // No state transition: no collateral moved, no liquidation record minted.
    // (The CAS `updateMany` is never reached because the eligibility re-check
    // throws first.)
    expect(mockTx.marginAccount.update).not.toHaveBeenCalled();
    expect(mockTx.marginLiquidation.create).not.toHaveBeenCalled();
  });

  it('refuses to liquidate a position that is not OPEN (anti double-liquidation gate)', async () => {
    const alreadyClosed = {
      ...buildLiquidationPosition({
        markPrice: '0.05',
        unrealizedPnl: '-250',
        maintenanceMargin: '40',
        collateralAmount: '100',
      }),
      status: 'LIQUIDATED',
    };

    mockTx.marginPosition.findUnique.mockResolvedValue(alreadyClosed);

    await expect(
      marginService.liquidatePosition('position-liq', thirdPartyLiquidator),
    ).rejects.toThrow('Position is not open');

    expect(mockTx.marginAccount.update).not.toHaveBeenCalled();
    expect(mockTx.marginLiquidation.create).not.toHaveBeenCalled();
  });

  it('allows a third-party liquidator to liquidate an ELIGIBLE position; penalty is debited from the owner and residual equity returns to the owner (no liquidator reward)', async () => {
    // Eligible: equity = collateral(100) + unrealizedPnl(-70) = 30 <= maint(40).
    const eligible = buildLiquidationPosition({
      markPrice: '0.086',
      unrealizedPnl: '-70',
      maintenanceMargin: '40',
      collateralAmount: '100',
    });

    mockTx.marginPosition.findUnique.mockResolvedValue(eligible);
    mockTx.marginAccount.findUnique.mockResolvedValue(baseAccount);
    mockTx.trade.findFirst.mockResolvedValue({
      price: new Decimal('0.086'),
      createdAt: new Date(),
    });
    mockOrderbookManager.get.mockReturnValue(undefined);
    mockTx.marginPosition.update.mockResolvedValue({
      ...eligible,
      markPrice: new Decimal('0.086'),
      unrealizedPnl: new Decimal('-70'),
    });
    // Atomic CAS claim wins (one row transitioned OPEN -> LIQUIDATED).
    mockTx.marginPosition.updateMany.mockResolvedValue({ count: 1 });
    mockTx.marginAccount.update.mockResolvedValue(baseAccount);
    mockTx.marginLiquidation.create.mockResolvedValue({});
    // Trailing getOverview(ownerAddress) reads via the non-tx client.
    mockPrisma.marginAccount.findUnique.mockResolvedValue(baseAccount);
    mockPrisma.marginPosition.findMany.mockResolvedValue([]);

    await marginService.liquidatePosition(
      'position-liq',
      thirdPartyLiquidator,
    );

    // The CAS is filtered on status OPEN -> only one liquidation can win.
    expect(mockTx.marginPosition.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'OPEN' }),
        data: expect.objectContaining({ status: 'LIQUIDATED' }),
      }),
    );

    // Liquidation record attributes the actor but grants NO reward credit.
    expect(mockTx.marginLiquidation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          liquidatorAddress: thirdPartyLiquidator,
        }),
      }),
    );

    // The only account credited is the OWNER's (residual equity returned).
    // The liquidator is never passed to marginAccount.update.
    const accountUpdates = mockTx.marginAccount.update.mock.calls;
    expect(accountUpdates.length).toBeGreaterThan(0);
    const creditedLiquidator = accountUpdates.some((call) =>
      JSON.stringify(call).includes(thirdPartyLiquidator),
    );
    expect(creditedLiquidator).toBe(false);
  });
});
