import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import crypto from 'crypto'
import { config } from './config'
import prisma from './db'
import { createWebSocketServer } from './websocket/server'
import { rehydrateOrderbooks } from './services/orderbookBootstrapService'
import { paginationMiddleware } from './middleware/pagination'
import { errorHandler } from './middleware/errors'
import { log } from './utils/logger'
import { metricsRegistry, httpRequestDuration, redisHealthy as redisHealthyGauge, blockchainLatestBlock, vaultTotalEquity, vaultReconciliationRepairs } from './utils/metrics'
import { redisHealthy, disconnectRedis } from './utils/redis'
import { vaultReconciliationService } from './services/vaultReconciliationService'

// Routes
import pairsRouter from './routes/pairs'
import ordersRouter from './routes/orders'
import tradesRouter from './routes/trades'
import candlesRouter from './routes/candles'
import orderbookRouter from './routes/orderbook'
import socialRouter from './routes/social'
import copytradeRouter from './routes/copytrade'
import marginRouter from './routes/margin'
import affiliateRouter from './routes/affiliate'
import agentsRouter from './routes/agents'
import tradeApiRouter from './routes/tradeApi'
import asymmetricRouter from './routes/asymmetric'
import routerRouter from './routes/router'
import listingRouter from './routes/listing'
import governanceRouter from './routes/governance'
import { settlementService } from './services/settlementService'
import { socialAnalyticsPipeline } from './services/socialAnalyticsPipeline'
import { tradeSettlementService } from './services/tradeSettlementService'
import { marginService } from './services/marginService'
import { rebalancerService } from './services/rebalancerService'

const app = express()

// ─── Trust Proxy (required for rate limiting behind nginx/load balancer) ──
if (config.trustProxy) {
  app.set('trust proxy', 1)
}

// ─── Security Headers ────────────────────────────────────────────
app.use(
  helmet({
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
)

// ─── CORS ────────────────────────────────────────────────────────
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    const allowed = config.cors.allowedOrigins

    // Allow requests with no origin (server-to-server, CLI, MCP)
    if (!origin) return callback(null, true)

    // Allow all origins in development or if explicitly set to '*'
    if (allowed.includes('*') || !config.isProd) {
      return callback(null, true)
    }

    if (allowed.includes(origin)) {
      return callback(null, true)
    }

    callback(new Error(`CORS: origin ${origin} not allowed`))
  },
  credentials: true,
  maxAge: 86400,
}
app.use(cors(corsOptions))

// ─── Body Parser ─────────────────────────────────────────────────
app.use(express.json({ limit: '5mb' }))

// ─── Request ID Tracking ─────────────────────────────────────────
app.use((req, res, next) => {
  const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID()
  res.setHeader('X-Request-Id', requestId)
  res.setHeader('X-API-Version', '1.0')
    ; (req as any).requestId = requestId
  next()
})

