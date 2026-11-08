'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseConfig, parseTrustProxy } = require('../src/config');
const { isWellKnownDevSeed, isWellKnownDevAddress } = require('../src/seed');

const PROD_BASE = {
  NODE_ENV: 'production',
  FAUCET_SEED: 'pistol cradle soft vital coral inject arrest damage obey width cart spare',
  TURNSTILE_SECRET: 'secret-xyz',
};

test('production: refuses to start without FAUCET_SEED', () => {
  assert.throws(
    () => parseConfig({ NODE_ENV: 'production', TURNSTILE_SECRET: 's' }),
    /FAUCET_SEED/,
  );
});

test('staging (non-dev): refuses to start without FAUCET_SEED', () => {
  assert.throws(
    () => parseConfig({ NODE_ENV: 'staging', TURNSTILE_SECRET: 's' }),
    /FAUCET_SEED/,
  );
});

test('NODE_ENV unset is treated as non-dev (fail closed)', () => {
  assert.throws(() => parseConfig({}), /FAUCET_SEED/);
});

test('production: rejects well-known dev seeds', () => {
  for (const seed of [
    '//Alice',
    '//Bob',
    '  //alice ',
    'bottom drive obey lake curtain smoke basket hold race lonely fit walk',
    'bottom drive obey lake curtain smoke basket hold race lonely fit walk//Alice',
    '0xe5be9a5092b81bca64be81d212e7f2f9eba183bb7a90954f7b76361f6edb5c0a',
  ]) {
    assert.throws(
      () => parseConfig({ ...PROD_BASE, FAUCET_SEED: seed }),
      /well-known dev seed/,
      `seed should be rejected: ${seed}`,
    );
  }
});

test('production: requires TURNSTILE_SECRET', () => {
  assert.throws(
    () => parseConfig({ ...PROD_BASE, TURNSTILE_SECRET: '' }),
    /TURNSTILE_SECRET/,
  );
});

test('development: falls back to //Alice and captcha disabled when unset', () => {
  const cfg = parseConfig({ NODE_ENV: 'development' });
  assert.equal(cfg.isDev, true);
  assert.equal(cfg.seed, '//Alice');
  assert.equal(cfg.seedIsDevFallback, true);
  assert.equal(cfg.captcha.enabled, false);
});

test('production: valid config parses with sane defaults', () => {
  const cfg = parseConfig(PROD_BASE);
  assert.equal(cfg.isDev, false);
  assert.equal(cfg.captcha.enabled, true);
  assert.equal(cfg.trustProxy, false, 'proxy headers are NOT trusted by default');
  assert.equal(cfg.limits.dailyLimit, 50);
  assert.equal(cfg.limits.ipMaxPerWindow, 3);
  assert.equal(cfg.native.amount, 1000000000000n);
  assert.deepEqual(cfg.tokens, [], 'tokens without address are not configured');
  assert.equal(cfg.redisUrl, null);
});

test('daily cap, per-IP and cooldowns are configurable', () => {
  const cfg = parseConfig({
    ...PROD_BASE,
    FAUCET_DAILY_LIMIT: '2000',
    FAUCET_IP_MAX_PER_WINDOW: '10',
    FAUCET_IP_WINDOW_MINUTES: '60',
    FAUCET_COOLDOWN_MINUTES: '720',
  });
  assert.equal(cfg.limits.dailyLimit, 2000);
  assert.equal(cfg.limits.ipMaxPerWindow, 10);
  assert.equal(cfg.limits.ipWindowMs, 60 * 60 * 1000);
  assert.equal(cfg.limits.addressCooldownMs, 720 * 60 * 1000);
});

test('rejects non-positive / non-numeric limits', () => {
  assert.throws(() => parseConfig({ ...PROD_BASE, FAUCET_DAILY_LIMIT: '0' }), /FAUCET_DAILY_LIMIT/);
  assert.throws(() => parseConfig({ ...PROD_BASE, FAUCET_DAILY_LIMIT: 'abc' }), /FAUCET_DAILY_LIMIT/);
  assert.throws(() => parseConfig({ ...PROD_BASE, FAUCET_DRIP_AMOUNT: '-5' }), /FAUCET_DRIP_AMOUNT/);
});

test('PSP22 test tokens are read from env with configurable amounts/decimals', () => {
  const cfg = parseConfig({
    ...PROD_BASE,
    FAUCET_TOKEN_LUSDT_ADDRESS: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty',
    FAUCET_TOKEN_LUSDT_AMOUNT: '250.5',
    FAUCET_TOKEN_LBTC_ADDRESS: '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y',
  });
  assert.equal(cfg.tokens.length, 2);
  const lusdt = cfg.tokens.find((t) => t.symbol === 'LUSDT');
  assert.equal(lusdt.decimals, 6);
  assert.equal(lusdt.amount, 250500000n);
  const lbtc = cfg.tokens.find((t) => t.symbol === 'LBTC');
  assert.equal(lbtc.decimals, 8);
  assert.ok(lbtc.amount > 0n);
});

test('rejects an invalid token address', () => {
  assert.throws(
    () => parseConfig({ ...PROD_BASE, FAUCET_TOKEN_LUSDT_ADDRESS: 'not-an-address' }),
    /FAUCET_TOKEN_LUSDT_ADDRESS/,
  );
});

test('FAUCET_TOKENS restricts which symbols are dripped', () => {
  const cfg = parseConfig({
    ...PROD_BASE,
    FAUCET_TOKENS: 'LUSDT',
    FAUCET_TOKEN_LUSDT_ADDRESS: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty',
    FAUCET_TOKEN_LBTC_ADDRESS: '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y',
  });
  assert.deepEqual(cfg.tokens.map((t) => t.symbol), ['LUSDT']);
});

test('parseTrustProxy mirrors Express `trust proxy` semantics', () => {
  assert.equal(parseTrustProxy(undefined), false);
  assert.equal(parseTrustProxy(''), false);
  assert.equal(parseTrustProxy('false'), false);
  assert.equal(parseTrustProxy('true'), true);
  assert.equal(parseTrustProxy('1'), 1);
  assert.equal(parseTrustProxy('loopback'), 'loopback');
  assert.equal(parseTrustProxy('10.0.0.0/8, loopback'), '10.0.0.0/8, loopback');
});

test('production: TRUST_PROXY=true (trust everything) is refused', () => {
  assert.throws(() => parseConfig({ ...PROD_BASE, TRUST_PROXY: 'true' }), /TRUST_PROXY/);
});

test('REDIS_URL is picked up', () => {
  const cfg = parseConfig({ ...PROD_BASE, REDIS_URL: 'redis://127.0.0.1:6379/2' });
  assert.equal(cfg.redisUrl, 'redis://127.0.0.1:6379/2');
});

test('isWellKnownDevSeed / isWellKnownDevAddress', () => {
  assert.equal(isWellKnownDevSeed('//Ferdie'), true);
  assert.equal(isWellKnownDevSeed(PROD_BASE.FAUCET_SEED), false);
  assert.equal(isWellKnownDevAddress('5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'), true);
  assert.equal(isWellKnownDevAddress('5DfhGyQdFobKM8NsWvEeAKk5EQQgYe9AydgJ7rMB6E1EqRzV'), true);
  assert.equal(isWellKnownDevAddress('5HYVGHPrMmG6TKeczuTjhaGcRTkW8sMhWfppaFrTCAvKFfBb'), false);
});
