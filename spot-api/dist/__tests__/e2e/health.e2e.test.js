"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const testApp_1 = __importDefault(require("./testApp"));
describe('Health Endpoint E2E', () => {
    it('GET /health should return status ok', async () => {
        const res = await (0, supertest_1.default)(testApp_1.default).get('/health');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('status', 'ok');
        expect(res.body).toHaveProperty('timestamp');
        expect(res.body).toHaveProperty('marginPriceHealth');
        expect(res.body.marginPriceHealth).toHaveProperty('trackedPairs');
    });
    it('GET /metrics should expose Prometheus metrics', async () => {
        const res = await (0, supertest_1.default)(testApp_1.default).get('/metrics');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/plain');
        expect(res.text).toContain('lunex_margin_mark_price_tracked_pairs');
    });
});
//# sourceMappingURL=health.e2e.test.js.map