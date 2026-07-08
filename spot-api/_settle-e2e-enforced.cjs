/* SETTLEMENT-E2E-REAL: prove enforced=true settle_trade with valid ECDSA attestor
 * recovered on-chain (balances move) + invalid attestation reverts (control).
 * Read-only check unless RUN=1. Bounded — no loops over the full SKIPPED set.
 */
const fs = require('fs');
const { ApiPromise, WsProvider, Keyring } = require('@polkadot/api');
const { ContractPromise } = require('@polkadot/api-contract');
const { BN } = require('@polkadot/util');
const {
  cryptoWaitReady,
  secp256k1PairFromSeed,
  secp256k1Compress,
  blake2AsU8a,
} = require('@polkadot/util-crypto');
const { secp256k1Sign: wasmSecp256k1Sign } = require('@polkadot/wasm-crypto');

const ROOT = '/Users/lucas/Documents/Projetos_DEV/Lunex';
const SPOT = ROOT + '/spot-api';
const WS = 'ws://127.0.0.1:9944';
const dd = require(SPOT + '/deployed-addresses.json');
const SPOT_ADDR = dd.spotSettlement;
const LBTC = dd.lbtc; // base
const LUSDT = dd.lusdt; // quote
const sMeta = JSON.parse(fs.readFileSync(ROOT + '/target/ink/spot_settlement_contract/spot_settlement_contract.contract', 'utf8'));
const tMeta = JSON.parse(fs.readFileSync(ROOT + '/target/ink/psp22_token/psp22_token.contract', 'utf8'));

const GAS = { refTime: new BN('600000000000'), proofSize: new BN('8000000') };
const SDL = null;
const RUN = process.env.RUN === '1';

function wv2(api) { return api.registry.createType('WeightV2', GAS); }
function opt(api) { return { gasLimit: wv2(api), storageDepositLimit: SDL, value: 0 }; }

