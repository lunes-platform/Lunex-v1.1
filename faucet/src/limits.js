'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;

function fmtWait(ms) {
  const mins = Math.max(1, Math.ceil(ms / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Anti-drain limiter. Reservation is atomic per address (SET NX) and rolled
 * back when the drip fails, so a broken RPC call does not burn a tester's slot,
 * while a racing duplicate request can never double-drip.
 */
function createLimiter({ store, limits, now = Date.now }) {
  const dayKey = () => `daily:${new Date(now()).toISOString().slice(0, 10)}`;

  async function tryReserve({ address, ip }) {
    const addrKey = `addr:${address}`;
    const ipKey = `ip:${ip}`;
    const dKey = dayKey();

    if (!(await store.reserve(addrKey, limits.addressCooldownMs))) {
      const retryAfterMs = await store.ttl(addrKey);
      return {
        allowed: false,
        code: 'ADDRESS_COOLDOWN',
        retryAfterMs,
        reason: `Address already received tokens. Try again in ${fmtWait(retryAfterMs)}.`,
      };
    }

    const ipCount = await store.incr(ipKey, limits.ipWindowMs);
    if (ipCount > limits.ipMaxPerWindow) {
      await store.decr(ipKey);
      await store.release(addrKey);
      const retryAfterMs = await store.ttl(ipKey);
      return {
        allowed: false,
        code: 'IP_LIMIT',
        retryAfterMs,
        reason: `Too many requests from your network. Try again in ${fmtWait(retryAfterMs)}.`,
      };
    }

    const dayCount = await store.incr(dKey, DAY_MS + 60 * 60 * 1000);
    if (dayCount > limits.dailyLimit) {
      await store.decr(dKey);
      await store.decr(ipKey);
      await store.release(addrKey);
      const retryAfterMs = DAY_MS - (now() % DAY_MS);
      return {
        allowed: false,
        code: 'DAILY_LIMIT',
        retryAfterMs,
        reason: 'Daily faucet limit reached. Try again tomorrow (UTC).',
      };
    }

    let rolledBack = false;
    return {
      allowed: true,
      rollback: async () => {
        if (rolledBack) return;
        rolledBack = true;
        await store.release(addrKey);
        await store.decr(ipKey);
        await store.decr(dKey);
      },
    };
  }

  async function dailyRemaining() {
    return Math.max(0, limits.dailyLimit - (await store.count(dayKey())));
  }

  return { tryReserve, dailyRemaining };
}

module.exports = { createLimiter };
