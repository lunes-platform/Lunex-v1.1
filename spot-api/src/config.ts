import dotenv from 'dotenv';
dotenv.config();

function parseCsv(value: string | undefined, fallback: string[]) {
  const normalized = value
    ?.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  return normalized && normalized.length > 0 ? normalized : fallback;
}

const TEST_ADMIN_SECRET = 'test-admin-secret-local-only-000000000001';
const rewardPoolPct = parseInt(process.env.REWARD_POOL_PCT || '20', 10);
const leaderPoolPct = parseInt(process.env.LEADER_POOL_PCT || '40', 10);
const traderPoolPct = parseInt(process.env.TRADER_POOL_PCT || '30', 10);
const stakerPoolPct = parseInt(process.env.STAKER_POOL_PCT || '30', 10);
const rewardSplitTotalPct = leaderPoolPct + traderPoolPct + stakerPoolPct;

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  wsPort: parseInt(process.env.WS_PORT || '4001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  trustProxy: process.env.TRUST_PROXY === 'true',

  cors: {
    allowedOrigins: parseCsv(
      process.env.CORS_ALLOWED_ORIGINS,
      process.env.NODE_ENV === 'production' ? [] : ['*'],
    ),
  },

  websocket: {
    allowedOrigins: parseCsv(
      process.env.ALLOWED_WS_ORIGINS,
      process.env.NODE_ENV === 'production'
        ? []
        : [
            'http://localhost:3000',
            'http://localhost:5173',
            'http://127.0.0.1:3000',
          ],
    ),
  },

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
    // AccountId used by the Spot contract to represent the native LUNES token.
    // Must match the on-chain constant (conventionally all-zero bytes: 0x00...00).
    // Set NATIVE_TOKEN_ADDRESS in .env if the contract uses a different sentinel.
    nativeTokenAddress: process.env.NATIVE_TOKEN_ADDRESS || '',
    // Factory contract — source of truth for pair existence (on-chain validation)
    factoryContractAddress: process.env.FACTORY_CONTRACT_ADDRESS || '',
    factoryContractMetadataPath:
      process.env.FACTORY_CONTRACT_METADATA_PATH || './abis/Factory.json',
  },

  // Admin secret for protected admin routes (pair registration, etc.)
  adminSecret:
    process.env.ADMIN_SECRET ||
    (process.env.NODE_ENV === 'test' ? TEST_ADMIN_SECRET : ''),

  settlement: {
    retryIntervalMs: parseInt(
      process.env.SETTLEMENT_RETRY_INTERVAL_MS || '10000',
      10,
    ),
  },

  socialAnalytics: {
    enabled: process.env.SOCIAL_ANALYTICS_ENABLED === 'true',
    chainName: process.env.SOCIAL_ANALYTICS_CHAIN_NAME || 'lunes',
    startBlock: parseInt(process.env.SOCIAL_ANALYTICS_START_BLOCK || '0', 10),
    backfillBlocks: parseInt(
      process.env.SOCIAL_ANALYTICS_BACKFILL_BLOCKS || '2000',
      10,
    ),
    pollIntervalMs: parseInt(
      process.env.SOCIAL_ANALYTICS_POLL_INTERVAL_MS || '15000',
      10,
    ),
    maxBlocksPerRun: parseInt(
      process.env.SOCIAL_ANALYTICS_MAX_BLOCKS_PER_RUN || '100',
      10,
    ),
    trackedPallets: parseCsv(process.env.SOCIAL_ANALYTICS_TRACKED_PALLETS, [
      'router',
      'factory',
      'pair',
      'market',
      'orders',
      'copytrade',
      'social',
    ]),
    trackedMethods: parseCsv(process.env.SOCIAL_ANALYTICS_TRACKED_METHODS, [
      'swapexecuted',
      'liquidityadded',
      'liquidityremoved',
      'tradeopened',
      'tradeclosed',
      'deposit',
      'withdraw',
    ]),
  },

  margin: {
    markPriceMaxAgeMs: parseInt(
      process.env.MARGIN_MARK_PRICE_MAX_AGE_MS || '120000',
      10,
    ),
    maxBookSpreadBps: parseInt(
      process.env.MARGIN_MAX_BOOK_SPREAD_BPS || '1000',
      10,
    ),
    maxTradeToBookDeviationBps: parseInt(
      process.env.MARGIN_MAX_TRADE_TO_BOOK_DEVIATION_BPS || '500',
      10,
    ),
    operationalBlockAfterFailures: parseInt(
      process.env.MARGIN_OPERATIONAL_BLOCK_AFTER_FAILURES || '3',
      10,
    ),
  },

  subquery: {
    endpoint: process.env.SUBQUERY_ENDPOINT || '',
    // When true, socialIndexerService uses SubQuery GraphQL as primary source
    // instead of polling the blockchain directly via Polkadot.js
    enabled: process.env.SUBQUERY_ENDPOINT
      ? process.env.SUBQUERY_ENABLED !== 'false'
      : false,
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
    nonceTtlSeconds: parseInt(process.env.NONCE_TTL_SECONDS || '300', 10),
  },

  matching: {
    lockTtlMs: parseInt(process.env.MATCHING_LOCK_TTL_MS || '30000', 10),
    lockWaitMs: parseInt(process.env.MATCHING_LOCK_WAIT_MS || '2000', 10),
    lockRetryMs: parseInt(process.env.MATCHING_LOCK_RETRY_MS || '50', 10),
  },

  reconciliation: {
    enabled: process.env.VAULT_RECONCILIATION_ENABLED === 'true',
    intervalMs: parseInt(
      process.env.VAULT_RECONCILIATION_INTERVAL_MS || '60000',
      10,
    ),
  },

  copytrade: {
    walletContinuationSchedulerEnabled:
      process.env.COPYTRADE_WALLET_CONTINUATION_SCHEDULER_ENABLED !== 'false',
    walletContinuationSweepIntervalMs: parseInt(
      process.env.COPYTRADE_WALLET_CONTINUATION_SWEEP_INTERVAL_MS || '60000',
      10,
    ),
    walletContinuationTtlMs: parseInt(
      process.env.COPYTRADE_WALLET_CONTINUATION_TTL_MS || '1800000',
      10,
    ),
  },

  rewards: {
    enabled: process.env.REWARDS_ENABLED === 'true',
    rewardPoolPct,
    leaderPoolPct,
    traderPoolPct,
    stakerPoolPct,
    rewardSplitTotalPct,
    rewardSplitValid: rewardSplitTotalPct === 100,
    treasuryAddress: process.env.TREASURY_ADDRESS || '',
    stakingContractAddress: process.env.STAKING_CONTRACT_ADDRESS || '',
    stakingContractMetadataPath:
      process.env.STAKING_CONTRACT_METADATA_PATH || './abis/Staking.json',
  },

  // Price precision: 10^8 (same as contract)
  PRICE_PRECISION: BigInt(100_000_000),
  FEE_DENOMINATOR: BigInt(10_000),
};
