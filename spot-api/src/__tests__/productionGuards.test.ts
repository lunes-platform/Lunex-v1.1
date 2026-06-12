import { collectProductionConfigErrors } from '../utils/productionGuards';

const validProductionConfig = {
  isProd: true,
  nodeEnv: 'production',
  adminSecret: 'a'.repeat(32),
  cors: {
    allowedOrigins: ['https://app.lunex.io'],
  },
  websocket: {
    allowedOrigins: ['https://app.lunex.io'],
  },
  blockchain: {
    wsUrl: 'wss://rpc.lunes.io',
    relayerSeed: 'real seed injected by secret manager',
    spotContractAddress: '5SpotSettlementContractAddress',
    spotContractMetadataPath: './abis/SpotSettlement.json',
    nativeTokenAddress: '5NativeTokenSentinelAccountId',
    factoryContractAddress: '5FactoryContractAddress',
  },
  bridge: {
    adminSeed: 'real bridge seed injected by secret manager',
  },
  redis: {
    url: 'redis://redis.internal:6379',
  },
  matching: {
    lockTtlMs: 30000,
    lockWaitMs: 2000,
    lockRetryMs: 50,
  },
  rewards: {
    enabled: true,
    leaderPoolPct: 40,
    traderPoolPct: 30,
    stakerPoolPct: 30,
    rewardSplitTotalPct: 100,
    rewardSplitValid: true,
    treasuryAddress: '5TreasuryAddress',
    stakingContractAddress: '5StakingContractAddress',
  },
};

