#!/usr/bin/env ts-node
/**
 * prove-b4-factory-fee-routing.ts — on-chain proof of the B4 fix.
 *
 * factory.create_pair now wires each new pair's protocol_fee_to /
 * trading_rewards_contract from the factory's globals. Proof:
 *  - Factory B (globals UNSET): create_pair → pair.get_protocol_fee_to()==None
 *    (this is the OLD behavior — fees collected nowhere).
 *  - Factory A (globals SET): create_pair → pair routing == the set addresses.
 *
 * Run from spot-api/:
 *   node_modules/.bin/ts-node --transpile-only scripts/prove-b4-factory-fee-routing.ts
 */
import { ApiPromise, WsProvider, Keyring } from '@polkadot/api'
import { CodePromise, ContractPromise } from '@polkadot/api-contract'
import { BN } from '@polkadot/util'
import type { WeightV2 } from '@polkadot/types/interfaces'
import * as fs from 'fs'
import * as path from 'path'

const WS_URL = process.env.LUNES_WS_URL || 'ws://127.0.0.1:9944'
const INK = path.resolve(__dirname, '..', '..', 'target', 'ink')
const ADDRS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'deployed-addresses.json'), 'utf8'))
const meta = (n: string) => JSON.parse(fs.readFileSync(path.join(INK, n, `${n}.contract`), 'utf8'))
const log = (m: string) => console.log(`[b4] ${m}`)

let api: ApiPromise
const cap = (): WeightV2 => api.registry.createType('WeightV2', { refTime: new BN('1200000000000'), proofSize: new BN('5000000') })
const decodeErr = (e: any): string => {
  if (e?.isModule) { try { const d = api.registry.findMetaError(e.asModule); return `${d.section}.${d.name}` } catch {} }
  return e?.toString() ?? 'unknown'
}
async function deploy(signer: any, name: string, ctor: string, args: unknown[]): Promise<string> {
  const b = meta(name)
  const code = new CodePromise(api as any, b, b.source?.wasm)
  return new Promise((res, rej) => {
    let addr = ''
    ;(code.tx[ctor] as any)({ gasLimit: cap(), storageDepositLimit: null }, ...args)
      .signAndSend(signer, ({ events = [], status, dispatchError }: any) => {
        if (dispatchError) return rej(new Error(`${name}: ${decodeErr(dispatchError)}`))
        if (status.isInBlock || status.isFinalized) {
          for (const { event } of events) if (event.section === 'contracts' && event.method === 'Instantiated') addr = event.data[1].toString()
          if (status.isFinalized) addr ? res(addr) : rej(new Error(`${name}: no addr`))
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
  return v
}

async function main() {
  api = await ApiPromise.create({ provider: new WsProvider(WS_URL) })
  await api.isReady
  const kr = new Keyring({ type: 'sr25519' })
  const alice = kr.addFromUri('//Alice')
  const feeTo = kr.addFromUri('//Charlie').address
  const rewards = kr.addFromUri('//Dave').address
  const codeHash = ADDRS.pairCodeHash
  const [tokA, tokB] = [ADDRS.wnative, ADDRS.lusdt]
  console.log(`\n=== B4 FACTORY FEE-ROUTING PROOF (pair code ${String(codeHash).slice(0, 12)}…) ===\n`)
  const fails: string[] = []
  const ck = (ok: boolean, d: string) => { console.log(`${ok ? '✅' : '❌'} ${d}`); if (!ok) fails.push(d) }

  // ── Control: factory with globals UNSET → new pair has None (old behavior) ──
  const facB = await deploy(alice, 'factory_contract', 'new', [alice.address, codeHash])
  log(`Factory B (globals unset) @ ${facB.slice(0, 12)}…`)
  const fb = new ContractPromise(api as any, meta('factory_contract'), facB)
  await txc(alice, fb, 'createPair', [tokA, tokB], 'B.create_pair')
  const pairB = await qy(fb, alice.address, 'getPair', [tokA, tokB])
  const pB = new ContractPromise(api as any, meta('pair_contract'), pairB)
  const feeB = await qy(pB, alice.address, 'getProtocolFeeTo', [])
  ck(feeB === null, `control: pair from unconfigured factory has protocol_fee_to == None (got ${JSON.stringify(feeB)})`)

  // ── Fix: factory with globals SET → new pair is wired ──
  const facA = await deploy(alice, 'factory_contract', 'new', [alice.address, codeHash])
  log(`Factory A (globals set) @ ${facA.slice(0, 12)}…`)
  const fa = new ContractPromise(api as any, meta('factory_contract'), facA)
  await txc(alice, fa, 'setProtocolFeeToGlobal', [feeTo], 'A.set_protocol_fee_to_global')
  await txc(alice, fa, 'setTradingRewardsGlobal', [rewards], 'A.set_trading_rewards_global')
  await txc(alice, fa, 'createPair', [tokA, tokB], 'A.create_pair')
  const pairA = await qy(fa, alice.address, 'getPair', [tokA, tokB])
  const pA = new ContractPromise(api as any, meta('pair_contract'), pairA)
  const feeA = await qy(pA, alice.address, 'getProtocolFeeTo', [])
  const rewA = await qy(pA, alice.address, 'getTradingRewardsContract', [])
  ck(feeA === feeTo, `pair.protocol_fee_to == fee_to global (${String(feeA).slice(0, 12)}… vs ${feeTo.slice(0, 12)}…)`)
  ck(rewA === rewards, `pair.trading_rewards_contract == rewards global (${String(rewA).slice(0, 12)}… vs ${rewards.slice(0, 12)}…)`)

  console.log('\n' + '='.repeat(60))
  console.log(fails.length ? '❌ B4 PROOF FAILED' : '✅ B4 FACTORY FEE-ROUTING PROVEN ON-CHAIN')
  console.log('='.repeat(60))
  await api.disconnect()
  process.exit(fails.length ? 1 : 0)
}
main().catch((e) => { console.error('[b4] ❌', e?.message ?? e); process.exit(1) })
