'use strict';

const esc = (v) =>
  String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Standalone faucet web UI (GET /faucet). Values come from public config only. */
function renderFaucetPage(view) {
  const native = `${esc(view.native.amount)} ${esc(view.native.symbol)}`;
  const tokenList = view.tokens.map((t) => `${esc(t.amount)} ${esc(t.symbol)}`).join(' + ');
  const perRequest = tokenList ? `${native} + ${tokenList}` : native;
  const cooldownHours = Math.max(1, Math.round(view.cooldownMinutes / 60));
  const siteKey = view.captcha.required && view.captcha.siteKey ? esc(view.captcha.siteKey) : '';
  const turnstileScript = siteKey
    ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>'
    : '';
  const turnstileWidget = siteKey
    ? `<div class="cf-turnstile" data-sitekey="${siteKey}" data-theme="dark"></div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Lunes Testnet Faucet — Test tokens (no real value)</title>
  <meta name="description" content="Lunes testnet faucet. Test tokens have no monetary value.">
  ${turnstileScript}
  <link rel="stylesheet" href="/faucet/assets/faucet.css">
</head>
<body>
  <div class="container">
    <div class="card">
      <h1>Lunes Testnet Faucet</h1>
      <p class="subtitle">Per request: ${perRequest}</p>
      <p class="warn">Testnet only. These tokens have no monetary value, cannot be redeemed and balances may be reset at any time.</p>
      <form id="faucetForm">
        <label for="address">Lunes address</label>
        <input type="text" id="address" name="address" placeholder="5YourLunesAddress..." autocomplete="off" spellcheck="false">
        ${turnstileWidget}
        <button type="submit" class="btn" id="requestBtn">Request test tokens</button>
      </form>
      <div class="result" id="result"></div>
      <div class="rules">
        <ul>
          <li>${cooldownHours}h cooldown per address</li>
          <li>Max ${esc(view.ipMaxPerWindow)} requests per network every ${esc(Math.round(view.ipWindowMinutes / 60))}h</li>
          <li>RPC: <code>${esc(view.publicRpc.wss)}</code></li>
        </ul>
      </div>
    </div>
  </div>
  <script src="/faucet/assets/faucet.js" defer></script>
</body>
</html>`;
}

module.exports = { renderFaucetPage };
