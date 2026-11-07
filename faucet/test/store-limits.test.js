'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryStore, createRedisStore } = require('../src/store');
const { createLimiter } = require('../src/limits');

/** Minimal in-memory fake of the ioredis commands the store uses. */
function fakeRedis(clock) {
  const kv = new Map();
  const live = (k) => {
    const e = kv.get(k);
    if (!e) return null;
    if (e.exp !== null && e.exp <= clock.now) {
      kv.delete(k);
      return null;
    }
    return e;
  };
  return {
    kv,
    async set(k, v, px, ms, nx) {
      assert.equal(px, 'PX');
      assert.equal(nx, 'NX');
      if (live(k)) return null;
      kv.set(k, { v: String(v), exp: clock.now + ms });
      return 'OK';
    },
    async pttl(k) {
      const e = live(k);
      if (!e) return -2;
      return e.exp === null ? -1 : e.exp - clock.now;
    },
    async del(k) {
      return kv.delete(k) ? 1 : 0;
    },
    async incr(k) {
      const e = live(k);
      if (!e) {
        kv.set(k, { v: '1', exp: null });
        return 1;
      }
      e.v = String(Number(e.v) + 1);
      return Number(e.v);
    },
    async decr(k) {
      const e = live(k);
      if (!e) return -1;
      e.v = String(Number(e.v) - 1);
      return Number(e.v);
    },
    async pexpire(k, ms) {
      const e = live(k);
      if (!e) return 0;
      e.exp = clock.now + ms;
      return 1;
    },
    async get(k) {
      const e = live(k);
      return e ? e.v : null;
    },
  };
}

const LIMITS = {
  addressCooldownMs: 60_000,
  ipMaxPerWindow: 2,
  ipWindowMs: 120_000,
  dailyLimit: 3,
};

for (const kind of ['memory', 'redis']) {
  const make = (clock) =>
    kind === 'memory'
      ? createMemoryStore({ now: () => clock.now })
      : createRedisStore(fakeRedis(clock), { prefix: 't:' });

  test(`[${kind}] reserve is exclusive until TTL expires`, async () => {
    const clock = { now: 1_000 };
    const store = make(clock);
    assert.equal(await store.reserve('a', 1000), true);
    assert.equal(await store.reserve('a', 1000), false);
    assert.ok((await store.ttl('a')) > 0);
    clock.now += 1001;
    assert.equal(await store.reserve('a', 1000), true);
    await store.release('a');
    assert.equal(await store.reserve('a', 1000), true);
  });

  test(`[${kind}] incr counts within a fixed window and resets after it`, async () => {
    const clock = { now: 0 };
    const store = make(clock);
    assert.equal(await store.incr('c', 500), 1);
    assert.equal(await store.incr('c', 500), 2);
    assert.equal(await store.count('c'), 2);
    await store.decr('c');
    assert.equal(await store.count('c'), 1);
    clock.now += 501;
    assert.equal(await store.count('c'), 0);
    assert.equal(await store.incr('c', 500), 1);
  });

  test(`[${kind}] limiter: per-address cooldown`, async () => {
    const clock = { now: Date.UTC(2026, 10, 7, 12) };
    const limiter = createLimiter({ store: make(clock), limits: LIMITS, now: () => clock.now });
    const first = await limiter.tryReserve({ address: 'A', ip: '1.1.1.1' });
    assert.equal(first.allowed, true);
    const again = await limiter.tryReserve({ address: 'A', ip: '2.2.2.2' });
    assert.equal(again.allowed, false);
    assert.equal(again.code, 'ADDRESS_COOLDOWN');
    assert.ok(again.retryAfterMs > 0);
    clock.now += LIMITS.addressCooldownMs + 1;
    assert.equal((await limiter.tryReserve({ address: 'A', ip: '2.2.2.2' })).allowed, true);
  });

  test(`[${kind}] limiter: per-IP window and rollback frees the slot`, async () => {
    const clock = { now: Date.UTC(2026, 10, 7, 12) };
    const limiter = createLimiter({ store: make(clock), limits: LIMITS, now: () => clock.now });
    assert.equal((await limiter.tryReserve({ address: 'A', ip: '9.9.9.9' })).allowed, true);
    const b = await limiter.tryReserve({ address: 'B', ip: '9.9.9.9' });
    assert.equal(b.allowed, true);
    const c = await limiter.tryReserve({ address: 'C', ip: '9.9.9.9' });
    assert.equal(c.allowed, false);
    assert.equal(c.code, 'IP_LIMIT');
    // a rejected request must not burn the address cooldown
    await b.rollback();
    const c2 = await limiter.tryReserve({ address: 'C', ip: '9.9.9.9' });
    assert.equal(c2.allowed, true, 'rolled-back drip frees the IP slot and C was not locked');
    // and B can retry after its own failed drip was rolled back
    assert.equal((await limiter.tryReserve({ address: 'B', ip: '8.8.8.8' })).allowed, true);
  });

  test(`[${kind}] limiter: global daily cap`, async () => {
    const clock = { now: Date.UTC(2026, 10, 7, 12) };
    const limiter = createLimiter({ store: make(clock), limits: LIMITS, now: () => clock.now });
    for (let i = 0; i < 3; i++) {
      assert.equal((await limiter.tryReserve({ address: `A${i}`, ip: `10.0.0.${i}` })).allowed, true);
    }
    const over = await limiter.tryReserve({ address: 'Z', ip: '10.0.0.99' });
    assert.equal(over.allowed, false);
    assert.equal(over.code, 'DAILY_LIMIT');
    assert.equal(await limiter.dailyRemaining(), 0);
    // over-cap attempt did not lock Z's address nor consume the IP slot
    clock.now += 24 * 60 * 60 * 1000; // next UTC day
    assert.equal((await limiter.tryReserve({ address: 'Z', ip: '10.0.0.99' })).allowed, true);
  });
}
