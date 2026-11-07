import type { TrustProxySetting } from './trustProxy';

type ProductionGuardConfig = {
  isProd: boolean;
  nodeEnv: string;
  adminSecret: string;
  trustProxy: TrustProxySetting;
  publicApiOrigin: string;
  signing: {
    domain: string;
    genesisHash: string;
    acceptLegacy: boolean;
  };
  settlement: {
    attestorSeed: string;
  };
  session: {
    secret: string;
  };
  cors: {
    allowedOrigins: string[];
  };
  websocket: {
    allowedOrigins: string[];
  };
  blockchain: {
    wsUrl: string;
    relayerSeed: string;
    spotContractAddress: string;
    spotContractMetadataPath: string;
    nativeTokenAddress: string;
    factoryContractAddress: string;
  };
  bridge: {
    adminSeed: string;
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
    treasuryAddress: string;
    stakingContractAddress: string;
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

// Well-known Substrate development mnemonic. Any seed built from it (with or
// without a //Alice-style derivation) has a publicly known private key.
const DEV_PHRASE =
  'bottom drive obey lake curtain smoke basket hold race lonely fit walk';

// Raw 32-byte secret seeds of well-known dev keys (`subkey inspect`), for
// configs that inject the hex seed instead of the URI. Each value is checked
// in productionGuards.hardening.test.ts against the address it derives.
const DEV_RAW_SEEDS = [
  // DEV_PHRASE itself (5DfhGyQdFobKM8NsWvEeAKk5EQQgYe9AydgJ7rMB6E1EqRzV)
  '0xfac7959dbfe72f052e5a0c3c8d6530f202b02fd8f9f5ca3580ec8deb7797479e',
  // //Alice (5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY)
  '0xe5be9a5092b81bca64be81d212e7f2f9eba183bb7a90954f7b76361f6edb5c0a',
  // //Bob (5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty)
  '0x398f0c28f98885e046333d4a41c19cee4c37368a9832c6502f6cfd182e2aef89',
];

export const DEV_RAW_SEEDS_FOR_TESTS = DEV_RAW_SEEDS;

const DEV_DERIVATION = new RegExp(
  `//(${DEV_SEEDS.map((seed) => seed.slice(2)).join('|')})(?![a-z0-9])`,
  'i',
);

/**
 * True for any seed whose key is publicly known: a `//Alice`-style dev
 * derivation anywhere in the string (also `<mnemonic>//Alice`), the
 * well-known dev mnemonic in any casing/spacing, or a raw dev seed.
 */
export function isDevSeed(value: string) {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized) return false;
  if (DEV_DERIVATION.test(normalized)) return true;
  if (normalized.startsWith(DEV_PHRASE)) return true;
  return DEV_RAW_SEEDS.some((seed) => normalized.startsWith(seed));
}

const GENESIS_HASH_RE = /^0x[0-9a-f]{64}$/;
const SIGNING_DOMAIN_RE = /^[a-z0-9.-]+$/;
const KNOWN_NODE_ENVS = new Set(['development', 'test', 'production']);

export function isPlaceholder(value: string) {
  return value.startsWith('REPLACE_WITH_');
}

export function isLocalEndpoint(value: string) {
  return (
    value.includes('127.0.0.1') ||
    value.includes('localhost') ||
    value.includes('0.0.0.0')
  );
}

export function collectProductionConfigErrors(config: ProductionGuardConfig) {
  const errors: string[] = [];

  // Fail closed on an unknown NODE_ENV even if a caller computed isProd=false.
  if (!KNOWN_NODE_ENVS.has(config.nodeEnv)) {
    errors.push(
      `NODE_ENV must be exactly "production", "development" or "test", got "${config.nodeEnv}"`,
    );
  }

  if (!config.isProd) return errors;

  // NODE_ENV must be explicitly "production" — the matching engine uses this
  // to decide between distributed (Redis) and local in-memory locks. A value
  // like "prod" or "Production" would silently fall through to local locks.
  if (config.nodeEnv !== 'production' && KNOWN_NODE_ENVS.has(config.nodeEnv)) {
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

  if (!config.session.secret) {
    errors.push('SESSION_SECRET is required in production');
  } else if (config.session.secret.length < 32) {
    errors.push('SESSION_SECRET must be at least 32 characters in production');
  } else if (config.session.secret === config.adminSecret) {
    errors.push('SESSION_SECRET must differ from ADMIN_SECRET');
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

  if (!config.blockchain.wsUrl) {
    errors.push('LUNES_WS_URL is required in production');
  } else if (isLocalEndpoint(config.blockchain.wsUrl)) {
    errors.push('LUNES_WS_URL must not point to localhost in production');
  }

  if (!config.blockchain.relayerSeed) {
    errors.push('RELAYER_SEED is required in production');
  } else if (isDevSeed(config.blockchain.relayerSeed)) {
    errors.push(
      'RELAYER_SEED must not use a development account in production',
    );
  } else if (isPlaceholder(config.blockchain.relayerSeed)) {
    errors.push(
      'RELAYER_SEED still contains a placeholder value — inject the real seed via secrets manager',
    );
  }

  if (!config.bridge.adminSeed) {
    errors.push('BRIDGE_ADMIN_SEED is required in production');
  } else if (isDevSeed(config.bridge.adminSeed)) {
    errors.push(
      'BRIDGE_ADMIN_SEED must not use a development account in production',
    );
  } else if (isPlaceholder(config.bridge.adminSeed)) {
    errors.push(
      'BRIDGE_ADMIN_SEED still contains a placeholder value — inject the real seed via secrets manager',
    );
  }

  if (!config.settlement.attestorSeed) {
    errors.push('ATTESTOR_SEED is required in production');
  } else if (config.settlement.attestorSeed === config.blockchain.relayerSeed) {
    errors.push(
      'ATTESTOR_SEED must differ from RELAYER_SEED (2-of-2 settlement, ADR-001)',
    );
  } else if (isDevSeed(config.settlement.attestorSeed)) {
    errors.push(
      'ATTESTOR_SEED must not use a development account in production',
    );
  }

  if (config.trustProxy === false) {
    errors.push(
      'TRUST_PROXY must be set in production to the proxy hop count (e.g. 1 for nginx, 2 for Cloudflare → nginx) or a trusted proxy CIDR list',
    );
  }

  if (!config.publicApiOrigin) {
    errors.push(
      'PUBLIC_API_ORIGIN is required in production (canonical https origin used by the HTTPS redirect)',
    );
  } else {
    let origin: URL | null = null;
    try {
      origin = new URL(config.publicApiOrigin);
    } catch {
      origin = null;
    }
    if (
      !origin ||
      origin.protocol !== 'https:' ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash ||
      origin.username ||
      origin.password
    ) {
      errors.push(
        'PUBLIC_API_ORIGIN must be a bare https origin (e.g. https://api.lunex.io)',
      );
    }
  }

  if (!config.signing.domain) {
    errors.push('SIGNING_DOMAIN is required in production');
  } else if (!SIGNING_DOMAIN_RE.test(config.signing.domain)) {
    errors.push(
      'SIGNING_DOMAIN must be a bare hostname (no scheme, port or path)',
    );
  }

  if (!GENESIS_HASH_RE.test(config.signing.genesisHash)) {
    errors.push(
      'LUNES_GENESIS_HASH is required in production (0x + 64 hex of the chain genesis block)',
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

  if (!config.blockchain.factoryContractAddress) {
    errors.push('FACTORY_CONTRACT_ADDRESS is required in production');
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

  if (config.rewards.enabled && !config.rewards.treasuryAddress) {
    errors.push('TREASURY_ADDRESS is required when rewards are enabled');
  }

  if (config.rewards.enabled && !config.rewards.stakingContractAddress) {
    errors.push(
      'STAKING_CONTRACT_ADDRESS is required when rewards are enabled',
    );
  }

  return errors;
}
