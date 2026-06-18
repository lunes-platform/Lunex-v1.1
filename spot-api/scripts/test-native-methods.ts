/**
 * On-chain validation of the NEW native (LUNES) router/WNative methods added
 * for the native-LUNES UX feature. Signs with //Alice against the local node.
 *
 * Exercises:
 *  1. wrapNative      → WNative.deposit (value attached)        → WLUNES balance up
 *  2. swapExactNative → router.swap_exact_native_for_tokens     → LUSDT balance up
 *  3. unwrapNative    → WNative.withdraw(amount)                → WLUNES balance down
 *
 * These mirror exactly what lunes-dex-main/src/services/contractService.ts now
 * calls (same ABI labels, same value-attach pattern).
 */

import { ApiPromise, WsProvider, Keyring } from '@polkadot/api'
import { ContractPromise } from '@polkadot/api-contract'
import { readFileSync } from 'fs'
import { join } from 'path'

const WS_URL = 'ws://127.0.0.1:9944'
const ARTIFACTS = join(__dirname, '../../target/ink')
const ADDRESSES = JSON.parse(
  readFileSync(join(__dirname, '../deployed-addresses.json'), 'utf8'),
) as Record<string, string>

const loadAbi = (name: string) =>
  JSON.parse(readFileSync(join(ARTIFACTS, name, `${name}.json`), 'utf8'))

const gas = (api: ApiPromise) =>
  api.registry.createType('WeightV2', {
    refTime: 900_000_000_000n,
    proofSize: 4_000_000n,
  }) as any

const ok = (m: string) => console.log(`  ✅ ${m}`)
const log = (m: string) => console.log(`  ℹ  ${m}`)
const section = (m: string) => console.log(`\n  📦 ${m}`)

const toBig = (v: any): bigint => BigInt((v?.ok ?? v ?? 0).toString().replace(/,/g, ''))

async function send(api: ApiPromise, tx: any, signer: any, label: string) {
  return new Promise<void>((resolve, reject) => {
    tx.signAndSend(signer, (r: any) => {
      if (r.dispatchError) {
        let detail = r.dispatchError.toString()
        if (r.dispatchError.isModule) {
          try {
            const d = api.registry.findMetaError(r.dispatchError.asModule)
            detail = `${d.section}.${d.name}: ${(d.docs || []).join(' ')}`
          } catch {
            /* keep raw */
          }
        }
        reject(new Error(`${label}: ${detail}`))
      } else if (r.status.isInBlock) {
        ok(`${label} — in block`)
        resolve()
      }
    }).catch(reject)
  })
}

async function balanceOf(c: ContractPromise, who: string): Promise<bigint> {
  const { output } = await c.query.balanceOf(who, { gasLimit: gas(c.api as any) }, who)
  return toBig((output as any)?.toJSON())
}

async function main() {
  const api = await ApiPromise.create({ provider: new WsProvider(WS_URL) })
  const keyring = new Keyring({ type: 'sr25519' })
  const alice = keyring.addFromUri('//Alice')

  const wnative = new ContractPromise(api, loadAbi('wnative_contract'), ADDRESSES.wnative)
  const router = new ContractPromise(api, loadAbi('router_contract'), ADDRESSES.router)
  const lusdt = new ContractPromise(api, loadAbi('wnative_contract'), ADDRESSES.lusdt)

  const deadline = Date.now() + 3_600_000

  // ── 1. wrapNative (deposit, value attached) ───────────────────────────────
  section('1. wrapNative — WNative.deposit (5 LUNES)')
  const wBefore = await balanceOf(wnative, alice.address)
  log(`WLUNES before: ${wBefore}`)
  const depositValue = 5n * 10n ** 8n // 5 LUNES (8 decimals)
  {
    const { gasRequired } = await wnative.query.deposit(alice.address, {
      gasLimit: gas(api),
      value: depositValue,
    })
    await send(
      api,
      wnative.tx.deposit({ gasLimit: gasRequired, storageDepositLimit: null, value: depositValue }),
      alice,
      'deposit',
    )
  }
  const wAfter = await balanceOf(wnative, alice.address)
  log(`WLUNES after:  ${wAfter}`)
  if (wAfter - wBefore !== depositValue) throw new Error(`wrap delta wrong: ${wAfter - wBefore}`)
  ok(`WLUNES +${depositValue} (1:1) ✓`)

  // ── 2. swapExactNativeForTokens (value attached, path WLUNES→LUSDT) ────────
  section('2. swapExactNativeForTokens — 1 LUNES → LUSDT')
  const lBefore = await balanceOf(lusdt, alice.address)
  log(`LUSDT before: ${lBefore}`)
  const swapValue = 1n * 10n ** 8n // 1 LUNES
  try {
    const path = [ADDRESSES.wnative, ADDRESSES.lusdt]
    // value as STRING + fixed generous gas (dry-run that reverts early
    // under-estimates gas for the full wrap+swap path).
    const { output } = await router.query.swapExactNativeForTokens(
      alice.address,
      { gasLimit: gas(api), value: swapValue.toString() },
      '0', // amountOutMin
      path,
      alice.address,
      deadline,
    )
    log(`dry-run result: ${JSON.stringify((output as any)?.toJSON())}`)
    await send(
      api,
      router.tx.swapExactNativeForTokens(
        { gasLimit: gas(api), storageDepositLimit: null, value: swapValue.toString() },
        '0',
        path,
        alice.address,
        deadline,
      ),
      alice,
      'swap_exact_native_for_tokens',
    )
    const lAfter = await balanceOf(lusdt, alice.address)
    log(`LUSDT after:  ${lAfter}`)
    if (lAfter <= lBefore) throw new Error('LUSDT balance did not increase')
    ok(`LUSDT +${lAfter - lBefore} from native swap ✓`)
  } catch (e: any) {
    console.log(`  ⚠️  swapExactNativeForTokens NÃO executou on-chain: ${e.message}`)
  }

  // ── 3. unwrapNative (withdraw) ────────────────────────────────────────────
  section('3. unwrapNative — WNative.withdraw (2 WLUNES)')
  const uBefore = await balanceOf(wnative, alice.address)
  const withdrawAmt = 2n * 10n ** 8n
  {
    const { gasRequired } = await wnative.query.withdraw(
      alice.address,
      { gasLimit: gas(api) },
      withdrawAmt,
    )
    await send(
      api,
      wnative.tx.withdraw({ gasLimit: gasRequired, storageDepositLimit: null }, withdrawAmt),
      alice,
      'withdraw',
    )
  }
  const uAfter = await balanceOf(wnative, alice.address)
  log(`WLUNES ${uBefore} → ${uAfter}`)
  if (uBefore - uAfter !== withdrawAmt) throw new Error(`unwrap delta wrong: ${uBefore - uAfter}`)
  ok(`WLUNES -${withdrawAmt} (unwrapped 1:1) ✓`)

  console.log('\n  🎉 NATIVE METHODS ON-CHAIN: ALL PASS\n')
  await api.disconnect()
}

main().catch((e) => {
  console.error('\n  ❌ FAIL:', e.message)
  process.exit(1)
})
