'use strict';
// Served as a static file so the faucet page works under a strict CSP
// (no 'unsafe-inline' in script-src).
(function () {
      var form = document.getElementById('faucetForm');
      var btn = document.getElementById('requestBtn');
      var result = document.getElementById('result');
      function show(kind, text) { result.className = 'result ' + kind; result.textContent = text; }
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        var address = document.getElementById('address').value.trim();
        var tokenEl = document.querySelector('[name="cf-turnstile-response"]');
        var captchaToken = tokenEl ? tokenEl.value : undefined;
        btn.disabled = true;
        show('loading', 'Submitting and waiting for finalization...');
        try {
          var res = await fetch('/faucet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: address, captchaToken: captchaToken }) });
          var data = await res.json();
          if (data.success) {
            var sent = (data.sent || []).map(function (s) { return s.amount + ' ' + s.symbol; }).join(', ');
            show('success', 'Sent: ' + sent + ' | finalized block ' + String(data.blockHash).slice(0, 18) + '...');
          } else {
            show('error', data.error || 'Unknown error');
          }
        } catch (err) {
          show('error', 'Network error');
        }
        if (window.turnstile) { try { window.turnstile.reset(); } catch (_) {} }
        btn.disabled = false;
      });
    })();
