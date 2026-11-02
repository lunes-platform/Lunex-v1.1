const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { loadRun, atomicJson, appendLog, windowState, sleep, alive } = require('./core.cjs');
const ctx = loadRun(process.argv[2]), m = ctx.manifest;
const stateFile = path.join(ctx.dir, 'supervisor-state.json');
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile)) : { samples: 0, unavailableSamples: 0, restarts: {}, incidents: 0 };
state.pid = process.pid; state.startedProcessAt = new Date().toISOString();
const env = ctx.dep('dotenv').parse(fs.readFileSync(path.join(ctx.dir, 'api.env')));
const children = new Map(), retryAt = new Map();
let closing = false, lastFinalized = '', lastFinalizedChangeAt = Date.now();
const read = (file, fallback = {}) => fs.existsSync(path.join(ctx.dir, file)) ? JSON.parse(fs.readFileSync(path.join(ctx.dir, file))) : fallback;
const log = (kind, data = {}) => appendLog(path.join(ctx.dir, 'supervisor.jsonl'), { at: new Date().toISOString(), kind, ...data });
const save = () => atomicJson(stateFile, state);
function launch(name, cmd, args, options = {}) {
  if (children.has(name) || Date.now() < (retryAt.get(name) || 0)) return;
  const child = spawn('/usr/bin/nice', ['-n', '10', cmd, ...args], { cwd: ctx.dir, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], ...options });
  children.set(name, child); state[name + 'Pid'] = child.pid; state.restarts[name] = (state.restarts[name] || 0) + 1; save(); log('process.started', { name, pid: child.pid });
  const capture = data => appendLog(path.join(ctx.dir, name + '.jsonl'), { at: new Date().toISOString(), line: String(data).slice(0, 16000) });
  child.stdout.on('data', capture); child.stderr.on('data', capture);
  child.on('error', e => log('process.error', { name, error: e.message }));
  child.on('exit', (code, signal) => { children.delete(name); state[name + 'Pid'] = null; retryAt.set(name, Date.now() + 30000); save(); log('process.exited', { name, code, signal }); });
}
function statusData() {
  const control = read('control.json'), worker = read('worker-state.json');
  const counters = Object.fromEntries(Object.entries(worker.counters || {}).map(([k, v]) => [k, v - (control.baselineCounters?.[k] || 0)]));
  const volumesRaw = Object.fromEntries(Object.entries(worker.volumes || {}).map(([k, v]) => [k, String(BigInt(v) - BigInt(control.baselineVolumes?.[k] || 0))]));
  const end = state.windowStatsAtEnd || state;
  const samples = end.samples - (control.baselineSamples || 0), unavailableSamples = end.unavailableSamples - (control.baselineUnavailable || 0), unmonitoredGapSeconds = Math.max(0, ((end.gapMs || 0) - (control.baselineGapMs || 0)) / 1000);
  return { run: m.id, window: windowState(control), startedAt: control.startedAt ? new Date(control.startedAt).toISOString() : null, deadline: control.deadline ? new Date(control.deadline).toISOString() : null, financialHalted: worker.financialHalted || null, cycles: worker.cycles || 0, counters, volumesRaw, lastSuccessAt: worker.lastSuccessAt, activeOperation: worker.activeOperation?.kind, health: state.health, resources: state.resources, samples, unavailableSamples, unmonitoredGapSeconds, sampledAvailability: samples ? (samples - unavailableSamples) / samples : null, canaryPassedAt: worker.canaryPassedAt };
}
const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Lunex • Soak 46h</title><style>body{background:#10151c;color:#e8edf5;font:16px system-ui;max-width:950px;margin:40px auto;padding:20px}a{color:#76d6a7}pre{white-space:pre-wrap;background:#18222d;padding:24px;border-radius:12px}h1{font-size:26px}</style><h1>Lunex — teste local de 46 horas</h1><p><a href="/spot">Spot</a> · <a href="/swap">Swap</a> · <a href="/pool">Pools</a></p><p>Saldos e volumes são de desenvolvimento. Atualização a cada 10 segundos.</p><pre id="s">Carregando…</pre><script>async function refresh(){try{const s=await(await fetch('/__soak/status')).json();document.getElementById('s').textContent=JSON.stringify(s,null,2)}catch(e){document.getElementById('s').textContent=String(e)}}refresh();setInterval(refresh,10000)</script></html>`;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const frontRoot = path.join(ctx.dir, 'frontend');
const server = http.createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
  let url; try { url = new URL(req.url, m.frontUrl); } catch { res.writeHead(400); return res.end(); }
  if (url.pathname === '/__soak/status') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify(statusData())); }
  if (url.pathname === '/__soak') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html); }
  let file; try { file = path.resolve(frontRoot, '.' + decodeURIComponent(url.pathname)); } catch { res.writeHead(400); return res.end(); }
  if (file !== frontRoot && !file.startsWith(frontRoot + path.sep)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(frontRoot, 'index.html');
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': file.endsWith('.html') ? 'no-store' : 'public, max-age=3600' });
  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(file); stream.on('error', () => res.destroy()); stream.pipe(res);
});
server.on('error', e => { log('frontend.error', { error: e.message }); process.exit(1); });
server.listen(Number(new URL(m.frontUrl).port), '127.0.0.1');
async function rpc(method, params = []) {
  const response = await fetch('http://127.0.0.1:9933', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(5000) });
  const body = await response.json(); if (body.error) throw new Error(JSON.stringify(body.error)); return body.result;
}
async function portOpen(port) { return new Promise(resolve => { const sock = net.connect({ host: '127.0.0.1', port }); sock.setTimeout(1500); sock.once('connect', () => { sock.destroy(); resolve(true); }); const fail = () => { sock.destroy(); resolve(false); }; sock.once('error', fail); sock.once('timeout', fail); }); }
async function tick() {
  const sampleNow = Date.now();
  if (state.lastSampleAt && sampleNow - state.lastSampleAt > 60000) { const gap = sampleNow - state.lastSampleAt - 30000; state.gapMs = (state.gapMs || 0) + gap; log('monitoring.gap', { ms: gap }); }
  state.lastSampleAt = sampleNow;
  const health = { at: new Date().toISOString(), frontend: false, api: false, node: false, db: false, redis: false };
  if (!await portOpen(9944)) launch('node', '/Users/lucas/Documents/Projetos_DEV/lunes-nightly/target/release/lunes-node', ['--dev', '--base-path', '/private/tmp/lunex-qa-lunes-20261017', '--ws-port', '9944', '--rpc-port', '9933', '--ws-external', '--rpc-cors', 'all']);
  if (!await portOpen(4200)) launch('api', process.execPath, ['--max-old-space-size=512', '-r', path.join(m.sourceRoot, 'spot-api/node_modules/dotenv/config'), path.join(__dirname, 'api.cjs')], { cwd: path.join(ctx.dir, 'runtime/api'), env: { ...process.env, ...env, DOTENV_CONFIG_PATH: path.join(ctx.dir, 'api.env') } });
  try { const head = await rpc('chain_getFinalizedHead'); const header = await rpc('chain_getHeader', [head]); if (head !== lastFinalized) { lastFinalized = head; lastFinalizedChangeAt = Date.now(); } health.finalizedBlock = Number.parseInt(header.number, 16); health.node = Date.now() - lastFinalizedChangeAt < 90000; } catch (e) { health.nodeError = e.message; }
  try { const response = await fetch(m.frontUrl + '/spot', { signal: AbortSignal.timeout(5000) }); health.frontend = response.ok && /id=["']root["']/.test(await response.text()); } catch (e) { health.frontendError = e.message; }
  try { const response = await fetch(m.apiUrl + '/health', { signal: AbortSignal.timeout(5000) }); const body = await response.json(); health.api = response.ok && body.status === 'ok'; health.db = body.db === 'connected'; health.redis = body.redis === 'connected'; state.apiTransportFailures = 0; } catch (e) { health.apiError = e.message; state.apiTransportFailures = (state.apiTransportFailures || 0) + 1; }
  if (state.apiTransportFailures >= 3 && children.has('api') && await portOpen(5432) && await portOpen(6379)) { log('api.unresponsive', { pid: children.get('api').pid }); children.get('api').kill('SIGTERM'); state.apiTransportFailures = 0; }
  const ok = health.frontend && health.api && health.node && health.db && health.redis;
  state.samples++; if (!ok) state.unavailableSamples++;
  if (!ok && state.health?.ok !== false) { state.incidents++; log('health.incident', health); }
  if (ok && state.health?.ok === false) log('health.recovered', health);
  state.resources = { supervisorRssMiB: Math.round(process.memoryUsage().rss / 1048576), freeMemoryMiB: Math.round(os.freemem() / 1048576), load1m: os.loadavg()[0], cpuCount: os.cpus().length };
  state.health = { ...health, ok }; save();
  const control = read('control.json'), worker = read('worker-state.json');
  const window = windowState(control);
  if (window === 'RUNNING') {
    if (!children.has('caffeinate')) launch('caffeinate', '/usr/bin/caffeinate', ['-i', '-t', String(Math.max(1, Math.ceil((control.deadline - Date.now()) / 1000)))]);
    if (ok && !worker.financialHalted && !children.has('worker') && !alive(worker.pid)) launch('worker', process.execPath, ['--max-old-space-size=512', path.join(__dirname, 'worker.cjs'), ctx.dir]);
  } else {
    if (control.startedAt && !state.windowStatsAtEnd) { state.windowStatsAtEnd = { samples: state.samples, unavailableSamples: state.unavailableSamples, gapMs: state.gapMs || 0, at: new Date().toISOString() }; save(); }
    children.get('caffeinate')?.kill('SIGTERM');
    // The worker checks control between recipes and drains already-submitted work.
    children.get('worker')?.kill('SIGTERM');
    if (control.startedAt && !children.has('worker') && !alive(worker.pid) && !fs.existsSync(path.join(ctx.dir, 'report.json'))) {
      const status = statusData();
      const result = worker.financialHalted ? 'FINANCIAL_HALTED' : !worker.cycles ? 'NO_FINANCIAL_CYCLES' : window === 'STOPPED' ? 'STOPPED' : status.unavailableSamples || status.unmonitoredGapSeconds ? 'COMPLETED_WITH_INTERRUPTION' : 'COMPLETED';
      const final = { ...status, windowEndedAt: new Date(control.stop ? control.stoppedAt : control.deadline).toISOString(), drainedAt: new Date().toISOString(), result, durationRequestedHours: 46, elapsedWallHours: ((control.stop ? control.stoppedAt : control.deadline) - control.startedAt) / 3600000, sampledDowntimeSecondsApprox: status.unavailableSamples * 30, monitoringNote: '30-second samples; this is not proof of continuous uptime between samples. Unmonitored gaps are reported separately.' };
      atomicJson(path.join(ctx.dir, 'report.json'), final);
    }
  }
}
async function shutdown() {
  if (closing) return; closing = true; log('supervisor.stopping');
  for (const child of children.values()) child.kill('SIGTERM');
  server.close(); setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
(async () => { log('supervisor.started', { pid: process.pid }); while (!closing) { try { await tick(); } catch (e) { log('supervisor.error', { error: e.message }); } await sleep(30000); } })();
