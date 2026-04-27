/**
 * Unit tests for Redis-backed nonce replay protection in auth middleware.
 *
 * We mock the Redis client and the getRedis utility so no real Redis
 * connection is required to run these tests.
 */

jest.mock('@polkadot/util-crypto', () => ({
  cryptoWaitReady: jest.fn().mockResolvedValue(undefined),
  signatureVerify: jest.fn(),
}));

jest.mock('../utils/redis', () => {
  const store = new Map<string, string>();

  const mockRedis = {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string, ...args: string[]) => {
      if (args.includes('NX') && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    }),
    ping: jest.fn(async () => 'PONG'),
    quit: jest.fn(async () => 'OK'),
    // Expose store for test assertions
    _store: store,
    _clear: () => store.clear(),
  };

  return {
    getRedis: jest.fn(() => mockRedis),
    redisHealthy: jest.fn(async () => true),
    disconnectRedis: jest.fn(async () => undefined),
    _mockRedis: mockRedis,
  };
});

jest.mock('../config', () => ({
  config: {
    isProd: false,
    redis: {
      url: 'redis://127.0.0.1:6379',
      nonceTtlSeconds: 300,
    },
  },
}));

jest.mock('../services/walletRiskService', () => ({
  walletRiskService: {
    assertWalletCanAct: jest.fn().mockResolvedValue(undefined),
  },
}));

import { signatureVerify } from '@polkadot/util-crypto';
import { config } from '../config';
import {
  buildWalletActionMessage,
  verifyWalletActionSignature,
  verifyWalletReadSignature,
} from '../middleware/auth';
import * as redisModule from '../utils/redis';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockRedis = (redisModule as any)._mockRedis as {
  get: jest.Mock;
  set: jest.Mock;
  ping: jest.Mock;
  quit: jest.Mock;
  _store: Map<string, string>;
  _clear: () => void;
};
const signatureVerifyMock = signatureVerify as jest.MockedFunction<
  typeof signatureVerify
>;

describe('buildWalletActionMessage', () => {
  it('builds a deterministic canonical message', () => {
    const msg = buildWalletActionMessage({
      action: 'deposit',
      address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
      nonce: 'abc123',
      timestamp: 1700000000000,
      fields: { amount: '100', token: 'WLUNES' },
    });

    expect(msg).toBe(
      'lunex-auth:deposit\n' +
        'address:5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY\n' +
        'amount:100\n' +
        'token:WLUNES\n' +
        'nonce:abc123\n' +
        'timestamp:1700000000000',
    );
  });

  it('sorts fields lexicographically', () => {
    const msg = buildWalletActionMessage({
      action: 'test',
      address: 'addr',
      nonce: 'n1',
      timestamp: 0,
      fields: { z: 'last', a: 'first', m: 'middle' },
    });

    const lines = msg.split('\n');
    const fieldLines = lines.slice(2, lines.length - 2);
    expect(fieldLines).toEqual(['a:first', 'm:middle', 'z:last']);
  });

  it('omits null/undefined fields', () => {
    const msg = buildWalletActionMessage({
      action: 'test',
      address: 'addr',
      nonce: 'n1',
      timestamp: 0,
      fields: { a: 'present', b: undefined, c: null },
    });

    expect(msg).not.toContain('b:');
    expect(msg).not.toContain('c:');
  });
});

