'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDripper, submitAndWaitFinalized, isOkContractOutput } = require('../src/drip');

const status = (type, hash = '0xblock') => ({
  type,
  isInBlock: type === 'InBlock',
  isFinalized: type === 'Finalized',
  isInvalid: type === 'Invalid',
  isDropped: type === 'Dropped',
  isUsurped: type === 'Usurped',
  asInBlock: { toHex: () => hash },
  asFinalized: { toHex: () => hash },
});

/** Extrinsic whose signAndSend replays a list of status updates. */
function fakeExtrinsic(name, updates, log) {
  return {
    name,
    hash: { toHex: () => `0xtx-${name}` },
    signAndSend(signer, cb) {
      log.push({ submitted: name, signer: signer.address });
      setImmediate(() => {
        for (const u of updates) cb(u);
      });
      return Promise.resolve(() => {});
    },
  };
}

function okUpdates(hash = '0xfinal') {
  return [{ status: status('Ready') }, { status: status('InBlock', '0xinblock') }, { status: status('Finalized', hash) }];
}

function fakeApi({ withUtility = true, log, updates = okUpdates } = {}) {
  const api = {
    registry: {
      createType: (_t, v) => v,
      findMetaError: () => ({ section: 'balances', name: 'InsufficientBalance', docs: ['x'] }),
    },
    tx: {
      balances: {
        transferKeepAlive: (to, amount) => {
          log.push({ native: to, amount: amount.toString() });
          return fakeExtrinsic('native', updates(), log);
        },
      },
    },
  };
  if (withUtility) {
    api.tx.utility = {
      batchAll: (calls) => {
        log.push({ batch: calls.map((c) => c.name) });
        return fakeExtrinsic('batch', updates(), log);
      },
    };
  }
  return api;
}

function fakeContractFactory(log, { failDryRun = [] } = {}) {
  return (address) => ({
    query: {
      transfer: async (caller, opts, to, amount, data) => {
        log.push({ dryRun: address, caller, to, amount: amount.toString(), data });
        const failing = failDryRun.includes(address);
        return {
          gasRequired: { refTime: 1000n, proofSize: 100n },
          result: { isOk: true, isErr: false, asOk: { flags: { isRevert: failing } } },
          output: failing
            ? { isErr: false, isOk: true, asOk: { isErr: true, isOk: false } }
            : { isErr: false, isOk: true, asOk: { isErr: false, isOk: true } },
        };
      },
    },
    tx: {
      transfer: (opts, to, amount) => {
        log.push({ tx: address, gasLimit: opts.gasLimit, to, amount: amount.toString() });
        return { name: `psp22:${address}`, hash: { toHex: () => '0x' } };
      },
    },
  });
}

const SIGNER = { address: '5Faucet' };
const TOKENS = [
  { symbol: 'LUSDT', address: 'ADDR_LUSDT', amount: 1000000n, decimals: 6 },
  { symbol: 'LBTC', address: 'ADDR_LBTC', amount: 5000000n, decimals: 8 },
];

test('drips native + every PSP22 token in one batchAll, resolved on isFinalized', async () => {
  const log = [];
  const dripper = createDripper({
    api: fakeApi({ log }),
    signer: SIGNER,
    native: { amount: 10n, decimals: 8 },
    tokens: TOKENS,
    createContract: fakeContractFactory(log),
    finalizeTimeoutMs: 1000,
  });
  const res = await dripper.drip('5Dest');
  assert.equal(res.blockHash, '0xfinal', 'must resolve with the FINALIZED block, not InBlock');
  assert.deepEqual(res.sent.map((s) => s.symbol), ['LUNES', 'LUSDT', 'LBTC']);
  assert.deepEqual(res.skipped, []);
  const batch = log.find((l) => l.batch);
  assert.deepEqual(batch.batch, ['native', 'psp22:ADDR_LUSDT', 'psp22:ADDR_LBTC']);
  // dry run uses the faucet account as caller and PSP22 transfer(to, value, data)
  const dry = log.filter((l) => l.dryRun);
  assert.equal(dry.length, 2);
  assert.equal(dry[0].caller, '5Faucet');
  assert.equal(dry[0].to, '5Dest');
  assert.deepEqual(dry[0].data, []);
  // gas limit gets a safety margin over the dry-run estimate
  const tx = log.find((l) => l.tx === 'ADDR_LUSDT');
  assert.equal(tx.gasLimit.refTime, 1200n);
});

