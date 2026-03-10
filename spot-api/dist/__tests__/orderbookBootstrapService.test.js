"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const library_1 = require("@prisma/client/runtime/library");
const mockPrisma = {
    order: {
        findMany: jest.fn(),
    },
};
const mockBook = {
    restoreLimitOrder: jest.fn(),
};
const mockOrderbookManager = {
    clearAll: jest.fn(),
    getOrCreate: jest.fn(() => mockBook),
    getAll: jest.fn(() => new Map([['LUNES/USDT', mockBook]])),
};
jest.mock('../db', () => ({
    __esModule: true,
    default: mockPrisma,
}));
jest.mock('../utils/orderbook', () => ({
    orderbookManager: mockOrderbookManager,
}));
const orderbookBootstrapService_1 = require("../services/orderbookBootstrapService");
describe('rehydrateOrderbooks', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockOrderbookManager.getOrCreate.mockReturnValue(mockBook);
        mockOrderbookManager.getAll.mockReturnValue(new Map([['LUNES/USDT', mockBook]]));
    });
    it('restores persisted resting orders into the in-memory orderbooks', async () => {
        const createdAt = new Date('2026-01-01T00:00:00Z');
        mockPrisma.order.findMany.mockResolvedValue([
            {
                id: 'order-1',
                side: 'BUY',
                price: new library_1.Decimal('100'),
                amount: new library_1.Decimal('2'),
                remainingAmount: new library_1.Decimal('1.5'),
                makerAddress: 'maker-1',
                createdAt,
                pair: { symbol: 'LUNES/USDT' },
            },
            {
                id: 'order-2',
                side: 'SELL',
                price: new library_1.Decimal('0'),
                amount: new library_1.Decimal('3'),
                remainingAmount: new library_1.Decimal('3'),
                makerAddress: 'maker-2',
                createdAt,
                pair: { symbol: 'LUNES/USDT' },
            },
        ]);
        const result = await (0, orderbookBootstrapService_1.rehydrateOrderbooks)();
        expect(mockOrderbookManager.clearAll).toHaveBeenCalledTimes(1);
        expect(mockPrisma.order.findMany).toHaveBeenCalledWith({
            where: {
                type: { in: ['LIMIT', 'STOP_LIMIT'] },
                status: { in: ['OPEN', 'PARTIAL'] },
            },
            include: {
                pair: {
                    select: {
                        symbol: true,
                    },
                },
            },
            orderBy: [{ createdAt: 'asc' }],
        });
        expect(mockBook.restoreLimitOrder).toHaveBeenCalledTimes(1);
        expect(mockBook.restoreLimitOrder).toHaveBeenCalledWith('order-1', 'BUY', 100, 2, 1.5, 'maker-1', createdAt.getTime());
        expect(result).toEqual({ restoredOrders: 1, restoredBooks: 1 });
    });
});
//# sourceMappingURL=orderbookBootstrapService.test.js.map