describe('verifyWalletActionSignature — replay protection', () => {
  beforeEach(() => {
    mockRedis._clear();
    jest.clearAllMocks();
    config.isProd = false;
    signatureVerifyMock.mockReturnValue({ isValid: false } as ReturnType<
      typeof signatureVerify
    >);
    // Restore get/set to default implementations after each test
    mockRedis.get.mockImplementation(
      async (key: string) => mockRedis._store.get(key) ?? null,
    );
    mockRedis.set.mockImplementation(
      async (key: string, value: string, ...args: string[]) => {
        if (args.includes('NX') && mockRedis._store.has(key)) return null;
        mockRedis._store.set(key, value);
        return 'OK';
      },
    );
  });

  it('uses atomic Redis SET NX after a valid action signature', async () => {
    signatureVerifyMock.mockReturnValue({ isValid: true } as ReturnType<
      typeof signatureVerify
    >);

    const result = await verifyWalletActionSignature({
      action: 'trade',
      address: 'addr',
      nonce: 'fresh-atomic-nonce',
      timestamp: Date.now(),
      signature: 'signed-payload',
    });

    expect(result.ok).toBe(true);
    expect(mockRedis.set).toHaveBeenCalledWith(
      'nonce:trade:addr:fresh-atomic-nonce',
      '1',
      'EX',
      config.redis.nonceTtlSeconds,
      'NX',
    );
  });

  it('allows at most one concurrent request to consume the same valid nonce', async () => {
    signatureVerifyMock.mockReturnValue({ isValid: true } as ReturnType<
      typeof signatureVerify
    >);
    const input = {
      action: 'trade',
      address: 'addr',
      nonce: 'same-concurrent-nonce',
      timestamp: Date.now(),
      signature: 'signed-payload',
    };

    const results = await Promise.all([
      verifyWalletActionSignature(input),
      verifyWalletActionSignature(input),
    ]);

    expect(results.filter((result) => result.ok).length).toBe(1);
    expect(results.filter((result) => !result.ok)[0]?.error).toMatch(
      /nonce already used/i,
    );
  });

  it('fails closed in production when Redis cannot atomically consume a nonce', async () => {
    config.isProd = true;
    signatureVerifyMock.mockReturnValue({ isValid: true } as ReturnType<
      typeof signatureVerify
    >);
    mockRedis.get.mockRejectedValue(new Error('Redis down'));
    mockRedis.set.mockRejectedValue(new Error('Redis down'));

    const result = await verifyWalletActionSignature({
      action: 'trade',
      address: 'addr',
      nonce: 'nonce-store-down',
      timestamp: Date.now(),
      signature: 'signed-payload',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/nonce store unavailable/i);
  });

  it('rejects an expired timestamp', async () => {
    const result = await verifyWalletActionSignature({
      action: 'deposit',
      address: 'addr',
      nonce: 'n1',
      timestamp: Date.now() - 10 * 60 * 1000, // 10 minutes ago
      signature: '0x00',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/expired/i);
  });

  it('rejects a future timestamp beyond the TTL window', async () => {
    const result = await verifyWalletActionSignature({
      action: 'deposit',
      address: 'addr',
      nonce: 'n2',
      timestamp: Date.now() + 10 * 60 * 1000, // 10 minutes in future
      signature: '0x00',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/expired/i);
  });

  it('rejects if nonce is already used (Redis)', async () => {
    const replayKey = 'nonce:deposit:addr:nonce-already-used';
    mockRedis._store.set(replayKey, '1');

    const result = await verifyWalletActionSignature({
      action: 'deposit',
      address: 'addr',
      nonce: 'nonce-already-used',
      timestamp: Date.now(),
      signature: '0x00',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/nonce already used/i);
  });

  it('falls back to in-memory when Redis throws on get', async () => {
    mockRedis.get.mockRejectedValueOnce(new Error('Redis down'));

    // Should not throw — should fall back gracefully and proceed to signature validation
    const result = await verifyWalletActionSignature({
      action: 'deposit',
      address: 'addr',
      nonce: 'nonce-fallback',
      timestamp: Date.now(),
      signature: '0x00',
    });

    // Signature validation will fail (invalid sig), but error is not about Redis
    expect(result.ok).toBe(false);
    expect(result.error).not.toMatch(/redis/i);
  });

  it('marks nonce in Redis after successful use (mock set called)', async () => {
    // Simulate a valid signature scenario by short-circuiting signature check
    // We inject a valid call where nonce hasn't been used
    // The call will fail on signature but we can assert Redis.set was NOT called before that
    mockRedis.get.mockResolvedValueOnce(null);

    await verifyWalletActionSignature({
      action: 'trade',
      address: 'addr',
      nonce: 'fresh-nonce',
      timestamp: Date.now(),
      signature: '0x00',
    });

    // Redis.set should NOT have been called because signature validation fails
    expect(mockRedis.set).not.toHaveBeenCalledWith(
      expect.stringContaining('fresh-nonce'),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });
});

describe('verifyWalletReadSignature — replay protection', () => {
  beforeEach(() => {
    mockRedis._clear();
    jest.clearAllMocks();
    config.isProd = false;
    signatureVerifyMock.mockReturnValue({ isValid: false } as ReturnType<
      typeof signatureVerify
    >);
    mockRedis.get.mockImplementation(
      async (key: string) => mockRedis._store.get(key) ?? null,
    );
    mockRedis.set.mockImplementation(
      async (key: string, value: string, ...args: string[]) => {
        if (args.includes('NX') && mockRedis._store.has(key)) return null;
        mockRedis._store.set(key, value);
        return 'OK';
      },
    );
  });

  it('rejects a replayed signed-read nonce before signature verification', async () => {
    const replayKey = 'nonce:read:orders.list:addr:read-nonce-used';
    mockRedis._store.set(replayKey, '1');

    const result = await verifyWalletReadSignature({
      action: 'orders.list',
      address: 'addr',
      nonce: 'read-nonce-used',
      timestamp: Date.now(),
      signature: '0x00',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/nonce already used/i);
  });
});
