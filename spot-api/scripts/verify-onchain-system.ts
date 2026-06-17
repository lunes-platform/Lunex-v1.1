#!/usr/bin/env ts-node
/**
 * verify-onchain-system.ts — detailed on-chain liveness + cross-contract checks.
 *
 * Checks (1) every contract in deployed-addresses.json is LIVE, and (2) the
 * cross-contract wiring actually works on-chain, including a REAL swap through
 * the router (router -> factory -> pair -> PSP22 transfers).
 *
 * Run from spot-api/:
 *   node_modules/.bin/ts-node --transpile-only scripts/verify-onchain-system.ts
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
const ADDRS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'deployed-addresses.json'), 'utf8'))

let api: ApiPromise
const results: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name} — ${detail}`)
}
const meta = (artifact: string) => JSON.parse(fs.readFileSync(path.join(INK, artifact, `${artifact}.json`), 'utf8'))
const cap = (): WeightV2 => api.registry.createType('WeightV2', { refTime: new BN('1200000000000'), proofSize: new BN('5000000') })

function decodeErr(e: any): string {
  if (e?.isModule) { try { const d = api.registry.findMetaError(e.asModule); return `${d.section}.${d.name}` } catch {} }
  return e?.toString() ?? 'unknown'
}
async function qy(c: ContractPromise, caller: string, m: string, args: unknown[]): Promise<any> {
  const { result, output } = await (c.query[m] as any)(caller, { gasLimit: cap(), storageDepositLimit: null }, ...args)
  if (result.isErr) throw new Error(`query ${m}: ${result.asErr.toString()}`)
  let v = output?.toJSON() as any
  // drill through nested {ok: ...} (MessageResult + contract Result), stop at arrays/scalars/structs
  while (v && typeof v === 'object' && !Array.isArray(v) && 'ok' in v) v = v.ok
  if (v && typeof v === 'object' && !Array.isArray(v) && 'err' in v) throw new Error(`query ${m} reverted: ${JSON.stringify(v.err)}`)
  return v
}
async function tx(signer: any, c: ContractPromise, m: string, args: unknown[], label: string): Promise<void> {
  const dry = await (c.query[m] as any)(signer.address, { gasLimit: cap(), storageDepositLimit: null }, ...args)
  if (dry.result.isErr) throw new Error(`${label} dry-run: ${dry.result.asErr.toString()}`)
  const out = dry.output?.toJSON() as any
  if (out && out.ok && out.ok.err !== undefined) throw new Error(`${label} reverted: ${JSON.stringify(out.ok.err)}`)
  return new Promise((resolve, reject) => {
    ;(c.tx[m] as any)({ gasLimit: dry.gasRequired, storageDepositLimit: null }, ...args)
      .signAndSend(signer, ({ status, dispatchError }: any) => {
        if (dispatchError) return reject(new Error(`${label}: ${decodeErr(dispatchError)}`))
        if (status.isFinalized) resolve()
      }).catch(reject)
  })
}
const toBig = (v: any) => BigInt(typeof v === 'string' && v.startsWith('0x') ? v : v)

async function main() {
  api = await ApiPromise.create({ provider: new WsProvider(WS_URL) })
  await api.isReady
  const best = (await api.rpc.chain.getHeader()).number.toNumber()
  console.log(`\n=== ON-CHAIN SYSTEM VERIFICATION (block ${best}, ${WS_URL}) ===\n`)
  const kr = new Keyring({ type: 'sr25519' })
  const alice = kr.addFromUri('//Alice')

  // ── 1. Liveness of every deployed contract ──────────────────────
  console.log('── 1. Contract liveness ──')
  const expected: Record<string, string> = {
    wnative: ADDRS.wnative, factory: ADDRS.factory, router: ADDRS.router,
    staking: ADDRS.staking, rewards: ADDRS.rewards, lusdt: ADDRS.lusdt,
    pairWlunesLusdt: ADDRS.pairWlunesLusdt,
  }
  for (const [k, addr] of Object.entries(expected)) {
    if (!addr) { check(`live:${k}`, false, 'no address in deployed-addresses.json'); continue }
    const info: any = await api.query.contracts.contractInfoOf(addr)
    check(`live:${k}`, info.isSome, info.isSome ? `${addr.slice(0, 10)}… LIVE` : `${addr.slice(0, 10)}… MISSING`)
  }

  // contract handles
  const factory = new ContractPromise(api as any, meta('factory_contract'), ADDRS.factory)
  const pair = new ContractPromise(api as any, meta('pair_contract'), ADDRS.pairWlunesLusdt)
  const router = new ContractPromise(api as any, meta('router_contract'), ADDRS.router)
  const wnative = new ContractPromise(api as any, meta('wnative_contract'), ADDRS.wnative)
  const lusdt = new ContractPromise(api as any, meta('psp22_token'), ADDRS.lusdt)

  // ── 2. factory ↔ pair registry ──────────────────────────────────
  console.log('\n── 2. factory ↔ pair registry ──')
  const len = await qy(factory, alice.address, 'allPairsLength', [])
  check('factory.all_pairs_length', Number(len) >= 1, `= ${len}`)
  const resolved = await qy(factory, alice.address, 'getPair', [ADDRS.wnative, ADDRS.lusdt])
  check('factory.get_pair(WLUNES,LUSDT) == deployed pair', resolved === ADDRS.pairWlunesLusdt, `${String(resolved).slice(0, 12)}… vs ${ADDRS.pairWlunesLusdt.slice(0, 12)}…`)

  // ── 3. pair ↔ token wiring + reserves ───────────────────────────
  console.log('\n── 3. pair ↔ token wiring + reserves ──')
  const t0 = await qy(pair, alice.address, 'token0', [])
  const t1 = await qy(pair, alice.address, 'token1', [])
  const toks = [t0, t1]
  check('pair.token_0/1 == {WLUNES,LUSDT}', toks.includes(ADDRS.wnative) && toks.includes(ADDRS.lusdt), `t0=${String(t0).slice(0, 8)}… t1=${String(t1).slice(0, 8)}…`)
  const reserves = await qy(pair, alice.address, 'getReserves', [])
  const r0 = toBig(reserves[0]), r1 = toBig(reserves[1])
  check('pair.get_reserves > 0', r0 > 0n && r1 > 0n, `r0=${r0} r1=${r1}`)
  // map reserves to tokens
  const wIsT0 = t0 === ADDRS.wnative
  const resW = wIsT0 ? r0 : r1
  const resU = wIsT0 ? r1 : r0

  // ── 4. router math (reads) ──────────────────────────────────────
  console.log('\n── 4. router pricing (view) ──')
  const amountIn = new BN((1n * 100_000_000n).toString()) // 1 WLUNES (8 decimals)
  const amtOut = await qy(router, alice.address, 'getAmountOut', [amountIn, resW.toString(), resU.toString()])
  check('router.get_amount_out(1 WLUNES) > 0', toBig(amtOut) > 0n, `=> ${toBig(amtOut)} LUSDT-raw`)

  // ── 5. REAL SWAP: router -> pair -> PSP22 (cross-contract) ───────
  console.log('\n── 5. REAL swap router.swap_exact_tokens_for_tokens (WLUNES->LUSDT) ──')
  const lusdtBefore = toBig(await qy(lusdt, alice.address, 'balanceOf', [alice.address]))
  const wnatBefore = toBig(await qy(wnative, alice.address, 'balanceOf', [alice.address]))
  await tx(alice, wnative, 'approve', [ADDRS.router, amountIn], 'wnative.approve(router)')
  const deadline = new BN('99999999999999')
  await tx(alice, router, 'swapExactTokensForTokens', [amountIn, 0, [ADDRS.wnative, ADDRS.lusdt], alice.address, deadline], 'swap 1 WLUNES->LUSDT')
  const lusdtAfter = toBig(await qy(lusdt, alice.address, 'balanceOf', [alice.address]))
  const wnatAfter = toBig(await qy(wnative, alice.address, 'balanceOf', [alice.address]))
  const reservesAfter = await qy(pair, alice.address, 'getReserves', [])
  const resWAfter = toBig(wIsT0 ? reservesAfter[0] : reservesAfter[1])
  const dLusdt = lusdtAfter - lusdtBefore
  const dWnat = wnatBefore - wnatAfter
  check('swap: caller LUSDT increased', dLusdt > 0n, `+${dLusdt} LUSDT-raw`)
  check('swap: caller WLUNES decreased by amount_in', dWnat === toBig(amountIn.toString()), `-${dWnat} (in=${amountIn})`)
  check('swap: pair WLUNES reserve increased', resWAfter > resW, `${resW} -> ${resWAfter}`)

  // ── 6. wnative native↔wrapped bridge (deposit) ──────────────────
  console.log('\n── 6. wnative native↔WLUNES ──')
  const wBefore = toBig(await qy(wnative, alice.address, 'balanceOf', [alice.address]))
  // deposit 1 LUNES native -> +1 WLUNES (8dec mapping). deposit() is payable.
  await new Promise<void>((resolve, reject) => {
    ;(wnative.tx['deposit'] as any)({ gasLimit: cap(), storageDepositLimit: null, value: new BN((1n * 1_000_000_000_000n).toString()) })
      .signAndSend(alice, ({ status, dispatchError }: any) => {
        if (dispatchError) return reject(new Error(`deposit: ${decodeErr(dispatchError)}`))
        if (status.isFinalized) resolve()
      }).catch(reject)
  })
  const wAfter = toBig(await qy(wnative, alice.address, 'balanceOf', [alice.address]))
  check('wnative.deposit mints WLUNES', wAfter > wBefore, `${wBefore} -> ${wAfter}`)

  // ── 7. staking / rewards liveness reads ─────────────────────────
  console.log('\n── 7. staking / rewards (view) ──')
  try {
    const staking = new ContractPromise(api as any, meta('staking_contract'), ADDRS.staking)
    const st = await qy(staking, alice.address, 'getStake', [alice.address])
    check('staking.get_stake reachable', true, `= ${JSON.stringify(st)}`)
  } catch (e: any) { check('staking.get_stake reachable', false, e.message) }

  // ── summary ─────────────────────────────────────────────────────
  const pass = results.filter((r) => r.ok).length
  const fail = results.filter((r) => !r.ok)
  console.log('\n' + '='.repeat(60))
  console.log(`RESULT: ${pass}/${results.length} checks passed`)
  if (fail.length) { console.log('FAILED:'); fail.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`)) }
  else console.log('✅ ALL CROSS-CONTRACT CHECKS PASSED')
  console.log('='.repeat(60))
  await api.disconnect()
  process.exit(fail.length ? 1 : 0)
}
main().catch((e) => { console.error('FATAL', e?.message ?? e); process.exit(1) })
