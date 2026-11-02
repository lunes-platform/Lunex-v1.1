const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { unwrap } = require('./core.cjs');

async function connect(ctx) {
  const { ApiPromise, WsProvider, Keyring } = ctx.dep('@polkadot/api');
  const { ContractPromise, CodePromise } = ctx.dep('@polkadot/api-contract');
  await ctx.dep('@polkadot/util-crypto').cryptoWaitReady();
  const api = await ApiPromise.create({ provider: new WsProvider(ctx.manifest.network) });
  assert.equal((await api.rpc.system.chain()).toString(), 'Development', 'development chain required');
  const genesis = api.genesisHash.toHex();
  if (ctx.manifest.genesis) assert.equal(genesis, ctx.manifest.genesis, 'chain changed');
  assert.equal(Number(api.registry.chainDecimals[0]), 8, 'native precision changed');
  const keyring = new Keyring({ type: 'sr25519' });
  const users = ctx.secrets.traders.map(seed => keyring.addFromUri(seed));
  const lp = keyring.addFromUri(ctx.secrets.lp), relayer = keyring.addFromUri(ctx.secrets.relayer), treasury = keyring.addFromUri(ctx.secrets.treasury);
  const abi = name => JSON.parse(fs.readFileSync(path.join(ctx.dir, 'abis', name + '.contract')));
  const contract = (name, address) => new ContractPromise(api, abi(name), address);
  const gasLimit = api.registry.createType('WeightV2', { refTime: 500000000000n, proofSize: 10000000n });
  async function query(c, method, args = [], user = lp, value = 0n) {
    const q = await c.query[method](user.address, { gasLimit, storageDepositLimit: null, value }, ...args);
    assert(q.result.isOk, method + ': RPC execution failed ' + JSON.stringify(q.result.toJSON()));
    if (q.result.asOk?.flags?.isRevert) throw new Error(method + ': reverted');
    return unwrap(q.output?.toJSON());
  }
  async function sendRaw(tx, user, label) {
    assert(!ctx.state.pendingTx, 'unresolved transaction: review journal before continuing');
    const nonce = await api.rpc.system.accountNextIndex(user.address);
    await tx.signAsync(user, { nonce });
    const head = await api.rpc.chain.getHeader();
    ctx.state.pendingTx = { label, caller: user.address, hash: tx.hash.toHex(), nonce: nonce.toString(), fromBlock: head.number.toString(), signedAt: Date.now() };
    ctx.save(); ctx.event('tx.submitting', ctx.state.pendingTx);
    return new Promise((resolve, reject) => {
      let unsub, finished = false;
      const finish = (err, result) => { if (finished) return; finished = true; clearTimeout(timer); unsub?.(); err ? reject(err) : resolve(result); };
      const timer = setTimeout(() => finish(new Error(label + ': finality timeout; transaction outcome uncertain')), 180000);
      tx.send(result => {
        if (result.status.isInvalid || result.status.isDropped || result.status.isUsurped) return finish(new Error(label + ': ' + result.status.type));
        if (!result.status.isFinalized) return;
        const evidence = { ...ctx.state.pendingTx, blockHash: result.status.asFinalized.toHex(), finalizedAt: Date.now() };
        ctx.state.pendingTx = null; ctx.save();
        if (result.dispatchError) { ctx.event('tx.failed', { ...evidence, error: result.dispatchError.toString() }); return finish(new Error(label + ': dispatch ' + result.dispatchError.toString())); }
        ctx.state.counters.extrinsics = (ctx.state.counters.extrinsics || 0) + 1; ctx.save(); ctx.event('tx.finalized', evidence); finish(null, evidence);
      }).then(u => { unsub = u; if (finished) unsub(); }).catch(e => finish(e));
    });
  }
  async function send(c, method, args = [], user = lp, value = 0n) {
    await query(c, method, args, user, value);
    return sendRaw(c.tx[method]({ gasLimit, storageDepositLimit: null, value }, ...args), user, method);
  }
  async function deploy(name, args, salt) {
    const bundle = abi(name); const code = new CodePromise(api, bundle, bundle.source.wasm);
    const evidence = await sendRaw(code.tx.new({ gasLimit, storageDepositLimit: null, salt: Buffer.from(salt) }, ...args), lp, 'deploy.' + name);
    const events = await api.query.system.events.at(evidence.blockHash);
    // Identify the contract instantiated by this owner, even if the block contains other transactions.
    const row = events.find(e => e.event.section === 'contracts' && e.event.method === 'Instantiated' && e.event.data[0].toString() === lp.address);
    assert(row, 'missing deployment address'); return row.event.data[1].toString();
  }
  return { api, genesis, keyring, users, lp, relayer, treasury, abi, contract, gasLimit, query, send, sendRaw, deploy };
}
module.exports = { connect };
