import { Keyring } from '@polkadot/keyring';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import {
  collectProductionConfigErrors,
  isDevSeed,
  DEV_RAW_SEEDS_FOR_TESTS,
} from '../../utils/productionGuards';

const DEV_PHRASE =
  'bottom drive obey lake curtain smoke basket hold race lonely fit walk';

const validProd = {
  isProd: true,
  nodeEnv: 'production',
  adminSecret: 'a'.repeat(32),
  trustProxy: 1 as const,
  publicApiOrigin: 'https://api.lunex.io',
  signing: {
    domain: 'lunex.lunes.io',
    genesisHash: `0x${'ab'.repeat(32)}`,
    acceptLegacy: false,
  },
  settlement: { attestorSeed: `0x${'12'.repeat(32)}` },
  session: { secret: 's'.repeat(32) },
  cors: { allowedOrigins: ['https://app.lunex.io'] },
  websocket: { allowedOrigins: ['https://app.lunex.io'] },
  blockchain: {
    wsUrl: 'wss://rpc.lunes.io',
    relayerSeed: 'real seed injected by secret manager',
    spotContractAddress: '5Spot',
    spotContractMetadataPath: './abis/SpotSettlement.json',
    nativeTokenAddress: '5Native',
    factoryContractAddress: '5Factory',
  },
  bridge: { adminSeed: 'real bridge seed injected by secret manager' },
  redis: { url: 'redis://redis.internal:6379' },
  matching: { lockTtlMs: 30000, lockWaitMs: 2000, lockRetryMs: 50 },
  rewards: {
    enabled: false,
    leaderPoolPct: 40,
    traderPoolPct: 30,
    stakerPoolPct: 30,
    rewardSplitTotalPct: 100,
    rewardSplitValid: true,
    treasuryAddress: '',
    stakingContractAddress: '',
  },
};

describe('production guards — hardening', () => {
  it('accepts the fully valid hardened config', () => {
    expect(collectProductionConfigErrors(validProd)).toEqual([]);
  });

  it('BE-16: requires TRUST_PROXY in production', () => {
    const errors = collectProductionConfigErrors({
      ...validProd,
      trustProxy: false,
    });
    expect(errors.some((e) => e.startsWith('TRUST_PROXY must be set'))).toBe(
      true,
    );
    expect(
      collectProductionConfigErrors({ ...validProd, trustProxy: 2 }),
    ).toEqual([]);
    expect(
      collectProductionConfigErrors({
        ...validProd,
        trustProxy: ['10.0.0.0/8'],
      }),
    ).toEqual([]);
  });

  it('BE-22: requires an attestor seed distinct from the relayer seed', () => {
    expect(
      collectProductionConfigErrors({
        ...validProd,
        settlement: { attestorSeed: '' },
      }),
    ).toContain('ATTESTOR_SEED is required in production');
    expect(
      collectProductionConfigErrors({
        ...validProd,
        settlement: { attestorSeed: validProd.blockchain.relayerSeed },
      }).some((e) => e.startsWith('ATTESTOR_SEED must differ')),
    ).toBe(true);
  });

  it('BE-22: requires a bare https PUBLIC_API_ORIGIN', () => {
    for (const origin of [
      '',
      'http://api.lunex.io',
      'https://api.lunex.io/v1',
      'api.lunex.io',
    ]) {
      const errors = collectProductionConfigErrors({
        ...validProd,
        publicApiOrigin: origin,
      });
      expect(errors.some((e) => e.startsWith('PUBLIC_API_ORIGIN'))).toBe(true);
    }
  });

  it('FE-03: requires signing domain and chain genesis in production', () => {
    const errors = collectProductionConfigErrors({
      ...validProd,
      signing: { domain: '', genesisHash: '', acceptLegacy: false },
    });
    expect(errors).toContain('SIGNING_DOMAIN is required in production');
    expect(errors.some((e) => e.startsWith('LUNES_GENESIS_HASH'))).toBe(true);
    expect(
      collectProductionConfigErrors({
        ...validProd,
        signing: { ...validProd.signing, domain: 'https://lunex.lunes.io' },
      }).some((e) => e.startsWith('SIGNING_DOMAIN must be a bare hostname')),
    ).toBe(true);
  });

  describe('IN-05: dev seeds in any form', () => {
    it.each([
      '//Alice',
      '  //alice',
      `${DEV_PHRASE}//Alice`,
      `${DEV_PHRASE.toUpperCase()}//Bob`,
      `${DEV_PHRASE}`,
      `  ${DEV_PHRASE.replace(/ /g, '   ')}  `,
      'some other words//Charlie',
      '//Dave//stash',
      '//EVE',
      '//Ferdie',
      ...DEV_RAW_SEEDS_FOR_TESTS,
    ])('isDevSeed(%p) === true', (seed) => {
      expect(isDevSeed(seed)).toBe(true);
    });

    it.each([
      'real seed injected by secret manager',
      '//Alicent-is-not-a-dev-account',
      `0x${'12'.repeat(32)}`,
      '',
    ])('isDevSeed(%p) === false', (seed) => {
      expect(isDevSeed(seed)).toBe(false);
    });

    it('rejects docker example style seeds for relayer and bridge', () => {
      const errors = collectProductionConfigErrors({
        ...validProd,
        blockchain: {
          ...validProd.blockchain,
          relayerSeed: `${DEV_PHRASE}//Alice`,
        },
        bridge: { adminSeed: `${DEV_PHRASE}//Alice` },
      });
      expect(errors).toEqual(
        expect.arrayContaining([
          'RELAYER_SEED must not use a development account in production',
          'BRIDGE_ADMIN_SEED must not use a development account in production',
        ]),
      );
    });

    it('raw dev seed constants really derive the well-known dev accounts', async () => {
      await cryptoWaitReady();
      const keyring = new Keyring({ type: 'sr25519', ss58Format: 42 });
      const known = new Set(
        [DEV_PHRASE, '//Alice', '//Bob'].map(
          (uri) => keyring.addFromUri(uri).address,
        ),
      );
      for (const seed of DEV_RAW_SEEDS_FOR_TESTS) {
        expect(known.has(keyring.addFromUri(seed).address)).toBe(true);
      }
    });
  });
});
