import { Registry, Counter, Histogram, Gauge } from 'prom-client';
export declare const metricsRegistry: Registry<"text/plain; version=0.0.4; charset=utf-8">;
export declare const httpRequestDuration: Histogram<"route" | "method" | "status_code">;
export declare const tradeExecutionDuration: Histogram<"pair" | "status">;
export declare const tradesTotal: Counter<"pair" | "status">;
export declare const ordersTotal: Counter<"pair" | "side" | "type">;
export declare const blockchainLatestBlock: Gauge<string>;
export declare const blockchainNodeHealthy: Gauge<string>;
export declare const indexerLagBlocks: Gauge<string>;
export declare const indexedEventsTotal: Counter<"method" | "pallet">;
export declare const dbQueryDuration: Histogram<"operation" | "model">;
export declare const redisHealthy: Gauge<string>;
export declare const vaultTotalEquity: Gauge<string>;
export declare const vaultReconciliationRepairs: Counter<string>;
export declare const settlementTotal: Counter<"status">;
export declare const settlementTimeouts: Counter<string>;
//# sourceMappingURL=metrics.d.ts.map