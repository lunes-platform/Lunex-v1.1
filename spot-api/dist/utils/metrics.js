"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.settlementTimeouts = exports.settlementTotal = exports.vaultReconciliationRepairs = exports.vaultTotalEquity = exports.redisHealthy = exports.dbQueryDuration = exports.indexedEventsTotal = exports.indexerLagBlocks = exports.blockchainNodeHealthy = exports.blockchainLatestBlock = exports.ordersTotal = exports.tradesTotal = exports.tradeExecutionDuration = exports.httpRequestDuration = exports.metricsRegistry = void 0;
const prom_client_1 = require("prom-client");
exports.metricsRegistry = new prom_client_1.Registry();
(0, prom_client_1.collectDefaultMetrics)({ register: exports.metricsRegistry, prefix: 'lunex_' });
// ─── API Latency ─────────────────────────────────────────────────
exports.httpRequestDuration = new prom_client_1.Histogram({
    name: 'lunex_http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [exports.metricsRegistry],
});
// ─── Trade Execution ─────────────────────────────────────────────
exports.tradeExecutionDuration = new prom_client_1.Histogram({
    name: 'lunex_trade_execution_duration_seconds',
    help: 'Time to execute and settle a trade on-chain',
    labelNames: ['pair', 'status'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
    registers: [exports.metricsRegistry],
});
exports.tradesTotal = new prom_client_1.Counter({
    name: 'lunex_trades_total',
    help: 'Total number of trades processed',
    labelNames: ['pair', 'status'],
    registers: [exports.metricsRegistry],
});
// ─── Orderbook ───────────────────────────────────────────────────
exports.ordersTotal = new prom_client_1.Counter({
    name: 'lunex_orders_total',
    help: 'Total number of orders placed',
    labelNames: ['pair', 'side', 'type'],
    registers: [exports.metricsRegistry],
});
// ─── Blockchain Node ─────────────────────────────────────────────
exports.blockchainLatestBlock = new prom_client_1.Gauge({
    name: 'lunex_blockchain_latest_block',
    help: 'Latest block number processed by the indexer',
    registers: [exports.metricsRegistry],
});
exports.blockchainNodeHealthy = new prom_client_1.Gauge({
    name: 'lunex_blockchain_node_healthy',
    help: '1 if the blockchain node is reachable, 0 otherwise',
    registers: [exports.metricsRegistry],
});
// ─── Indexer ─────────────────────────────────────────────────────
exports.indexerLagBlocks = new prom_client_1.Gauge({
    name: 'lunex_indexer_lag_blocks',
    help: 'Number of blocks the indexer is behind the chain head',
    registers: [exports.metricsRegistry],
});
exports.indexedEventsTotal = new prom_client_1.Counter({
    name: 'lunex_indexed_events_total',
    help: 'Total on-chain events indexed by the social analytics indexer',
    labelNames: ['pallet', 'method'],
    registers: [exports.metricsRegistry],
});
// ─── Database ────────────────────────────────────────────────────
exports.dbQueryDuration = new prom_client_1.Histogram({
    name: 'lunex_db_query_duration_seconds',
    help: 'Prisma database query duration in seconds',
    labelNames: ['operation', 'model'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
    registers: [exports.metricsRegistry],
});
// ─── Redis ───────────────────────────────────────────────────────
exports.redisHealthy = new prom_client_1.Gauge({
    name: 'lunex_redis_healthy',
    help: '1 if Redis is reachable, 0 otherwise',
    registers: [exports.metricsRegistry],
});
// ─── Copy Vaults ─────────────────────────────────────────────────
exports.vaultTotalEquity = new prom_client_1.Gauge({
    name: 'lunex_vault_total_equity',
    help: 'Total equity in all CopyVaults (USDT)',
    registers: [exports.metricsRegistry],
});
exports.vaultReconciliationRepairs = new prom_client_1.Counter({
    name: 'lunex_vault_reconciliation_repairs_total',
    help: 'Total number of vault equity repairs performed by the reconciliation job',
    registers: [exports.metricsRegistry],
});
// ─── Settlement ──────────────────────────────────────────────────
exports.settlementTotal = new prom_client_1.Counter({
    name: 'lunex_settlement_total',
    help: 'Total on-chain settlement attempts',
    labelNames: ['status'],
    registers: [exports.metricsRegistry],
});
exports.settlementTimeouts = new prom_client_1.Counter({
    name: 'lunex_settlement_timeouts_total',
    help: 'Total signAndSend timeout errors during settlement',
    registers: [exports.metricsRegistry],
});
//# sourceMappingURL=metrics.js.map