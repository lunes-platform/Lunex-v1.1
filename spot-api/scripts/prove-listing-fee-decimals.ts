#!/usr/bin/env ts-node
/**
 * prove-listing-fee-decimals.ts — on-chain proof of the listing-fee decimals fix.
 *
 * listing_manager is now decimals-agnostic: the constructor takes lunes_decimals
 * and scales tier fees/min-liq by 10^decimals. This proves, against a live node,
 * that with an 8-decimal fee token a tier-1 listing costs exactly 1_000 tokens
 * (1_000 * 1e8), NOT the old hardcoded 1_000 * 1e12 (which was a 10_000x
 * overcharge and made list_token uncallable).
 *
 * Run from spot-api/:
 *   node_modules/.bin/ts-node --transpile-only scripts/prove-listing-fee-decimals.ts
 */
import { ApiPromise, WsProvider, Keyring } from '@polkadot/api'
import { CodePromise, ContractPromise } from '@polkadot/api-contract'
import { BN } from '@polkadot/util'
import type { WeightV2 } from '@polkadot/types/interfaces'
import * as fs from 'fs'
import * as path from 'path'

const WS_URL = process.env.LUNES_WS_URL || 'ws://127.0.0.1:9944'
const INK = path.resolve(__dirname, '..', '..', 'target', 'ink')
const load = (n: string) => JSON.parse(fs.readFileSync(path.join(INK, n, `${n}.contract`), 'utf8'))
const log = (m: string) => console.log(`[fee] ${m}`)
const D8 = 100_000_000n // 10^8

let api: ApiPromise
const cap = (): WeightV2 => api.registry.createType('WeightV2', { refTime: new BN('1200000000000'), proofSize: new BN('5000000') })
const decodeErr = (e: any): string => {
  if (e?.isModule) { try { const d = api.registry.findMetaError(e.asModule); return `${d.section}.${d.name}` } catch {} }
  return e?.toString() ?? 'unknown'
}
async function deploy(signer: any, name: string, ctor: string, args: unknown[]): Promise<string> {
  const b = load(name)
  const code = new CodePromise(api as any, b, b.source?.wasm)
  return new Promise((res, rej) => {
    let addr = ''
    ;(code.tx[ctor] as any)({ gasLimit: cap(), storageDepositLimit: null }, ...args)
      .signAndSend(signer, ({ events = [], status, dispatchError }: any) => {
        if (dispatchError) return rej(new Error(`${name}: ${decodeErr(dispatchError)}`))
        if (status.isInBlock || status.isFinalized) {
          for (const { event } of events) if (event.section === 'contracts' && event.method === 'Instantiated') addr = event.data[1].toString()
          if (status.isFinalized) addr ? (log(`deployed ${name} @ ${addr.slice(0, 12)}…`), res(addr)) : rej(new Error(`${name}: no addr`))
        }
      }).catch(rej)
  })
}
async function txc(signer: any, c: ContractPromise, m: string, args: unknown[], label: string): Promise<void> {
  const dry = await (c.query[m] as any)(signer.address, { gasLimit: cap(), storageDepositLimit: null }, ...args)
  if (dry.result.isErr) throw new Error(`${label} dry-run: ${dry.result.asErr.toString()}`)
  const out = dry.output?.toJSON() as any
  if (out && out.ok && out.ok.err !== undefined) throw new Error(`${label} reverted: ${JSON.stringify(out.ok.err)}`)
  return new Promise((res, rej) => {
    ;(c.tx[m] as any)({ gasLimit: dry.gasRequired, storageDepositLimit: null }, ...args)
      .signAndSend(signer, ({ status, dispatchError }: any) => {
        if (dispatchError) return rej(new Error(`${label}: ${decodeErr(dispatchError)}`))
        if (status.isFinalized) res()
      }).catch(rej)
  })
}
async function qy(c: ContractPromise, caller: string, m: string, args: unknown[]): Promise<any> {
  const { result, output } = await (c.query[m] as any)(caller, { gasLimit: cap(), storageDepositLimit: null }, ...args)
  if (result.isErr) throw new Error(`query ${m}: ${result.asErr.toString()}`)
  let v = output?.toJSON() as any
  while (v && typeof v === 'object' && !Array.isArray(v) && 'ok' in v) v = v.ok
  if (v && typeof v === 'object' && !Array.isArray(v) && 'err' in v) throw new Error(`${m} reverted: ${JSON.stringify(v.err)}`)
  return v
}
const toBig = (v: any) => BigInt(typeof v === 'string' ? v : v)

