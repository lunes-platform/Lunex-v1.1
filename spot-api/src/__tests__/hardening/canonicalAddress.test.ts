/**
 * M-09 — the same public key under different SS58 prefixes must collapse to
 * one identity (bans, limits, nonces, balance reservation) instead of N.
 */
jest.mock('../../utils/redis', () => {
  const store = new Map<string, string>();
  const mockRedis = {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(
      async (
        key: string,
        value: string,
        _ex: string,
        _ttl: number,
        nx?: string,
      ) => {
        if (nx === 'NX' && store.has(key)) return null;
        store.set(key, value);
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
import { u8aToHex } from '@polkadot/util';
import { cryptoWaitReady, encodeAddress } from '@polkadot/util-crypto';
import { config } from '../../config';
import {
  buildWalletActionMessage,
  verifyWalletActionSignature,
  verifyWalletReadSignature,
} from '../../middleware/auth';
import { walletRiskService } from '../../services/walletRiskService';
import * as redisModule from '../../utils/redis';
import {
  CancelOrderSchema,
  CreateOrderSchema,
  MarginClosePositionSchema,
  MarginCollateralSchema,
  MarginLiquidatePositionSchema,
  MarginOpenPositionSchema,
  ss58Address,
} from '../../utils/validation';

const mockRedis = (
  redisModule as unknown as { __mockRedis: { _clear(): void } }
).__mockRedis;
const assertWalletCanAct = walletRiskService.assertWalletCanAct as jest.Mock;

let pair: ReturnType<Keyring['addFromUri']>;
let generic: string; // prefix 42
let lunes: string; // prefix 57
const originalSigning = { ...config.signing };

beforeAll(async () => {
  await cryptoWaitReady();
  pair = new Keyring({ type: 'sr25519' }).addFromUri('//CanonicalAddress');
  generic = encodeAddress(pair.publicKey, 42);
  lunes = encodeAddress(pair.publicKey, 57);
});

beforeEach(() => {
  mockRedis._clear();
  assertWalletCanAct.mockClear();
  config.signing.domain = 'lunex.lunes.io';
  config.signing.genesisHash = `0x${'ab'.repeat(32)}`;
  config.signing.acceptLegacy = false;
});

afterAll(() => {
  Object.assign(config.signing, originalSigning);
});

describe('ss58Address schema', () => {
  it('maps the same key in two SS58 prefixes to one canonical address', () => {
    expect(generic).not.toBe(lunes);
    const a = ss58Address.parse(generic);
    const b = ss58Address.parse(lunes);
    expect(a).toBe(b);
    expect(a).toBe(generic);
  });

  it('normalizes a raw hex public key to the same canonical address', () => {
    expect(ss58Address.parse(u8aToHex(pair.publicKey))).toBe(generic);
  });

  it.each([
    ['empty', ''],
    ['garbage', 'not-an-address'],
    // Alice's address with the last character changed.
    ['bad checksum', '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQZ'],
    ['short hex', '0x1234'],
  ])('rejects an invalid address (%s)', (_label, value) => {
    expect(ss58Address.safeParse(value).success).toBe(false);
  });
});

describe('request schemas normalize wallet addresses', () => {
  const signed = {
    nonce: 'nonce-123456',
    timestamp: 1,
    signature: '0x12345678',
  };

  it('orders: create and cancel', () => {
    const order = CreateOrderSchema.parse({
      pairSymbol: 'LUNES/USDT',
      side: 'BUY',
      type: 'LIMIT',
      price: '1',
      amount: '1',
      ...signed,
      makerAddress: lunes,
    });
    expect(order.makerAddress).toBe(generic);
    expect(
      CancelOrderSchema.parse({ ...signed, makerAddress: lunes }).makerAddress,
    ).toBe(generic);
  });

  it('margin: collateral, open, close, liquidate', () => {
    expect(
      MarginCollateralSchema.parse({ ...signed, address: lunes, amount: '1' })
        .address,
    ).toBe(generic);
    expect(
      MarginOpenPositionSchema.parse({
        ...signed,
        address: lunes,
        pairSymbol: 'LUNES/USDT',
        side: 'BUY',
        collateralAmount: '1',
        leverage: '2',
      }).address,
    ).toBe(generic);
    expect(
      MarginClosePositionSchema.parse({ ...signed, address: lunes }).address,
    ).toBe(generic);
    expect(
      MarginLiquidatePositionSchema.parse({
        ...signed,
        liquidatorAddress: lunes,
      }).liquidatorAddress,
    ).toBe(generic);
  });

  it('still returns a validation error for an invalid address', () => {
    expect(
      CancelOrderSchema.safeParse({ ...signed, makerAddress: 'nope' }).success,
    ).toBe(false);
  });
});

describe('auth uses the canonical address for identity', () => {
  function input(nonce: string) {
    return {
      action: 'orders.cancel',
      nonce,
      timestamp: Date.now(),
      fields: { orderId: 'o-1' },
    };
  }

  it('accepts a message the wallet signed with its own (non-canonical) prefix', async () => {
    // The client signs `address:<lunes form>`; after schema normalization the
    // route hands auth the canonical form. The signature must still verify.
    const base = input('n-prefix-1');
    const signature = u8aToHex(
      pair.sign(buildWalletActionMessage({ ...base, address: lunes })),
    );
    const result = await verifyWalletActionSignature({
      ...base,
      address: generic,
      signature,
    });
    expect(result.ok).toBe(true);
  });

  it('checks bans against the canonical address', async () => {
    const base = input('n-ban-1');
    const signature = u8aToHex(
      pair.sign(buildWalletActionMessage({ ...base, address: lunes })),
    );
    const result = await verifyWalletActionSignature({
      ...base,
      address: lunes,
      signature,
    });
    expect(result.ok).toBe(true);
    expect(assertWalletCanAct).toHaveBeenCalledWith(generic);
  });

  it('a nonce consumed under one prefix cannot be replayed under another', async () => {
    const base = input('n-replay-1');
    const signature = u8aToHex(
      pair.sign(buildWalletActionMessage({ ...base, address: lunes })),
    );
    const first = await verifyWalletActionSignature({
      ...base,
      address: lunes,
      signature,
    });
    expect(first.ok).toBe(true);

    const replay = await verifyWalletActionSignature({
      ...base,
      address: generic,
      signature,
    });
    expect(replay).toEqual({
      ok: false,
      error: 'Signature nonce already used',
    });
  });

  it('read signatures share the canonical replay key too', async () => {
    const base = { ...input('n-read-1'), action: 'orders.read' };
    const signature = u8aToHex(
      pair.sign(buildWalletActionMessage({ ...base, address: lunes })),
    );
    expect(
      (await verifyWalletReadSignature({ ...base, address: lunes, signature }))
        .ok,
    ).toBe(true);
    expect(
      await verifyWalletReadSignature({ ...base, address: generic, signature }),
    ).toEqual({ ok: false, error: 'Signature nonce already used' });
  });

  it('rejects an address that is not a valid account', async () => {
    const result = await verifyWalletActionSignature({
      ...input('n-invalid-1'),
      address: 'not-an-address',
      signature: '0x1234',
    });
    expect(result).toEqual({ ok: false, error: 'Invalid signature' });
    expect(assertWalletCanAct).not.toHaveBeenCalled();
  });
});
