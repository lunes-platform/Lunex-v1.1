const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { localUrl, windowState, resumeSafety, amountOut, spotDeltas, atomicJson, appendLog, acquireLock, unwrap, loopbackListenArgs, swapPlan } = require('./core.cjs');

test('only explicit loopback endpoints are allowed', () => {
  for (const url of ['ws://127.0.0.1:9944', 'http://localhost:4200', 'redis://127.0.0.1:6379/10']) assert(localUrl(url));
  for (const url of ['https://ws-test.lunes.io', 'http://127.0.0.1.example.com', 'https://example.com', 'file:///etc/passwd']) assert.throws(() => localUrl(url));
});
test('46 hours is an absolute deadline and restart never renews it', () => {
  const s = { startedAt: 1000, deadline: 1000 + 46 * 3600000 };
  assert.equal(windowState(s, 1001), 'RUNNING');
  assert.equal(windowState(s, s.deadline), 'COMPLETED');
  assert.equal(windowState(s, s.deadline + 999999), 'COMPLETED');
  assert.equal(s.deadline - s.startedAt, 165600000);
});
test('stop wins over the remaining time', () => assert.equal(windowState({ startedAt: 1, deadline: 1e15, stop: true }, 100), 'STOPPED'));
test('interrupted operation and pending HTTP or transaction fail closed', () => {
  for (const state of [{ activeOperation: { kind: 'swap' } }, { pendingTx: { hash: '0x1' } }, { pendingRequest: { nonce: '1' } }]) assert.equal(resumeSafety(state), false);
  assert.equal(resumeSafety({ activeOperation: null }), true);
});
test('AMM reference uses real 0.5% fee and integer rounding', () => {
  assert.equal(amountOut(1000n, 100000n, 200000n), 1970n);
  assert.equal(amountOut(1n, 10n ** 18n, 1n), 0n);
  assert.throws(() => amountOut(-1n, 1n, 2n));
});
test('Spot BUY conserves base and quote including independently floored fees', () => {
  const d = spotDeltas([{ makerAddress: 'seller', takerAddress: 'buyer', side: 'BUY', amount: '1', price: '2' }], 8, 6);
  assert.deepEqual(d, { seller: { base: -100000000n, quote: 1998000n }, buyer: { base: 100000000n, quote: -2005000n }, fees: 7000n });
  assert.equal(d.seller.quote + d.buyer.quote + d.fees, 0n);
});
test('Spot SELL assigns maker fee to buyer and handles decimal dust exactly', () => {
  const d = spotDeltas([{ makerAddress: 'buyer', takerAddress: 'seller', side: 'SELL', amount: '0.00000001', price: '2' }], 8, 6);
  assert.equal(d.buyer.base, 1n); assert.equal(d.seller.base, -1n);
  assert.equal(d.fees, 0n); assert.equal(d.buyer.quote + d.seller.quote, 0n);
});
test('atomic checkpoint is private and readable after replacement', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lunex-soak-test-'));
  try { const file = path.join(dir, 'state.json'); atomicJson(file, { seq: 1 }); atomicJson(file, { seq: 2 }); assert.deepEqual(JSON.parse(fs.readFileSync(file)), { seq: 2 }); assert.equal(fs.statSync(file).mode & 0o777, 0o600); } finally { fs.rmSync(dir, { recursive: true }); }
});
test('log rotation bounds retained disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lunex-soak-test-'));
  try { const file = path.join(dir, 'events.jsonl'); for (let i = 0; i < 20; i++) appendLog(file, { data: 'x'.repeat(100) }, 200, 2); assert(fs.readdirSync(dir).length <= 3); assert(fs.statSync(file).size < 400); } finally { fs.rmSync(dir, { recursive: true }); }
});
test('failed contract output is never treated as a zero balance', () => {
  assert.equal(unwrap({ ok: { ok: '0' } }), '0');
  assert.throws(() => unwrap({ ok: { err: 'InsufficientBalance' } })); assert.throws(() => unwrap(undefined));
});
test('one live financial worker owns the run; a stale process can be replaced', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lunex-soak-test-'));
  try { const file = path.join(dir, 'lock'); const release = acquireLock(file); assert.throws(() => acquireLock(file)); release(); fs.writeFileSync(file, JSON.stringify({ pid: 999999999 })); const release2 = acquireLock(file); assert.equal(JSON.parse(fs.readFileSync(file)).pid, process.pid); release2(); } finally { fs.rmSync(dir, { recursive: true }); }
});
test('API/WS listen signatures bind loopback and preserve callbacks', () => {
  const cb = () => {};
  assert.deepEqual(loopbackListenArgs([4200, cb]), [4200, '127.0.0.1', cb]);
  assert.deepEqual(loopbackListenArgs([{ port: 4201 }, cb]), [{ port: 4201, host: '127.0.0.1' }, cb]);
  assert.deepEqual(loopbackListenArgs([4200, '0.0.0.0', cb]), [4200, '127.0.0.1', cb]);
  assert.throws(() => loopbackListenArgs(['/tmp/unexpected.sock']));
});
test('wallet funding covers every swap input over 46h at maximum cadence even without recycling proceeds', () => {
  const used = Array.from({ length: 4 }, () => ({ base: 0, quote: 0 }));
  for (let i = 0; i < 2762; i++) { const p = swapPlan(i); used[p.userIndex][p.reverse ? 'quote' : 'base'] += p.units; }
  for (const wallet of used) { assert(wallet.base < 5000000, 'base wallet exhausted'); assert(wallet.quote < 20000000, 'quote wallet exhausted'); assert(wallet.base > 0 && wallet.quote > 0, 'both directions required per wallet'); }
});
test('operator CLI gates start, refuses deadline renewal and stops a run', () => {
  const { spawnSync } = require('node:child_process'); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lunex-soak-cli-'));
  const command = name => spawnSync(process.execPath, [path.join(__dirname, 'control.cjs'), dir, name], { encoding: 'utf8' });
  try {
    atomicJson(path.join(dir, 'worker-state.json'), { counters: {}, volumes: {}, cycles: 0 }); atomicJson(path.join(dir, 'canary.json'), { status: 'PASSED' });
    assert.notEqual(command('start').status, 0); assert(!fs.existsSync(path.join(dir, 'control.json')));
    atomicJson(path.join(dir, 'canary.json'), { status: 'PASSED', preciseLiquidityAt: new Date().toISOString() });
    assert.equal(command('start').status, 0); const started = JSON.parse(fs.readFileSync(path.join(dir, 'control.json'))); assert.equal(started.deadline - started.startedAt, 165600000);
    assert.notEqual(command('start').status, 0); assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'control.json'))).deadline, started.deadline);
    const stop = command('stop'); assert.equal(stop.status, 0); assert.equal(JSON.parse(stop.stdout).window, 'STOPPED');
  } finally { fs.rmSync(dir, { recursive: true }); }
});