// ─── HTTPS Enforcement (production) ──────────────────────────────
if (config.isProd) {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`)
    }
    next()
  })
}

// ─── HTTP Metrics Middleware ─────────────────────────────────────
app.use((req, res, next) => {
  const end = httpRequestDuration.startTimer()
  res.on('finish', () => {
    const route = (req.route?.path as string | undefined) ?? req.path
    end({ method: req.method, route, status_code: String(res.statusCode) })
  })
  next()
})

// ─── Rate Limiting ───────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
})
app.use('/api/', apiLimiter)

// Stricter rate limit for order creation
const orderLimiter = rateLimit({
  windowMs: 1000, // 1 second
  max: config.rateLimit.orderMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Order rate limit exceeded' },
})
app.use('/api/v1/orders', orderLimiter)

// ─── API Routes ──────────────────────────────────────────────────
app.use('/api/', paginationMiddleware())
app.use('/api/v1/pairs', pairsRouter)
app.use('/api/v1/orders', ordersRouter)
app.use('/api/v1/trades', tradesRouter)
app.use('/api/v1/candles', candlesRouter)
app.use('/api/v1/orderbook', orderbookRouter)
app.use('/api/v1/social', socialRouter)
app.use('/api/v1/copytrade', copytradeRouter)
app.use('/api/v1/margin', marginRouter)
app.use('/api/v1/affiliate', affiliateRouter)
app.use('/api/v1/agents', agentsRouter)
app.use('/api/v1/trade', tradeApiRouter)
app.use('/api/v1/asymmetric', asymmetricRouter)
app.use('/api/v1/route', routerRouter)
app.use('/api/v1/listing', listingRouter)
app.use('/api/v1/governance', governanceRouter)

// ─── Health & Metrics ────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  let dbOk = false
  let redisOk = false
  try {
    await prisma.$queryRaw`SELECT 1`
    dbOk = true
  } catch {
    // DB is down
  }
  try {
    redisOk = await redisHealthy()
  } catch {
    // Redis is down
  }

  redisHealthyGauge.set(redisOk ? 1 : 0)

  const overallOk = dbOk
  const status = overallOk ? 'ok' : 'degraded'
  res.status(overallOk ? 200 : 503).json({
    status,
    timestamp: new Date().toISOString(),
    db: dbOk ? 'connected' : 'disconnected',
    redis: redisOk ? 'connected' : 'unavailable',
    marginPriceHealth: marginService.getPriceHealthSummary(),
  })
})

app.get('/metrics', async (_req, res) => {
  try {
    // Update live gauges before scraping
    const [equity, redisOk] = await Promise.all([
      prisma.copyVault.aggregate({ _sum: { totalEquity: true } }),
      redisHealthy(),
    ])
    vaultTotalEquity.set(parseFloat(equity._sum.totalEquity?.toString() ?? '0'))
    redisHealthyGauge.set(redisOk ? 1 : 0)
  } catch {
    // Non-fatal — metrics will be stale
  }

  res.setHeader('Content-Type', metricsRegistry.contentType)
  res.send(await metricsRegistry.metrics())
})

// ─── Error Handler (must be AFTER all routes) ────────────────────
app.use(errorHandler())

// ─── Startup ─────────────────────────────────────────────────────
let httpServer: ReturnType<typeof app.listen> | null = null

async function main() {
  try {
    await prisma.$connect()
    log.info('Database connected')

    const { restoredOrders, restoredBooks } = await rehydrateOrderbooks()
    log.info(`Orderbooks rehydrated: ${restoredOrders} orders across ${restoredBooks} books`)

    await settlementService.ensureReady()
    await rebalancerService.ensureReady()

    const recovery = await tradeSettlementService.retryPendingSettlements()
    log.info(
      `Trade settlement recovery: ${recovery.processed} trades (${recovery.settled} settled, ${recovery.failed} failed)`,
    )

    await socialAnalyticsPipeline.start()
    vaultReconciliationService.start()

    setInterval(() => {
      tradeSettlementService.retryPendingSettlements().catch((error) => {
        log.error({ err: error }, 'Trade settlement retry loop failed')
      })
    }, config.settlement.retryIntervalMs)

    httpServer = app.listen(config.port, () => {
      log.info(`Spot API running on http://localhost:${config.port} [${config.nodeEnv}]`)
    })

    createWebSocketServer(config.wsPort)
  } catch (error) {
    log.error({ err: error }, 'Failed to start server')
    process.exit(1)
  }
}

// ─── Graceful Shutdown ───────────────────────────────────────────
async function shutdown(signal: string) {
  log.info(`Received ${signal}, shutting down gracefully...`)

  if (httpServer) {
    httpServer.close(() => {
      log.info('HTTP server closed')
    })
  }

  try {
    vaultReconciliationService.stop()
    await prisma.$disconnect()
    await disconnectRedis()
    log.info('Database and Redis disconnected')
  } catch (err) {
    log.error({ err }, 'Error during shutdown')
  }

  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

main()

export default app
