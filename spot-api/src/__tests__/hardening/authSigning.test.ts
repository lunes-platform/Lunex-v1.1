/**
 * BE-17 (nonce retention covers the whole signature window, future skew)
 * FE-03 (signed messages bound to domain + chain genesis; legacy behind flag)
 * — exercised with real sr25519 signatures.
 */
jest.mock('../../utils/redis', () => {
  const store = new Map<string, { value: string; expiresAt: number }>();
  const mockRedis = {
    get: jest.fn(async (key: string) => {
      const entry = store.get(key);
      if (!entry || entry.expiresAt <= Date.now()) return null;
      return entry.value;
    }),
    set: jest.fn(
      async (
        key: string,
        value: string,
        _ex: string,
        ttlSeconds: number,
        nx?: string,
      ) => {
        const existing = store.get(key);
        if (nx === 'NX' && existing && existing.expiresAt > Date.now()) {
          return null;
        }
        store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
        return 'OK';
      },
    ),
    _clear: () => store.clear(),
  };
  return {
    getRedis: jest.fn(() => mockRedis),
    disconnectRedis: jest.fn(async () => undefined),
    __mockRedis: mockRedis,
  };
});

jest.mock('../../services/walletRiskService', () => ({
  walletRiskService: {
    assertWalletCanAct: jest.fn().mockResolvedValue(undefined),
  },
}));

import { Keyring } from '@polkadot/keyring';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import { u8aToHex } from '@polkadot/util';
import { config } from '../../config';
import {
  buildLegacyWalletActionMessage,
  buildSpotOrderMessage,
  buildSpotOrderMessageV2,
  buildWalletActionMessage,
  NONCE_RETENTION_SECONDS,
  verifySpotOrderSignature,
  verifyWalletActionSignature,
  verifyWalletReadSignature,
} from '../../middleware/auth';
import * as redisModule from '../../utils/redis';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockRedis = (redisModule as any).__mockRedis as {
  set: jest.Mock;
  _clear: () => void;
};

const GENESIS = `0x${'ab'.repeat(32)}`;
const OTHER_GENESIS = `0x${'cd'.repeat(32)}`;

let pair: ReturnType<Keyring['addFromUri']>;
const originalSigning = { ...config.signing };

function sign(message: string) {
  return u8aToHex(pair.sign(message));
}

beforeAll(async () => {
  await cryptoWaitReady();
  pair = new Keyring({ type: 'sr25519' }).addFromUri('//HardeningTest');
});

beforeEach(() => {
  mockRedis._clear();
  mockRedis.set.mockClear();
  config.signing.domain = 'lunex.lunes.io';
  config.signing.genesisHash = GENESIS;
  config.signing.acceptLegacy = false;
});

afterAll(() => {
  Object.assign(config.signing, originalSigning);
});

function actionInput(nonce: string, timestamp = Date.now()) {
  return {
    action: 'favorites.add',
    address: pair.address,
    nonce,
    timestamp,
    fields: { pairSymbol: 'LUNES/USDT' },
  };
}

