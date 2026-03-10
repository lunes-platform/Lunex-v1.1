"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const testApp_1 = __importDefault(require("./testApp"));
jest.mock('../../db', () => ({
    __esModule: true,
    default: {
        pair: { findUnique: jest.fn().mockResolvedValue(null) },
        order: {
            create: jest.fn(),
            findUnique: jest.fn(),
            findMany: jest.fn().mockResolvedValue([]),
            update: jest.fn(),
        },
        trade: { findFirst: jest.fn() },
    },
}));
jest.mock('../../utils/orderbook', () => ({
    orderbookManager: {
        getOrCreate: jest.fn().mockReturnValue({
            addLimitOrder: jest.fn().mockReturnValue([]),
            addMarketOrder: jest.fn().mockReturnValue([]),
            cancelOrder: jest.fn(),
        }),
        get: jest.fn(),
    },
}));
jest.mock('../../services/tradeService', () => ({
    tradeService: { processMatches: jest.fn() },
}));
jest.mock('../../services/settlementService', () => ({
    settlementService: {
        isEnabled: jest.fn().mockReturnValue(false),
        isNonceUsed: jest.fn(),
        isNonceCancelled: jest.fn(),
        getVaultBalance: jest.fn(),
        cancelOrderFor: jest.fn(),
    },
}));
jest.mock('../../middleware/auth', () => ({
    ...jest.requireActual('../../middleware/auth'),
    verifyAddressSignature: jest.fn().mockResolvedValue(true),
}));
describe('Orders API E2E', () => {
    describe('POST /api/v1/orders', () => {
        it('should return 400 on invalid payload', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default)
                .post('/api/v1/orders')
                .send({});
            expect(res.status).toBe(400);
            expect(res.body).toHaveProperty('error');
        });
        it('should return 400 with missing required fields', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default)
                .post('/api/v1/orders')
                .send({
                pairSymbol: 'LUNES/USDT',
                side: 'BUY',
            });
            expect(res.status).toBe(400);
            expect(res.body).toHaveProperty('error', 'Validation failed');
        });
        it('should return 400 on invalid side enum', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default)
                .post('/api/v1/orders')
                .send({
                pairSymbol: 'LUNES/USDT',
                side: 'INVALID',
                type: 'LIMIT',
                price: '100',
                amount: '1',
                nonce: '123456',
                signature: 'sig123',
                makerAddress: 'addr123',
            });
            expect(res.status).toBe(400);
        });
    });
    describe('DELETE /api/v1/orders/:id', () => {
        it('should return 400 on empty body', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default)
                .delete('/api/v1/orders/some-order-id')
                .send({});
            expect(res.status).toBe(400);
            expect(res.body).toHaveProperty('error', 'Validation failed');
        });
    });
    describe('GET /api/v1/orders', () => {
        it('should return 400 without makerAddress', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).get('/api/v1/orders');
            expect(res.status).toBe(400);
            expect(res.body).toHaveProperty('error', 'makerAddress required');
        });
        it('should return 200 with empty orders for valid address', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).get('/api/v1/orders?makerAddress=test-addr');
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('orders');
            expect(Array.isArray(res.body.orders)).toBe(true);
        });
    });
});
//# sourceMappingURL=orders.e2e.test.js.map