describe('production startup guards', () => {
  it('returns no errors with a fully-valid production config', () => {
    expect(collectProductionConfigErrors(validProductionConfig)).toEqual([]);
  });

  it('does not require settlement config outside production', () => {
    expect(
      collectProductionConfigErrors({
        ...validProductionConfig,
        isProd: false,
        nodeEnv: 'development',
        adminSecret: '',
        cors: { allowedOrigins: ['*'] },
        blockchain: {
          relayerSeed: '',
          spotContractAddress: '',
          spotContractMetadataPath: '',
          nativeTokenAddress: '',
          wsUrl: '',
          factoryContractAddress: '',
        },
      }),
    ).toEqual([]);
  });

  it('rejects production startup without mandatory settlement configuration', () => {
    const errors = collectProductionConfigErrors({
      ...validProductionConfig,
      blockchain: {
        wsUrl: '',
        relayerSeed: '',
        spotContractAddress: '',
        spotContractMetadataPath: '',
        nativeTokenAddress: '',
        factoryContractAddress: '',
      },
    });

    expect(errors).toEqual(
      expect.arrayContaining([
        'RELAYER_SEED is required in production',
        'LUNES_WS_URL is required in production',
        'SPOT_CONTRACT_ADDRESS is required in production',
        'SPOT_CONTRACT_METADATA_PATH is required in production',
        'FACTORY_CONTRACT_ADDRESS is required in production',
      ]),
    );
    expect(
      errors.some((e) => e.startsWith('NATIVE_TOKEN_ADDRESS is required')),
    ).toBe(true);
  });

  it('rejects development relayer seeds and wildcard CORS in production', () => {
    const errors = collectProductionConfigErrors({
      ...validProductionConfig,
      cors: { allowedOrigins: ['https://app.lunex.io', '*'] },
      blockchain: {
        ...validProductionConfig.blockchain,
        relayerSeed: '//Alice',
      },
    });

    expect(errors).toEqual(
      expect.arrayContaining([
        'RELAYER_SEED must not use a development account in production',
        'Wildcard CORS origins are forbidden in production',
      ]),
    );
  });

  it('rejects placeholder relayer seeds in production', () => {
    const errors = collectProductionConfigErrors({
      ...validProductionConfig,
      blockchain: {
        ...validProductionConfig.blockchain,
        relayerSeed:
          'REPLACE_WITH_PRODUCTION_RELAYER_SEED_FROM_SECRETS_MANAGER',
      },
    });

    expect(
      errors.some((e) =>
        e.includes('RELAYER_SEED still contains a placeholder'),
      ),
    ).toBe(true);
  });

  it('rejects local LUNES RPC endpoints in production', () => {
    const errors = collectProductionConfigErrors({
      ...validProductionConfig,
      blockchain: {
        ...validProductionConfig.blockchain,
        wsUrl: 'ws://127.0.0.1:9944',
      },
    });
    expect(errors).toContain(
      'LUNES_WS_URL must not point to localhost in production',
    );
  });

  it('rejects missing, development, or placeholder bridge admin seeds', () => {
    expect(
      collectProductionConfigErrors({
        ...validProductionConfig,
        bridge: { adminSeed: '' },
      }),
    ).toContain('BRIDGE_ADMIN_SEED is required in production');

    expect(
      collectProductionConfigErrors({
        ...validProductionConfig,
        bridge: { adminSeed: '//Alice' },
      }),
    ).toContain(
      'BRIDGE_ADMIN_SEED must not use a development account in production',
    );

    const placeholderErrors = collectProductionConfigErrors({
      ...validProductionConfig,
      bridge: {
        adminSeed: 'REPLACE_WITH_PRODUCTION_BRIDGE_ADMIN_SEED',
      },
    });
    expect(
      placeholderErrors.some((e) =>
        e.includes('BRIDGE_ADMIN_SEED still contains a placeholder'),
      ),
    ).toBe(true);
  });

  it('rejects missing or wildcard WebSocket origins in production', () => {
    expect(
      collectProductionConfigErrors({
        ...validProductionConfig,
        websocket: { allowedOrigins: [] },
      }),
    ).toContain('ALLOWED_WS_ORIGINS is required in production');

    expect(
      collectProductionConfigErrors({
        ...validProductionConfig,
        websocket: { allowedOrigins: ['https://app.lunex.io', '*'] },
      }),
    ).toContain('Wildcard WebSocket origins are forbidden in production');
  });

  it('requires Redis and valid matching lock settings in production', () => {
    const errors = collectProductionConfigErrors({
      ...validProductionConfig,
      redis: { url: '' },
      matching: {
        lockTtlMs: 0,
        lockWaitMs: -1,
        lockRetryMs: 0,
      },
    });

    expect(errors).toEqual(
      expect.arrayContaining([
        'REDIS_URL is required in production',
        'MATCHING_LOCK_TTL_MS must be positive in production',
        'MATCHING_LOCK_WAIT_MS must be non-negative in production',
        'MATCHING_LOCK_RETRY_MS must be positive in production',
      ]),
    );
  });

  it('rejects NODE_ENV that is not exactly "production"', () => {
    const errors = collectProductionConfigErrors({
      ...validProductionConfig,
      nodeEnv: 'prod',
    });
    expect(errors.some((e) => e.includes('NODE_ENV must be exactly'))).toBe(
      true,
    );
  });

  it('rejects reward split that does not sum to 100', () => {
    const errors = collectProductionConfigErrors({
      ...validProductionConfig,
      rewards: {
        ...validProductionConfig.rewards,
        enabled: true,
        leaderPoolPct: 40,
        traderPoolPct: 40,
        stakerPoolPct: 40,
        rewardSplitTotalPct: 120,
        rewardSplitValid: false,
      },
    });
    expect(
      errors.some((e) =>
        e.includes('REWARD split percentages must sum to 100'),
      ),
    ).toBe(true);
  });

  it('skips reward split validation when rewards are disabled', () => {
    const errors = collectProductionConfigErrors({
      ...validProductionConfig,
      rewards: {
        ...validProductionConfig.rewards,
        enabled: false,
        leaderPoolPct: 0,
        traderPoolPct: 0,
        stakerPoolPct: 0,
        rewardSplitTotalPct: 0,
        rewardSplitValid: false,
      },
    });
    expect(errors.some((e) => e.includes('REWARD split'))).toBe(false);
  });

  it('requires treasury and staking contract addresses when rewards are enabled', () => {
    const errors = collectProductionConfigErrors({
      ...validProductionConfig,
      rewards: {
        ...validProductionConfig.rewards,
        treasuryAddress: '',
        stakingContractAddress: '',
      },
    });
    expect(errors).toEqual(
      expect.arrayContaining([
        'TREASURY_ADDRESS is required when rewards are enabled',
        'STAKING_CONTRACT_ADDRESS is required when rewards are enabled',
      ]),
    );
  });

  it('rejects missing NATIVE_TOKEN_ADDRESS in production', () => {
    const errors = collectProductionConfigErrors({
      ...validProductionConfig,
      blockchain: {
        ...validProductionConfig.blockchain,
        nativeTokenAddress: '',
      },
    });
    expect(
      errors.some((e) => e.startsWith('NATIVE_TOKEN_ADDRESS is required')),
    ).toBe(true);
  });
});
