"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
function parseCsv(value, fallback) {
    const normalized = value
        ?.split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
    return normalized && normalized.length > 0 ? normalized : fallback;
}
exports.config = {
    port: parseInt(process.env.PORT || '4000', 10),
    wsPort: parseInt(process.env.WS_PORT || '4001', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    rateLimit: {
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
        maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
        orderMax: parseInt(process.env.ORDER_RATE_LIMIT_MAX || '10', 10),
    },
    blockchain: {
        wsUrl: process.env.LUNES_WS_URL || 'ws://127.0.0.1:9944',
        spotContractAddress: process.env.SPOT_CONTRACT_ADDRESS || '',
        spotContractMetadataPath: process.env.SPOT_CONTRACT_METADATA_PATH || '',
        relayerSeed: process.env.RELAYER_SEED || '',
    },
    settlement: {
        retryIntervalMs: parseInt(process.env.SETTLEMENT_RETRY_INTERVAL_MS || '10000', 10),
    },
    socialAnalytics: {
        enabled: process.env.SOCIAL_ANALYTICS_ENABLED === 'true',
        chainName: process.env.SOCIAL_ANALYTICS_CHAIN_NAME || 'lunes',
        startBlock: parseInt(process.env.SOCIAL_ANALYTICS_START_BLOCK || '0', 10),
        backfillBlocks: parseInt(process.env.SOCIAL_ANALYTICS_BACKFILL_BLOCKS || '2000', 10),
        pollIntervalMs: parseInt(process.env.SOCIAL_ANALYTICS_POLL_INTERVAL_MS || '15000', 10),
        maxBlocksPerRun: parseInt(process.env.SOCIAL_ANALYTICS_MAX_BLOCKS_PER_RUN || '100', 10),
        trackedPallets: parseCsv(process.env.SOCIAL_ANALYTICS_TRACKED_PALLETS, ['router', 'factory', 'pair', 'market', 'orders', 'copytrade', 'social']),
        trackedMethods: parseCsv(process.env.SOCIAL_ANALYTICS_TRACKED_METHODS, ['swapexecuted', 'liquidityadded', 'liquidityremoved', 'tradeopened', 'tradeclosed', 'deposit', 'withdraw']),
    },
    margin: {
        markPriceMaxAgeMs: parseInt(process.env.MARGIN_MARK_PRICE_MAX_AGE_MS || '120000', 10),
        maxBookSpreadBps: parseInt(process.env.MARGIN_MAX_BOOK_SPREAD_BPS || '1000', 10),
        maxTradeToBookDeviationBps: parseInt(process.env.MARGIN_MAX_TRADE_TO_BOOK_DEVIATION_BPS || '500', 10),
        operationalBlockAfterFailures: parseInt(process.env.MARGIN_OPERATIONAL_BLOCK_AFTER_FAILURES || '3', 10),
    },
    // Price precision: 10^8 (same as contract)
    PRICE_PRECISION: BigInt(100000000),
    FEE_DENOMINATOR: BigInt(10000),
};
//# sourceMappingURL=config.js.map