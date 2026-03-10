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
        pair: {
            findMany: jest.fn().mockResolvedValue([]),
            findUnique: jest.fn().mockResolvedValue(null),
        },
        trade: {
            findMany: jest.fn().mockResolvedValue([]),
        },
    },
}));
jest.mock('../../utils/orderbook', () => ({
    orderbookManager: {
        get: jest.fn().mockReturnValue(null),
    },
}));
describe('Pairs API E2E', () => {
    describe('GET /api/v1/pairs', () => {
        it('should return empty pairs list', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).get('/api/v1/pairs');
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('pairs');
            expect(Array.isArray(res.body.pairs)).toBe(true);
        });
    });
    describe('GET /api/v1/pairs/:symbol/ticker', () => {
        it('should return 404 when pair not found', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).get('/api/v1/pairs/FAKE-PAIR/ticker');
            expect(res.status).toBe(404);
            expect(res.body).toHaveProperty('error', 'Pair not found');
        });
        it('should return ticker data when pair exists', async () => {
            const { default: mockPrisma } = require('../../db');
            mockPrisma.pair.findUnique.mockResolvedValueOnce({
                id: 'pair-1',
                symbol: 'LUNES/USDT',
                isActive: true,
            });
            mockPrisma.trade.findMany.mockResolvedValueOnce([]);
            const res = await (0, supertest_1.default)(testApp_1.default).get('/api/v1/pairs/LUNES%2FUSDT/ticker');
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('symbol', 'LUNES/USDT');
            expect(res.body).toHaveProperty('lastPrice');
            expect(res.body).toHaveProperty('volume24h');
            expect(res.body).toHaveProperty('change24h');
        });
    });
});
//# sourceMappingURL=pairs.e2e.test.js.map