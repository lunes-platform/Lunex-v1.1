"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const pairs_1 = __importDefault(require("../../routes/pairs"));
const orders_1 = __importDefault(require("../../routes/orders"));
const trades_1 = __importDefault(require("../../routes/trades"));
const candles_1 = __importDefault(require("../../routes/candles"));
const orderbook_1 = __importDefault(require("../../routes/orderbook"));
const social_1 = __importDefault(require("../../routes/social"));
const copytrade_1 = __importDefault(require("../../routes/copytrade"));
const margin_1 = __importDefault(require("../../routes/margin"));
const affiliate_1 = __importDefault(require("../../routes/affiliate"));
const agents_1 = __importDefault(require("../../routes/agents"));
const marginService_1 = require("../../services/marginService");
const app = (0, express_1.default)();
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use('/api/v1/pairs', pairs_1.default);
app.use('/api/v1/orders', orders_1.default);
app.use('/api/v1/trades', trades_1.default);
app.use('/api/v1/candles', candles_1.default);
app.use('/api/v1/orderbook', orderbook_1.default);
app.use('/api/v1/social', social_1.default);
app.use('/api/v1/copytrade', copytrade_1.default);
app.use('/api/v1/margin', margin_1.default);
app.use('/api/v1/affiliate', affiliate_1.default);
app.use('/api/v1/agents', agents_1.default);
app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        marginPriceHealth: marginService_1.marginService.getPriceHealthSummary(),
    });
});
app.get('/metrics', (_req, res) => {
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(marginService_1.marginService.getPriceHealthMetrics());
});
exports.default = app;
//# sourceMappingURL=testApp.js.map