'use strict';

const { formatUnits } = require('./units');

// Upper bound for the PSP22 transfer dry-run (same order as scripts/fund_tester.ts).
const DRY_RUN_GAS = { refTime: 300000000000n, proofSize: 10000000n };

/**
 * Serializes extrinsic *submission* (not finalization) for the single faucet
 * signer: each signAndSend picks the next nonce from the node, so two
 * concurrent submissions could otherwise collide on the same nonce.
 */
function createSubmissionQueue() {
  let tail = Promise.resolve();
  return {
    run(fn) {
      const p = tail.then(fn, fn);
      tail = p.then(
        () => undefined,
        () => undefined,
      );
      return p;
    },
  };
}

function describeDispatchError(api, dispatchError) {
  if (dispatchError && dispatchError.isModule) {
    try {
      const d = api.registry.findMetaError(dispatchError.asModule);
      return `${d.section}.${d.name}`;
    } catch {
      /* fallthrough */
    }
  }
  return String(dispatchError);
}

/**
 * Sign, submit and resolve only once the extrinsic is in a FINALIZED block.
 * Rejects on dispatch error, Invalid/Dropped/Usurped, or timeout (err.code =
 * FINALIZATION_TIMEOUT, err.txHash set — the tx may still land).
 */
function submitAndWaitFinalized(api, extrinsic, signer, { timeoutMs, queue } = {}) {
  const txHash = extrinsic.hash && extrinsic.hash.toHex ? extrinsic.hash.toHex() : undefined;
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsub = null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (unsub) {
        try {
          unsub();
        } catch {
          /* ignore */
        }
      }
      fn(value);
    };
    const timer = setTimeout(() => {
      const err = new Error(`Finalization timeout after ${timeoutMs}ms`);
      err.code = 'FINALIZATION_TIMEOUT';
      err.txHash = txHash;
      finish(reject, err);
    }, timeoutMs);

    const send = () =>
      extrinsic.signAndSend(signer, (result) => {
        const { status, dispatchError } = result;
        if (dispatchError) {
          const err = new Error(`Dispatch error: ${describeDispatchError(api, dispatchError)}`);
          err.code = 'DISPATCH_ERROR';
          err.txHash = txHash;
          return finish(reject, err);
        }
        if (status && (status.isInvalid || status.isDropped || status.isUsurped)) {
          const err = new Error(`Transaction ${status.type}`);
          err.code = 'TX_REJECTED';
          err.txHash = txHash;
          return finish(reject, err);
        }
        if (status && status.isFinalized) {
          finish(resolve, { blockHash: status.asFinalized.toHex(), txHash });
        }
      });

    (queue ? queue.run(send) : send())
      .then((u) => {
        unsub = u;
        if (settled && typeof u === 'function') u();
      })
      .catch((e) => finish(reject, e));
  });
}

/** ink! 4 query output is MessageResult<Result<(), PSP22Error>>: both layers must be Ok. */
function isOkContractOutput(output) {
  let v = output;
  for (let i = 0; i < 2; i++) {
    if (!v || typeof v.isErr !== 'boolean') return true;
    if (v.isErr) return false;
    v = v.asOk;
  }
  return true;
}

function bump(value) {
  const n = BigInt(value.toString());
  return n + n / 5n; // +20% safety margin over the dry-run estimate
}

/**
 * Builds the drip: native LUNES + every configured PSP22 test token.
 * PSP22 transfers are dry-run first; a token that would fail (faucet empty,
 * paused, wrong address) is skipped and reported instead of reverting the
 * whole batch.
 */
function createDripper({ api, signer, native, tokens, createContract, finalizeTimeoutMs, queue, isReady, log }) {
  const q = queue || createSubmissionQueue();
  const contracts = new Map(tokens.map((t) => [t.symbol, createContract(t.address)]));
  const logger = log || { warn() {} };

  async function buildTokenCalls(to) {
    const calls = [];
    const sent = [];
    const skipped = [];
    for (const t of tokens) {
      const c = contracts.get(t.symbol);
      try {
        const dry = await c.query.transfer(
          signer.address,
          { gasLimit: api.registry.createType('WeightV2', DRY_RUN_GAS), storageDepositLimit: null },
          to,
          t.amount,
          [],
        );
        const reverted = dry.result.isErr || (dry.result.asOk && dry.result.asOk.flags && dry.result.asOk.flags.isRevert);
        if (reverted || !isOkContractOutput(dry.output)) {
          skipped.push({ symbol: t.symbol, reason: 'dry-run failed (faucet balance or token unavailable)' });
          continue;
        }
        const gasLimit = api.registry.createType('WeightV2', {
          refTime: bump(dry.gasRequired.refTime),
          proofSize: bump(dry.gasRequired.proofSize),
        });
        calls.push(c.tx.transfer({ gasLimit, storageDepositLimit: null }, to, t.amount, []));
        sent.push({ symbol: t.symbol, amount: formatUnits(t.amount, t.decimals) });
      } catch (e) {
        logger.warn(`[faucet] ${t.symbol} dry-run error: ${e.message}`);
        skipped.push({ symbol: t.symbol, reason: 'dry-run error' });
      }
    }
    return { calls, sent, skipped };
  }

  async function drip(to) {
    const nativeCall = api.tx.balances.transferKeepAlive(to, native.amount);
    const nativeSent = { symbol: native.symbol || 'LUNES', amount: formatUnits(native.amount, native.decimals) };
    const { calls, sent, skipped } = await buildTokenCalls(to);
    const opts = { timeoutMs: finalizeTimeoutMs, queue: q };

    if (calls.length === 0) {
      const r = await submitAndWaitFinalized(api, nativeCall, signer, opts);
      return { ...r, sent: [nativeSent], skipped };
    }

    if (api.tx.utility && typeof api.tx.utility.batchAll === 'function') {
      // Atomic: either every transfer is finalized or none is.
      const r = await submitAndWaitFinalized(api, api.tx.utility.batchAll([nativeCall, ...calls]), signer, opts);
      return { ...r, sent: [nativeSent, ...sent], skipped };
    }

    // No utility pallet: one finalized transfer after the other.
    let last = await submitAndWaitFinalized(api, nativeCall, signer, opts);
    const done = [nativeSent];
    for (let i = 0; i < calls.length; i++) {
      try {
        last = await submitAndWaitFinalized(api, calls[i], signer, opts);
        done.push(sent[i]);
      } catch (e) {
        if (e.code === 'FINALIZATION_TIMEOUT') throw e;
        logger.warn(`[faucet] ${sent[i].symbol} transfer failed: ${e.message}`);
        skipped.push({ symbol: sent[i].symbol, reason: 'transfer failed' });
      }
    }
    return { ...last, sent: done, skipped };
  }

  return {
    drip,
    ready: () => (typeof isReady === 'function' ? isReady() : true),
  };
}

module.exports = { createDripper, submitAndWaitFinalized, createSubmissionQueue, isOkContractOutput };
