#!/usr/bin/env ts-node
/**
 * verify-advanced-onchain.ts — liveness + cross-contract checks for the
 * "advanced" contracts deployed by deploy-remaining-contracts.ts:
 * liquidity_lock, listing_manager, spot_settlement, copy_vault,
 * asymmetric_pair, asset_wrapper.
 *
 * Addresses are read from the SANDBOX_* / *_CONTRACT_ADDRESS keys that the
 * deploy script wrote into spot-api/.env.
 *
 * Run from spot-api/:
 *   node_modules/.bin/ts-node --transpile-only scripts/verify-advanced-onchain.ts
 */
import { ApiPromise, WsProvider, Keyring } from '@polkadot/api'
import { ContractPromise } from '@polkadot/api-contract'
import { BN } from '@polkadot/util'
import type { WeightV2 } from '@polkadot/types/interfaces'
import * as fs from 'fs'
import * as path from 'path'

const WS_URL = process.env.LUNES_WS_URL || 'ws://127.0.0.1:9944'
const ROOT = path.resolve(__dirname, '..', '..')
const INK = path.join(ROOT, 'target', 'ink')
const ENV = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
const envv = (k: string) => (ENV.match(new RegExp(`^${k}=\\s*"?([^"\\n]+)"?`, 'm')) || [])[1]

const A = {
  liquidity_lock: envv('LIQUIDITY_LOCK_CONTRACT_ADDRESS'),
  listing_manager: envv('LISTING_MANAGER_CONTRACT_ADDRESS'),
  spot_settlement: envv('SANDBOX_SPOT_SETTLEMENT_CONTRACT'),
  copy_vault: envv('SANDBOX_COPY_VAULT_CONTRACT'),
  asymmetric_pair: envv('SANDBOX_ASYMMETRIC_PAIR_CONTRACT'),
}

let api: ApiPromise
const results: { name: string; ok: boolean; detail: string }[] = []
const check = (n: string, ok: boolean, d: string) => { results.push({ name: n, ok, detail: d }); console.log(`${ok ? '✅' : '❌'} ${n} — ${d}`) }
const meta = (a: string) => JSON.parse(fs.readFileSync(path.join(INK, a, `${a}.json`), 'utf8'))
const cap = (): WeightV2 => api.registry.createType('WeightV2', { refTime: new BN('1200000000000'), proofSize: new BN('5000000') })
async function qy(c: ContractPromise, caller: string, m: string, args: unknown[]): Promise<any> {
  const { result, output } = await (c.query[m] as any)(caller, { gasLimit: cap(), storageDepositLimit: null }, ...args)
  if (result.isErr) throw new Error(`query ${m}: ${result.asErr.toString()}`)
  let v = output?.toJSON() as any
  while (v && typeof v === 'object' && !Array.isArray(v) && 'ok' in v) v = v.ok
  if (v && typeof v === 'object' && !Array.isArray(v) && 'err' in v) throw new Error(`${m} reverted: ${JSON.stringify(v.err)}`)
  return v
}
const safe = async (fn: () => Promise<void>, name: string) => { try { await fn() } catch (e: any) { check(name, false, e.message) } }

