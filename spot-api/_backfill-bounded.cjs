/* BOUNDED backfill: settle N matched trades on-chain under enforced=true with
 * valid ECDSA attestations. HARD LIMIT N=15 (no loop over the 275k SKIPPED set).
 * Proves the enforced pipeline drains a batch: each settle = real tx + vault move.
 * Marks the corresponding SKIPPED proof-trades is OUT OF SCOPE (DB untouched —
 * real SKIPPED use unfunded bot vaults + untrusted sources; see report).
 */
const fs = require('fs');
const { ApiPromise, WsProvider, Keyring } = require('@polkadot/api');
const { ContractPromise } = require('@polkadot/api-contract');
const { BN } = require('@polkadot/util');
const { cryptoWaitReady, secp256k1PairFromSeed, secp256k1Compress, blake2AsU8a } = require('@polkadot/util-crypto');
const { secp256k1Sign: wasmSecp256k1Sign } = require('@polkadot/wasm-crypto');

const ROOT = '/Users/lucas/Documents/Projetos_DEV/Lunex';
const SPOT = ROOT + '/spot-api';
const WS = 'ws://127.0.0.1:9944';
const dd = require(SPOT + '/deployed-addresses.json');
const SPOT_ADDR = dd.spotSettlement, LBTC = dd.lbtc, LUSDT = dd.lusdt;
const sMeta = JSON.parse(fs.readFileSync(ROOT + '/target/ink/spot_settlement_contract/spot_settlement_contract.contract', 'utf8'));
const tMeta = JSON.parse(fs.readFileSync(ROOT + '/target/ink/psp22_token/psp22_token.contract', 'utf8'));
const GAS = { refTime: new BN('600000000000'), proofSize: new BN('8000000') };
const N = Math.min(parseInt(process.env.N || '15', 10), 20); // HARD CAP 20

function wv2(api) { return api.registry.createType('WeightV2', GAS); }
function opt(api) { return { gasLimit: wv2(api), storageDepositLimit: null, value: 0 }; }
function u128LE(v){v=BigInt(v);const o=new Uint8Array(16);for(let i=0;i<16;i++){o[i]=Number(v&0xffn);v>>=8n;}return o;}
function u64LE(v){v=BigInt(v);const o=new Uint8Array(8);for(let i=0;i<8;i++){o[i]=Number(v&0xffn);v>>=8n;}return o;}
function accU8a(api,a){return api.createType('AccountId',a).toU8a();}
function buildMsgV2(api,o){const p=[new TextEncoder().encode('lunex:v2:spot-order\n'),accU8a(api,o.maker),accU8a(api,o.base_token),accU8a(api,o.quote_token),Uint8Array.of(o.side),u128LE(o.price.toString()),u128LE(o.amount.toString()),u64LE(o.nonce.toString()),u64LE(o.expiry.toString())];const t=p.reduce((n,x)=>n+x.length,0);const m=new Uint8Array(t);let off=0;for(const x of p){m.set(x,off);off+=x.length;}return m;}
function attest(api,o,sk){const h=blake2AsU8a(buildMsgV2(api,o),256);const s=wasmSecp256k1Sign(h,sk);return Array.from(s);}
async function send(api, signer, tx, tag) {
  return new Promise((resolve) => { let done=false;
    tx.signAndSend(signer, ({ status, dispatchError, txHash }) => {
      if (dispatchError) { let msg=dispatchError.toString(); if(dispatchError.isModule){try{const d=api.registry.findMetaError(dispatchError.asModule);msg=d.section+'.'+d.name;}catch(e){}} if(!done){done=true;resolve({ok:false,err:msg,txHash:txHash.toHex()});} return; }
      if (status.isInBlock || status.isFinalized) { if(!done){done=true;resolve({ok:true,txHash:txHash.toHex()});} }
    }).catch(()=>{ if(!done){done=true;resolve({ok:false,err:'send-throw'});} });
  });
}
function toBN(output){try{const j=output&&output.toJSON?output.toJSON():output;const v=(j&&j.ok!==undefined)?j.ok:j;return new BN(String(v).replace(/^0x/,''),String(v).startsWith('0x')?16:10).toString();}catch(e){return '0';}}
async function vaultBal(s,c,who,tok){const{output}=await s.query.getBalance(c,opt(s.api),who,tok);return toBN(output);}

