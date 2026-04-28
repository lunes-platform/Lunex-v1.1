import { getRedis } from './redis';
import { log } from './logger';

/**
 * Redis-backed sliding-window rate limiter.
 *
 * Stores attempts as members of a sorted set (`ZADD`) keyed by timestamp.
 * On each call:
 *   1. Trim the set to the current window (`ZREMRANGEBYSCORE`)
 *   2. Count remaining members (`ZCARD`)
 *   3. If under limit, add the new attempt (`ZADD`)
 *
 * The set has a TTL slightly larger than the window so empty buckets are
 * reclaimed automatically.
 *
 * Survives process restart and works across horizontally scaled API replicas
 * — unlike the in-process `Map<string, number[]>` it replaces.
 */

export type RateLimitOptions = {
  key: string;
  limit: number;
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
};

const FAIL_OPEN = true;

export async function checkRedisRateLimit(
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  const { key, limit, windowMs } = options;
  const now = Date.now();
  const windowStart = now - windowMs;

  try {
    const redis = getRedis();
    const member = `${now}:${Math.random().toString(36).slice(2, 8)}`;
    const ttlSeconds = Math.ceil((windowMs * 2) / 1000);

    // Pipeline: trim, count, add (atomic enough for our purposes — slight
    // over-count is acceptable, under-count is not).
    const pipeline = redis
      .pipeline()
      .zremrangebyscore(key, 0, windowStart)
      .zcard(key);

    const results = await pipeline.exec();
    if (!results) {
      // Pipeline returned no results — fail open (do not block legitimate users).
      return failOpen(limit);
    }

    const cardErr = results[1]?.[0];
    const cardVal = results[1]?.[1] as number | undefined;
    if (cardErr || typeof cardVal !== 'number') {
      return failOpen(limit);
    }

    if (cardVal >= limit) {
      // Find the oldest member to compute Retry-After.
      const oldest = await redis.zrange(key, 0, 0, 'WITHSCORES');
      const oldestTs = oldest && oldest.length >= 2 ? Number(oldest[1]) : now;
      const retryAfterMs = Math.max(0, oldestTs + windowMs - now);
      return { allowed: false, remaining: 0, retryAfterMs };
    }

    // Under limit — record the attempt.
    await redis.pipeline().zadd(key, now, member).expire(key, ttlSeconds).exec();

    return {
      allowed: true,
      remaining: Math.max(0, limit - cardVal - 1),
      retryAfterMs: 0,
    };
  } catch (err) {
    log.warn({ err, key }, '[redisRateLimit] check failed — failing open');
    return failOpen(limit);
  }
}

function failOpen(limit: number): RateLimitResult {
  if (!FAIL_OPEN) {
    return { allowed: false, remaining: 0, retryAfterMs: 60_000 };
  }
  return { allowed: true, remaining: limit, retryAfterMs: 0 };
}
