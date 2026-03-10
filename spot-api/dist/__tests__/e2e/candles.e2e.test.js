"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const testApp_1 = __importDefault(require("./testApp"));
jest.mock('../../services/candleService', () => ({
    candleService: {
        getCandles: jest.fn().mockResolvedValue([]),
    },
}));
describe('Candles API E2E', () => {
    describe('GET /api/v1/candles/:symbol', () => {
        it('should return empty candles with default params', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).get('/api/v1/candles/LUNES-USDT');
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('candles');
            expect(Array.isArray(res.body.candles)).toBe(true);
        });
        it('should accept timeframe and limit params', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).get('/api/v1/candles/LUNES-USDT?timeframe=4h&limit=100');
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('candles');
        });
        it('should use default timeframe when invalid', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).get('/api/v1/candles/LUNES-USDT?timeframe=invalid');
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('candles');
        });
    });
});
//# sourceMappingURL=candles.e2e.test.js.map