// ---- attestor crypto: byte-for-byte mirror of settlementService.ts ----
function u128LE(value) {
  let v = BigInt(value); const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) { out[i] = Number(v & 0xffn); v >>= 8n; }
  return out;
}
function u64LE(value) {
  let v = BigInt(value); const out = new Uint8Array(8);
  for (let i = 0; i < 8; i++) { out[i] = Number(v & 0xffn); v >>= 8n; }
  return out;
}
function accU8a(api, addr) { return api.createType('AccountId', addr).toU8a(); }
function buildMsgV2(api, o) {
  const prefix = new TextEncoder().encode('lunex:v2:spot-order\n');
  const parts = [
    prefix,
    accU8a(api, o.maker),
    accU8a(api, o.base_token),
    accU8a(api, o.quote_token),
    Uint8Array.of(o.side),
    u128LE(o.price.toString()),
    u128LE(o.amount.toString()),
    u64LE(o.nonce.toString()),
    u64LE(o.expiry.toString()),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const msg = new Uint8Array(total); let off = 0;
  for (const p of parts) { msg.set(p, off); off += p.length; }
  return msg;
}
function attestHash(api, o) { return blake2AsU8a(buildMsgV2(api, o), 256); }
function attest(api, o, secretKey) {
  const hash = attestHash(api, o);
  const sig = wasmSecp256k1Sign(hash, secretKey); // 65-byte r||s||v, signs digest directly — same as settlementService
  if (sig.length !== 65) throw new Error('attestation not 65 bytes: ' + sig.length);
  return Array.from(sig);
}

async function send(api, signer, tx, tag) {
  return new Promise((resolve, reject) => {
    let done = false;
    tx.signAndSend(signer, ({ status, events = [], dispatchError, txHash }) => {
      if (dispatchError) {
        let msg = dispatchError.toString();
        if (dispatchError.isModule) { try { const d = api.registry.findMetaError(dispatchError.asModule); msg = `${d.section}.${d.name}`; } catch (e) {} }
        if (!done) { done = true; resolve({ ok: false, err: msg, txHash: txHash.toHex() }); }
        return;
      }
      // detect ContractEmitted / ExtrinsicFailed handled above; check contract revert in events
      if (status.isInBlock || status.isFinalized) {
        let reverted = null;
        for (const { event } of events) {
          if (api.events.contracts && api.events.contracts.ContractReverted && api.events.contracts.ContractReverted.is(event)) reverted = event.toString();
        }
        if (!done) { done = true; resolve({ ok: reverted ? false : true, txHash: txHash.toHex(), reverted, block: status.isFinalized ? 'finalized' : 'inBlock' }); }
      }
    }).catch((e) => { if (!done) { done = true; reject(e); } });
  });
}

async function dryRun(contract, caller, method, args) {
  const { result, output } = await contract.query[method](caller, opt(contract.api), ...args);
  return { ok: result.isOk, output: output ? output.toHuman() : null, raw: output ? output.toJSON() : null };
}

function toBN(output) {
  try { const j = output && output.toJSON ? output.toJSON() : output; const v = (j && j.ok !== undefined) ? j.ok : j; return new BN(String(v).replace(/^0x/, ''), String(v).startsWith('0x') ? 16 : 10).toString(); } catch (e) { return '0'; }
}
async function vaultBal(settle, caller, who, tok) {
  const { output } = await settle.query.getBalance(caller, opt(settle.api), who, tok);
  return toBN(output);
}

async function main() {
  await cryptoWaitReady();
  const api = await ApiPromise.create({ provider: new WsProvider(WS) });
  const kr = new Keyring({ type: 'sr25519' });
  const alice = kr.addFromUri('//Alice');
  const bob = kr.addFromUri('//Bob');
  const relayer = kr.addFromUri('//SpotRelayer');
  const settle = new ContractPromise(api, sMeta, SPOT_ADDR);
  const lbtc = new ContractPromise(api, tMeta, LBTC);
  const lusdt = new ContractPromise(api, tMeta, LUSDT);

  // attestor keypair from .env ATTESTOR_SEED
  const envTxt = fs.readFileSync(SPOT + '/.env', 'utf8');
  const m = envTxt.match(/ATTESTOR_SEED="?(0x[0-9a-fA-F]{64})"?/);
  if (!m) throw new Error('ATTESTOR_SEED not found in .env');
  const seed = Uint8Array.from(Buffer.from(m[1].slice(2), 'hex'));
  const pair = secp256k1PairFromSeed(seed);
  const attestorPub = secp256k1Compress(pair.publicKey); // 33 bytes
  const attestorPubHex = '0x' + Buffer.from(attestorPub).toString('hex');
  const attestorSecret = pair.secretKey;

  const out = { SPOT_ADDR, attestorPubHex };
  out.owner = (await settle.query.getOwner(alice.address, opt(api))).output?.toString();
  out.paused = (await settle.query.isPaused(alice.address, opt(api))).output?.toJSON();
  out.enf0 = (await settle.query.isSignatureVerificationEnforced(alice.address, opt(api))).output?.toJSON();
  try { out.attKey0 = (await settle.query.getAttestorKey(alice.address, opt(api))).output?.toJSON(); } catch (e) { out.attKey0 = 'ERR:' + e.message; }
  console.log('STATE0 ' + JSON.stringify(out));

  if (!RUN) { console.log('DRY MODE (RUN!=1) — no mutation'); await api.disconnect(); return; }

  // 1) set attestor key + enforce (owner=relayer). Idempotent.
  if (!out.attKey0 || (typeof out.attKey0 === 'string' && out.attKey0.startsWith('ERR')) || out.attKey0 === null) {
    const r = await send(api, relayer, settle.tx.setAttestorKey(opt(api), Array.from(attestorPub)), 'set_attestor_key');
    console.log('SET_ATTESTOR ' + JSON.stringify(r));
  }
  out.attKey1 = (await settle.query.getAttestorKey(alice.address, opt(api))).output?.toJSON();
  if (out.enf0 !== true) {
    const r = await send(api, relayer, settle.tx.setSignatureVerificationEnforced(opt(api), true), 'enforce_true');
    console.log('SET_ENFORCED ' + JSON.stringify(r));
  }
  out.enf1 = (await settle.query.isSignatureVerificationEnforced(alice.address, opt(api))).output?.toJSON();
  console.log('STATE1 attKey=' + JSON.stringify(out.attKey1) + ' enforced=' + out.enf1);

  // 2) fund vaults: Alice deposits LBTC (base), Bob deposits LUSDT (quote)
  const BIG = new BN('1000000000000000000');
  const depBase = new BN('2000000000');
  const depQuote = new BN('5000000000');
  // ensure Bob has LUSDT to deposit
  await send(api, alice, lusdt.tx.transfer(opt(api), bob.address, depQuote.muln(2), []), 'fund Bob LUSDT');
  await send(api, alice, lbtc.tx.approve(opt(api), SPOT_ADDR, BIG), 'alice approve lbtc');
  await send(api, bob, lusdt.tx.approve(opt(api), SPOT_ADDR, BIG), 'bob approve lusdt');
  const dA = await send(api, alice, settle.tx.depositPsp22(opt(api), LBTC, depBase), 'deposit lbtc');
  const dB = await send(api, bob, settle.tx.depositPsp22(opt(api), LUSDT, depQuote), 'deposit lusdt');
  out.depAliceLbtc = dA; out.depBobLusdt = dB;
  const vA_lbtc = await vaultBal(settle, alice.address, alice.address, LBTC);
  const vB_lusdt = await vaultBal(settle, alice.address, bob.address, LUSDT);
  console.log('FUNDED vaultAliceLBTC=' + vA_lbtc + ' vaultBobLUSDT=' + vB_lusdt + ' txA=' + dA.txHash + ' txB=' + dB.txHash);

  // 3) build matched trade. Alice SELL LBTC (side=1), Bob BUY (side=0). fill 1 LBTC @ price 2.0
  const price = new BN('200000000'); // 2.0 scaled 1e8
  const fill = new BN('1000000000'); // 1 LBTC
  const mkOrder = (maker, side, nonce) => ({ maker, base_token: LBTC, quote_token: LUSDT, side, price, amount: fill, filled_amount: 0, nonce, expiry: 0 });
  const makerO = mkOrder(alice.address, 1, 9101);
  const takerO = mkOrder(bob.address, 0, 9102);
  const SIG = '0x01' + '00'.repeat(63); // non-blank sr25519 placeholder (off-chain verified)
  // valid attestations over each order
  const makerAtt = attest(api, makerO, attestorSecret);
  const takerAtt = attest(api, takerO, attestorSecret);
  const makerFull = { ...makerO, signature: SIG, attestation: makerAtt };
  const takerFull = { ...takerO, signature: SIG, attestation: takerAtt };

  const vBefore = {
    bobLusdt: await vaultBal(settle, relayer.address, bob.address, LUSDT),
    bobLbtc: await vaultBal(settle, relayer.address, bob.address, LBTC),
    aliceLbtc: await vaultBal(settle, relayer.address, alice.address, LBTC),
    aliceLusdt: await vaultBal(settle, relayer.address, alice.address, LUSDT),
  };
  console.log('VAULT_BEFORE ' + JSON.stringify(vBefore));

  // 4a) CONTROL: invalid attestation must revert AttestationInvalid (dry-run)
  const badAtt = makerAtt.slice(); badAtt[0] ^= 0xff; // corrupt
  const makerBad = { ...makerFull, attestation: badAtt };
  const drBad = await dryRun(settle, relayer.address, 'settleTrade', [makerBad, takerFull, fill, price]);
  console.log('CONTROL_INVALID ' + JSON.stringify(drBad));

  // 4b) valid path: dry-run then submit real tx
  const drGood = await dryRun(settle, relayer.address, 'settleTrade', [makerFull, takerFull, fill, price]);
  console.log('VALID_DRYRUN ' + JSON.stringify(drGood).slice(0, 400));
  let settleTx = null;
  if (drGood.ok && !/AttestationInvalid|Reverted|Trapped|InsufficientBalance|error/i.test(JSON.stringify(drGood.raw))) {
    settleTx = await send(api, relayer, settle.tx.settleTrade(opt(api), makerFull, takerFull, fill, price), 'settle_trade');
    console.log('SETTLE_TX ' + JSON.stringify(settleTx));
  } else {
    console.log('SETTLE_SKIPPED_DRY_FAIL');
  }
  const vAfter = {
    bobLusdt: await vaultBal(settle, relayer.address, bob.address, LUSDT),
    bobLbtc: await vaultBal(settle, relayer.address, bob.address, LBTC),
    aliceLbtc: await vaultBal(settle, relayer.address, alice.address, LBTC),
    aliceLusdt: await vaultBal(settle, relayer.address, alice.address, LUSDT),
  };
  console.log('VAULT_AFTER ' + JSON.stringify(vAfter));
  const moved = settleTx && settleTx.ok && vAfter.bobLbtc !== vBefore.bobLbtc && vAfter.aliceLusdt !== vBefore.aliceLusdt;
  console.log('SETTLE_REAL_RESULT=' + (moved ? 'OK' : 'NO_MOVE') + ' tx=' + (settleTx && settleTx.txHash));

  await api.disconnect();
}
main().catch((e) => { console.error('FATAL', e.message, e.stack); process.exit(1); });
