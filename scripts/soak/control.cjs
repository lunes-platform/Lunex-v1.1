const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { atomicJson, windowState } = require('./core.cjs');
const dir = process.argv[2], command = process.argv[3] || 'status';
assert(dir && path.isAbsolute(dir), 'Usage: node control.cjs ABSOLUTE_RUN_DIR status|start|stop');
const file = path.join(dir, 'control.json');
let control = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {};
if (command === 'start') {
  const canary = JSON.parse(fs.readFileSync(path.join(dir, 'canary.json'))); assert.equal(canary.status, 'PASSED', 'successful canary required');
  assert(canary.preciseLiquidityAt, 'precise LP conservation check required');
  const worker = JSON.parse(fs.readFileSync(path.join(dir, 'worker-state.json'))); assert(!worker.financialHalted && !worker.activeOperation && !worker.pendingTx && !worker.pendingRequest, 'unresolved financial state');
  assert(!control.startedAt, 'window already started; never reset its deadline');
  const supervisorBaseline = fs.existsSync(path.join(dir, 'supervisor-state.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'supervisor-state.json'))) : {};
  control = { startedAt: Date.now(), durationMs: 46 * 3600000, stop: false, baselineCounters: worker.counters, baselineVolumes: worker.volumes, baselineSamples: supervisorBaseline.samples || 0, baselineUnavailable: supervisorBaseline.unavailableSamples || 0, baselineGapMs: supervisorBaseline.gapMs || 0 }; control.deadline = control.startedAt + control.durationMs; atomicJson(file, control);
} else if (command === 'stop') { control.stop = true; control.stoppedAt = Date.now(); atomicJson(file, control); }
else assert.equal(command, 'status', 'unknown command');
const read = name => fs.existsSync(path.join(dir, name)) ? JSON.parse(fs.readFileSync(path.join(dir, name))) : null;
const worker = read('worker-state.json'), supervisor = read('supervisor-state.json');
const counters = Object.fromEntries(Object.entries(worker?.counters || {}).map(([k, v]) => [k, v - (control.baselineCounters?.[k] || 0)]));
const volumes = Object.fromEntries(Object.entries(worker?.volumes || {}).map(([k, v]) => [k, String(BigInt(v) - BigInt(control.baselineVolumes?.[k] || 0))]));
console.log(JSON.stringify({ window: windowState(control), startedAt: control.startedAt ? new Date(control.startedAt).toISOString() : null, deadline: control.deadline ? new Date(control.deadline).toISOString() : null, remainingHours: control.deadline ? Math.max(0, (control.deadline - Date.now()) / 3600000) : null, financialHalted: worker?.financialHalted || null, cycles: worker?.cycles, canaryPassedAt: worker?.canaryPassedAt, counters, volumes, lastSuccessAt: worker?.lastSuccessAt, activeOperation: worker?.activeOperation?.kind, supervisor }, null, 2));
