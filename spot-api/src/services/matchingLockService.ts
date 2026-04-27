import crypto from 'crypto';
import { config } from '../config';
import { getRedis } from '../utils/redis';
import { log } from '../utils/logger';

const localQueues = new Map<string, Promise<void>>();

const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

const EXTEND_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
end
return 0
`;

function lockKey(pairSymbol: string) {
  return `matching-lock:${pairSymbol}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withLocalLock<T>(key: string, callback: () => Promise<T>) {
  const previous = localQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  localQueues.set(key, queued);

  await previous.catch(() => undefined);
  try {
    return await callback();
  } finally {
    release();
    if (localQueues.get(key) === queued) {
      localQueues.delete(key);
    }
  }
}

async function acquireRedisLock(key: string, token: string) {
  const startedAt = Date.now();
  let lastError: unknown = null;

  while (Date.now() - startedAt <= config.matching.lockWaitMs) {
    try {
      const result = await getRedis().set(
        key,
        token,
        'PX',
        config.matching.lockTtlMs,
        'NX',
      );
      if (result === 'OK') return true;
    } catch (err) {
      lastError = err;
      break;
    }

    await sleep(config.matching.lockRetryMs);
  }

  if (lastError) {
    log.error({ err: lastError, key }, 'Matching engine Redis lock failed');
    throw new Error('Matching engine lock unavailable');
  }

  throw new Error('Matching engine busy');
}

async function releaseRedisLock(key: string, token: string) {
  try {
    await getRedis().eval(RELEASE_LOCK_SCRIPT, 1, key, token);
  } catch (err) {
    log.error({ err, key }, 'Failed to release matching engine Redis lock');
  }
}

function startRedisLockExtension(key: string, token: string) {
  const intervalMs = Math.max(10, Math.floor(config.matching.lockTtlMs / 3));
  let extending = false;

  const timer = setInterval(async () => {
    if (extending) return;
    extending = true;
    try {
      const result = await getRedis().eval(
        EXTEND_LOCK_SCRIPT,
        1,
        key,
        token,
        String(config.matching.lockTtlMs),
      );
      if (result !== 1) {
        log.error({ key }, 'Matching engine Redis lock ownership lost');
      }
    } catch (err) {
      log.error({ err, key }, 'Failed to extend matching engine Redis lock');
    } finally {
      extending = false;
    }
  }, intervalMs);

  timer.unref?.();
  return () => clearInterval(timer);
}

export async function withMatchingLock<T>(
  pairSymbol: string,
  callback: () => Promise<T>,
) {
  const key = lockKey(pairSymbol);

  if (!config.isProd) {
    return withLocalLock(key, callback);
  }

  const token = crypto.randomUUID();
  await acquireRedisLock(key, token);
  const stopExtendingLock = startRedisLockExtension(key, token);
  try {
    return await callback();
  } finally {
    stopExtendingLock();
    await releaseRedisLock(key, token);
  }
}
