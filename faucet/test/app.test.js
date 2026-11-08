'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { parseConfig } = require('../src/config');
const { createMemoryStore } = require('../src/store');
const { createLimiter } = require('../src/limits');

const VALID = '5HYVGHPrMmG6TKeczuTjhaGcRTkW8sMhWfppaFrTCAvKFfBb';
const VALID_2 = '5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy';

function baseConfig(env = {}) {
  return parseConfig({
    NODE_ENV: 'production',
    FAUCET_SEED: 'pistol cradle soft vital coral inject arrest damage obey width cart spare',
    TURNSTILE_SECRET: 'sek',
    TURNSTILE_SITE_KEY: '0xSITE',
    FAUCET_IP_MAX_PER_WINDOW: '1',
    ...env,
  });
}

async function withServer(opts, fn) {
  const config = opts.config || baseConfig();
  const store = createMemoryStore();
  const limiter = createLimiter({ store, limits: config.limits });
  const calls = { drip: [], captcha: [] };
  const app = createApp({
    config,
    limiter,
    captcha: {
      enabled: config.captcha.enabled,
      verify: async (token, ip) => {
        calls.captcha.push({ token, ip });
        return opts.captchaResult || { success: token === 'good' };
      },
    },
    dripper: {
      ready: () => opts.ready !== false,
      drip: async (address) => {
        calls.drip.push(address);
        if (opts.dripError) throw opts.dripError;
        return {
          blockHash: '0xfinal',
          txHash: '0xtx',
          sent: [
            { symbol: 'LUNES', amount: '10000' },
            { symbol: 'LUSDT', amount: '1000' },
          ],
          skipped: [],
        };
      },
    },
    getStatus: async () => ({ balance: '1 LUNES', faucetAddress: '5F' }),
    log: { info() {}, warn() {}, error() {} },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn({ base, calls });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const post = (base, body, headers = {}) =>
  fetch(`${base}/faucet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

test('rejects invalid addresses before touching captcha or chain', async () => {
  await withServer({}, async ({ base, calls }) => {
    for (const address of [undefined, 42, 'abc', '5' + 'x'.repeat(47), VALID + 'A']) {
      const res = await post(base, { address, captchaToken: 'good' });
      assert.equal(res.status, 400, `address ${address}`);
    }
    assert.equal(calls.captcha.length, 0);
    assert.equal(calls.drip.length, 0);
  });
});

test('requires a valid Turnstile token when captcha is enabled', async () => {
  await withServer({}, async ({ base, calls }) => {
    const res = await post(base, { address: VALID, captchaToken: 'bad' });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, 'CAPTCHA_FAILED');
    assert.equal(calls.drip.length, 0);
  });
});

test('successful drip returns finalized block and token list', async () => {
  await withServer({}, async ({ base, calls }) => {
    const res = await post(base, { address: VALID, captchaToken: 'good' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.finalized, true);
    assert.equal(body.blockHash, '0xfinal');
    assert.deepEqual(body.sent.map((s) => s.symbol), ['LUNES', 'LUSDT']);
    assert.deepEqual(calls.drip, [VALID]);
  });
});

test('second request for the same address is rejected with 429 + Retry-After', async () => {
  await withServer({ config: baseConfig({ FAUCET_IP_MAX_PER_WINDOW: '10' }) }, async ({ base }) => {
    assert.equal((await post(base, { address: VALID, captchaToken: 'good' })).status, 200);
    const res = await post(base, { address: VALID, captchaToken: 'good' });
    assert.equal(res.status, 429);
    assert.equal((await res.json()).code, 'ADDRESS_COOLDOWN');
    assert.ok(Number(res.headers.get('retry-after')) > 0);
  });
});

test('X-Forwarded-For is IGNORED when TRUST_PROXY is unset (no IP spoofing)', async () => {
  await withServer({}, async ({ base, calls }) => {
    assert.equal((await post(base, { address: VALID, captchaToken: 'good' }, { 'X-Forwarded-For': '1.1.1.1' })).status, 200);
    // a different spoofed IP must not bypass the per-IP limit (max 1)
    const res = await post(base, { address: VALID_2, captchaToken: 'good' }, { 'X-Forwarded-For': '2.2.2.2' });
    assert.equal(res.status, 429);
    assert.equal((await res.json()).code, 'IP_LIMIT');
    assert.ok(calls.captcha.every((c) => c.ip !== '1.1.1.1' && c.ip !== '2.2.2.2'));
  });
});

test('X-Forwarded-For is honoured when TRUST_PROXY=loopback (behind local nginx)', async () => {
  await withServer({ config: baseConfig({ TRUST_PROXY: 'loopback' }) }, async ({ base, calls }) => {
    assert.equal((await post(base, { address: VALID, captchaToken: 'good' }, { 'X-Forwarded-For': '1.1.1.1' })).status, 200);
    assert.equal((await post(base, { address: VALID_2, captchaToken: 'good' }, { 'X-Forwarded-For': '2.2.2.2' })).status, 200);
    assert.deepEqual(calls.captcha.map((c) => c.ip), ['1.1.1.1', '2.2.2.2']);
  });
});

test('a failed drip rolls back the reservation so the user can retry', async () => {
  const dripError = new Error('rpc boom');
  await withServer({ dripError }, async ({ base }) => {
    const res = await post(base, { address: VALID, captchaToken: 'good' });
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.code, 'DRIP_FAILED');
    assert.ok(!JSON.stringify(body).includes('rpc boom'), 'internal error text not leaked');
  });
});

test('finalization timeout keeps the reservation and answers 202 pending', async () => {
  const dripError = Object.assign(new Error('Finalization timeout'), { code: 'FINALIZATION_TIMEOUT', txHash: '0xabc' });
  await withServer({ dripError, config: baseConfig({ FAUCET_IP_MAX_PER_WINDOW: '10' }) }, async ({ base }) => {
    const res = await post(base, { address: VALID, captchaToken: 'good' });
    assert.equal(res.status, 202);
    const body = await res.json();
    assert.equal(body.pending, true);
    assert.equal(body.txHash, '0xabc');
    assert.equal((await post(base, { address: VALID, captchaToken: 'good' })).status, 429);
  });
});

test('503 when chain not connected', async () => {
  await withServer({ ready: false }, async ({ base }) => {
    assert.equal((await post(base, { address: VALID, captchaToken: 'good' })).status, 503);
  });
});

test('GET /faucet/config exposes public settings for the DEX (no secrets)', async () => {
  await withServer({}, async ({ base }) => {
    const res = await fetch(`${base}/faucet/config`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.captcha.required, true);
    assert.equal(body.captcha.siteKey, '0xSITE');
    assert.equal(body.native.symbol, 'LUNES');
    assert.ok(Array.isArray(body.tokens));
    const raw = JSON.stringify(body);
    assert.ok(!raw.includes('sek'));
    assert.ok(!raw.includes('pistol'));
  });
});

test('GET /faucet HTML embeds the Turnstile widget when a site key is set', async () => {
  await withServer({}, async ({ base }) => {
    const html = await (await fetch(`${base}/faucet`)).text();
    assert.ok(html.includes('challenges.cloudflare.com/turnstile/v0/api.js'));
    assert.ok(html.includes('data-sitekey="0xSITE"'));
  });
});

test('GET /faucet has no inline <script> (strict CSP) and serves its JS/CSS statically', async () => {
  await withServer({}, async ({ base }) => {
    const html = await (await fetch(`${base}/faucet`)).text();
    const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
    assert.ok(scripts.length > 0);
    for (const [, attrs, body] of scripts) {
      assert.match(attrs, /src=/, 'every script must be external');
      assert.equal(body.trim(), '');
    }
    assert.ok(!/<style/.test(html), 'no inline style block');
    assert.ok(!/ style="/.test(html), 'no inline style attributes');
    const js = await fetch(`${base}/faucet/assets/faucet.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type'), /javascript/);
    assert.match(await js.text(), /captchaToken/);
    assert.equal((await fetch(`${base}/faucet/assets/faucet.css`)).status, 200);
  });
});

test('GET /health', async () => {
  await withServer({}, async ({ base }) => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'healthy');
  });
});
