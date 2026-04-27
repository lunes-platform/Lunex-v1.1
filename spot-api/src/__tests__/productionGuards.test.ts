import { collectProductionConfigErrors } from '../utils/productionGuards';

const validProductionConfig = {
  isProd: true,
  adminSecret: 'a'.repeat(32),
  cors: {
    allowedOrigins: ['https://app.lunex.io'],
  },
  websocket: {
    allowedOrigins: ['https://app.lunex.io'],
  },
  blockchain: {
    relayerSeed: 'real seed injected by secret manager',
    spotContractAddress: '5SpotSettlementContractAddress',
    spotContractMetadataPath: './abis/SpotSettlement.json',
  },
  redis: {
    url: 'redis://redis.internal:6379',
  },
  matching: {
    lockTtlMs: 30000,
    lockWaitMs: 2000,
    lockRetryMs: 50,
  },
};

describe('production startup guards', () => {
  it('does not require settlement config outside production', () => {
    expect(
      collectProductionConfigErrors({
        ...validProductionConfig,
        isProd: false,
        adminSecret: '',
        cors: { allowedOrigins: ['*'] },
        blockchain: {
          relayerSeed: '',
          spotContractAddress: '',
          spotContractMetadataPath: '',
        },
      }),
    ).toEqual([]);
  });

  it('rejects production startup without mandatory settlement configuration', () => {
    const errors = collectProductionConfigErrors({
      ...validProductionConfig,
      blockchain: {
        relayerSeed: '',
        spotContractAddress: '',
        spotContractMetadataPath: '',
      },
    });

    expect(errors).toEqual(
      expect.arrayContaining([
        'RELAYER_SEED is required in production',
        'SPOT_CONTRACT_ADDRESS is required in production',
        'SPOT_CONTRACT_METADATA_PATH is required in production',
      ]),
    );
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
});