test('a token whose dry-run fails (e.g. faucet out of LBTC) is skipped, others still dripped', async () => {
  const log = [];
  const dripper = createDripper({
    api: fakeApi({ log }),
    signer: SIGNER,
    native: { amount: 10n, decimals: 8 },
    tokens: TOKENS,
    createContract: fakeContractFactory(log, { failDryRun: ['ADDR_LBTC'] }),
    finalizeTimeoutMs: 1000,
  });
  const res = await dripper.drip('5Dest');
  assert.deepEqual(res.sent.map((s) => s.symbol), ['LUNES', 'LUSDT']);
  assert.deepEqual(res.skipped.map((s) => s.symbol), ['LBTC']);
});

test('without utility pallet: falls back to sequential finalized transfers', async () => {
  const log = [];
  const api = fakeApi({ log, withUtility: false });
  const dripper = createDripper({
    api,
    signer: SIGNER,
    native: { amount: 10n, decimals: 8 },
    tokens: [TOKENS[0]],
    createContract: (address) => {
      const c = fakeContractFactory(log)(address);
      c.tx.transfer = () => fakeExtrinsic('psp22', okUpdates('0xlast'), log);
      return c;
    },
    finalizeTimeoutMs: 1000,
  });
  const res = await dripper.drip('5Dest');
  assert.deepEqual(log.filter((l) => l.submitted).map((l) => l.submitted), ['native', 'psp22']);
  assert.equal(res.blockHash, '0xlast');
  assert.deepEqual(res.sent.map((s) => s.symbol), ['LUNES', 'LUSDT']);
});

test('submitAndWaitFinalized rejects on dispatchError', async () => {
  const log = [];
  const api = fakeApi({ log });
  const ext = fakeExtrinsic(
    'bad',
    [{ status: status('InBlock'), dispatchError: { isModule: true, asModule: {} } }],
    log,
  );
  await assert.rejects(submitAndWaitFinalized(api, ext, SIGNER, { timeoutMs: 500 }), /balances\.InsufficientBalance/);
});

test('submitAndWaitFinalized rejects on Invalid/Dropped status', async () => {
  const log = [];
  const api = fakeApi({ log });
  const ext = fakeExtrinsic('drop', [{ status: status('Dropped') }], log);
  await assert.rejects(submitAndWaitFinalized(api, ext, SIGNER, { timeoutMs: 500 }), /Dropped/);
});

test('submitAndWaitFinalized times out with FINALIZATION_TIMEOUT when only InBlock arrives', async () => {
  const log = [];
  const api = fakeApi({ log });
  const ext = fakeExtrinsic('slow', [{ status: status('InBlock') }], log);
  await assert.rejects(submitAndWaitFinalized(api, ext, SIGNER, { timeoutMs: 30 }), (err) => {
    assert.equal(err.code, 'FINALIZATION_TIMEOUT');
    assert.equal(err.txHash, '0xtx-slow');
    return true;
  });
});

test('submissions are serialized so concurrent drips do not reuse a nonce', async () => {
  const log = [];
  const order = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const mkExt = (name) => ({
    hash: { toHex: () => name },
    signAndSend(_s, cb) {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      order.push(name);
      return new Promise((resolve) =>
        setTimeout(() => {
          inFlight--;
          resolve(() => {});
          setImmediate(() => cb({ status: status('Finalized', name) }));
        }, 5),
      );
    },
  });
  const api = fakeApi({ log });
  const { createSubmissionQueue } = require('../src/drip');
  const queue = createSubmissionQueue();
  await Promise.all(
    ['a', 'b', 'c'].map((n) => submitAndWaitFinalized(api, mkExt(n), SIGNER, { timeoutMs: 500, queue })),
  );
  assert.equal(maxInFlight, 1);
  assert.deepEqual(order, ['a', 'b', 'c']);
});

test('isOkContractOutput unwraps MessageResult<Result<..>>', () => {
  assert.equal(isOkContractOutput(null), true);
  assert.equal(isOkContractOutput({ isErr: true, isOk: false }), false);
  assert.equal(isOkContractOutput({ isErr: false, isOk: true, asOk: { isErr: true } }), false);
  assert.equal(isOkContractOutput({ isErr: false, isOk: true, asOk: { isErr: false, isOk: true } }), true);
});
