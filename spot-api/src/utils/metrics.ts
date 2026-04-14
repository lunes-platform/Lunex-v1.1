import {
  Registry,
  Histogram,
  Gauge,
  Counter,
  collectDefaultMetrics,
} from 'prom-client';

export const metricsRegistry = new Registry();

collectDefaultMetrics({ register: metricsRegistry, prefix: 'lunex_' });

// ─── API Latency ─────────────────────────────────────────────────
export const httpRequestDuration = new Histogram({
  name: 'lunex_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [metricsRegistry],
});

// ─── Redis ───────────────────────────────────────────────────────
export const redisHealthy = new Gauge({
  name: 'lunex_redis_healthy',
  help: '1 if Redis is reachable, 0 otherwise',
  registers: [metricsRegistry],
});

export const dbHealthy = new Gauge({
  name: 'lunex_db_healthy',
  help: '1 if PostgreSQL is reachable, 0 otherwise',
  registers: [metricsRegistry],
});

export const pendingSettlements = new Gauge({
  name: 'lunex_pending_settlements',
  help: 'Number of trades pending settlement lifecycle completion',
  registers: [metricsRegistry],
});

export const blockchainConnected = new Gauge({
  name: 'lunex_blockchain_connected',
  help: '1 if settlement on-chain connectivity is ready, 0 otherwise',
  registers: [metricsRegistry],
});

export const wsConnections = new Gauge({
  name: 'lunex_ws_connections',
  help: 'Current number of active WebSocket client connections',
  registers: [metricsRegistry],
});

// ─── Copy Vaults ─────────────────────────────────────────────────
export const vaultTotalEquity = new Gauge({
  name: 'lunex_vault_total_equity',
  help: 'Total equity in all CopyVaults (USDT)',
  registers: [metricsRegistry],
});

export const copytradeWalletContinuationsPending = new Gauge({
  name: 'lunex_copytrade_wallet_continuations_pending',
  help: 'Current number of copytrade wallet-assisted continuations waiting confirmation',
  registers: [metricsRegistry],
});

export const copytradeWalletContinuationsExpiredTotal = new Counter({
  name: 'lunex_copytrade_wallet_continuations_expired_total',
  help: 'Total expired copytrade wallet-assisted continuations',
  registers: [metricsRegistry],
});
