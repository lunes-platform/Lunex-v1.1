type ProductionGuardConfig = {
  isProd: boolean;
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
  };
  redis: {
    url: string;
  };
  matching: {
    lockTtlMs: number;
    lockWaitMs: number;
    lockRetryMs: number;
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
  }

  if (!config.blockchain.spotContractAddress) {
    errors.push('SPOT_CONTRACT_ADDRESS is required in production');
  }

  if (!config.blockchain.spotContractMetadataPath) {
    errors.push('SPOT_CONTRACT_METADATA_PATH is required in production');
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

  return errors;
}
