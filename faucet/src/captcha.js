'use strict';

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const MAX_TOKEN_LENGTH = 2048; // Cloudflare documents tokens up to 2048 chars

/** Server-side Cloudflare Turnstile verification. Fails closed on any error. */
async function verifyTurnstile({ secret, token, remoteIp, fetchImpl = globalThis.fetch, timeoutMs = 5000 }) {
  if (typeof token !== 'string' || !token || token.length > MAX_TOKEN_LENGTH) {
    return { success: false, errorCodes: ['missing-input-response'] };
  }
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set('remoteip', remoteIp);
  try {
    const res = await fetchImpl(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { success: false, errorCodes: [`siteverify-http-${res.status}`] };
    const data = await res.json();
    return {
      success: data && data.success === true,
      errorCodes: (data && data['error-codes']) || [],
      hostname: data && data.hostname,
    };
  } catch {
    return { success: false, errorCodes: ['siteverify-unreachable'] };
  }
}

/** `captchaConfig` comes from parseConfig().captcha; disabled only in dev without a secret. */
function createCaptchaVerifier(captchaConfig, { fetchImpl } = {}) {
  if (!captchaConfig.enabled) {
    return { enabled: false, verify: async () => ({ success: true, skipped: true }) };
  }
  return {
    enabled: true,
    verify: (token, remoteIp) =>
      verifyTurnstile({ secret: captchaConfig.secret, token, remoteIp, fetchImpl }),
  };
}

module.exports = { verifyTurnstile, createCaptchaVerifier, TURNSTILE_VERIFY_URL };
