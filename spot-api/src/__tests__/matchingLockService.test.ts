const mockRedis = {
  set: jest.fn(),
  eval: jest.fn(),
};

jest.mock('../utils/redis', () => ({
  getRedis: jest.fn(() => mockRedis),
}));

jest.mock('../utils/logger', () => ({
  log: {
    error: jest.fn(),
  },
}));

import { config } from '../config';
import { withMatchingLock } from '../services/matchingLockService';

describe('matchingLockService', () => {
  const originalIsProd = config.isProd;
  const originalMatching = { ...config.matching };

  beforeEach(() => {
    jest.clearAllMocks();
    config.isProd = true;
    config.matching.lockWaitMs = 1;
    config.matching.lockRetryMs = 1;
    config.matching.lockTtlMs = 5000;
  });

  afterEach(() => {
    config.isProd = originalIsProd;
    config.matching.lockWaitMs = originalMatching.lockWaitMs;
    config.matching.lockRetryMs = originalMatching.lockRetryMs;
    config.matching.lockTtlMs = originalMatching.lockTtlMs;
  });

  it('fails closed in production when Redis lock cannot be acquired', async () => {
    const callback = jest.fn();
    mockRedis.set.mockRejectedValueOnce(new Error('redis unavailable'));

    await expect(withMatchingLock('LUNES/USDT', callback)).rejects.toThrow(
      'Matching engine lock unavailable',
    );

    expect(callback).not.toHaveBeenCalled();
  });

  it('releases the Redis lock after a successful critical section', async () => {
    mockRedis.set.mockResolvedValueOnce('OK');
    mockRedis.eval.mockResolvedValueOnce(1);

    const result = await withMatchingLock('LUNES/USDT', async () => 'matched');

    expect(result).toBe('matched');
    expect(mockRedis.set).toHaveBeenCalledWith(
      'matching-lock:LUNES/USDT',
      expect.any(String),
      'PX',
      5000,
      'NX',
    );
    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("get", KEYS[1])'),
      1,
      'matching-lock:LUNES/USDT',
      expect.any(String),
    );
  });

  it('extends the Redis lock while a critical section is still running', async () => {
    config.matching.lockTtlMs = 30;
    mockRedis.set.mockResolvedValueOnce('OK');
    mockRedis.eval.mockResolvedValue(1);

    const result = await withMatchingLock(
      'LUNES/USDT',
      () => new Promise((resolve) => setTimeout(() => resolve('matched'), 80)),
    );

    expect(result).toBe('matched');
    const extensionCalls = mockRedis.eval.mock.calls.filter((call) =>
      String(call[0]).includes('pexpire'),
    );
    expect(extensionCalls.length).toBeGreaterThanOrEqual(1);
  });
});
