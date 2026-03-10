"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const config_1 = require("./config");
const db_1 = __importDefault(require("./db"));
const server_1 = require("./websocket/server");
const orderbookBootstrapService_1 = require("./services/orderbookBootstrapService");
// Routes
const pairs_1 = __importDefault(require("./routes/pairs"));
const orders_1 = __importDefault(require("./routes/orders"));
const trades_1 = __importDefault(require("./routes/trades"));
const candles_1 = __importDefault(require("./routes/candles"));
const orderbook_1 = __importDefault(require("./routes/orderbook"));
const social_1 = __importDefault(require("./routes/social"));
const copytrade_1 = __importDefault(require("./routes/copytrade"));
const margin_1 = __importDefault(require("./routes/margin"));
const affiliate_1 = __importDefault(require("./routes/affiliate"));
const settlementService_1 = require("./services/settlementService");
const socialAnalyticsPipeline_1 = require("./services/socialAnalyticsPipeline");
const tradeSettlementService_1 = require("./services/tradeSettlementService");
const marginService_1 = require("./services/marginService");
const app = (0, express_1.default)();
// Middleware
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '5mb' }));
// Rate limiting
const apiLimiter = (0, express_rate_limit_1.default)({
    windowMs: config_1.config.rateLimit.windowMs,
    max: config_1.config.rateLimit.maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' },
});
app.use('/api/', apiLimiter);
// Stricter rate limit for order creation
const orderLimiter = (0, express_rate_limit_1.default)({
    windowMs: 1000, // 1 second
    max: config_1.config.rateLimit.orderMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Order rate limit exceeded' },
});
app.use('/api/v1/orders', orderLimiter);
// API Routes
app.use('/api/v1/pairs', pairs_1.default);
app.use('/api/v1/orders', orders_1.default);
app.use('/api/v1/trades', trades_1.default);
app.use('/api/v1/candles', candles_1.default);
app.use('/api/v1/orderbook', orderbook_1.default);
app.use('/api/v1/social', social_1.default);
app.use('/api/v1/copytrade', copytrade_1.default);
app.use('/api/v1/margin', margin_1.default);
app.use('/api/v1/affiliate', affiliate_1.default);
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
async function main() {
    try {
        await db_1.default.$connect();
        console.log('Database connected');
        const { restoredOrders, restoredBooks } = await (0, orderbookBootstrapService_1.rehydrateOrderbooks)();
        console.log(`Orderbooks rehydrated: ${restoredOrders} orders across ${restoredBooks} books`);
        await settlementService_1.settlementService.ensureReady();
        const recovery = await tradeSettlementService_1.tradeSettlementService.retryPendingSettlements();
        console.log(`Trade settlement recovery processed ${recovery.processed} trades (${recovery.settled} settled, ${recovery.failed} failed)`);
        await socialAnalyticsPipeline_1.socialAnalyticsPipeline.start();
        setInterval(() => {
            tradeSettlementService_1.tradeSettlementService.retryPendingSettlements().catch((error) => {
                console.error('Trade settlement retry loop failed:', error);
            });
        }, config_1.config.settlement.retryIntervalMs);
        app.listen(config_1.config.port, () => {
            console.log(`Spot API running on http://localhost:${config_1.config.port}`);
        });
        (0, server_1.createWebSocketServer)(config_1.config.wsPort);
    }
    catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}
main();
exports.default = app;
//# sourceMappingURL=index.js.map