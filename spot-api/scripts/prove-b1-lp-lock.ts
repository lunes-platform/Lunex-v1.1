#!/usr/bin/env ts-node
/**
 * prove-b1-lp-lock.ts — On-chain proof that B1 is fixed.
 *
 * listing_manager::list_token must now create a REAL lock in liquidity_lock via
 * the create_lock cross-contract call (B1), not the old stub lock_id=listing_id.
 *
 * Discriminating proof: pre-create one dummy lock as Alice (initial manager) →
 * liquidity_lock.next_id becomes 1. Then list_token runs with listing_id=0 but
 * must return lock_id=1, and get_lock(1) must be present with matching fields.
 * Under the OLD code get_lock(1) is None (create_lock never called).
 *
 * Run from spot-api/:  node_modules/.bin/ts-node --transpile-only scripts/prove-b1-lp-lock.ts
 */
import { ApiPromise, WsProvider, Keyring } from '@polkadot/api'
import { CodePromise, ContractPromise } from '@polkadot/api-contract'
import { BN } from '@polkadot/util'
import type { WeightV2 } from '@polkadot/types/interfaces'
import * as fs from 'fs'
import * as path from 'path'

const WS_URL = process.env.LUNES_WS_URL || 'ws://127.0.0.1:9944'
const ROOT = path.resolve(__dirname, '..', '..')
const INK = path.join(ROOT, 'target', 'ink')
const DECIMALS = 1_000_000_000_000n

const load = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(INK, name, `${name}.contract`), 'utf8'))
const log = (m: string) => console.log(`[b1] ${m}`)

let api: ApiPromise
// Deploy/tx ceiling: under maxExtrinsic refTime (~1.3e12), generous proofSize.
const capGas = (): WeightV2 =>
  api.registry.createType('WeightV2', {
    refTime: new BN('1200000000000'),
    proofSize: new BN('5000000'),
  })

async function deploy(signer: any, name: string, ctor: string, args: unknown[]): Promise<string> {
  const bundle = load(name)
  const code = new CodePromise(api as any, bundle, bundle.source?.wasm)
  return new Promise((resolve, reject) => {
    let addr = ''
    ;(code.tx[ctor] as any)({ gasLimit: capGas(), storageDepositLimit: null }, ...args)
      .signAndSend(signer, ({ events = [], status, dispatchError }: any) => {
        if (dispatchError) return reject(new Error(`${name} deploy: ${decodeErr(dispatchError)}`))
        if (status.isInBlock || status.isFinalized) {
          for (const { event } of events)
            if (event.section === 'contracts' && event.method === 'Instantiated')
              addr = event.data[1].toString()
          if (status.isFinalized)
            addr ? (log(`✅ deployed ${name} @ ${addr}`), resolve(addr)) : reject(new Error(`${name}: no Instantiated event`))
        }
      })
      .catch(reject)
  })
}

function decodeErr(dispatchError: any): string {
  if (dispatchError?.isModule) {
    try {
      const d = api.registry.findMetaError(dispatchError.asModule)
      return `${d.section}.${d.name}`
    } catch {}
  }
  return dispatchError?.toString() ?? 'unknown'
}

async function txCall(signer: any, c: ContractPromise, method: string, args: unknown[], label: string): Promise<void> {
  // Dry-run to estimate gas (list_token does 4 cross-contract calls).
  const dry = await (c.query[method] as any)(signer.address, { gasLimit: capGas(), storageDepositLimit: null }, ...args)
  if (dry.result.isErr) throw new Error(`${label} dry-run reverted: ${dry.result.asErr.toString()}`)
  // contract-level Result<_, Error> revert surfaces in output as { Err: ... }
  const out = dry.output?.toJSON() as any
  if (out && out.ok && out.ok.err !== undefined) throw new Error(`${label} contract returned Err: ${JSON.stringify(out.ok.err)}`)
  const gas = dry.gasRequired as WeightV2
  return new Promise((resolve, reject) => {
    ;(c.tx[method] as any)({ gasLimit: gas, storageDepositLimit: null }, ...args)
      .signAndSend(signer, ({ status, dispatchError }: any) => {
        if (dispatchError) return reject(new Error(`${label}: ${decodeErr(dispatchError)}`))
        if (status.isFinalized) (log(`✅ ${label}`), resolve())
      })
      .catch(reject)
  })
}

