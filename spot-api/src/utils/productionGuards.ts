type ProductionGuardConfig = {
  isProd: boolean;
  nodeEnv: string;
  adminSecret: string;
  cors: {
    allowedOrigins: string[];
  };
  websocket: {
    allowedOrigins: string[];
  };
  blockchain: {
    relayerSeed: string;
    spotContractAddress: string;
    spotContractMetadataPath: string;
    nativeTokenAddress: string;
  };
  redis: {
    url: string;
  };
  matching: {
    lockTtlMs: number;
    lockWaitMs: number;
    lockRetryMs: number;
  };
  rewards: {
    enabled: boolean;
    leaderPoolPct: number;
    traderPoolPct: number;
    stakerPoolPct: number;
    rewardSplitTotalPct: number;
    rewardSplitValid: boolean;
  };
};

const DEV_SEEDS = [
  '//Alice',
  '//Bob',
  '//Charlie',
  '//Dave',
  '//Eve',
  '//Ferdie',
];

export function collectProductionConfigErrors(config: ProductionGuardConfig) {
  if (!config.isProd) return [];

  const errors: string[] = [];

  // NODE_ENV must be explicitly "production" — the matching engine uses this
  // to decide between distributed (Redis) and local in-memory locks. A value
  // like "prod" or "Production" would silently fall through to local locks.
  if (config.nodeEnv !== 'production') {
    errors.push(
      `NODE_ENV must be exactly "production", got "${config.nodeEnv}". ` +
        'Distributed matching locks require NODE_ENV=production.',
    );
  }

  if (!config.adminSecret) {
    errors.push('ADMIN_SECRET is required in production');
  } else if (config.adminSecret.length < 32) {
    errors.push('ADMIN_SECRET must be at least 32 characters in production');
  }

  if (
    config.cors.allowedOrigins.length === 0 ||
    config.cors.allowedOrigins.some(
      (origin) => origin === '*' || origin.includes('*'),
    )
  ) {
    errors.push('Wildcard CORS origins are forbidden in production');
  }

  if (config.websocket.allowedOrigins.length === 0) {
    errors.push('ALLOWED_WS_ORIGINS is required in production');
  } else if (
    config.websocket.allowedOrigins.some(
      (origin) => origin === '*' || origin.includes('*'),
    )
  ) {
    errors.push('Wildcard WebSocket origins are forbidden in production');
  }

  if (!config.blockchain.relayerSeed) {
    errors.push('RELAYER_SEED is required in production');
  } else if (
    DEV_SEEDS.some((devSeed) =>
      config.blockchain.relayerSeed.startsWith(devSeed),
    )
  ) {
    errors.push(
      'RELAYER_SEED must not use a development account in production',
    );
  } else if (
    config.blockchain.relayerSeed.startsWith('REPLACE_WITH_') ||
    config.blockchain.relayerSeed === ''
  ) {
    errors.push(
      'RELAYER_SEED still contains a placeholder value — inject the real seed via secrets manager',
    );
  }

  if (!config.blockchain.spotContractAddress) {
    errors.push('SPOT_CONTRACT_ADDRESS is required in production');
  }

  if (!config.blockchain.spotContractMetadataPath) {
    errors.push('SPOT_CONTRACT_METADATA_PATH is required in production');
  }

  // NATIVE_TOKEN_ADDRESS — the AccountId the spot_settlement contract uses to
  // represent the native LUNES token. Without it, settlementService falls back
  // to AccountId zero with only a log.warn — trades on LUNES pairs would be
  // silently mismatched.
  if (!config.blockchain.nativeTokenAddress) {
    errors.push(
      'NATIVE_TOKEN_ADDRESS is required in production. ' +
        'Set it to the sentinel AccountId used by spot_settlement for native LUNES.',
    );
  }

  if (!config.redis.url) {
    errors.push('REDIS_URL is required in production');
  } else if (
    config.redis.url.includes('127.0.0.1') ||
    config.redis.url.includes('localhost')
  ) {
    errors.push('REDIS_URL must not point to localhost in production');
  }

  if (config.matching.lockTtlMs <= 0) {
    errors.push('MATCHING_LOCK_TTL_MS must be positive in production');
  }

  if (config.matching.lockWaitMs < 0) {
    errors.push('MATCHING_LOCK_WAIT_MS must be non-negative in production');
  }

  if (config.matching.lockRetryMs <= 0) {
    errors.push('MATCHING_LOCK_RETRY_MS must be positive in production');
  }

  // Reward split must sum to 100 — otherwise runWeeklyDistribution would
  // distribute more (or less) than the available pool.
  if (config.rewards.enabled && !config.rewards.rewardSplitValid) {
    const { leaderPoolPct, traderPoolPct, stakerPoolPct, rewardSplitTotalPct } =
      config.rewards;
    errors.push(
      `REWARD split percentages must sum to 100, got ${rewardSplitTotalPct} ` +
        `(leader=${leaderPoolPct}%, trader=${traderPoolPct}%, staker=${stakerPoolPct}%)`,
    );
  }

  return errors;
}
