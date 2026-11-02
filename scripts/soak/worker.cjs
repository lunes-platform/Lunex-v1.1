const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { loadRun, sleep, atomicJson, resumeSafety, amountOut, swapPlan, spotDeltas, windowState, acquireLock } = require('./core.cjs');
const { connect } = require('./chain.cjs');
const dir = process.argv[2];
const verifyLiquidity = process.argv.includes('--verify-liquidity');
const canary = process.argv.includes('--canary') || verifyLiquidity;
const recipes = ['limit_partial_full', 'market_buy', 'market_sell', 'ioc_partial', 'fok_insufficient', 'fok_full', 'stop_buy', 'stop_sell', 'stop_limit_buy', 'stop_limit_sell', 'price_priority', 'time_priority', 'cancel_auth'];
let ending = false;
process.on('SIGTERM', () => { ending = true; }); process.on('SIGINT', () => { ending = true; });

async function main() {
  const ctx = loadRun(dir), m = ctx.manifest, s = ctx.state;
  const release = acquireLock(path.join(dir, 'worker.lock'));
  process.once('exit', release);
  s.pid = process.pid; ctx.save();
  if (!resumeSafety(s)) { s.financialHalted = 'Interrupted financial operation; inspect activeOperation/pendingTx/pendingRequest before any replay'; ctx.save(); }
  const env = ctx.dep('dotenv').parse(fs.readFileSync(path.join(dir, 'api.env')));
  const dbUrl = new URL(env.DATABASE_URL); assert.equal(dbUrl.pathname, '/' + m.database);
  const { PrismaClient } = ctx.dep('@prisma/client'); const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  const auth = require(path.join(dir, 'runtime/api/dist/middleware/auth.js'));
  const c = await connect(ctx), users = c.users;
  const vault = c.contract('spot_settlement_contract', m.spot), base = c.contract('psp22_token', m.base), quote = c.contract('psp22_token', m.quote), pair = c.contract('pair_contract', m.pair), router = c.contract('router_contract', m.router), wrapped = c.contract('wnative_contract', m.wrapped);
  const count = (key, amount = 1) => { s.counters[key] = (s.counters[key] || 0) + amount; ctx.save(); };
  const volume = (key, raw) => { s.volumes[key] = String(BigInt(s.volumes[key] || '0') + raw); ctx.save(); };
  const nonce = () => { s.nonceSequence = (s.nonceSequence || 0) + 1; ctx.save(); return String(BigInt(Date.now()) * 1000000n + BigInt(s.nonceSequence)); };
  let monitoringStopped = false;
  const WebSocket = ctx.dep('ws');
  let ws;
  const monitor = (async () => {
    while (!monitoringStopped) {
      if (!ws || ws.readyState === WebSocket.CLOSED) {
        ws = new WebSocket(m.wsUrl, { origin: m.frontUrl });
        ws.on('open', () => ws.send(JSON.stringify({ action: 'subscribe', channel: 'orderbook:' + m.symbol })));
        ws.on('message', data => { try { const frame = JSON.parse(String(data)); if (frame.channel === 'orderbook:' + m.symbol) count('ws.bookFrames'); } catch { count('ws.invalidFrames'); } });
        ws.on('error', () => count('ws.errors'));
      }
      try {
        const at = Date.now(), response = await fetch(m.apiUrl + '/api/v1/orderbook/' + encodeURIComponent(m.symbol), { signal: AbortSignal.timeout(5000) });
        await response.arrayBuffer(); count('readPulse.' + response.status); ctx.event('read.pulse', { status: response.status, ms: Date.now() - at });
        if (response.status === 429) await sleep(Math.min(60000, Number(response.headers.get('retry-after') || 5) * 1000));
      } catch (e) { count('readPulse.errors'); ctx.event('read.pulseError', { error: e.message }); }
      for (let i = 0; i < 3 && !monitoringStopped; i++) await sleep(1000);
    }
  })();
  function sign(user, action, fields) { const metadata = { nonce: nonce(), timestamp: Date.now() }; return { ...metadata, signature: '0x' + Buffer.from(user.sign(Buffer.from(auth.buildWalletActionMessage({ action, address: user.address, ...metadata, fields })))).toString('hex') }; }
  async function request(route, method = 'GET', body) {
    for (let retry = 0; retry < 3; retry++) {
      if (method !== 'GET') { s.pendingRequest = { route, method, nonce: body?.nonce, at: Date.now() }; ctx.save(); }
      const start = Date.now();
      const response = await fetch(m.apiUrl + '/api/v1' + route, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(180000) });
      const data = await response.json();
      if (response.status < 500) { s.pendingRequest = null; ctx.save(); }
      count('http.' + response.status); ctx.event('http', { route: route.split('?')[0], method, status: response.status, ms: Date.now() - start });
      if (response.status === 429) { await sleep(Math.max(1000, Math.min(60000, Number(response.headers.get('retry-after') || 5) * 1000))); continue; }
      assert(response.status < 500, 'API error ' + response.status + ': ' + JSON.stringify(data));
      return { status: response.status, data };
    }
    throw new Error('rate limit persisted');
  }
  function orderBody(user, values = {}) {
    const body = { pairSymbol: m.symbol, side: 'SELL', type: 'LIMIT', price: '2', amount: '1000', timeInForce: 'GTC', ...values, makerAddress: user.address, nonce: nonce(), timestamp: Date.now() };
    if (['MARKET', 'STOP'].includes(body.type)) delete body.price;
    body.signature = '0x' + Buffer.from(user.sign(Buffer.from(auth.buildSpotOrderMessage(body)))).toString('hex'); return body;
  }
  async function create(user, values) {
    const r = await request('/orders', 'POST', orderBody(user, values)); assert.equal(r.status, 201, JSON.stringify(r.data));
    s.activeOperation.orderIds.push(r.data.order.id); ctx.save(); count('orders.created'); return r.data.order;
  }
  async function cancel(user, id) { const r = await request('/orders/' + id, 'DELETE', { makerAddress: user.address, ...sign(user, 'orders.cancel', { orderId: id }) }); assert.equal(r.status, 200, JSON.stringify(r.data)); count('orders.cancelled'); }
  const getOrder = id => db.order.findUniqueOrThrow({ where: { id } });
  async function status(id, expected, filled) { const o = await getOrder(id); assert.equal(o.status, expected); if (filled !== undefined) assert.equal(o.filledAmount.toString(), String(filled)); }
  async function ledger() {
    const out = { users: {}, fees: BigInt(await c.query(vault, 'getCollectedFees', [m.quote])), custodyBase: BigInt(await c.query(base, 'balanceOf', [m.spot])), custodyQuote: BigInt(await c.query(quote, 'balanceOf', [m.spot])) };
    for (const user of users) out.users[user.address] = { base: BigInt(await c.query(vault, 'getBalance', [user.address, m.base])), quote: BigInt(await c.query(vault, 'getBalance', [user.address, m.quote])), native: BigInt(await c.query(vault, 'getBalance', [user.address, m.native])) };
    assert.equal(Object.values(out.users).reduce((n, u) => n + u.base, 0n), out.custodyBase, 'vault base custody');
    assert.equal(Object.values(out.users).reduce((n, u) => n + u.quote, out.fees), out.custodyQuote, 'vault quote custody');
    return out;
  }
  async function waitTrades(ids) {
    for (let i = 0; i < 180; i++) {
      const rows = await db.trade.findMany({ where: { OR: [{ makerOrderId: { in: ids } }, { takerOrderId: { in: ids } }] } });
      if (!rows.some(t => t.settlementStatus === 'PENDING' || t.settlementStatus === 'SETTLING')) {
        for (const row of rows) assert.equal(row.settlementStatus, 'SETTLED', row.settlementError || 'trade not settled');
        return rows;
      }
      await sleep(1000);
    }
    throw new Error('settlement timeout');
  }
  async function conservation(before, rows) {
    const after = await ledger(); const d = spotDeltas(rows.map(r => ({ ...r, price: r.price.toString(), amount: r.amount.toString() })), 8, 6);
    for (const user of users) {
      assert.equal(after.users[user.address].base - before.users[user.address].base, d[user.address]?.base || 0n, 'base delta');
      assert.equal(after.users[user.address].quote - before.users[user.address].quote, d[user.address]?.quote || 0n, 'quote delta');
      assert.equal(after.users[user.address].native, before.users[user.address].native, 'native ledger changed');
    }
    assert.equal(after.fees - before.fees, d.fees, 'fee delta');
    assert.equal(after.custodyBase, before.custodyBase); assert.equal(after.custodyQuote, before.custodyQuote);
    for (const row of rows) { assert(row.txHash, 'settled without tx hash'); count('trades.settled'); volume('spotBaseRaw', BigInt(row.amount.mul(100000000).toFixed(0))); volume('spotQuoteRaw', BigInt(row.amount.mul(row.price).mul(1000000).toFixed(0))); }
    ctx.event('spot.conservation', { recipe: s.activeOperation.kind, before, after, trades: rows.map(r => ({ id: r.id, txHash: r.txHash, amount: r.amount.toString(), price: r.price.toString(), settlementStatus: r.settlementStatus })) });
  }
  async function book(kind, index) {
    const seller = users[index % 4], buyer = users[(index + 1) % 4];
    const amount = String([1000, 5000, 10000, 50000][index % 4]);
    const before = await ledger();
    const make = values => create(seller, { amount, ...values });
    const buy = values => create(buyer, { side: 'BUY', amount, ...values });
    const cross = async price => { await make({ price, amount: '10' }); await buy({ price, amount: '10' }); };
    if (kind === 'limit_partial_full') { const o = await make({ amount: String(Number(amount) * 2) }); await buy(); await status(o.id, 'PARTIAL', amount); await buy(); await status(o.id, 'FILLED', Number(amount) * 2); }
    if (kind === 'market_buy') { await make(); await make({ price: '2.1' }); const o = await buy({ type: 'MARKET', amount: String(Number(amount) * 1.5), timeInForce: 'IOC' }); await status(o.id, 'FILLED'); }
    if (kind === 'market_sell') { await buy(); await buy({ price: '1.9' }); const o = await make({ type: 'MARKET', amount: String(Number(amount) * 1.5), timeInForce: 'IOC' }); await status(o.id, 'FILLED'); }
    if (kind === 'ioc_partial') { await make(); const o = await buy({ amount: String(Number(amount) * 2), timeInForce: 'IOC' }); await status(o.id, 'CANCELLED', amount); }
    if (kind === 'fok_insufficient') { const maker = await make(); const o = await buy({ amount: String(Number(amount) * 2), timeInForce: 'FOK' }); await status(o.id, 'CANCELLED', '0'); await status(maker.id, 'OPEN', '0'); }
    if (kind === 'fok_full') { await make(); await make({ price: '2.1' }); const o = await buy({ price: '2.1', amount: String(Number(amount) * 2), timeInForce: 'FOK' }); await status(o.id, 'FILLED'); }
    if (kind.startsWith('stop')) {
      await cross('2'); const isBuy = kind.endsWith('buy'), isLimit = kind.startsWith('stop_limit');
      const o = await (isBuy ? buy : make)({ type: isLimit ? 'STOP_LIMIT' : 'STOP', stopPrice: isBuy ? '3' : '1.5', price: isBuy ? '3.2' : '1.4' });
      await status(o.id, 'PENDING_TRIGGER');
      if (isBuy) await make({ price: isLimit ? '3.5' : '3.1' }); else await buy({ price: isLimit ? '1.3' : '1.4' });
      await cross(isBuy ? '3' : '1.5');
      if (isLimit) { await status(o.id, 'OPEN'); if (isBuy) await make({ price: '3.1' }); else await buy({ price: '1.6' }); }
      await status(o.id, 'FILLED');
    }
    if (kind === 'price_priority') { const high = await make({ price: '2.2' }); const low = await make(); await buy({ price: '2.2' }); await status(low.id, 'FILLED'); await status(high.id, 'OPEN'); }
    if (kind === 'time_priority') { const first = await make(); const second = await make(); await buy(); await status(first.id, 'FILLED'); await status(second.id, 'OPEN'); }
    if (kind === 'cancel_auth') {
      const body = orderBody(seller, { amount }); const r = await request('/orders', 'POST', body); assert.equal(r.status, 201); s.activeOperation.orderIds.push(r.data.order.id); ctx.save(); count('orders.created');
      assert.equal((await request('/orders', 'POST', body)).status, 401);
      const altered = orderBody(buyer, { side: 'BUY', amount }); altered.timeInForce = 'FOK'; assert.equal((await request('/orders', 'POST', altered)).status, 401);
      const expired = orderBody(buyer, { side: 'BUY', expiresAt: new Date(Date.now() - 10000).toISOString() }); assert.equal((await request('/orders', 'POST', expired)).status, 400);
      const noFunds = orderBody(seller, { amount: '999999999999' }); assert.equal((await request('/orders', 'POST', noFunds)).status, 400);
      assert.equal((await request('/orders/' + r.data.order.id, 'DELETE', { makerAddress: buyer.address, ...sign(buyer, 'orders.cancel', { orderId: r.data.order.id }) })).status, 403); count('negativeChecks', 5);
    }
    const rows = await waitTrades(s.activeOperation.orderIds);
    if (kind === 'fok_insufficient' || kind === 'cancel_auth') assert.equal(rows.length, 0);
    await conservation(before, rows);
    const open = await db.order.findMany({ where: { id: { in: s.activeOperation.orderIds }, status: { in: ['OPEN', 'PARTIAL', 'PENDING_TRIGGER'] } } });
    for (const o of open) await cancel(users.find(u => u.address === o.makerAddress), o.id);
    assert.equal(await db.order.count({ where: { status: { in: ['OPEN', 'PARTIAL', 'PENDING_TRIGGER'] } } }), 0, 'book must be clean between recipes');
    count('recipe.' + kind);
  }
  async function reserves() { const r = await c.query(pair, 'getReserves'); const token0 = await c.query(pair, 'token0'); return token0 === m.base ? [BigInt(r[0]), BigInt(r[1])] : [BigInt(r[1]), BigInt(r[0])]; }
  async function swap(index) {
    const plan = swapPlan(index), user = users[plan.userIndex], reverse = plan.reverse;
    const [a, b] = await reserves(), input = BigInt(plan.units) * (reverse ? 1000000n : 100000000n);
    const expected = amountOut(input, reverse ? b : a, reverse ? a : b), min = expected * 995n / 1000n;
    const from = reverse ? quote : base, to = reverse ? base : quote;
    const beforeIn = BigInt(await c.query(from, 'balanceOf', [user.address])), beforeOut = BigInt(await c.query(to, 'balanceOf', [user.address]));
    const tx = await c.send(router, 'swapExactTokensForTokens', [input, min, reverse ? [m.quote, m.base] : [m.base, m.quote], user.address, Date.now() + 180000], user);
    const afterIn = BigInt(await c.query(from, 'balanceOf', [user.address])), afterOut = BigInt(await c.query(to, 'balanceOf', [user.address]));
    assert.equal(beforeIn - afterIn, input); assert.equal(afterOut - beforeOut, expected); assert(expected >= min);
    const [aa, bb] = await reserves(); assert.equal(aa, reverse ? a - expected : a + input); assert.equal(bb, reverse ? b + input : b - expected); assert(aa * bb >= a * b, 'AMM product decreased');
    count('swaps.finalized'); volume(reverse ? 'swapQuoteInputRaw' : 'swapBaseInputRaw', input); ctx.event('swap.verified', { reverse, input, expected, min, txHash: tx.hash });
  }
  async function extras(kind, index) {
    const user = users[index % 4];
    if (kind === 'wrap') {
      const before = BigInt(await c.query(wrapped, 'balanceOf', [user.address])); await c.send(wrapped, 'deposit', [], user, 10000000n);
      assert.equal(BigInt(await c.query(wrapped, 'balanceOf', [user.address])) - before, 10000000n);
      await c.send(wrapped, 'withdraw', [10000000n], user); assert.equal(BigInt(await c.query(wrapped, 'balanceOf', [user.address])), before); count('wrapUnwrap.cycles');
    }
    if (kind === 'vault') {
      const before = await ledger(), wallet = BigInt(await c.query(base, 'balanceOf', [user.address])); const raw = 100n * 100000000n;
      await c.send(vault, 'withdrawPsp22', [m.base, raw], user); assert.equal(BigInt(await c.query(base, 'balanceOf', [user.address])) - wallet, raw); assert.equal(BigInt(await c.query(vault, 'getBalance', [user.address, m.base])), before.users[user.address].base - raw);
      await c.send(base, 'approve', [m.spot, raw], user); await c.send(vault, 'depositPsp22', [m.base, raw], user);
      const nativeBefore = BigInt((await c.api.query.system.account(m.spot)).data.free.toString());
      await c.send(vault, 'withdrawNative', [10000000n], user); assert.equal(BigInt((await c.api.query.system.account(m.spot)).data.free.toString()), nativeBefore - 10000000n);
      await c.send(vault, 'depositNative', [], user, 10000000n); assert.deepEqual(await ledger(), before); assert.equal(BigInt(await c.query(base, 'balanceOf', [user.address])), wallet); count('vault.cycles');
    }
    if (kind === 'liquidity') {
      const [a, b] = await reserves(), input = 1000n * 100000000n, output = input * b / a;
      const lpBefore = BigInt(await c.query(pair, 'balanceOf', [c.lp.address]));
      const beforeBase = BigInt(await c.query(base, 'balanceOf', [c.lp.address])), beforeQuote = BigInt(await c.query(quote, 'balanceOf', [c.lp.address]));
      await c.send(router, 'addLiquidity', [m.base, m.quote, input, output, input * 99n / 100n, output * 99n / 100n, c.lp.address, Date.now() + 180000]);
      const minted = BigInt(await c.query(pair, 'balanceOf', [c.lp.address])) - lpBefore; assert(minted > 0n);
      const depositedA = beforeBase - BigInt(await c.query(base, 'balanceOf', [c.lp.address])), depositedB = beforeQuote - BigInt(await c.query(quote, 'balanceOf', [c.lp.address])); assert(depositedA > 0n && depositedB > 0n);
      await c.send(pair, 'approve', [m.router, minted]);
      const removeA = BigInt(await c.query(base, 'balanceOf', [c.lp.address])), removeB = BigInt(await c.query(quote, 'balanceOf', [c.lp.address]));
      const poolA = BigInt(await c.query(base, 'balanceOf', [m.pair])), poolB = BigInt(await c.query(quote, 'balanceOf', [m.pair])), totalSupply = BigInt(await c.query(pair, 'totalSupply'));
      assert.equal(BigInt(await c.query(pair, 'balanceOf', [m.pair])), 0n, 'unexpected LP already held by pair');
      const expectedA = minted * poolA / totalSupply, expectedB = minted * poolB / totalSupply;
      await c.send(router, 'removeLiquidity', [m.base, m.quote, minted, depositedA * 99n / 100n, depositedB * 99n / 100n, c.lp.address, Date.now() + 180000]);
      assert.equal(BigInt(await c.query(pair, 'balanceOf', [c.lp.address])), lpBefore);
      assert.equal(BigInt(await c.query(base, 'balanceOf', [c.lp.address])) - removeA, expectedA); assert.equal(BigInt(await c.query(quote, 'balanceOf', [c.lp.address])) - removeB, expectedB);
      assert.equal(BigInt(await c.query(base, 'balanceOf', [m.pair])), poolA - expectedA); assert.equal(BigInt(await c.query(quote, 'balanceOf', [m.pair])), poolB - expectedB);
      ctx.event('liquidity.verified', { minted, expectedA, expectedB, poolA, poolB, totalSupply }); count('liquidity.cycles');
    }
  }
  async function runOperation(kind, fn) {
    if (!canary && (ending || windowState(JSON.parse(fs.readFileSync(path.join(dir, 'control.json')))) !== 'RUNNING')) return;
    s.activeOperation = { kind, at: Date.now(), orderIds: [] }; ctx.save(); ctx.event('operation.start', { operation: kind });
    const started = Date.now(); await fn();
    s.activeOperation = null; s.lastSuccessAt = new Date().toISOString(); ctx.save(); ctx.event('operation.passed', { operation: kind, ms: Date.now() - started });
  }
  async function readLoad() {
    for (const route of ['/pairs', '/orderbook/' + encodeURIComponent(m.symbol), '/trades?symbol=' + encodeURIComponent(m.symbol) + '&limit=20']) { const r = await request(route); assert.equal(r.status, 200, route); }
    const user = users[s.cycles % 4]; const fields = { limit: 20, offset: 0 }; const signed = sign(user, 'orders.list', fields);
    const r = await request('/orders?' + new URLSearchParams({ makerAddress: user.address, ...fields, ...signed })); assert.equal(r.status, 200); count('readBatches');
    const trades = await request('/trades?' + new URLSearchParams({ address: user.address, ...fields, ...sign(user, 'trades.list', fields) })); assert.equal(trades.status, 200);
    const balances = await request('/balances?' + new URLSearchParams({ address: user.address, ...sign(user, 'balances.list', {}) })); assert.equal(balances.status, 200);
  }
  async function browserCheck() {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--max-old-space-size=512', path.join(__dirname, 'browser.cjs'), dir], { stdio: ['ignore', 'pipe', 'pipe'] });
      let output = ''; child.stdout.on('data', d => { output = (output + d).slice(-4000); }); child.stderr.on('data', d => { output = (output + d).slice(-4000); });
      const timer = setTimeout(() => child.kill('SIGTERM'), 240000);
      child.on('error', reject); child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('browser failed: ' + output)); });
    });
    const browserReport = JSON.parse(fs.readFileSync(path.join(dir, 'browser-latest.json')));
    assert.equal(browserReport.status, 'PASSED'); assert(browserReport.frontendSwap?.finalizedBlock);
    count('frontendSwaps.finalized'); volume('frontendSwapNativeInputRaw', BigInt(browserReport.frontendSwap.nativeInputRaw)); volume('frontendSwapQuoteOutputRaw', BigInt(browserReport.frontendSwap.quoteReceivedRaw));
    count('browser.passed'); s.lastBrowserAt = Date.now(); ctx.save();
  }
  try {
    assert.equal(await c.query(vault, 'isSignatureVerificationEnforced'), true);
    if (s.financialHalted) { ctx.event('financial.halted', { reason: s.financialHalted }); return; }
    if (verifyLiquidity) {
      const previous = JSON.parse(fs.readFileSync(path.join(dir, 'canary.json'))); assert.equal(previous.status, 'PASSED');
      await runOperation('liquidity.precise', () => extras('liquidity', 0));
      previous.preciseLiquidityAt = new Date().toISOString(); previous.counters = s.counters; atomicJson(path.join(dir, 'canary.json'), previous); ctx.event('canary.preciseLiquidityPassed'); return;
    }
    if (canary) {
      s.canaryCompleted ||= [];
      const check = async (label, fn) => { if (s.canaryCompleted.includes(label)) return; assert(!ending, 'canary interrupted'); await runOperation(label, fn); s.canaryCompleted.push(label); ctx.save(); };
      for (let i = 0; i < recipes.length; i++) await check(recipes[i], () => book(recipes[i], i));
      for (let i = 0; i < 2; i++) await check('swap.' + i, () => swap(i));
      for (const kind of ['wrap', 'vault', 'liquidity']) await check(kind, () => extras(kind, 0));
      await check('readLoad', readLoad); await check('browser', browserCheck);
      s.canaryPassedAt = new Date().toISOString(); ctx.save(); atomicJson(path.join(dir, 'canary.json'), { status: 'PASSED', at: s.canaryPassedAt, counters: s.counters, volumes: s.volumes }); ctx.event('canary.passed'); return;
    }
    while (!ending && windowState(JSON.parse(fs.readFileSync(path.join(dir, 'control.json')))) === 'RUNNING') {
      const start = Date.now(), i = s.cycles, kind = recipes[i % recipes.length];
      try { await readLoad(); } catch (error) { ctx.event('read.transientFailure', { error: error.message }); await sleep(30000); continue; }
      await runOperation(kind, () => book(kind, i));
      await runOperation('swap', () => swap(i));
      if (i % 10 === 0) await runOperation(['wrap', 'vault', 'liquidity'][Math.floor(i / 10) % 3], () => extras(['wrap', 'vault', 'liquidity'][Math.floor(i / 10) % 3], i));
      if (!s.lastBrowserAt || Date.now() - s.lastBrowserAt >= m.browserEveryMs) await runOperation('browser', browserCheck);
      s.cycles++; ctx.save(); ctx.event('cycle.passed', { cycle: s.cycles, ms: Date.now() - start });
      while (!ending && Date.now() - start < m.minCycleMs) { if (windowState(JSON.parse(fs.readFileSync(path.join(dir, 'control.json')))) !== 'RUNNING') break; await sleep(1000); }
    }
  } catch (error) {
    s.failures++; s.financialHalted = error.message; ctx.save(); ctx.event('financial.halted', { reason: error.message, activeOperation: s.activeOperation });
    if (canary) throw error;
  } finally { monitoringStopped = true; await monitor; ws?.close(); await db.$disconnect(); await c.api.disconnect(); release(); }
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { recipes };