async function main() {
  api = await ApiPromise.create({ provider: new WsProvider(WS_URL) })
  await api.isReady
  const kr = new Keyring({ type: 'sr25519' })
  const alice = kr.addFromUri('//Alice')
  const bob = kr.addFromUri('//Bob').address
  const charlie = kr.addFromUri('//Charlie').address
  const django = kr.addFromUri('//Dave').address
  const tokenAddr = kr.addFromUri('//Eve').address
  console.log(`\n=== LISTING-FEE DECIMALS FIX PROOF (8-dec fee token) ===\n`)

  // 1. 8-decimal PSP22 as the fee token; Alice gets 1,000,000 tokens
  const psp = await deploy(alice, 'psp22_token', 'new', ['LUNES8', 'LUNES8', 8, new BN((1_000_000n * D8).toString())])
  const token = new ContractPromise(api as any, load('psp22_token'), psp)

  // 2. liquidity_lock + dummy lock (id 0) so list_token's lock_id becomes 1
  const lockAddr = await deploy(alice, 'liquidity_lock', 'new', [alice.address])
  const lock = new ContractPromise(api as any, load('liquidity_lock'), lockAddr)
  await txc(alice, lock, 'createLock', [alice.address, bob, charlie, new BN(D8.toString()), new BN(D8.toString()), new BN(D8.toString()), new BN('1000'), 1], 'dummy lock')

  // 3. listing_manager with lunes_decimals = 8; recipients are NOT Alice so the
  //    fee actually leaves her balance (measurable). The FIX is the 6th arg.
  const mgrAddr = await deploy(alice, 'listing_manager', 'new', [psp, lockAddr, bob /*treasury*/, charlie /*rewards*/, django /*staking*/, 8])
  const mgr = new ContractPromise(api as any, load('listing_manager'), mgrAddr)
  await txc(alice, lock, 'setManager', [mgrAddr], 'set_manager')

  // 4. tier_config must scale to 8 decimals
  const tc = await qy(mgr, alice.address, 'tierConfig', [1])
  const fee = toBig(tc.listingFee ?? tc.listing_fee)
  const minLiq = toBig(tc.minLunesLiq ?? tc.min_lunes_liq)
  const fails: string[] = []
  const ck = (ok: boolean, d: string) => { console.log(`${ok ? '✅' : '❌'} ${d}`); if (!ok) fails.push(d) }
  ck(fee === 1_000n * D8, `tier_config(1).listing_fee == 1000*1e8 (got ${fee}, old-bug value would be ${1_000n * 1_000_000_000_000n})`)
  ck(minLiq === 10_000n * D8, `tier_config(1).min_lunes_liq == 10000*1e8 (got ${minLiq})`)

  // 5. Real list_token: approve EXACTLY the fee, then list. Succeeds only if the
  //    fee is the small (correct) amount — Alice holds 1e6*1e8, far below the
  //    old-bug fee of 1000*1e12.
  await txc(alice, token, 'approve', [mgrAddr, new BN((1_000n * D8).toString())], 'approve(1000 LUNES8)')
  const balBefore = toBig(await qy(token, alice.address, 'balanceOf', [alice.address]))
  await txc(alice, mgr, 'listToken', [1, tokenAddr, charlie, django, new BN(D8.toString()), new BN((10_000n * D8).toString()), new BN(D8.toString())], 'list_token(tier=1)')
  const balAfter = toBig(await qy(token, alice.address, 'balanceOf', [alice.address]))
  const spent = balBefore - balAfter
  ck(spent === 1_000n * D8, `list_token charged EXACTLY 1000*1e8 (spent ${spent}, NOT 10M)`)

  const listing = await qy(mgr, alice.address, 'getListing', [0])
  const lockId = listing?.lockId ?? listing?.lock_id
  const lockRec = await qy(lock, alice.address, 'getLock', [lockId])
  ck(Number(lockId) === 1 && !!lockRec, `B1 still holds on fixed contract: lock_id=${lockId}, get_lock present`)

  console.log('\n' + '='.repeat(60))
  console.log(fails.length ? '❌ DECIMALS FIX PROOF FAILED' : '✅ LISTING-FEE DECIMALS FIX PROVEN ON-CHAIN')
  console.log('='.repeat(60))
  await api.disconnect()
  process.exit(fails.length ? 1 : 0)
}
main().catch((e) => { console.error('[fee] ❌', e?.message ?? e); process.exit(1) })