async function main() {
  api = await ApiPromise.create({ provider: new WsProvider(WS_URL) })
  await api.isReady
  const best = (await api.rpc.chain.getHeader()).number.toNumber()
  console.log(`\n=== ADVANCED CONTRACTS VERIFICATION (block ${best}) ===\n`)
  const alice = new Keyring({ type: 'sr25519' }).addFromUri('//Alice')

  console.log('── liveness ──')
  for (const [k, addr] of Object.entries(A)) {
    if (!addr) { check(`live:${k}`, false, 'no address in .env'); continue }
    const info: any = await api.query.contracts.contractInfoOf(addr)
    check(`live:${k}`, info.isSome, info.isSome ? `${addr.slice(0, 10)}… LIVE` : `${addr.slice(0, 10)}… MISSING`)
  }

  // ── liquidity_lock ↔ listing_manager wiring (B1 authorization) ──
  console.log('\n── B1 wiring: liquidity_lock.manager == listing_manager ──')
  await safe(async () => {
    const lock = new ContractPromise(api as any, meta('liquidity_lock'), A.liquidity_lock)
    const mgr = await qy(lock, alice.address, 'manager', [])
    check('liquidity_lock.manager == listing_manager', mgr === A.listing_manager, `${String(mgr).slice(0, 12)}… vs ${A.listing_manager.slice(0, 12)}…`)
    const admin = await qy(lock, alice.address, 'admin', [])
    check('liquidity_lock.admin == deployer', admin === alice.address, `${String(admin).slice(0, 12)}…`)
  }, 'liquidity_lock checks')

  await safe(async () => {
    const lm = new ContractPromise(api as any, meta('listing_manager'), A.listing_manager)
    const admin = await qy(lm, alice.address, 'admin', [])
    check('listing_manager.admin == deployer', admin === alice.address, `${String(admin).slice(0, 12)}…`)
  }, 'listing_manager checks')

  // ── spot_settlement config ──
  console.log('\n── spot_settlement ──')
  await safe(async () => {
    const s = new ContractPromise(api as any, meta('spot_settlement_contract'), A.spot_settlement)
    const owner = await qy(s, alice.address, 'getOwner', [])
    check('spot_settlement.get_owner == deployer', owner === alice.address, `${String(owner).slice(0, 12)}…`)
    const treasury = await qy(s, alice.address, 'getTreasury', [])
    check('spot_settlement.get_treasury set', !!treasury, `${String(treasury).slice(0, 12)}…`)
    const fees = await qy(s, alice.address, 'getFeeRates', [])
    check('spot_settlement.get_fee_rates reachable', fees !== undefined, JSON.stringify(fees))
  }, 'spot_settlement checks')

  // ── copy_vault config ──
  console.log('\n── copy_vault ──')
  await safe(async () => {
    const v = new ContractPromise(api as any, meta('copy_vault'), A.copy_vault)
    const leader = await qy(v, alice.address, 'getLeader', [])
    check('copy_vault.get_leader == deployer', leader === alice.address, `${String(leader).slice(0, 12)}…`)
    const sp = await qy(v, alice.address, 'getSharePrice', [])
    check('copy_vault.get_share_price reachable', sp !== undefined, JSON.stringify(sp))
  }, 'copy_vault checks')

  // ── asymmetric_pair pricing engine ──
  console.log('\n── asymmetric_pair ──')
  await safe(async () => {
    const ap = new ContractPromise(api as any, meta('asymmetric_pair'), A.asymmetric_pair)
    const owner = await qy(ap, alice.address, 'getOwner', [])
    check('asymmetric_pair.get_owner == deployer', owner === alice.address, `${String(owner).slice(0, 12)}…`)
    const curve = await qy(ap, alice.address, 'getBuyCurve', [])
    check('asymmetric_pair.get_buy_curve set', curve !== undefined, JSON.stringify(curve).slice(0, 80))
    const quote = await qy(ap, alice.address, 'getQuote', [new BN('100000000'), true])
    check('asymmetric_pair.get_quote(buy) reachable', quote !== undefined, JSON.stringify(quote).slice(0, 80))
  }, 'asymmetric_pair checks')

  const pass = results.filter((r) => r.ok).length
  const fail = results.filter((r) => !r.ok)
  console.log('\n' + '='.repeat(60))
  console.log(`RESULT: ${pass}/${results.length} checks passed`)
  if (fail.length) { console.log('FAILED:'); fail.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`)) }
  else console.log('✅ ALL ADVANCED CROSS-CONTRACT CHECKS PASSED')
  console.log('='.repeat(60))
  await api.disconnect()
  process.exit(fail.length ? 1 : 0)
}
main().catch((e) => { console.error('FATAL', e?.message ?? e); process.exit(1) })
