const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { loadRun, atomicJson, sleep, amountOut } = require('./core.cjs');
const { connect } = require('./chain.cjs');
const ctx = loadRun(process.argv[2]), m = ctx.manifest;
const playwrightPath = process.env.LUNEX_PLAYWRIGHT_PATH || '/Users/lucas/.npm/_npx/c61c9351a0dbcfa7/node_modules/playwright';
let browser, c, latestPage;
const report = { at: new Date().toISOString(), pages: [], errors: [], requestsFailed: [], wsMessages: 0 };
const reportPath = path.join(ctx.dir, 'browser-latest.json');
(async () => {
  c = await connect(ctx);
  const user = c.users[3];
  browser = await require(playwrightPath).chromium.launch({ headless: true, args: ['--disable-background-networking'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  let signatures = 0;
  await context.exposeBinding('soakSign', async (_, kind, payload) => ({ id: ++signatures, signature: kind === 'payload' ? c.api.registry.createType('ExtrinsicPayload', payload, { version: payload.version }).sign(user).signature : '0x' + Buffer.from(user.sign(Buffer.from(payload.data.slice(2), 'hex'))).toString('hex') }));
  await context.addInitScript(({ address }) => {
    const accounts = [{ address, name: 'Soak Trader 4 (local)', type: 'sr25519' }];
    window.injectedWeb3 = { 'polkadot-js': { version: 'soak-local', enable: async () => ({ accounts: { get: async () => accounts, subscribe: cb => { cb(accounts); return () => {}; } }, signer: { signPayload: p => window.soakSign('payload', p), signRaw: p => window.soakSign('raw', p) } }) } };
  }, { address: user.address });
  const page = await context.newPage(); latestPage = page;
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('response', r => { if (r.url().startsWith(m.apiUrl) && r.status() >= 400) report.requestsFailed.push({ path: new URL(r.url()).pathname, status: r.status() }); });
  const uiHashes = [];
  page.on('websocket', ws => {
    ws.on('framereceived', () => report.wsMessages++);
    ws.on('framesent', frame => {
      try {
        const rpc = JSON.parse(String(frame.payload));
        if (String(rpc.method).startsWith('author_submit') && rpc.params?.[0]) {
          const tx = c.api.registry.createType('Extrinsic', rpc.params[0]);
          if (tx.signer.toString() === user.address) { const hash = tx.hash.toHex(); if (!uiHashes.includes(hash)) uiHashes.push(hash); report.submittedTxHashes = [...uiHashes]; atomicJson(reportPath, report); }
        }
      } catch (error) { if (String(frame.payload).includes('author_submit')) { report.rpcCaptureError = error.message; atomicJson(reportPath, report); } }
    });
  });
  page.on('console', msg => { if (/Tx Hash:/.test(msg.text())) { const match = msg.text().match(/0x[0-9a-fA-F]{64}/); if (match) uiHashes.push(match[0]); } });
  await page.goto(m.frontUrl + '/spot', { waitUntil: 'networkidle' });
  await page.getByText('Connect wallet', { exact: true }).click();
  await page.getByText('Lunes', { exact: true }).click();
  await page.waitForFunction(prefix => document.body.innerText.includes(prefix), user.address.slice(0, 6));
  await page.getByRole('button', { name: '✕', exact: true }).click();
  await page.getByRole('button', { name: /^(Load|Refresh) Spot balances$/ }).click();
  await page.getByRole('button', { name: 'Refresh Spot balances', exact: true }).waitFor();
  await page.getByText('Amount (SB46)', { exact: true }).waitFor();
  await page.locator('label').filter({ hasText: /^Price \(SUSD46\)$/ }).waitFor();
  await page.getByRole('tab', { name: 'Sell', exact: true }).click();
  await page.getByRole('tab', { name: 'Limit', exact: true }).click();
  await page.locator('input[type="number"]').nth(0).fill('2'); await page.locator('input[type="number"]').nth(1).fill('1000');
  await page.getByRole('button', { name: '▼ Sell SB46 (Limit)', exact: true }).click();
  const posted = page.waitForResponse(r => r.url().endsWith('/api/v1/orders') && r.request().method() === 'POST');
  await page.getByRole('button', { name: /Confirm Sell$/ }).click();
  const response = await posted, body = await response.json(); assert.equal(response.status(), 201, JSON.stringify(body));
  report.orderId = body.order.id; atomicJson(reportPath, report);
  await page.getByRole('button', { name: 'Cancel', exact: true }).first().waitFor({ timeout: 30000 });
  const cancelled = page.waitForResponse(r => r.request().method() === 'DELETE' && r.url().endsWith('/orders/' + body.order.id), { timeout: 180000 });
  await page.getByRole('button', { name: 'Cancel', exact: true }).first().click(); assert.equal((await cancelled).status(), 200);
  report.pages.push({ path: '/spot', wallet: user.address, signedCreateCancel: true, signatures });
  assert(report.wsMessages > 0, 'missing websocket stream');
  await page.screenshot({ path: path.join(ctx.dir, 'browser-spot-latest.png'), fullPage: true });
  for (const route of ['/swap', '/pool']) {
    await page.goto(m.frontUrl + route, { waitUntil: 'networkidle' }); assert((await page.locator('body').innerText()).length > 200, 'empty ' + route);
    if (route === '/swap') {
      // A full navigation resets SDK wallet permission state; explicitly reconnect.
      const connect = page.getByRole('button', { name: 'Connect Wallet', exact: true }).last();
      if (await connect.count()) await connect.click();
      await page.waitForFunction(() => !document.body.innerText.includes('Connecting...'));
      const usd = c.contract('psp22_token', m.quote);
      const before = BigInt(await c.query(usd, 'balanceOf', [user.address]));
      const nativePair = c.contract('pair_contract', m.nativePair), reserves = await c.query(nativePair, 'getReserves'), token0 = await c.query(nativePair, 'token0');
      const [reserveNative, reserveQuote] = token0 === m.wrapped ? reserves : [reserves[1], reserves[0]];
      const expected = amountOut(1000000n, BigInt(reserveNative), BigInt(reserveQuote));
      const fromBlock = (await c.api.rpc.chain.getHeader()).number.toNumber();
      report.swapBefore = { fromBlock, quoteBalanceRaw: before.toString() }; atomicJson(reportPath, report);
      await page.locator('input#swap-to-amount').locator('xpath=ancestor::div[button][1]').getByRole('button').click();
      await page.locator('input[placeholder="Search token"]').fill('LUSDT');
      await page.locator('p').filter({ hasText: /^LUSDT(?:Lunes|$)/ }).first().click();
      await page.locator('input#swap-from-amount').fill('0.01');
      await page.waitForFunction(() => Number(document.querySelector('input#swap-to-amount').value) > 0, {}, { timeout: 30000 });
      await page.getByRole('button', { name: 'Swap tokens', exact: true }).click();
      await page.getByText('Transaction submitted', { exact: true }).waitFor({ timeout: 120000 });
      assert(uiHashes.length > 0, 'missing frontend swap transaction hash');
      const hash = uiHashes.at(-1); let finalizedBlock, finalizedIndex;
      for (let attempt = 0; attempt < 90 && !finalizedBlock; attempt++) {
        const end = (await c.api.rpc.chain.getHeader(await c.api.rpc.chain.getFinalizedHead())).number.toNumber();
        for (let height = fromBlock; height <= end; height++) {
          const blockHash = await c.api.rpc.chain.getBlockHash(height), block = await c.api.rpc.chain.getBlock(blockHash);
          const index = block.block.extrinsics.findIndex(tx => tx.hash.toHex() === hash);
          if (index >= 0) { finalizedBlock = height; finalizedIndex = index; break; }
        }
        if (!finalizedBlock) await sleep(1000);
      }
      assert(finalizedBlock, 'frontend swap did not finalize');
      const events = await c.api.query.system.events.at(await c.api.rpc.chain.getBlockHash(finalizedBlock));
      assert(events.some(e => e.phase.isApplyExtrinsic && e.phase.asApplyExtrinsic.toNumber() === finalizedIndex && e.event.section === 'system' && e.event.method === 'ExtrinsicSuccess'), 'frontend swap dispatch failed');
      const received = BigInt(await c.query(usd, 'balanceOf', [user.address])) - before; assert.equal(received, expected, 'frontend swap token output');
      report.frontendSwap = { hash, finalizedBlock, dispatchSuccess: true, nativeInputRaw: '1000000', quoteReceivedRaw: received.toString() };
      await page.getByRole('button', { name: 'Close and wait in explorer' }).click();
    }
    report.pages.push({ path: route, rendered: true });
  }
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await mobile.newPage(); p.on('pageerror', e => report.errors.push(e.message));
  await p.goto(m.frontUrl + '/spot', { waitUntil: 'networkidle' }); await p.getByRole('tab', { name: 'Limit', exact: true }).waitFor();
  report.mobile = await p.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert(report.mobile.scrollWidth <= report.mobile.width + 2, 'mobile overflow');
  await p.screenshot({ path: path.join(ctx.dir, 'browser-mobile-latest.png'), fullPage: true });
  assert.deepEqual(report.errors, []); assert.deepEqual(report.requestsFailed, []);
  report.status = 'PASSED'; report.finishedAt = new Date().toISOString(); atomicJson(reportPath, report); ctx.event('browser.verified', report); console.log(JSON.stringify({ status: report.status, signatures, wsMessages: report.wsMessages }));
})().catch(async e => { report.status = 'FAILED'; report.error = e.message; if (latestPage && !latestPage.isClosed()) { report.failureBody = await latestPage.locator('body').innerText().catch(() => ''); await latestPage.screenshot({ path: path.join(ctx.dir, 'browser-failure-latest.png'), fullPage: true }).catch(() => {}); } atomicJson(reportPath, report); console.error(e.stack); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); if (c) await c.api.disconnect(); });
