import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import path from 'path';
import { config } from './config';
import prisma from './db';
import { createWebSocketServer } from './websocket/server';
import { rehydrateOrderbooks } from './services/orderbookBootstrapService';
import { paginationMiddleware } from './middleware/pagination';
import { errorHandler } from './middleware/errors';
import { requireAdminOrInternal } from './middleware/adminGuard';
import { securityShield } from './middleware/securityShield';
import { responseSanitizer } from './middleware/responseSanitizer';
import { log } from './utils/logger';
import {
  metricsRegistry,
  httpRequestDuration,
  redisHealthy as redisHealthyGauge,
  dbHealthy as dbHealthyGauge,
  pendingSettlements as pendingSettlementsGauge,
  blockchainConnected as blockchainConnectedGauge,
  vaultTotalEquity,
  copytradeWalletContinuationsPending,
} from './utils/metrics';
import { redisHealthy, disconnectRedis } from './utils/redis';
import { vaultReconciliationService } from './services/vaultReconciliationService';
import { collectProductionConfigErrors } from './utils/productionGuards';

// Routes
import pairsRouter from './routes/pairs';
import ordersRouter from './routes/orders';
import tradesRouter from './routes/trades';
import candlesRouter from './routes/candles';
import orderbookRouter from './routes/orderbook';
import socialRouter from './routes/social';
import copytradeRouter from './routes/copytrade';
import marginRouter from './routes/margin';
import affiliateRouter from './routes/affiliate';
import agentsRouter from './routes/agents';
import strategiesRouter from './routes/strategies';
import executionRouter from './routes/execution';
import tradeApiRouter from './routes/tradeApi';
import asymmetricRouter from './routes/asymmetric';
import routerRouter from './routes/router';
import listingRouter from './routes/listing';
import governanceRouter from './routes/governance';
import tokenRegistryRouter from './routes/tokenRegistry';
import favoritesRouter from './routes/favorites';
import marketInfoRouter from './routes/marketInfo';
import rewardsRouter from './routes/rewards';
import adminRouter from './routes/admin';
import { rewardScheduler } from './services/rewardScheduler';
import { copytradeWalletContinuationScheduler } from './services/copytradeWalletContinuationScheduler';
import { settlementService } from './services/settlementService';
import { socialAnalyticsPipeline } from './services/socialAnalyticsPipeline';
import { tradeSettlementService } from './services/tradeSettlementService';
import { marginService } from './services/marginService';
import { rebalancerService } from './services/rebalancerService';
import { strategyService } from './services/strategyService';
import { copytradeService } from './services/copytradeService';

// ─── Startup secrets validation ──────────────────────────────────
// RELAYER_SEED is a Substrate mnemonic / raw seed — treat it like a private key.
// In production it MUST be injected by the deployment platform (e.g. AWS Secrets
// Manager, Kubernetes Secret, Vault agent) and never stored in a committed file.
function assertProductionSecrets() {
  const errors = collectProductionConfigErrors(config);
  if (errors.length > 0) {
    for (const error of errors) {
      log.error(`FATAL: ${error}`);
    }
    process.exit(1);
  }
}

assertProductionSecrets();

const app = express();
app.disable('x-powered-by');

// ─── Trust Proxy (required for rate limiting behind nginx/load balancer) ──
if (config.trustProxy) {
  app.set('trust proxy', 1);
}

// ─── Security Headers ────────────────────────────────────────────
app.use(
  helmet({
    hsts: config.isProd
      ? { maxAge: 31536000, includeSubDomains: true, preload: true }
      : false,
    frameguard: { action: 'deny' },
    noSniff: true,
    referrerPolicy: { policy: 'no-referrer' },
    contentSecurityPolicy: config.isProd
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
  }),
);

// ─── Application Shield ──────────────────────────────────────────
app.use(securityShield());
app.use(responseSanitizer());

// ─── CORS ────────────────────────────────────────────────────────
// Routes that REQUIRE browser origin (trading, user-facing)
const STRICT_CORS_ROUTES = [
  '/api/v1/orders',
  '/api/v1/trades',
  '/api/v1/trade',
  '/api/v1/social',
  '/api/v1/copytrade',
  '/api/v1/margin',
];

if (config.isProd && config.cors.allowedOrigins.length === 0) {
  log.error('FATAL: CORS_ALLOWED_ORIGINS must be configured in production');
  process.exit(1);
}

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    const allowed = config.cors.allowedOrigins;

    // Allow all origins in development for local DX.
    if (!config.isProd) {
      return callback(null, true);
    }

    // Allow requests with no origin (server-to-server, CLI, MCP)
    // Only for non-strict routes — strict routes handled by middleware below
    if (!origin) return callback(null, true);

    if (allowed.includes(origin)) {
      return callback(null, true);
    }

    callback(new Error('CORS: origin not allowed'));
  },
  credentials: true,
  maxAge: 86400,
};
app.use(cors(corsOptions));

