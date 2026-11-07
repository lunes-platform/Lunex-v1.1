'use strict';

const { isWellKnownDevSeed } = require('./seed');
const { parseUnits } = require('./units');
const { isValidAddress } = require('./address');

const DEV_ENVS = new Set(['development', 'test']);

/** PSP22 test tokens the faucet knows about. Decimals mirror lunes-dex-main tokenRegistry. */
const KNOWN_TOKENS = {
  LUSDT: { decimals: 6, amount: '1000' },
  LBTC: { decimals: 8, amount: '0.05' },
  LETH: { decimals: 8, amount: '1' },
  GMC: { decimals: 8, amount: '1000' },
  LUP: { decimals: 8, amount: '1000' },
};

/**
 * Express `trust proxy` value. Unset/empty/"false" => do not trust any proxy
 * header (req.ip = socket address). Numbers = hop count; anything else is a
 * comma-separated list of IPs/CIDRs/`loopback`/`uniquelocal` passed verbatim.
 */
function parseTrustProxy(raw) {
  if (raw === undefined || raw === null) return false;
  const v = String(raw).trim();
  if (v === '' || v === 'false') return false;
  if (v === 'true') return true;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

function positiveInt(env, name, def) {
  const raw = env[name];
  if (raw === undefined || raw === '') return def;
  if (!/^\d+$/.test(String(raw).trim()) || Number(raw) <= 0) {
    throw new Error(`${name} must be a positive integer (got "${raw}")`);
  }
  return Number(raw);
}

function positiveBigInt(env, name, def) {
  const raw = env[name];
  const v = raw === undefined || raw === '' ? def : String(raw).trim();
  if (!/^\d+$/.test(v) || BigInt(v) <= 0n) {
    throw new Error(`${name} must be a positive integer amount in base units (got "${raw}")`);
  }
  return BigInt(v);
}

function parseTokens(env) {
  const symbols = (env.FAUCET_TOKENS || Object.keys(KNOWN_TOKENS).join(','))
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const tokens = [];
  for (const symbol of symbols) {
    if (!/^[A-Z0-9]{1,12}$/.test(symbol)) throw new Error(`FAUCET_TOKENS: invalid symbol "${symbol}"`);
    const address = (env[`FAUCET_TOKEN_${symbol}_ADDRESS`] || '').trim();
    if (!address) continue; // not configured on this network -> not dripped
    if (!isValidAddress(address)) {
      throw new Error(`FAUCET_TOKEN_${symbol}_ADDRESS is not a valid ss58 address`);
    }
    const known = KNOWN_TOKENS[symbol] || {};
    const decimals = positiveIntOrZero(env, `FAUCET_TOKEN_${symbol}_DECIMALS`, known.decimals);
    if (decimals === undefined) {
      throw new Error(`FAUCET_TOKEN_${symbol}_DECIMALS is required for unknown token ${symbol}`);
    }
    const amountHuman = env[`FAUCET_TOKEN_${symbol}_AMOUNT`] || known.amount;
    if (!amountHuman) throw new Error(`FAUCET_TOKEN_${symbol}_AMOUNT is required for unknown token ${symbol}`);
    let amount;
    try {
      amount = parseUnits(amountHuman, decimals);
    } catch (e) {
      throw new Error(`FAUCET_TOKEN_${symbol}_AMOUNT: ${e.message}`);
    }
    if (amount <= 0n) throw new Error(`FAUCET_TOKEN_${symbol}_AMOUNT must be > 0`);
    tokens.push({ symbol, address, decimals, amount });
  }
  return tokens;
}

function positiveIntOrZero(env, name, def) {
  const raw = env[name];
  if (raw === undefined || raw === '') return def;
  if (!/^\d+$/.test(String(raw).trim()) || Number(raw) > 30) {
    throw new Error(`${name} must be an integer between 0 and 30`);
  }
  return Number(raw);
}

/**
 * Parse and validate the faucet configuration. Throws (=> refuse to start) on
 * anything unsafe. "dev" means NODE_ENV=development|test; an unset NODE_ENV is
 * treated as non-dev so a forgotten variable fails closed.
 */
function parseConfig(env = process.env) {
  const nodeEnv = (env.NODE_ENV || '').trim();
  const isDev = DEV_ENVS.has(nodeEnv);
  const isProduction = nodeEnv === 'production';

  let seed = (env.FAUCET_SEED || '').trim();
  let seedIsDevFallback = false;
  if (!seed) {
    if (!isDev) {
      throw new Error(
        'FAUCET_SEED is required outside development (NODE_ENV=development|test). ' +
          'Fund a dedicated treasury account and inject its mnemonic via the secret manager.',
      );
    }
    seed = '//Alice';
    seedIsDevFallback = true;
  }
  if (isProduction && isWellKnownDevSeed(seed)) {
    throw new Error('FAUCET_SEED is a well-known dev seed (//Alice, dev phrase...) — refused in production');
  }

  const captchaSecret = (env.TURNSTILE_SECRET || '').trim();
  if (!captchaSecret && !isDev) {
    throw new Error('TURNSTILE_SECRET is required outside development (captcha may only be skipped in dev)');
  }

  const trustProxy = parseTrustProxy(env.TRUST_PROXY);
  if (trustProxy === true && !isDev) {
    throw new Error(
      'TRUST_PROXY=true trusts any client-supplied X-Forwarded-For (IP spoofing). ' +
        'Use a hop count (e.g. 1) or the proxy address/CIDR (e.g. loopback, 172.16.0.0/12).',
    );
  }

  const corsOrigins = (env.FAUCET_CORS_ORIGINS || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    nodeEnv,
    isDev,
    isProduction,
    port: positiveInt(env, 'FAUCET_PORT', 3333),
    wsUrl: env.LUNES_WS_URL || 'ws://lunes-testnet-node:9944',
    seed,
    seedIsDevFallback,
    trustProxy,
    corsOrigins,
    redisUrl: (env.REDIS_URL || '').trim() || null,
    redisPrefix: env.FAUCET_REDIS_PREFIX || 'faucet:',
    captcha: {
      enabled: Boolean(captchaSecret),
      secret: captchaSecret || null,
      siteKey: (env.TURNSTILE_SITE_KEY || '').trim() || null,
    },
    native: {
      symbol: 'LUNES',
      decimals: 8,
      amount: positiveBigInt(env, 'FAUCET_DRIP_AMOUNT', '1000000000000'), // 10,000 LUNES
    },
    tokens: parseTokens(env),
    limits: {
      addressCooldownMs: positiveInt(env, 'FAUCET_COOLDOWN_MINUTES', 300) * 60 * 1000,
      ipMaxPerWindow: positiveInt(env, 'FAUCET_IP_MAX_PER_WINDOW', 3),
      ipWindowMs: positiveInt(env, 'FAUCET_IP_WINDOW_MINUTES', 24 * 60) * 60 * 1000,
      dailyLimit: positiveInt(env, 'FAUCET_DAILY_LIMIT', 50),
    },
    globalRatePerMinute: positiveInt(env, 'FAUCET_GLOBAL_RATE_PER_MINUTE', 20),
    finalizeTimeoutMs: positiveInt(env, 'FAUCET_FINALIZE_TIMEOUT_MS', 120000),
    publicRpc: {
      wss: env.FAUCET_PUBLIC_WSS || 'wss://sandbox.lunes.io/ws',
      http: env.FAUCET_PUBLIC_RPC || 'https://sandbox.lunes.io',
    },
  };
}

module.exports = { parseConfig, parseTrustProxy, KNOWN_TOKENS };
