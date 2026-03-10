"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const testApp_1 = __importDefault(require("./testApp"));
jest.mock('../../utils/orderbook', () => ({
    orderbookManager: {
        get: jest.fn().mockReturnValue(null),
    },
}));
describe('Orderbook API E2E', () => {
    describe('GET /api/v1/orderbook/:symbol', () => {
        it('should return empty book when no orderbook exists', async () => {
            const res = await (0, supertest_1.default)(testApp_1.default).get('/api/v1/orderbook/LUNES-USDT');
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('bids');
            expect(res.body).toHaveProperty('asks');
            expect(res.body.bids).toEqual([]);
            expect(res.body.asks).toEqual([]);
        });
        it('should return book data when orderbook exists', async () => {
            const { orderbookManager } = require('../../utils/orderbook');
            orderbookManager.get.mockReturnValueOnce({
                getSnapshot: jest.fn().mockReturnValue({
                    bids: [{ price: 100, amount: 5 }],
                    asks: [{ price: 101, amount: 3 }],
                }),
                getSpread: jest.fn().mockReturnValue(1),
                getBestBid: jest.fn().mockReturnValue(100),
                getBestAsk: jest.fn().mockReturnValue(101),
            });
            const res = await (0, supertest_1.default)(testApp_1.default).get('/api/v1/orderbook/LUNES-USDT?depth=10');
            expect(res.status).toBe(200);
            expect(res.body.bids).toHaveLength(1);
            expect(res.body.asks).toHaveLength(1);
            expect(res.body).toHaveProperty('spread', 1);
            expect(res.body).toHaveProperty('bestBid', 100);
            expect(res.body).toHaveProperty('bestAsk', 101);
        });
    });
});
//# sourceMappingURL=orderbook.e2e.test.js.map