async function main() {
  await cryptoWaitReady();
  const api = await ApiPromise.create({ provider: new WsProvider(WS) });
  const kr = new Keyring({ type: 'sr25519' });
  const alice = kr.addFromUri('//Alice'), bob = kr.addFromUri('//Bob'), relayer = kr.addFromUri('//SpotRelayer');
  const settle = new ContractPromise(api, sMeta, SPOT_ADDR);
  const lbtc = new ContractPromise(api, tMeta, LBTC), lusdt = new ContractPromise(api, tMeta, LUSDT);
  const m = fs.readFileSync(SPOT + '/.env','utf8').match(/ATTESTOR_SEED="?(0x[0-9a-fA-F]{64})"?/);
  const pair = secp256k1PairFromSeed(Uint8Array.from(Buffer.from(m[1].slice(2),'hex')));
  const sk = pair.secretKey;

  // Fund enough for N fills of 1 LBTC @ 2.0 (=2 LUSDT + fee each). Top up generously, idempotent.
  const BIG = new BN('1000000000000000000');
  const fill = new BN('1000000000'), price = new BN('200000000');
  const needBase = fill.muln(N).add(fill.muln(2));
  const needQuote = new BN('200000000000'); // ample
  await send(api, alice, lusdt.tx.transfer(opt(api), bob.address, needQuote, []), 'fund bob');
  await send(api, alice, lbtc.tx.approve(opt(api), SPOT_ADDR, BIG), 'a-appr');
  await send(api, bob, lusdt.tx.approve(opt(api), SPOT_ADDR, BIG), 'b-appr');
  await send(api, alice, settle.tx.depositPsp22(opt(api), LBTC, needBase), 'dep-lbtc');
  await send(api, bob, settle.tx.depositPsp22(opt(api), LUSDT, needQuote), 'dep-lusdt');
  const vA0 = await vaultBal(settle, alice.address, alice.address, LBTC);
  const vB0 = await vaultBal(settle, alice.address, bob.address, LUSDT);
  console.log('BACKFILL_FUNDED vaultAliceLBTC=' + vA0 + ' vaultBobLUSDT=' + vB0 + ' N=' + N);

  let settled = 0; const txs = [];
  const baseNonce = 20000 + Math.floor(Date.now() / 1000) % 100000;
  for (let i = 0; i < N; i++) {
    const mk = (maker, side, nonce) => ({ maker, base_token: LBTC, quote_token: LUSDT, side, price, amount: fill, filled_amount: 0, nonce, expiry: 0 });
    const makerO = mk(alice.address, 1, baseNonce + i * 2);
    const takerO = mk(bob.address, 0, baseNonce + i * 2 + 1);
    const SIG = '0x01' + '00'.repeat(63);
    const makerFull = { ...makerO, signature: SIG, attestation: attest(api, makerO, sk) };
    const takerFull = { ...takerO, signature: SIG, attestation: attest(api, takerO, sk) };
    const r = await send(api, relayer, settle.tx.settleTrade(opt(api), makerFull, takerFull, fill, price), 'settle#' + i);
    if (r.ok) { settled++; txs.push(r.txHash); }
    console.log('SETTLE#' + i + ' ok=' + r.ok + ' tx=' + (r.txHash || '') + (r.err ? ' err=' + r.err : ''));
  }
  const vA1 = await vaultBal(settle, alice.address, alice.address, LBTC);
  const vB1 = await vaultBal(settle, alice.address, bob.address, LUSDT);
  console.log('BACKFILL_RESULT settled=' + settled + '/' + N + ' vaultAliceLBTC ' + vA0 + '->' + vA1 + ' vaultBobLUSDT ' + vB0 + '->' + vB1);
  console.log('TXS ' + JSON.stringify(txs));
  await api.disconnect();
}
main().catch((e) => { console.error('FATAL', e.message, e.stack); process.exit(1); });