describe('FE-03 — domain/chain bound wallet messages', () => {
  it('canonical message carries domain and chain', () => {
    const message = buildWalletActionMessage(actionInput('n-format-1', 1));
    expect(message.split('\n').slice(0, 4)).toEqual([
      'lunex-auth:favorites.add',
      'domain:lunex.lunes.io',
      `chain:${GENESIS}`,
      `address:${pair.address}`,
    ]);
  });

  it('accepts a signature bound to this domain + chain', async () => {
    const input = actionInput('n-bound-ok-1');
    const result = await verifyWalletActionSignature({
      ...input,
      signature: sign(buildWalletActionMessage(input)),
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a signature produced for another chain (testnet → mainnet)', async () => {
    const input = actionInput('n-other-chain-1');
    const message = buildWalletActionMessage(input, {
      domain: 'lunex.lunes.io',
      chain: OTHER_GENESIS,
    });
    const result = await verifyWalletActionSignature({
      ...input,
      signature: sign(message),
    });
    expect(result).toEqual({ ok: false, error: 'Invalid signature' });
  });

  it('rejects a signature produced for another domain (sandbox → prod)', async () => {
    const input = actionInput('n-other-domain-1');
    const message = buildWalletActionMessage(input, {
      domain: 'lunex-sandbox.lunes.io',
      chain: GENESIS,
    });
    const read = await verifyWalletReadSignature({
      ...input,
      signature: sign(message),
    });
    expect(read.ok).toBe(false);
  });

  it('legacy unbound messages only validate when SIGNING_ACCEPT_LEGACY is on', async () => {
    const input = actionInput('n-legacy-1');
    const signature = sign(buildLegacyWalletActionMessage(input));
    expect(
      (await verifyWalletActionSignature({ ...input, signature })).ok,
    ).toBe(false);

    config.signing.acceptLegacy = true;
    const input2 = actionInput('n-legacy-2');
    expect(
      (
        await verifyWalletActionSignature({
          ...input2,
          signature: sign(buildLegacyWalletActionMessage(input2)),
        })
      ).ok,
    ).toBe(true);
  });

  it('orders: v3 is bound; v2 only behind the legacy flag', async () => {
    const order = {
      pairSymbol: 'LUNES/USDT',
      side: 'BUY' as const,
      type: 'LIMIT' as const,
      price: '1',
      amount: '2',
      nonce: 'order-n-1',
      timestamp: 1700000000000,
      timeInForce: 'GTC',
    };
    expect(buildSpotOrderMessage(order)).toBe(
      `lunex-order-v3:lunex.lunes.io:${GENESIS}:LUNES/USDT:BUY:LIMIT:1:0:2:order-n-1:1700000000000:GTC:0`,
    );
    const v3 = sign(buildSpotOrderMessage(order));
    expect(await verifySpotOrderSignature(order, v3, pair.address)).toBe('v3');

    const otherChain = sign(
      buildSpotOrderMessage(order, { domain: 'lunex.lunes.io', chain: OTHER_GENESIS }),
    );
    expect(
      await verifySpotOrderSignature(order, otherChain, pair.address),
    ).toBeNull();

    const v2 = sign(buildSpotOrderMessageV2(order));
    expect(await verifySpotOrderSignature(order, v2, pair.address)).toBeNull();
    config.signing.acceptLegacy = true;
    expect(await verifySpotOrderSignature(order, v2, pair.address)).toBe('v2');
  });
});

describe('BE-17 — nonce retention and future skew', () => {
  it('stores nonces for at least twice the signature window', async () => {
    expect(NONCE_RETENTION_SECONDS).toBeGreaterThanOrEqual(600);
    const input = actionInput('n-ttl-1');
    await verifyWalletActionSignature({
      ...input,
      signature: sign(buildWalletActionMessage(input)),
    });
    const ttl = mockRedis.set.mock.calls[0][3];
    expect(ttl).toBeGreaterThanOrEqual(600);
  });

  it('rejects timestamps more than a small skew in the future', async () => {
    const input = actionInput('n-future-1', Date.now() + 4 * 60 * 1000);
    const result = await verifyWalletActionSignature({
      ...input,
      signature: sign(buildWalletActionMessage(input)),
    });
    expect(result).toEqual({ ok: false, error: 'Timestamp in the future' });
  });

  it('a nonce consumed near the end of the window cannot be replayed later', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      const start = Date.now();
      jest.setSystemTime(start);
      const input = actionInput('n-replay-window-1', start + 50_000);
      const signature = sign(buildWalletActionMessage(input));
      expect((await verifyWalletActionSignature({ ...input, signature })).ok).toBe(
        true,
      );
      // 5 min + 40 s later: timestamp still inside ±5 min of now.
      jest.setSystemTime(start + 340_000);
      expect(await verifyWalletActionSignature({ ...input, signature })).toEqual({
        ok: false,
        error: 'Signature nonce already used',
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
