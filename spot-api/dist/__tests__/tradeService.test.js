"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mockPrisma = {
    pair: {
        findUnique: jest.fn(),
    },
    trade: {
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
const tradeService_1 = require("../services/tradeService");
describe('tradeService operational settlement methods', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });
    it('lists trades filtered by settlement status', async () => {
        const trades = [
            { id: 'trade-1', settlementStatus: 'FAILED', pair: { symbol: 'LUNES/USDT' } },
        ];
        mockPrisma.trade.findMany.mockResolvedValue(trades);
        const result = await tradeService_1.tradeService.getTradesBySettlementStatus('FAILED', 10, 5);
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
        await tradeService_1.tradeService.getTradesBySettlementStatus(undefined, 20, 0);
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
        const result = await tradeService_1.tradeService.retryTradeSettlements(12);
        expect(result).toEqual({ processed: 2, settled: 1, failed: 1 });
        expect(mockTradeSettlementService.retryPendingSettlements).toHaveBeenCalledWith(12);
    });
});
//# sourceMappingURL=tradeService.test.js.map