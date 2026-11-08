'use strict';

/**
 * Persistence for cooldowns and counters. Two implementations with the same
 * async interface:
 *   reserve(key, ttlMs) -> boolean   (SET NX PX: true if the key was free)
 *   ttl(key)            -> ms left (0 when absent)
 *   release(key)
 *   incr(key, windowMs) -> new count (fixed window starting at first incr)
 *   decr(key)
 *   count(key)          -> current count (0 when absent)
 */

function createMemoryStore({ now = Date.now, sweepEvery = 500 } = {}) {
  const kv = new Map(); // key -> { value, expiresAt }
  let ops = 0;

  const live = (key) => {
    const e = kv.get(key);
    if (!e) return null;
    if (e.expiresAt <= now()) {
      kv.delete(key);
      return null;
    }
    return e;
  };
  const maybeSweep = () => {
    if (++ops % sweepEvery !== 0) return;
    const t = now();
    for (const [k, e] of kv) if (e.expiresAt <= t) kv.delete(k);
  };

  return {
    kind: 'memory',
    async reserve(key, ttlMs) {
      maybeSweep();
      if (live(key)) return false;
      kv.set(key, { value: 1, expiresAt: now() + ttlMs });
      return true;
    },
    async ttl(key) {
      const e = live(key);
      return e ? e.expiresAt - now() : 0;
    },
    async release(key) {
      kv.delete(key);
    },
    async incr(key, windowMs) {
      maybeSweep();
      const e = live(key);
      if (!e) {
        kv.set(key, { value: 1, expiresAt: now() + windowMs });
        return 1;
      }
      e.value += 1;
      return e.value;
    },
    async decr(key) {
      const e = live(key);
      if (e) e.value = Math.max(0, e.value - 1);
    },
    async count(key) {
      const e = live(key);
      return e ? e.value : 0;
    },
    async close() {},
  };
}

/** Redis-backed store (ioredis client). Survives restarts and works across replicas. */
function createRedisStore(client, { prefix = 'faucet:' } = {}) {
  const k = (key) => `${prefix}${key}`;
  return {
    kind: 'redis',
    async reserve(key, ttlMs) {
      return (await client.set(k(key), '1', 'PX', ttlMs, 'NX')) === 'OK';
    },
    async ttl(key) {
      const ms = await client.pttl(k(key));
      return ms > 0 ? ms : 0;
    },
    async release(key) {
      await client.del(k(key));
    },
    async incr(key, windowMs) {
      const v = await client.incr(k(key));
      if (v === 1) {
        await client.pexpire(k(key), windowMs);
      } else if ((await client.pttl(k(key))) === -1) {
        // self-heal a counter left without TTL (crash between INCR and PEXPIRE)
        await client.pexpire(k(key), windowMs);
      }
      return v;
    },
    async decr(key) {
      const v = await client.decr(k(key));
      if (v < 0) await client.del(k(key));
    },
    async count(key) {
      const v = await client.get(k(key));
      return v ? Math.max(0, Number(v)) : 0;
    },
    async close() {
      if (typeof client.quit === 'function') await client.quit();
    },
  };
}

module.exports = { createMemoryStore, createRedisStore };
