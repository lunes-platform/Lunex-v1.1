"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const library_1 = require("@prisma/client/runtime/library");
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
const orderService_1 = require("../services/orderService");
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
function makeOrder(overrides = {}) {
    return {
        id: 'order-1',
        pairId: pair.id,
        makerAddress: 'maker-1',
        side: 'BUY',
        type: 'STOP',
        price: new library_1.Decimal('0'),
        stopPrice: new library_1.Decimal('120'),
        amount: new library_1.Decimal('1'),
        filledAmount: new library_1.Decimal('0'),
        remainingAmount: new library_1.Decimal('1'),
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
        mockPrisma.trade.findFirst.mockReset();
        mockBook.addMarketOrder.mockReset();
        mockBook.addLimitOrder.mockReset();
        mockBook.cancelOrder.mockReset();
        mockBook.getBestBid.mockReset();
        mockBook.getBestAsk.mockReset();
        mockTradeService.processMatches.mockReset();
        mockSettlementService.isEnabled.mockReturnValue(true);
        mockSettlementService.isNonceUsed.mockResolvedValue(false);
        mockSettlementService.isNonceCancelled.mockResolvedValue(false);
        mockSettlementService.getVaultBalance.mockResolvedValue(10000000000000n);
        mockSettlementService.cancelOrderFor.mockResolvedValue(null);
        mockOrderbookManager.getOrCreate.mockReturnValue(mockBook);
        mockOrderbookManager.get.mockReturnValue(mockBook);
    });
    it('keeps a STOP order in PENDING_TRIGGER when the trigger price has not been reached', async () => {
        const createdOrder = makeOrder();
        mockPrisma.order.findFirst.mockResolvedValueOnce(null);
        mockPrisma.order.findUnique.mockResolvedValueOnce(createdOrder);
        mockPrisma.order.create.mockResolvedValue(createdOrder);
        mockPrisma.order.findMany
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([createdOrder]);
        mockPrisma.trade.findFirst.mockResolvedValue({ price: new library_1.Decimal('100') });
        const result = await orderService_1.orderService.createOrder({
            pairSymbol: pair.symbol,
            side: 'BUY',
            type: 'STOP',
            amount: '1',
            stopPrice: '120',
            nonce: '1700000000001',
            signature: 'sig',
            makerAddress: 'maker-1',
            timeInForce: 'GTC',
        });
        expect(result).toEqual(createdOrder);
        expect(mockPrisma.order.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                status: 'PENDING_TRIGGER',
            }),
        }));
        expect(mockPrisma.order.update).not.toHaveBeenCalled();
        expect(mockBook.addMarketOrder).not.toHaveBeenCalled();
        expect(mockTradeService.processMatches).not.toHaveBeenCalled();
    });
    it('activates and executes a STOP order when the trigger price is reached', async () => {
        const createdOrder = makeOrder();
        const activatedOrder = makeOrder({ status: 'OPEN' });
        const filledOrder = makeOrder({
            status: 'FILLED',
            filledAmount: new library_1.Decimal('1'),
            remainingAmount: new library_1.Decimal('0'),
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
        mockPrisma.trade.findFirst.mockResolvedValue({ price: new library_1.Decimal('125') });
        mockPrisma.order.update.mockResolvedValue(activatedOrder);
        const matches = [{
                makerOrderId: 'maker-order-1',
                takerOrderId: createdOrder.id,
                fillAmount: 1,
                fillPrice: 125,
                makerAddress: 'maker-2',
                takerAddress: createdOrder.makerAddress,
            }];
        mockBook.addMarketOrder.mockReturnValue(matches);
        mockTradeService.processMatches.mockResolvedValue([]);
        const result = await orderService_1.orderService.createOrder({
            pairSymbol: pair.symbol,
            side: 'BUY',
            type: 'STOP',
            amount: '1',
            stopPrice: '120',
            nonce: '1700000000002',
            signature: 'sig',
            makerAddress: 'maker-1',
            timeInForce: 'GTC',
        });
        expect(result).toEqual(filledOrder);
        expect(mockPrisma.order.update).toHaveBeenCalledWith({
            where: { id: createdOrder.id },
            data: { status: 'OPEN' },
        });
        expect(mockBook.addMarketOrder).toHaveBeenCalledWith(createdOrder.id, 'BUY', 1, 'maker-1');
        expect(mockTradeService.processMatches).toHaveBeenCalledWith(pair.id, matches);
    });
    it('activates a STOP_LIMIT order and places it on the book as a limit order', async () => {
        const openOrder = makeOrder({
            id: 'order-2',
            side: 'SELL',
            type: 'STOP_LIMIT',
            price: new library_1.Decimal('88'),
            stopPrice: new library_1.Decimal('90'),
            amount: new library_1.Decimal('2'),
            remainingAmount: new library_1.Decimal('2'),
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
        mockPrisma.trade.findFirst.mockResolvedValue({ price: new library_1.Decimal('89') });
        mockPrisma.order.update.mockResolvedValue(activatedOrder);
        mockBook.addLimitOrder.mockReturnValue([]);
        const result = await orderService_1.orderService.createOrder({
            pairSymbol: pair.symbol,
            side: 'SELL',
            type: 'STOP_LIMIT',
            price: '88',
            stopPrice: '90',
            amount: '2',
            nonce: '1700000000003',
            signature: 'sig',
            makerAddress: 'maker-1',
            timeInForce: 'GTC',
        });
        expect(result).toEqual(openOrder);
        expect(mockBook.addLimitOrder).toHaveBeenCalledWith(openOrder.id, 'SELL', 88, 2, 'maker-1');
        expect(mockBook.addMarketOrder).not.toHaveBeenCalled();
        expect(mockTradeService.processMatches).not.toHaveBeenCalled();
    });
    it('fails closed when settlement is enabled but on-chain nonce validation is unavailable', async () => {
        mockSettlementService.isNonceUsed.mockResolvedValue(null);
        await expect(orderService_1.orderService.createOrder({
            pairSymbol: pair.symbol,
            side: 'BUY',
            type: 'LIMIT',
            price: '100',
            amount: '1',
            nonce: '1700000000004',
            signature: 'sig',
            makerAddress: 'maker-1',
            timeInForce: 'GTC',
        })).rejects.toThrow('On-chain nonce validation unavailable');
    });
});
//# sourceMappingURL=orderService.test.js.map