// Strict CORS enforcement: reject no-origin on trading routes in production
if (config.isProd) {
  for (const route of STRICT_CORS_ROUTES) {
    app.use(route, (req, res, next) => {
      const origin = req.headers.origin;
      const hasApiKey = Boolean(req.headers['x-api-key']);
      const isTrustedMcpClient = req.headers['x-lunex-client'] === 'mcp';
      const signedQuery = req.query as Record<string, unknown>;
      const hasSignedQueryAuth =
        typeof signedQuery.signature === 'string' &&
        typeof signedQuery.nonce === 'string' &&
        signedQuery.timestamp !== undefined;
      if (!origin) {
        // Allow authenticated server-to-server traffic (MCP/agents/CLI) even
        // without browser Origin header.
        if (hasApiKey || hasSignedQueryAuth || isTrustedMcpClient) {
          return next();
        }
        return res.status(403).json({
          error: 'Origin header required for this endpoint',
          code: 'CORS_STRICT',
        });
      }
      next();
    });
  }
}

// ─── Body Parser ─────────────────────────────────────────────────
app.use(express.json({ limit: '5mb' }));

// ─── Static: token logos ─────────────────────────────────────────
app.use(
  '/tokens',
  express.static(path.join(__dirname, '..', 'public', 'tokens'), {
    maxAge: '7d',
    immutable: true,
  }),
);

// ─── Request ID Tracking ─────────────────────────────────────────
app.use((req, res, next) => {
  const requestId =
    (req.headers['x-request-id'] as string) || crypto.randomUUID();
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-API-Version', '1.0');
  (req as any).requestId = requestId;
  next();
});

// ─── HTTPS Enforcement (production) ──────────────────────────────
if (config.isProd) {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

// ─── HTTP Metrics Middleware ─────────────────────────────────────
app.use((req, res, next) => {
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    const route = (req.route?.path as string | undefined) ?? req.path;
    end({ method: req.method, route, status_code: String(res.statusCode) });
  });
  next();
});

// ─── Rate Limiting ───────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});
app.use('/api/', apiLimiter);

// Stricter rate limit for order creation / cancellation
const orderLimiter = rateLimit({
  windowMs: 1000,
  max: config.rateLimit.orderMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Order rate limit exceeded' },
});
app.use('/api/v1/orders', orderLimiter);

// Swap endpoint rate limit (10 req/s)
const swapLimiter = rateLimit({
  windowMs: 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Swap rate limit exceeded' },
});
app.use('/api/v1/trade', swapLimiter);

// Agent signal rate limit (5 req/s)
const agentLimiter = rateLimit({
  windowMs: 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Agent signal rate limit exceeded' },
});
app.use('/api/v1/agents', agentLimiter);
app.use('/api/v1/execution', agentLimiter);

// ─── API Routes ──────────────────────────────────────────────────
app.use('/api/', paginationMiddleware());
app.use('/api/v1/pairs', pairsRouter);
app.use('/api/v1/orders', ordersRouter);
app.use('/api/v1/trades', tradesRouter);
app.use('/api/v1/candles', candlesRouter);
app.use('/api/v1/orderbook', orderbookRouter);
app.use('/api/v1/social', socialRouter);
app.use('/api/v1/copytrade', copytradeRouter);
app.use('/api/v1/margin', marginRouter);
app.use('/api/v1/affiliate', affiliateRouter);
app.use('/api/v1/agents', agentsRouter);
app.use('/api/v1/strategies', strategiesRouter);
app.use('/api/v1/execution', executionRouter);
app.use('/api/v1/trade', tradeApiRouter);
app.use('/api/v1/asymmetric', asymmetricRouter);
app.use('/api/v1/route', routerRouter);
app.use('/api/v1/listing', listingRouter);
app.use('/api/v1/governance', governanceRouter);
app.use('/api/v1/tokens', tokenRegistryRouter);
app.use('/api/v1/user', favoritesRouter);
app.use('/api/v1/markets', marketInfoRouter);
app.use('/api/v1/rewards', rewardsRouter);
app.use('/api/v1/admin', adminRouter);

