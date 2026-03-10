import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client'

export const metricsRegistry = new Registry()

collectDefaultMetrics({ register: metricsRegistry, prefix: 'lunex_' })

// ─── API Latency ─────────────────────────────────────────────────
export const httpRequestDuration = new Histogram({
  name: 'lunex_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [metricsRegistry],
})

// ─── Trade Execution ─────────────────────────────────────────────
export const tradeExecutionDuration = new Histogram({
  name: 'lunex_trade_execution_duration_seconds',
  help: 'Time to execute and settle a trade on-chain',
  labelNames: ['pair', 'status'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
  registers: [metricsRegistry],
})

export const tradesTotal = new Counter({
  name: 'lunex_trades_total',
  help: 'Total number of trades processed',
  labelNames: ['pair', 'status'],
  registers: [metricsRegistry],
})

// ─── Orderbook ───────────────────────────────────────────────────
export const ordersTotal = new Counter({
  name: 'lunex_orders_total',
  help: 'Total number of orders placed',
  labelNames: ['pair', 'side', 'type'],
  registers: [metricsRegistry],
})

// ─── Blockchain Node ─────────────────────────────────────────────
export const blockchainLatestBlock = new Gauge({
  name: 'lunex_blockchain_latest_block',
  help: 'Latest block number processed by the indexer',
  registers: [metricsRegistry],
})

export const blockchainNodeHealthy = new Gauge({
  name: 'lunex_blockchain_node_healthy',
  help: '1 if the blockchain node is reachable, 0 otherwise',
  registers: [metricsRegistry],
})

// ─── Indexer ─────────────────────────────────────────────────────
export const indexerLagBlocks = new Gauge({
  name: 'lunex_indexer_lag_blocks',
  help: 'Number of blocks the indexer is behind the chain head',
  registers: [metricsRegistry],
})

export const indexedEventsTotal = new Counter({
  name: 'lunex_indexed_events_total',
  help: 'Total on-chain events indexed by the social analytics indexer',
  labelNames: ['pallet', 'method'],
  registers: [metricsRegistry],
})

// ─── Database ────────────────────────────────────────────────────
export const dbQueryDuration = new Histogram({
  name: 'lunex_db_query_duration_seconds',
  help: 'Prisma database query duration in seconds',
  labelNames: ['operation', 'model'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  registers: [metricsRegistry],
})

// ─── Redis ───────────────────────────────────────────────────────
export const redisHealthy = new Gauge({
  name: 'lunex_redis_healthy',
  help: '1 if Redis is reachable, 0 otherwise',
  registers: [metricsRegistry],
})

// ─── Copy Vaults ─────────────────────────────────────────────────
export const vaultTotalEquity = new Gauge({
  name: 'lunex_vault_total_equity',
  help: 'Total equity in all CopyVaults (USDT)',
  registers: [metricsRegistry],
})

export const vaultReconciliationRepairs = new Counter({
  name: 'lunex_vault_reconciliation_repairs_total',
  help: 'Total number of vault equity repairs performed by the reconciliation job',
  registers: [metricsRegistry],
})

// ─── Settlement ──────────────────────────────────────────────────
export const settlementTotal = new Counter({
  name: 'lunex_settlement_total',
  help: 'Total on-chain settlement attempts',
  labelNames: ['status'],
  registers: [metricsRegistry],
})

export const settlementTimeouts = new Counter({
  name: 'lunex_settlement_timeouts_total',
  help: 'Total signAndSend timeout errors during settlement',
  registers: [metricsRegistry],
})