async function q(c: ContractPromise, caller: string, method: string, args: unknown[]): Promise<any> {
  const { result, output } = await (c.query[method] as any)(caller, { gasLimit: capGas(), storageDepositLimit: null }, ...args)
  if (result.isErr) throw new Error(`query ${method}: ${result.asErr.toString()}`)
  const j = output?.toJSON() as any
  return j?.ok !== undefined ? j.ok : j
}

async function main() {
  log(`Connecting ${WS_URL}…`)
  api = await ApiPromise.create({ provider: new WsProvider(WS_URL) })
  await api.isReady
  const kr = new Keyring({ type: 'sr25519' })
  const alice = kr.addFromUri('//Alice')
  const bob = kr.addFromUri('//Bob').address
  const charlie = kr.addFromUri('//Charlie').address
  const dave = kr.addFromUri('//Dave').address
  log(`Alice: ${alice.address}`)

  // 1. PSP22 token = LUNES fee token (Alice gets supply)
  const psp22Addr = await deploy(alice, 'psp22_token', 'new', ['LUNES', 'LUNES', 12, new BN((1_000_000n * DECIMALS).toString())])
  const psp22 = new ContractPromise(api as any, load('psp22_token'), psp22Addr)

  // 2. liquidity_lock with manager = Alice (rewired below)
  const lockAddr = await deploy(alice, 'liquidity_lock', 'new', [alice.address])
  const lock = new ContractPromise(api as any, load('liquidity_lock'), lockAddr)

  // 3. dummy lock as Alice → next_id advances to 1
  await txCall(alice, lock, 'createLock', [alice.address, bob, charlie, new BN(DECIMALS.toString()), new BN(DECIMALS.toString()), new BN(DECIMALS.toString()), new BN('1000'), 1], 'dummy create_lock (id 0)')

  // 4. listing_manager (lunes_token=psp22, lock, treasury/rewards/staking=Alice)
  const mgrAddr = await deploy(alice, 'listing_manager', 'new', [psp22Addr, lockAddr, alice.address, alice.address, alice.address])
  const mgr = new ContractPromise(api as any, load('listing_manager'), mgrAddr)

  // 5. set_manager → listing_manager (B1 deploy-order requirement)
  await txCall(alice, lock, 'setManager', [mgrAddr], 'set_manager → listing_manager')

  // 6. approve tier-1 fee (1000 LUNES)
  await txCall(alice, psp22, 'approve', [mgrAddr, new BN((1_000n * DECIMALS).toString())], 'approve(manager, 1000 LUNES)')

  // 7. list_token tier 1 → listing_id 0, expect lock_id 1
  await txCall(alice, mgr, 'listToken', [1, bob, charlie, dave, new BN(DECIMALS.toString()), new BN((10_000n * DECIMALS).toString()), new BN(DECIMALS.toString())], 'list_token(tier=1)')

  // 8. read results
  const listing = await q(mgr, alice.address, 'getListing', [0])
  log(`get_listing(0) = ${JSON.stringify(listing)}`)
  const lockId = listing?.lockId ?? listing?.lock_id
  const lockRec = await q(lock, alice.address, 'getLock', [lockId])
  log(`get_lock(${lockId}) = ${JSON.stringify(lockRec)}`)

  // 9. assertions
  const fails: string[] = []
  if (Number(lockId) !== 1) fails.push(`lock_id expected 1 (≠ listing_id 0), got ${lockId}`)
  if (!lockRec) fails.push(`get_lock(${lockId}) is None — create_lock NOT called (B1 REGRESSION)`)
  else {
    const recLp = BigInt(lockRec.lpAmount ?? lockRec.lp_amount ?? 0)
    if (recLp !== DECIMALS) fails.push(`lp_amount expected ${DECIMALS}, got ${recLp}`)
    if (lockRec.owner !== alice.address) fails.push(`owner expected Alice, got ${lockRec.owner}`)
    if (Number(lockRec.tier) !== 1) fails.push(`tier expected 1, got ${lockRec.tier}`)
  }

  console.log('\n' + '='.repeat(60))
  if (!fails.length) {
    console.log('✅✅✅ B1 PROVEN ON-CHAIN')
    console.log('list_token created a real lock (lock_id=1 ≠ listing_id=0);')
    console.log('get_lock(1) present, lp_amount/owner/tier match.')
  } else {
    console.log('❌ B1 PROOF FAILED:')
    fails.forEach((f) => console.log('  - ' + f))
  }
  console.log('='.repeat(60))
  await api.disconnect()
  process.exit(fails.length ? 1 : 0)
}
main().catch((e) => {
  console.error('[b1] ❌', e?.message ?? e)
  process.exit(1)
})