// ─── Health & Metrics ────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  let dbOk = false;
  let redisOk = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    // DB is down
  }
  try {
    redisOk = await redisHealthy();
  } catch {
    // Redis is down
  }

  dbHealthyGauge.set(dbOk ? 1 : 0);
  redisHealthyGauge.set(redisOk ? 1 : 0);

  const overallOk = dbOk;
  const status = overallOk ? 'ok' : 'degraded';
  res.status(overallOk ? 200 : 503).json({
    status,
    timestamp: new Date().toISOString(),
    db: dbOk ? 'connected' : 'disconnected',
    redis: redisOk ? 'connected' : 'unavailable',
    marginPriceHealth: marginService.getPriceHealthSummary(),
  });
});

app.get('/metrics', requireAdminOrInternal, async (_req, res) => {
  try {
    const [equity, pendingWallet, pendingSettlementsCount] = await Promise.all([
      prisma.copyVault.aggregate({ _sum: { totalEquity: true } }),
      copytradeService.countPendingWalletContinuations(),
      prisma.trade.count({
        where: { settlementStatus: { in: ['PENDING', 'FAILED', 'SETTLING'] } },
      }),
    ]);

    vaultTotalEquity.set(
      parseFloat(equity._sum.totalEquity?.toString() ?? '0'),
    );
    copytradeWalletContinuationsPending.set(pendingWallet.count);
    pendingSettlementsGauge.set(pendingSettlementsCount);
    dbHealthyGauge.set(1);

    try {
      redisHealthyGauge.set((await redisHealthy()) ? 1 : 0);
    } catch {
      redisHealthyGauge.set(0);
    }

    try {
      blockchainConnectedGauge.set(
        (await settlementService.ensureReady()) ? 1 : 0,
      );
    } catch {
      blockchainConnectedGauge.set(0);
    }
  } catch {
    // Non-fatal — scrape still returns metrics with previous values
    dbHealthyGauge.set(0);
  }

  res.setHeader('Content-Type', metricsRegistry.contentType);
  res.send(await metricsRegistry.metrics());
});

// ─── Error Handler (must be AFTER all routes) ────────────────────
app.use(errorHandler());

// ─── Startup ─────────────────────────────────────────────────────
let httpServer: ReturnType<typeof app.listen> | null = null;

async function main() {
  try {
    await prisma.$connect();
    log.info('Database connected');

    const { restoredOrders, restoredBooks } = await rehydrateOrderbooks();
    log.info(
      `Orderbooks rehydrated: ${restoredOrders} orders across ${restoredBooks} books`,
    );

    await settlementService.ensureReady();
    await rebalancerService.ensureReady();

    const recovery = await tradeSettlementService.retryPendingSettlements();
    log.info(
      `Trade settlement recovery: ${recovery.processed} trades (${recovery.settled} settled, ${recovery.failed} failed)`,
    );

    await socialAnalyticsPipeline.start();
    vaultReconciliationService.start();
    copytradeWalletContinuationScheduler.start();

    setInterval(() => {
      tradeSettlementService.retryPendingSettlements().catch((error) => {
        log.error({ err: error }, 'Trade settlement retry loop failed');
      });
    }, config.settlement.retryIntervalMs);

    // ─── Strategy Reputation Engine: sync every 6 h ─────────────
    const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
    const runStrategySyncOnce = async () => {
      try {
        const result = await strategyService.syncAllLeaderStrategies();
        log.info(result, '[StrategySync] reputation scores updated');
      } catch (err) {
        log.error({ err }, '[StrategySync] sync failed');
      }
    };
    // Run once at startup (non-blocking), then every 6 h
    runStrategySyncOnce();
    setInterval(runStrategySyncOnce, SIX_HOURS_MS);

    // ─── Reward Distribution Scheduler ───────────────────────────
    rewardScheduler.start();

    httpServer = app.listen(config.port, () => {
      log.info(
        `Spot API running on http://localhost:${config.port} [${config.nodeEnv}]`,
      );
    });

    createWebSocketServer(config.wsPort);
  } catch (error) {
    log.error({ err: error }, 'Failed to start server');
    process.exit(1);
  }
}

// ─── Graceful Shutdown ───────────────────────────────────────────
async function shutdown(signal: string) {
  log.info(`Received ${signal}, shutting down gracefully...`);

  if (httpServer) {
    httpServer.close(() => {
      log.info('HTTP server closed');
    });
  }

  try {
    rewardScheduler.stop();
    vaultReconciliationService.stop();
    copytradeWalletContinuationScheduler.stop();
    await prisma.$disconnect();
    await disconnectRedis();
    log.info('Database and Redis disconnected');
  } catch (err) {
    log.error({ err }, 'Error during shutdown');
  }

  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main();

export default app;
