/**
 * Lunes Testnet Faucet
 *
 * Drips native LUNES + configured PSP22 test tokens (LUSDT, LBTC, LETH, GMC,
 * LUP) from a dedicated treasury account (FAUCET_SEED), behind Cloudflare
 * Turnstile and per-address / per-IP / daily limits persisted in Redis.
 *
 *   POST /faucet          { "address": "5...", "captchaToken": "..." }
 *   GET  /faucet          Web UI
 *   GET  /faucet/config   Public settings (amounts, captcha site key)
 *   GET  /faucet/status   Balance + remaining daily drips
 *   GET  /health
 *
 * See .env.example for every variable.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { ApiPromise, WsProvider } = require('@polkadot/api');
const { ContractPromise } = require('@polkadot/api-contract');
const { Keyring } = require('@polkadot/keyring');
const { cryptoWaitReady } = require('@polkadot/util-crypto');

const { parseConfig } = require('./src/config');
const { isWellKnownDevAddress } = require('./src/seed');
const { createMemoryStore, createRedisStore } = require('./src/store');
const { createLimiter } = require('./src/limits');
const { createCaptchaVerifier } = require('./src/captcha');
const { createDripper } = require('./src/drip');
const { createApp } = require('./src/app');

const PSP22_ABI = JSON.parse(fs.readFileSync(path.join(__dirname, 'abis', 'PSP22.json'), 'utf8'));

async function createStore(config) {
  if (!config.redisUrl) {
    if (!config.isDev) {
      console.warn('[faucet] REDIS_URL not set: cooldowns are in-memory and reset on restart');
    }
    return createMemoryStore();
  }
  const Redis = require('ioredis');
  const client = new Redis(config.redisUrl, { maxRetriesPerRequest: 2, enableOfflineQueue: false, lazyConnect: true });
  client.on('error', (e) => console.error('[faucet] redis error:', e.message));
  await client.connect();
  console.log('[faucet] Using Redis store for cooldowns');
  return createRedisStore(client, { prefix: config.redisPrefix });
}

async function main() {
  let config;
  try {
    config = parseConfig(process.env);
  } catch (err) {
    console.error(`[faucet] Refusing to start: ${err.message}`);
    process.exit(1);
  }

  await cryptoWaitReady();
  const signer = new Keyring({ type: 'sr25519' }).addFromUri(config.seed);
  if (config.isProduction && isWellKnownDevAddress(signer.address)) {
    console.error('[faucet] Refusing to start: FAUCET_SEED derives a well-known dev account');
    process.exit(1);
  }
  if (config.seedIsDevFallback) {
    console.warn('[faucet] DEV MODE: FAUCET_SEED not set, using //Alice (development only)');
  }
  if (!config.captcha.enabled) {
    console.warn('[faucet] DEV MODE: TURNSTILE_SECRET not set, captcha disabled');
  }

  const store = await createStore(config);
  const limiter = createLimiter({ store, limits: config.limits });
  const captcha = createCaptchaVerifier(config.captcha);

  console.log(`[faucet] Connecting to ${config.wsUrl}...`);
  const api = await ApiPromise.create({ provider: new WsProvider(config.wsUrl) });
  const [chain, nodeName, nodeVersion] = await Promise.all([
    api.rpc.system.chain(),
    api.rpc.system.name(),
    api.rpc.system.version(),
  ]);
  console.log(`[faucet] Connected to ${chain} (${nodeName} v${nodeVersion})`);
  console.log(`[faucet] Faucet account: ${signer.address}`);

  const dripper = createDripper({
    api,
    signer,
    native: config.native,
    tokens: config.tokens,
    createContract: (address) => new ContractPromise(api, PSP22_ABI, address),
    finalizeTimeoutMs: config.finalizeTimeoutMs,
    isReady: () => api.isConnected,
    log: console,
  });

  const getStatus = async () => {
    const { data } = await api.query.system.account(signer.address);
    return { faucetAddress: signer.address, balance: data.free.toHuman() };
  };

  const { data: balance } = await api.query.system.account(signer.address);
  console.log(`[faucet] Balance: ${balance.free.toHuman()} | tokens: ${config.tokens.map((t) => t.symbol).join(', ') || 'none'}`);

  const app = createApp({ config, limiter, captcha, dripper, getStatus, log: console });
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`[faucet] Faucet live on port ${config.port} (trust proxy: ${JSON.stringify(config.trustProxy)})`);
  });
}

main().catch((err) => {
  console.error('[faucet] Fatal:', err);
  process.exit(1);
});
