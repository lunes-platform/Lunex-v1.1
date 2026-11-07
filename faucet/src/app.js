'use strict';

const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { isValidAddress } = require('./address');
const { formatUnits } = require('./units');
const { renderFaucetPage } = require('./page');

/**
 * HTTP layer. All collaborators are injected so the app is testable without
 * a chain: { config, limiter, captcha, dripper, getStatus, log }.
 */
function createApp({ config, limiter, captcha, dripper, getStatus, log = console }) {
  const app = express();
  app.disable('x-powered-by');
  // Only trust X-Forwarded-For when explicitly configured (TRUST_PROXY).
  app.set('trust proxy', config.trustProxy);
  app.use(express.json({ limit: '8kb' }));

  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: config.globalRatePerMinute,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many requests. Slow down.', code: 'RATE_LIMITED' },
    }),
  );

  const allowAny = config.corsOrigins.includes('*');
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (allowAny) {
      res.header('Access-Control-Allow-Origin', '*');
    } else if (origin && config.corsOrigins.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Vary', 'Origin');
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  const publicConfig = () => ({
    network: 'Lunes Testnet',
    native: {
      symbol: config.native.symbol,
      amount: formatUnits(config.native.amount, config.native.decimals),
    },
    tokens: config.tokens.map((t) => ({
      symbol: t.symbol,
      address: t.address,
      amount: formatUnits(t.amount, t.decimals),
    })),
    cooldownMinutes: Math.round(config.limits.addressCooldownMs / 60000),
    ipMaxPerWindow: config.limits.ipMaxPerWindow,
    ipWindowMinutes: Math.round(config.limits.ipWindowMs / 60000),
    captcha: { required: captcha.enabled, provider: 'turnstile', siteKey: config.captcha.siteKey },
  });

  app.get('/health', (_req, res) => {
    const ok = dripper.ready();
    res.status(ok ? 200 : 503).json({ status: ok ? 'healthy' : 'disconnected' });
  });

  // Static JS/CSS for the web UI (no inline script: strict-CSP friendly).
  app.use('/faucet/assets', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h', index: false }));

  app.get('/faucet', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderFaucetPage({ ...publicConfig(), publicRpc: config.publicRpc }));
  });

  app.get('/faucet/config', (_req, res) => res.json(publicConfig()));

  app.get('/faucet/status', async (_req, res) => {
    if (!dripper.ready()) return res.status(503).json({ error: 'Chain not connected', code: 'CHAIN_UNAVAILABLE' });
    try {
      const status = await getStatus();
      res.json({ ...publicConfig(), ...status, dailyDripsRemaining: await limiter.dailyRemaining() });
    } catch (err) {
      log.error('[faucet] status error', err && err.message);
      res.status(500).json({ error: 'Status unavailable', code: 'STATUS_ERROR' });
    }
  });

  app.post('/faucet', async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { address, captchaToken } = body;
    const ip = req.ip;

    if (!isValidAddress(address)) {
      return res.status(400).json({ error: 'Invalid Lunes address.', code: 'INVALID_ADDRESS' });
    }
    if (!dripper.ready()) {
      return res.status(503).json({ error: 'Blockchain not connected. Try again later.', code: 'CHAIN_UNAVAILABLE' });
    }

    const verdict = await captcha.verify(captchaToken, ip);
    if (!verdict.success) {
      return res.status(403).json({ error: 'Captcha verification failed. Please retry.', code: 'CAPTCHA_FAILED' });
    }

    let reservation;
    try {
      reservation = await limiter.tryReserve({ address, ip });
    } catch (err) {
      log.error('[faucet] limiter store error', err && err.message);
      return res.status(503).json({ error: 'Faucet temporarily unavailable.', code: 'STORE_UNAVAILABLE' });
    }
    if (!reservation.allowed) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(reservation.retryAfterMs / 1000))));
      return res.status(429).json({ error: reservation.reason, code: reservation.code, retryAfterMs: reservation.retryAfterMs });
    }

    try {
      const result = await dripper.drip(address);
      log.info(`[faucet] drip finalized to ${address} block=${result.blockHash}`);
      return res.json({
        success: true,
        finalized: true,
        address,
        amount: `${result.sent[0].amount} ${result.sent[0].symbol}`,
        sent: result.sent,
        skipped: result.skipped,
        blockHash: result.blockHash,
        txHash: result.txHash,
      });
    } catch (err) {
      if (err && err.code === 'FINALIZATION_TIMEOUT') {
        // The tx may still be finalized: keep the reservation (no double drip).
        log.warn(`[faucet] drip to ${address} not finalized in time tx=${err.txHash}`);
        return res.status(202).json({
          success: false,
          pending: true,
          txHash: err.txHash,
          error: 'Transaction submitted but not finalized yet. Check your balance in a few minutes.',
          code: 'PENDING_FINALIZATION',
        });
      }
      await reservation.rollback().catch(() => {});
      log.error(`[faucet] drip to ${address} failed: ${err && err.message}`);
      return res.status(502).json({ error: 'Drip failed. Please try again later.', code: 'DRIP_FAILED' });
    }
  });

  return app;
}

module.exports = { createApp };
