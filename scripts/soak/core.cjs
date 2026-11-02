const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);
function atomicJson(file, value) {
  const tmp = file + '.new';
  const fd = fs.openSync(tmp, 'w', 0o600);
  try { fs.writeFileSync(fd, json(value) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}
function appendLog(file, value, maxBytes = 10 * 1024 * 1024, retained = 8) {
  if (fs.existsSync(file) && fs.statSync(file).size >= maxBytes) {
    for (let i = retained; i >= 1; i--) {
      const from = i === 1 ? file : file + '.' + (i - 1);
      const to = file + '.' + i;
      if (fs.existsSync(from)) fs.renameSync(from, to);
    }
  }
  fs.appendFileSync(file, JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v) + '\n', { mode: 0o600 });
}
function localUrl(value) {
  const u = new URL(value);
  assert(['http:', 'ws:', 'redis:', 'postgresql:'].includes(u.protocol), 'unsupported endpoint protocol');
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname), 'loopback endpoint required');
  return u;
}
function loopbackListenArgs(args) {
  const values = [...args];
  if (typeof values[0] === 'object' && values[0] !== null && 'port' in values[0]) values[0] = { ...values[0], host: '127.0.0.1' };
  else if (typeof values[0] === 'number') { if (typeof values[1] === 'string') values[1] = '127.0.0.1'; else values.splice(1, 0, '127.0.0.1'); }
  else throw new Error('unsupported local server listen signature');
  return values;
}
function windowState(state, now = Date.now()) {
  if (state.stop) return 'STOPPED';
  if (!state.startedAt) return 'READY';
  return now >= state.deadline ? 'COMPLETED' : 'RUNNING';
}
function resumeSafety(state) { return !state.activeOperation && !state.pendingTx && !state.pendingRequest; }
function alive(pid) { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
function acquireLock(file) {
  if (fs.existsSync(file)) {
    const lock = JSON.parse(fs.readFileSync(file)); assert(!alive(lock.pid), 'another worker owns the run'); fs.unlinkSync(file);
  }
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() })); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return () => { if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file)).pid === process.pid) fs.unlinkSync(file); };
}
function unwrap(value) {
  for (let i = 0; i < 6; i++) {
    if (value && typeof value === 'object' && 'err' in value) throw new Error('contract error: ' + JSON.stringify(value.err));
    if (value && typeof value === 'object' && 'ok' in value) value = value.ok;
    else { assert.notEqual(value, undefined, 'missing contract output'); return value; }
  }
  throw new Error('invalid nested contract output');
}
function amountOut(input, reserveIn, reserveOut) {
  assert(input > 0n && reserveIn > 0n && reserveOut > 0n, 'positive AMM quantities required');
  return input * 995n * reserveOut / (reserveIn * 1000n + input * 995n);
}
function swapPlan(index) { return { userIndex: Math.floor(index / 2) % 4, reverse: index % 2 === 1, units: [1000, 5000, 10000, 20000][index % 4] }; }
function decimalParts(value) {
  const s = String(value); assert(/^\d+(\.\d+)?$/.test(s), 'plain positive decimal required');
  const [whole, frac = ''] = s.split('.'); return [BigInt(whole + frac), frac.length];
}
function spotDeltas(rows, baseDecimals, quoteDecimals) {
  const out = { fees: 0n };
  for (const row of rows) {
    const [a, ad] = decimalParts(row.amount); const [p, pd] = decimalParts(row.price);
    const base = a * 10n ** BigInt(baseDecimals) / 10n ** BigInt(ad);
    const quote = a * p * 10n ** BigInt(quoteDecimals) / 10n ** BigInt(ad + pd);
    const mf = quote * 10n / 10000n, tf = quote * 25n / 10000n;
    const buyer = row.side === 'BUY' ? row.takerAddress : row.makerAddress;
    const seller = row.side === 'BUY' ? row.makerAddress : row.takerAddress;
    out[buyer] ||= { base: 0n, quote: 0n }; out[seller] ||= { base: 0n, quote: 0n };
    out[buyer].base += base; out[seller].base -= base;
    out[buyer].quote -= quote + (buyer === row.makerAddress ? mf : tf);
    out[seller].quote += quote - (seller === row.makerAddress ? mf : tf);
    out.fees += mf + tf;
  }
  return out;
}
function loadRun(dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json')));
  for (const key of ['network', 'apiUrl', 'wsUrl', 'frontUrl']) localUrl(manifest[key]);
  const secrets = JSON.parse(fs.readFileSync(path.join(dir, 'wallets.secrets')));
  const dep = name => require(path.join(manifest.sourceRoot, 'spot-api/node_modules', name));
  const stateFile = path.join(dir, 'worker-state.json');
  const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile)) : { cycles: 0, counters: {}, volumes: {}, failures: 0 };
  const save = () => atomicJson(stateFile, state);
  const event = (kind, data = {}) => appendLog(path.join(dir, 'events.jsonl'), { at: new Date().toISOString(), kind, ...data });
  return { dir, manifest, secrets, dep, state, save, event };
}
module.exports = { sleep, json, atomicJson, appendLog, localUrl, loopbackListenArgs, windowState, resumeSafety, alive, acquireLock, unwrap, amountOut, swapPlan, spotDeltas, loadRun };
