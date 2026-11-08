'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyTurnstile, createCaptchaVerifier, TURNSTILE_VERIFY_URL } = require('../src/captcha');

function fakeFetch(response, capture = {}) {
  return async (url, init) => {
    capture.url = url;
    capture.body = init.body.toString();
    capture.method = init.method;
    if (response instanceof Error) throw response;
    return {
      ok: response.status ? response.status < 400 : true,
      status: response.status || 200,
      json: async () => response.body,
    };
  };
}

test('posts secret, token and remoteip to Cloudflare siteverify', async () => {
  const cap = {};
  const res = await verifyTurnstile({
    secret: 'sek',
    token: 'tok',
    remoteIp: '1.2.3.4',
    fetchImpl: fakeFetch({ body: { success: true, hostname: 'x' } }, cap),
  });
  assert.equal(res.success, true);
  assert.equal(cap.url, TURNSTILE_VERIFY_URL);
  assert.equal(cap.method, 'POST');
  const params = new URLSearchParams(cap.body);
  assert.equal(params.get('secret'), 'sek');
  assert.equal(params.get('response'), 'tok');
  assert.equal(params.get('remoteip'), '1.2.3.4');
});

test('fails closed on missing token, invalid token, HTTP error, network error', async () => {
  assert.equal((await verifyTurnstile({ secret: 's', token: '', fetchImpl: fakeFetch({ body: { success: true } }) })).success, false);
  assert.equal((await verifyTurnstile({ secret: 's', token: 'x'.repeat(5000), fetchImpl: fakeFetch({ body: { success: true } }) })).success, false);
  assert.equal(
    (await verifyTurnstile({ secret: 's', token: 't', fetchImpl: fakeFetch({ body: { success: false, 'error-codes': ['invalid-input-response'] } }) })).success,
    false,
  );
  assert.equal((await verifyTurnstile({ secret: 's', token: 't', fetchImpl: fakeFetch({ status: 500, body: {} }) })).success, false);
  assert.equal((await verifyTurnstile({ secret: 's', token: 't', fetchImpl: fakeFetch(new Error('ECONNRESET')) })).success, false);
});

test('verifier is a pass-through only when captcha disabled (dev without secret)', async () => {
  const off = createCaptchaVerifier({ enabled: false, secret: null });
  assert.deepEqual(await off.verify('', '1.1.1.1'), { success: true, skipped: true });
  const on = createCaptchaVerifier({ enabled: true, secret: 's' }, { fetchImpl: fakeFetch({ body: { success: false } }) });
  assert.equal((await on.verify('t', '1.1.1.1')).success, false);
});
