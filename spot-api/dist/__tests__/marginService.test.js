"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const library_1 = require("@prisma/client/runtime/library");
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
    $transaction: jest.fn(async (callback) => callback(mockTx)),
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
const mockLog = { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
jest.mock('../utils/logger', () => ({ log: mockLog }));
const marginService_1 = require("../services/marginService");
describe('marginService hardening', () => {
    const baseAccount = {
        id: 'account-1',
        address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
        collateralToken: 'USDT',
        collateralAvailable: new library_1.Decimal('100'),
        collateralLocked: new library_1.Decimal('50'),
        totalRealizedPnl: new library_1.Decimal('0'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    beforeEach(() => {
        jest.clearAllMocks();
        marginService_1.marginService.resetPriceHealthMonitor();
        mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockTx));
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
        mockTx.marginPosition.findUnique.mockReset();
        mockTx.marginCollateralTransfer.create.mockReset();
        mockTx.marginLiquidation.create.mockReset();
        mockOrderbookManager.get.mockReset();
    });
    function createFreshBook(bestBid, bestAsk, lastUpdatedAt = Date.now() - 1000) {
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
                collateralAmount: new library_1.Decimal('50'),
                leverage: new library_1.Decimal('2'),
                notional: new library_1.Decimal('100'),
                quantity: new library_1.Decimal('1000'),
                entryPrice: new library_1.Decimal('0.1'),
                markPrice: new library_1.Decimal('0.1'),
                borrowedAmount: new library_1.Decimal('50'),
                maintenanceMargin: new library_1.Decimal('40'),
                liquidationPrice: new library_1.Decimal('0.09'),
                unrealizedPnl: new library_1.Decimal('-70'),
                realizedPnl: new library_1.Decimal('0'),
                openedAt: new Date('2026-01-01T00:00:00.000Z'),
                closedAt: null,
                updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            },
        ]);
        mockTx.trade.findFirst.mockResolvedValue({ price: new library_1.Decimal('0.03') });
        mockTx.marginPosition.update.mockImplementation(async ({ where }) => ({
            id: where.id,
            accountId: baseAccount.id,
            pairId: 'pair-1',
            pairSymbol: 'LUNES/USDT',
            side: 'BUY',
            status: 'OPEN',
            collateralAmount: new library_1.Decimal('50'),
            leverage: new library_1.Decimal('2'),
            notional: new library_1.Decimal('100'),
            quantity: new library_1.Decimal('1000'),
            entryPrice: new library_1.Decimal('0.1'),
            markPrice: new library_1.Decimal('0.03'),
            borrowedAmount: new library_1.Decimal('50'),
            maintenanceMargin: new library_1.Decimal('40'),
            liquidationPrice: new library_1.Decimal('0.09'),
            unrealizedPnl: new library_1.Decimal('-100'),
            realizedPnl: new library_1.Decimal('0'),
            openedAt: new Date('2026-01-01T00:00:00.000Z'),
            closedAt: null,
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        }));
        await expect(marginService_1.marginService.withdrawCollateral({
            address: baseAccount.address,
            amount: '45',
            token: 'USDT',
            signature: 'sig',
        })).rejects.toThrow('Withdrawal would breach maintenance margin requirements');
        expect(mockTx.marginAccount.update).not.toHaveBeenCalled();
        expect(mockTx.marginCollateralTransfer.create).not.toHaveBeenCalled();
    });
    it('rejects leverage above the safe initial cap', async () => {
        await expect(marginService_1.marginService.openPosition({
            address: baseAccount.address,
            pairSymbol: 'LUNES/USDT',
            side: 'BUY',
            collateralAmount: '100',
            leverage: '7.95',
            signature: 'sig',
        })).rejects.toThrow('Leverage must be between 1x and 7.90x');
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
                collateralAmount: new library_1.Decimal('50'),
                leverage: new library_1.Decimal('2'),
                notional: new library_1.Decimal('100'),
                quantity: new library_1.Decimal('1000'),
                entryPrice: new library_1.Decimal('0.1'),
                markPrice: new library_1.Decimal('0.03'),
                borrowedAmount: new library_1.Decimal('50'),
                maintenanceMargin: new library_1.Decimal('40'),
                liquidationPrice: new library_1.Decimal('0.09'),
                unrealizedPnl: new library_1.Decimal('-100'),
                realizedPnl: new library_1.Decimal('0'),
                openedAt: new Date('2026-01-01T00:00:00.000Z'),
                closedAt: null,
                updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            },
        ]);
        mockTx.trade.findFirst.mockResolvedValue({ price: new library_1.Decimal('0.03') });
        mockTx.marginPosition.update.mockImplementation(async ({ where }) => ({
            id: where.id,
            accountId: baseAccount.id,
            pairId: 'pair-1',
            pairSymbol: 'LUNES/USDT',
            side: 'BUY',
            status: 'OPEN',
            collateralAmount: new library_1.Decimal('50'),
            leverage: new library_1.Decimal('2'),
            notional: new library_1.Decimal('100'),
            quantity: new library_1.Decimal('1000'),
            entryPrice: new library_1.Decimal('0.1'),
            markPrice: new library_1.Decimal('0.03'),
            borrowedAmount: new library_1.Decimal('50'),
            maintenanceMargin: new library_1.Decimal('40'),
            liquidationPrice: new library_1.Decimal('0.09'),
            unrealizedPnl: new library_1.Decimal('-100'),
            realizedPnl: new library_1.Decimal('0'),
            openedAt: new Date('2026-01-01T00:00:00.000Z'),
            closedAt: null,
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        }));
        await expect(marginService_1.marginService.openPosition({
            address: baseAccount.address,
            pairSymbol: 'LUNES/USDT',
            side: 'BUY',
            collateralAmount: '100',
            leverage: '2',
            signature: 'sig',
        })).rejects.toThrow('Insufficient account equity for requested margin exposure');
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
            price: new library_1.Decimal('0.03'),
            createdAt: new Date(Date.now() - 300000),
        });
        mockOrderbookManager.get.mockReturnValue(undefined);
        await expect(marginService_1.marginService.openPosition({
            address: baseAccount.address,
            pairSymbol: 'LUNES/USDT',
            side: 'BUY',
            collateralAmount: '100',
            leverage: '2',
            signature: 'sig',
        })).rejects.toThrow('Mark price stale for LUNES/USDT');
        expect(marginService_1.marginService.getPriceHealth('LUNES/USDT')).toEqual(expect.objectContaining({
            summary: expect.objectContaining({
                trackedPairs: 1,
                unhealthyPairs: 1,
                hasActiveAlerts: true,
            }),
            pairs: [
                expect.objectContaining({
                    pairSymbol: 'LUNES/USDT',
                    status: 'UNHEALTHY',
                    totalFailures: 1,
                    consecutiveFailures: 1,
                    lastFailureReason: 'Mark price stale for LUNES/USDT',
                }),
            ],
        }));
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
            collateralAmount: new library_1.Decimal('100'),
            leverage: new library_1.Decimal('2'),
            notional: new library_1.Decimal('200'),
            quantity: new library_1.Decimal('2'),
            entryPrice: new library_1.Decimal('100'),
            markPrice: new library_1.Decimal('100'),
            borrowedAmount: new library_1.Decimal('100'),
            maintenanceMargin: new library_1.Decimal('20'),
            liquidationPrice: new library_1.Decimal('60'),
            unrealizedPnl: new library_1.Decimal('0'),
            realizedPnl: new library_1.Decimal('0'),
            openedAt: new Date('2026-01-01T00:00:00.000Z'),
            closedAt: null,
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        };
        mockTx.pair.findUnique.mockResolvedValue({ id: 'pair-1', symbol: 'LUNES/USDT', isActive: true });
        mockTx.marginAccount.findUnique.mockResolvedValue(baseAccount);
        mockTx.marginPosition.findMany.mockResolvedValue([]);
        mockTx.trade.findFirst.mockResolvedValue({
            price: new library_1.Decimal('90'),
            createdAt: new Date(Date.now() - 300000),
        });
        mockPrisma.trade.findFirst.mockResolvedValue({
            price: new library_1.Decimal('90'),
            createdAt: new Date(Date.now() - 300000),
        });
        mockOrderbookManager.get.mockReturnValue(freshBook);
        mockTx.marginAccount.update.mockResolvedValue(undefined);
        mockTx.marginPosition.create.mockResolvedValue(createdPosition);
        mockPrisma.marginPosition.update.mockResolvedValue(createdPosition);
        mockPrisma.marginAccount.findUnique.mockResolvedValue(baseAccount);
        mockPrisma.marginPosition.findMany.mockResolvedValue([]);
        const result = await marginService_1.marginService.openPosition({
            address: baseAccount.address,
            pairSymbol: 'LUNES/USDT',
            side: 'BUY',
            collateralAmount: '100',
            leverage: '2',
            signature: 'sig',
        });
        expect(result.position.entryPrice).toBe(100);
        expect(result.position.markPriceMeta).toEqual(expect.objectContaining({
            source: 'BOOK_MID',
        }));
        expect(result.overview.risk).toBeDefined();
        expect(result.overview.risk).toHaveProperty('markPriceHealth');
        expect(mockTx.marginPosition.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                entryPrice: expect.any(library_1.Decimal),
                markPrice: expect.any(library_1.Decimal),
            }),
        }));
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
            price: new library_1.Decimal('200'),
            createdAt: new Date(Date.now() - 1000),
        });
        mockOrderbookManager.get.mockReturnValue(createFreshBook(95, 105));
        await expect(marginService_1.marginService.openPosition({
            address: baseAccount.address,
            pairSymbol: 'LUNES/USDT',
            side: 'BUY',
            collateralAmount: '100',
            leverage: '2',
            signature: 'sig',
        })).rejects.toThrow('Mark price circuit breaker triggered for LUNES/USDT');
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
            price: new library_1.Decimal('200'),
            createdAt: new Date(Date.now() - 1000),
        });
        mockOrderbookManager.get.mockReturnValue(createFreshBook(95, 105));
        await expect(marginService_1.marginService.openPosition({
            address: baseAccount.address,
            pairSymbol: 'LUNES/USDT',
            side: 'BUY',
            collateralAmount: '100',
            leverage: '2',
            signature: 'sig',
        })).rejects.toThrow('Mark price circuit breaker triggered for LUNES/USDT');
        expect(mockLog.error).toHaveBeenCalledWith(expect.objectContaining({ event: 'margin.safe_mark_price_unavailable' }), expect.any(String));
    });
    it('logs restoration and resets consecutive failures after price health recovers', async () => {
        mockLog.error.mockClear();
        mockLog.info.mockClear();
        const consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
        const freshBook = createFreshBook(95, 105);
        const createdPosition = {
            id: 'position-new',
            accountId: baseAccount.id,
            pairId: 'pair-1',
            pairSymbol: 'LUNES/USDT',
            side: 'BUY',
            status: 'OPEN',
            collateralAmount: new library_1.Decimal('100'),
            leverage: new library_1.Decimal('2'),
            notional: new library_1.Decimal('200'),
            quantity: new library_1.Decimal('2'),
            entryPrice: new library_1.Decimal('100'),
            markPrice: new library_1.Decimal('100'),
            borrowedAmount: new library_1.Decimal('100'),
            maintenanceMargin: new library_1.Decimal('20'),
            liquidationPrice: new library_1.Decimal('60'),
            unrealizedPnl: new library_1.Decimal('0'),
            realizedPnl: new library_1.Decimal('0'),
            openedAt: new Date('2026-01-01T00:00:00.000Z'),
            closedAt: null,
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        };
        mockTx.pair.findUnique.mockResolvedValue({ id: 'pair-1', symbol: 'LUNES/USDT', isActive: true });
        mockTx.marginAccount.findUnique.mockResolvedValue(baseAccount);
        mockTx.marginPosition.findMany.mockResolvedValue([]);
        mockTx.trade.findFirst.mockResolvedValueOnce({
            price: new library_1.Decimal('200'),
            createdAt: new Date(Date.now() - 1000),
        });
        mockTx.trade.findFirst.mockResolvedValueOnce({
            price: new library_1.Decimal('90'),
            createdAt: new Date(Date.now() - 300000),
        });
        mockPrisma.trade.findFirst.mockResolvedValue({
            price: new library_1.Decimal('90'),
            createdAt: new Date(Date.now() - 300000),
        });
        mockOrderbookManager.get.mockReturnValue(freshBook);
        mockTx.marginAccount.update.mockResolvedValue(undefined);
        mockTx.marginPosition.create.mockResolvedValue(createdPosition);
        mockPrisma.marginPosition.update.mockResolvedValue(createdPosition);
        mockPrisma.marginAccount.findUnique.mockResolvedValue(baseAccount);
        mockPrisma.marginPosition.findMany.mockResolvedValue([]);
        await expect(marginService_1.marginService.openPosition({
            address: baseAccount.address,
            pairSymbol: 'LUNES/USDT',
            side: 'BUY',
            collateralAmount: '100',
            leverage: '2',
            signature: 'sig',
        })).rejects.toThrow('Mark price circuit breaker triggered for LUNES/USDT');
        await marginService_1.marginService.openPosition({
            address: baseAccount.address,
            pairSymbol: 'LUNES/USDT',
            side: 'BUY',
            collateralAmount: '100',
            leverage: '2',
            signature: 'sig',
        });
        expect(mockLog.error).toHaveBeenCalledWith(expect.objectContaining({ event: 'margin.safe_mark_price_unavailable' }), expect.any(String));
        expect(consoleInfoSpy).toHaveBeenCalledWith(expect.stringContaining('margin.safe_mark_price_restored'));
        consoleInfoSpy.mockRestore();
        expect(marginService_1.marginService.getPriceHealth('LUNES/USDT')).toEqual(expect.objectContaining({
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
        }));
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
            price: new library_1.Decimal('0.03'),
            createdAt: new Date(Date.now() - 300000),
        });
        mockOrderbookManager.get.mockReturnValue(undefined);
        await expect(marginService_1.marginService.openPosition({
            address: baseAccount.address,
            pairSymbol: 'LUNES/USDT',
            side: 'BUY',
            collateralAmount: '100',
            leverage: '2',
            signature: 'sig',
        })).rejects.toThrow('Mark price stale for LUNES/USDT');
        await expect(marginService_1.marginService.openPosition({
            address: baseAccount.address,
            pairSymbol: 'LUNES/USDT',
            side: 'BUY',
            collateralAmount: '100',
            leverage: '2',
            signature: 'sig',
        })).rejects.toThrow('Mark price stale for LUNES/USDT');
        await expect(marginService_1.marginService.openPosition({
            address: baseAccount.address,
            pairSymbol: 'LUNES/USDT',
            side: 'BUY',
            collateralAmount: '100',
            leverage: '2',
            signature: 'sig',
        })).rejects.toThrow('Mark price stale for LUNES/USDT');
        expect(marginService_1.marginService.getPriceHealth('LUNES/USDT')).toEqual(expect.objectContaining({
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
        }));
        await expect(marginService_1.marginService.openPosition({
            address: baseAccount.address,
            pairSymbol: 'LUNES/USDT',
            side: 'BUY',
            collateralAmount: '100',
            leverage: '2',
            signature: 'sig',
        })).rejects.toThrow('Margin price health is operationally blocked for LUNES/USDT');
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
            price: new library_1.Decimal('0.03'),
            createdAt: new Date(Date.now() - 300000),
        });
        mockOrderbookManager.get.mockReturnValue(undefined);
        await expect(marginService_1.marginService.openPosition({
            address: baseAccount.address,
            pairSymbol: 'LUNES/USDT',
            side: 'BUY',
            collateralAmount: '100',
            leverage: '2',
            signature: 'sig',
        })).rejects.toThrow('Mark price stale for LUNES/USDT');
        expect(marginService_1.marginService.getPriceHealth('LUNES/USDT').summary.trackedPairs).toBe(1);
        const resetResult = marginService_1.marginService.resetPriceHealthMonitor('LUNES/USDT');
        expect(resetResult).toEqual(expect.objectContaining({
            summary: expect.objectContaining({
                trackedPairs: 0,
                blockedPairs: 0,
            }),
            pairs: [],
        }));
        expect(marginService_1.marginService.getPriceHealth('LUNES/USDT').summary.trackedPairs).toBe(0);
    });
});
//# sourceMappingURL=marginService.test.js.map