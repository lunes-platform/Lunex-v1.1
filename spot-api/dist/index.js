"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const crypto_1 = __importDefault(require("crypto"));
const path_1 = __importDefault(require("path"));
const config_1 = require("./config");
const db_1 = __importDefault(require("./db"));
const server_1 = require("./websocket/server");
const orderbookBootstrapService_1 = require("./services/orderbookBootstrapService");
const pagination_1 = require("./middleware/pagination");
const errors_1 = require("./middleware/errors");
const logger_1 = require("./utils/logger");
const metrics_1 = require("./utils/metrics");
const redis_1 = require("./utils/redis");
const vaultReconciliationService_1 = require("./services/vaultReconciliationService");
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
const agents_1 = __importDefault(require("./routes/agents"));
const strategies_1 = __importDefault(require("./routes/strategies"));
const execution_1 = __importDefault(require("./routes/execution"));
const tradeApi_1 = __importDefault(require("./routes/tradeApi"));
const asymmetric_1 = __importDefault(require("./routes/asymmetric"));
const router_1 = __importDefault(require("./routes/router"));
const listing_1 = __importDefault(require("./routes/listing"));
const governance_1 = __importDefault(require("./routes/governance"));
const tokenRegistry_1 = __importDefault(require("./routes/tokenRegistry"));
const favorites_1 = __importDefault(require("./routes/favorites"));
const marketInfo_1 = __importDefault(require("./routes/marketInfo"));
const rewards_1 = __importDefault(require("./routes/rewards"));
const rewardScheduler_1 = require("./services/rewardScheduler");
const settlementService_1 = require("./services/settlementService");
const socialAnalyticsPipeline_1 = require("./services/socialAnalyticsPipeline");
const tradeSettlementService_1 = require("./services/tradeSettlementService");
const marginService_1 = require("./services/marginService");
const rebalancerService_1 = require("./services/rebalancerService");
const strategyService_1 = require("./services/strategyService");
// ─── Startup secrets validation ──────────────────────────────────
// RELAYER_SEED is a Substrate mnemonic / raw seed — treat it like a private key.
// In production it MUST be injected by the deployment platform (e.g. AWS Secrets
// Manager, Kubernetes Secret, Vault agent) and never stored in a committed file.
function assertProductionSecrets() {
    if (!config_1.config.isProd)
        return;
    const DEV_SEEDS = ['//Alice', '//Bob', '//Charlie', '//Dave', '//Eve', '//Ferdie'];
    const relayerSeed = config_1.config.blockchain.relayerSeed;
    if (!relayerSeed) {
        logger_1.log.warn('RELAYER_SEED is not set — on-chain settlement will be disabled');
        return;
    }
    if (DEV_SEEDS.some((dev) => relayerSeed.startsWith(dev))) {
        // A dev seed in production is a critical misconfiguration — crash immediately
        // so ops notices before funds are at risk.
        logger_1.log.error({ relayerSeed: relayerSeed.slice(0, 8) + '...' }, 'FATAL: RELAYER_SEED is a development account — refusing to start in production');
        process.exit(1);
    }
    if (!config_1.config.adminSecret) {
        logger_1.log.error('FATAL: ADMIN_SECRET is not set in production');
        process.exit(1);
    }
    if (config_1.config.adminSecret.length < 32) {
        logger_1.log.error('FATAL: ADMIN_SECRET must be at least 32 characters in production');
        process.exit(1);
    }
}
assertProductionSecrets();
const app = (0, express_1.default)();
// ─── Trust Proxy (required for rate limiting behind nginx/load balancer) ──
if (config_1.config.trustProxy) {
    app.set('trust proxy', 1);
}
// ─── Security Headers ────────────────────────────────────────────
app.use((0, helmet_1.default)({
    contentSecurityPolicy: config_1.config.isProd
        ? {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", 'data:', 'blob:'],
                connectSrc: ["'self'", 'wss:', 'ws:'],
                fontSrc: ["'self'"],
                objectSrc: ["'none'"],
                mediaSrc: ["'none'"],
                frameSrc: ["'none'"],
            },
        }
        : false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
// ─── CORS ────────────────────────────────────────────────────────
// Routes that REQUIRE browser origin (trading, user-facing)
const STRICT_CORS_ROUTES = ['/api/v1/orders', '/api/v1/trades', '/api/v1/trade', '/api/v1/social', '/api/v1/copytrade', '/api/v1/margin'];
const corsOptions = {
    origin: (origin, callback) => {
        const allowed = config_1.config.cors.allowedOrigins;
        // Allow all origins in development or if explicitly set to '*'
        if (allowed.includes('*') || !config_1.config.isProd) {
            return callback(null, true);
        }
        // Allow requests with no origin (server-to-server, CLI, MCP)
        // Only for non-strict routes — strict routes handled by middleware below
        if (!origin)
            return callback(null, true);
        if (allowed.includes(origin)) {
            return callback(null, true);
        }
        callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
    maxAge: 86400,
};
app.use((0, cors_1.default)(corsOptions));
// Strict CORS enforcement: reject no-origin on trading routes in production
if (config_1.config.isProd) {
    for (const route of STRICT_CORS_ROUTES) {
        app.use(route, (req, res, next) => {
            const origin = req.headers.origin;
            if (!origin) {
                return res.status(403).json({ error: 'Origin header required for this endpoint', code: 'CORS_STRICT' });
            }
            next();
        });
    }
}
// ─── Body Parser ─────────────────────────────────────────────────
app.use(express_1.default.json({ limit: '5mb' }));
// ─── Static: token logos ─────────────────────────────────────────
app.use('/tokens', express_1.default.static(path_1.default.join(__dirname, '..', 'public', 'tokens'), {
    maxAge: '7d',
    immutable: true,
}));
// ─── Request ID Tracking ─────────────────────────────────────────
app.use((req, res, next) => {
    const requestId = req.headers['x-request-id'] || crypto_1.default.randomUUID();
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-API-Version', '1.0');
    req.requestId = requestId;
    next();
});
// ─── HTTPS Enforcement (production) ──────────────────────────────
if (config_1.config.isProd) {
    app.use((req, res, next) => {
        if (req.headers['x-forwarded-proto'] !== 'https') {
            return res.redirect(301, `https://${req.headers.host}${req.url}`);
        }
        next();
    });
}
// ─── HTTP Metrics Middleware ─────────────────────────────────────
app.use((req, res, next) => {
    const end = metrics_1.httpRequestDuration.startTimer();
    res.on('finish', () => {
        const route = req.route?.path ?? req.path;
        end({ method: req.method, route, status_code: String(res.statusCode) });
    });
    next();
});
// ─── Rate Limiting ───────────────────────────────────────────────
const apiLimiter = (0, express_rate_limit_1.default)({
    windowMs: config_1.config.rateLimit.windowMs,
    max: config_1.config.rateLimit.maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' },
});
app.use('/api/', apiLimiter);
// Stricter rate limit for order creation / cancellation
const orderLimiter = (0, express_rate_limit_1.default)({
    windowMs: 1000,
    max: config_1.config.rateLimit.orderMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Order rate limit exceeded' },
});
app.use('/api/v1/orders', orderLimiter);
// Swap endpoint rate limit (10 req/s)
const swapLimiter = (0, express_rate_limit_1.default)({
    windowMs: 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Swap rate limit exceeded' },
});
app.use('/api/v1/trade', swapLimiter);
// Agent signal rate limit (5 req/s)
const agentLimiter = (0, express_rate_limit_1.default)({
    windowMs: 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Agent signal rate limit exceeded' },
});
app.use('/api/v1/agents', agentLimiter);
app.use('/api/v1/execution', agentLimiter);
// ─── API Routes ──────────────────────────────────────────────────
app.use('/api/', (0, pagination_1.paginationMiddleware)());
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
app.use('/api/v1/strategies', strategies_1.default);
app.use('/api/v1/execution', execution_1.default);
app.use('/api/v1/trade', tradeApi_1.default);
app.use('/api/v1/asymmetric', asymmetric_1.default);
app.use('/api/v1/route', router_1.default);
app.use('/api/v1/listing', listing_1.default);
app.use('/api/v1/governance', governance_1.default);
app.use('/api/v1/tokens', tokenRegistry_1.default);
app.use('/api/v1/user', favorites_1.default);
app.use('/api/v1/markets', marketInfo_1.default);
app.use('/api/v1/rewards', rewards_1.default);
// ─── Health & Metrics ────────────────────────────────────────────
app.get('/health', async (_req, res) => {
    let dbOk = false;
    let redisOk = false;
    try {
        await db_1.default.$queryRaw `SELECT 1`;
        dbOk = true;
    }
    catch {
        // DB is down
    }
    try {
        redisOk = await (0, redis_1.redisHealthy)();
    }
    catch {
        // Redis is down
    }
    metrics_1.redisHealthy.set(redisOk ? 1 : 0);
    const overallOk = dbOk;
    const status = overallOk ? 'ok' : 'degraded';
    res.status(overallOk ? 200 : 503).json({
        status,
        timestamp: new Date().toISOString(),
        db: dbOk ? 'connected' : 'disconnected',
        redis: redisOk ? 'connected' : 'unavailable',
        marginPriceHealth: marginService_1.marginService.getPriceHealthSummary(),
    });
});
app.get('/metrics', async (_req, res) => {
    try {
        // Update live gauges before scraping
        const [equity, redisOk] = await Promise.all([
            db_1.default.copyVault.aggregate({ _sum: { totalEquity: true } }),
            (0, redis_1.redisHealthy)(),
        ]);
        metrics_1.vaultTotalEquity.set(parseFloat(equity._sum.totalEquity?.toString() ?? '0'));
        metrics_1.redisHealthy.set(redisOk ? 1 : 0);
    }
    catch {
        // Non-fatal — metrics will be stale
    }
    res.setHeader('Content-Type', metrics_1.metricsRegistry.contentType);
    res.send(await metrics_1.metricsRegistry.metrics());
});
// ─── Error Handler (must be AFTER all routes) ────────────────────
app.use((0, errors_1.errorHandler)());
// ─── Startup ─────────────────────────────────────────────────────
let httpServer = null;
async function main() {
    try {
        await db_1.default.$connect();
        logger_1.log.info('Database connected');
        const { restoredOrders, restoredBooks } = await (0, orderbookBootstrapService_1.rehydrateOrderbooks)();
        logger_1.log.info(`Orderbooks rehydrated: ${restoredOrders} orders across ${restoredBooks} books`);
        await settlementService_1.settlementService.ensureReady();
        await rebalancerService_1.rebalancerService.ensureReady();
        const recovery = await tradeSettlementService_1.tradeSettlementService.retryPendingSettlements();
        logger_1.log.info(`Trade settlement recovery: ${recovery.processed} trades (${recovery.settled} settled, ${recovery.failed} failed)`);
        await socialAnalyticsPipeline_1.socialAnalyticsPipeline.start();
        vaultReconciliationService_1.vaultReconciliationService.start();
        setInterval(() => {
            tradeSettlementService_1.tradeSettlementService.retryPendingSettlements().catch((error) => {
                logger_1.log.error({ err: error }, 'Trade settlement retry loop failed');
            });
        }, config_1.config.settlement.retryIntervalMs);
        // ─── Strategy Reputation Engine: sync every 6 h ─────────────
        const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
        const runStrategySyncOnce = async () => {
            try {
                const result = await strategyService_1.strategyService.syncAllLeaderStrategies();
                logger_1.log.info(result, '[StrategySync] reputation scores updated');
            }
            catch (err) {
                logger_1.log.error({ err }, '[StrategySync] sync failed');
            }
        };
        // Run once at startup (non-blocking), then every 6 h
        runStrategySyncOnce();
        setInterval(runStrategySyncOnce, SIX_HOURS_MS);
        // ─── Reward Distribution Scheduler ───────────────────────────
        rewardScheduler_1.rewardScheduler.start();
        httpServer = app.listen(config_1.config.port, () => {
            logger_1.log.info(`Spot API running on http://localhost:${config_1.config.port} [${config_1.config.nodeEnv}]`);
        });
        (0, server_1.createWebSocketServer)(config_1.config.wsPort);
    }
    catch (error) {
        logger_1.log.error({ err: error }, 'Failed to start server');
        process.exit(1);
    }
}
// ─── Graceful Shutdown ───────────────────────────────────────────
async function shutdown(signal) {
    logger_1.log.info(`Received ${signal}, shutting down gracefully...`);
    if (httpServer) {
        httpServer.close(() => {
            logger_1.log.info('HTTP server closed');
        });
    }
    try {
        rewardScheduler_1.rewardScheduler.stop();
        vaultReconciliationService_1.vaultReconciliationService.stop();
        await db_1.default.$disconnect();
        await (0, redis_1.disconnectRedis)();
        logger_1.log.info('Database and Redis disconnected');
    }
    catch (err) {
        logger_1.log.error({ err }, 'Error during shutdown');
    }
    process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
main();
exports.default = app;
//# sourceMappingURL=index.js.map