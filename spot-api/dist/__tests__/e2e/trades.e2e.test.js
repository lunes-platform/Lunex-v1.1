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
        trade: {
            findMany: jest.fn().mockResolvedValue([]),
        },
    },
}));
jest.mock('../../services/tradeService', () => ({
    tradeService: {
        getRecentTrades: jest.fn().mockResolvedValue([]),
        getUserTrades: jest.fn().mockResolvedValue([]),
        getTradesBySettlementStatus: jest.fn().mockResolvedValue([]),
        retryTradeSettlements: jest.fn().mockResolvedValue({
            processed: 0,
            settled: 0,
            failed: 0,
        }),
    },
}));
jest.mock('../../services/tradeSettlementService', () => ({
    tradeSettlementService: {
        retryPendingSettlements: jest.fn().mockResolvedValue({ processed: 0, settled: 0, failed: 0 }),
    },
}));
describe('Trades API E2E', () => {
    describe('GET /api/v1/trades/:symbol', () => {
        it('should return 200 with empty trades', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).get('/api/v1/trades/LUNES-USDT');
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('trades');
            expect(Array.isArray(res.body.trades)).toBe(true);
        });
        it('should respect limit query parameter', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).get('/api/v1/trades/LUNES-USDT?limit=10');
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('trades');
        });
    });
    describe('GET /api/v1/trades', () => {
        it('should return 400 without address', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).get('/api/v1/trades');
            expect(res.status).toBe(400);
            expect(res.body).toHaveProperty('error', 'address required');
        });
        it('should return 200 with valid address', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).get('/api/v1/trades?address=test-addr-123');
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('trades');
        });
    });
    describe('GET /api/v1/trades/settlement/status', () => {
        it('should return 200 with default params', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).get('/api/v1/trades/settlement/status');
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('trades');
        });
        it('should return 200 with status filter', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).get('/api/v1/trades/settlement/status?status=PENDING');
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('trades');
        });
    });
    describe('POST /api/v1/trades/settlement/retry', () => {
        it('should return 200 on valid retry request', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default)
                .post('/api/v1/trades/settlement/retry')
                .send({ limit: 10 });
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('processed');
        });
    });
});
//# sourceMappingURL=trades.e2e.test.js.map