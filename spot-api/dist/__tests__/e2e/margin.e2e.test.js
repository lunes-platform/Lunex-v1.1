"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const testApp_1 = __importDefault(require("./testApp"));
jest.mock('../../services/marginService', () => ({
    marginService: {
        getOverview: jest.fn().mockResolvedValue({
            account: null,
            positions: [],
            risk: {
                openPositions: 0,
                totalUnrealizedPnl: 0,
                liquidatablePositions: 0,
                markPriceHealth: null,
            },
        }),
        getPriceHealth: jest.fn().mockReturnValue({
            generatedAt: '2026-03-06T00:00:00.000Z',
            summary: {
                trackedPairs: 1,
                healthyPairs: 1,
                unhealthyPairs: 0,
                hasActiveAlerts: false,
            },
            pairs: [],
        }),
        getPriceHealthSummary: jest.fn().mockReturnValue({
            trackedPairs: 1,
            healthyPairs: 1,
            unhealthyPairs: 0,
            hasActiveAlerts: false,
            blockedPairs: 0,
            operationalBlockAfterFailures: 3,
        }),
        getPriceHealthMetrics: jest.fn().mockReturnValue([
            '# HELP lunex_margin_mark_price_tracked_pairs Number of pairs tracked by the margin safe mark price monitor',
            '# TYPE lunex_margin_mark_price_tracked_pairs gauge',
            'lunex_margin_mark_price_tracked_pairs 1',
        ].join('\n')),
        resetPriceHealthMonitor: jest.fn().mockReturnValue({
            generatedAt: '2026-03-06T00:00:00.000Z',
            summary: {
                trackedPairs: 0,
                healthyPairs: 0,
                unhealthyPairs: 0,
                hasActiveAlerts: false,
                blockedPairs: 0,
                operationalBlockAfterFailures: 3,
            },
            pairs: [],
        }),
        depositCollateral: jest.fn().mockResolvedValue({ transfer: 'ok' }),
        withdrawCollateral: jest.fn().mockResolvedValue({ transfer: 'ok' }),
        openPosition: jest.fn().mockResolvedValue({ position: 'ok' }),
        closePosition: jest.fn().mockResolvedValue({ overview: 'ok' }),
        liquidatePosition: jest.fn().mockResolvedValue({ overview: 'ok' }),
    },
}));
jest.mock('../../middleware/auth', () => ({
    ...jest.requireActual('../../middleware/auth'),
    verifyAddressSignature: jest.fn().mockResolvedValue(true),
}));
describe('Margin API E2E', () => {
    describe('GET /api/v1/margin', () => {
        it('should return 400 without address query', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).get('/api/v1/margin');
            expect(res.status).toBe(400);
            expect(res.body).toHaveProperty('error');
        });
        it('should return 200 with valid address', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).get('/api/v1/margin?address=test-addr-123');
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('account');
            expect(res.body).toHaveProperty('positions');
        });
    });
    describe('GET /api/v1/margin/price-health', () => {
        it('should return 200 without filters', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).get('/api/v1/margin/price-health');
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('summary');
            expect(res.body).toHaveProperty('pairs');
        });
        it('should return 200 with pair filter', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).get('/api/v1/margin/price-health?pairSymbol=LUNES/USDT');
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('summary');
        });
        it('should return 400 on invalid pair filter', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).get('/api/v1/margin/price-health?pairSymbol=x');
            expect(res.status).toBe(400);
            expect(res.body).toHaveProperty('error');
        });
    });
    describe('POST /api/v1/margin/price-health/reset', () => {
        it('should return 200 without filters', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).post('/api/v1/margin/price-health/reset').send({});
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('summary');
            expect(res.body).toHaveProperty('pairs');
        });
        it('should return 200 with pair filter', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).post('/api/v1/margin/price-health/reset').send({ pairSymbol: 'LUNES/USDT' });
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('summary');
        });
        it('should return 400 on invalid pair filter', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).post('/api/v1/margin/price-health/reset').send({ pairSymbol: 'x' });
            expect(res.status).toBe(400);
            expect(res.body).toHaveProperty('error');
        });
    });
    describe('POST /api/v1/margin/collateral/deposit', () => {
        it('should return 400 on invalid body', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default)
                .post('/api/v1/margin/collateral/deposit')
                .send({});
            expect(res.status).toBe(400);
        });
        it('should return 201 on valid deposit', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default)
                .post('/api/v1/margin/collateral/deposit')
                .send({
                address: 'test-addr-123',
                token: 'USDT',
                amount: '1000',
                signature: 'valid-sig-12345678',
            });
            expect(res.status).toBe(201);
        });
    });
    describe('POST /api/v1/margin/collateral/withdraw', () => {
        it('should return 400 on invalid body', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default)
                .post('/api/v1/margin/collateral/withdraw')
                .send({});
            expect(res.status).toBe(400);
        });
        it('should return 201 on valid withdrawal', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default)
                .post('/api/v1/margin/collateral/withdraw')
                .send({
                address: 'test-addr-123',
                token: 'USDT',
                amount: '500',
                signature: 'valid-sig-12345678',
            });
            expect(res.status).toBe(201);
        });
    });
    describe('POST /api/v1/margin/positions', () => {
        it('should return 400 on invalid body', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default)
                .post('/api/v1/margin/positions')
                .send({});
            expect(res.status).toBe(400);
        });
        it('should return 201 on valid position open', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default)
                .post('/api/v1/margin/positions')
                .send({
                address: 'test-addr-123',
                pairSymbol: 'LUNES/USDT',
                side: 'BUY',
                collateralAmount: '500',
                leverage: '5',
                signature: 'valid-sig-12345678',
            });
            expect(res.status).toBe(201);
        });
    });
    describe('POST /api/v1/margin/positions/:id/close', () => {
        it('should return 400 on invalid body', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default)
                .post('/api/v1/margin/positions/pos-1/close')
                .send({});
            expect(res.status).toBe(400);
        });
        it('should return 200 on valid close', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default)
                .post('/api/v1/margin/positions/pos-1/close')
                .send({
                address: 'test-addr-123',
                signature: 'valid-sig-12345678',
            });
            expect(res.status).toBe(200);
        });
    });
    describe('POST /api/v1/margin/positions/:id/liquidate', () => {
        it('should return 400 on invalid body', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default)
                .post('/api/v1/margin/positions/pos-1/liquidate')
                .send({});
            expect(res.status).toBe(400);
        });
        it('should return 200 on valid liquidation', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default)
                .post('/api/v1/margin/positions/pos-1/liquidate')
                .send({
                liquidatorAddress: 'liquidator-addr-123',
                signature: 'valid-sig-12345678',
            });
            expect(res.status).toBe(200);
        });
    });
});
//# sourceMappingURL=margin.e2e.test.js.map