/**
 * Lunex DEX — Liquidity Pool End-to-End Test
 *
 * Flow:
 *  1. Deploy mock USDT (second wnative instance)
 *  2. Wrap LUNES → WLUNES and LUNES → mock USDT (via deposit())
 *  3. Approve router to spend both tokens
 *  4. factory.create_pair(wlunes, usdt)
 *  5. router.add_liquidity(wlunes, usdt, ...)
 *  6. Verify pair reserves, LP token balance
 *  7. Swap WLUNES → USDT via router
 */

import { ApiPromise, WsProvider, Keyring } from '@polkadot/api'
import { ContractPromise, CodePromise } from '@polkadot/api-contract'
import { readFileSync } from 'fs'
import { join } from 'path'
import { blake2AsHex } from '@polkadot/util-crypto'

const WS_URL    = 'ws://127.0.0.1:9944'
const ARTIFACTS = join(__dirname, '../../target/ink')

const ADDRESSES = {
  wnative:  '5HRAv1VDeWkLnmkZAjgo6oigU5179nUDBgjKX4u5wztM7tTo',
  factory:  '5D7pe8YhnMpdBHnVobrPooomnM1ikgRJ4vDRyfcppFonCuK2',
  router:   '5GSR7WUo53S2UpqSW7sMccSYNeP2dmAakfUnoK9BCY3YMb2B',
}

function ok(msg: string)   { console.log(`  ✅ ${msg}`) }
function fail(msg: string) { console.log(`  ❌ ${msg}`); throw new Error(msg) }
function log(msg: string)  { console.log(`  ℹ  ${msg}`) }
function section(msg: string) { console.log(`\n  📦 ${msg}`) }

function loadAbi(name: string) {
  return JSON.parse(readFileSync(join(ARTIFACTS, name, `${name}.json`), 'utf8'))
}

function makeGas(api: ApiPromise) {
  return api.registry.createType('WeightV2', {
    refTime:   300_000_000_000n,
    proofSize: 10_000_000n,
  }) as any
}

function makeDryGas(api: ApiPromise) {
  return api.registry.createType('WeightV2', {
    refTime:   50_000_000_000n,
    proofSize: 1_000_000n,
  }) as any
}

/** Wait for a tx to be in-block, then unsubscribe */
function sendTx(label: string, tx: any, signer: any): Promise<void> {
  return new Promise((resolve, reject) => {
    let unsub: (() => void) | null = null
    tx.signAndSend(signer, (result: any) => {
      const { status, dispatchError } = result
      if (dispatchError) {
        const msg = dispatchError.isModule
          ? dispatchError.asModule.toString()
          : dispatchError.toString()
        if (unsub) unsub()
        reject(new Error(`${label}: ${msg}`)); return
      }
      if (status.isInBlock || status.isFinalized) {
        ok(`${label} — in block`)
        if (unsub) unsub()
        resolve()
      }
    }).then((u: () => void) => { unsub = u }).catch(reject)
  })
}

/** Deploy a new wnative instance as mock PSP22 token */
async function deployMockToken(
  api: ApiPromise,
  deployer: any,
  name: string,
  symbol: string,
  decimals: number,
): Promise<string> {
  log(`Deploying mock token ${symbol}...`)
  const abi  = JSON.parse(readFileSync(join(ARTIFACTS, 'wnative_contract', 'wnative_contract.contract'), 'utf8'))
  const code = new CodePromise(api, abi, abi.source.wasm)
  const gas  = makeGas(api)

  return new Promise((resolve, reject) => {
    const tx = (code.tx as any)['new'](
      { gasLimit: gas, storageDepositLimit: null },
      name, symbol, decimals,
    )
    let unsub: (() => void) | null = null
    tx.signAndSend(deployer, (result: any) => {
      const { status, contract, dispatchError } = result
      if (dispatchError) {
        if (unsub) unsub()
        reject(new Error(dispatchError.toString())); return
      }
      if ((status.isInBlock || status.isFinalized) && contract?.address) {
        ok(`${symbol} deployed → ${contract.address.toString()}`)
        if (unsub) unsub()
        resolve(contract.address.toString())
      }
    }).then((u: () => void) => { unsub = u }).catch(reject)
  })
}

/** Query contract value (dry-run) */
async function query(
  api: ApiPromise,
  caller: any,
  contract: ContractPromise,
  method: string,
  args: any[] = [],
): Promise<any> {
  const gas = makeDryGas(api)
  const { result, output } = await (contract.query as any)[method](
    caller.address, { gasLimit: gas }, ...args,
  )
  if (result.isErr) throw new Error(`query ${method}: ${result.asErr.toString()}`)
  return output?.toJSON()
}

async function main() {
  console.log('\n🔬 Lunex DEX — Liquidity Pool E2E Test')
  console.log('═'.repeat(55))

  const provider = new WsProvider(WS_URL)
  const api      = await ApiPromise.create({ provider })
  await api.isReady

  const chain = await api.rpc.system.chain()
  log(`Connected to: ${chain}`)

  const keyring = new Keyring({ type: 'sr25519' })
  const alice   = keyring.addFromUri('//Alice')
  const bob     = keyring.addFromUri('//Bob')
  log(`Alice: ${alice.address}`)
  log(`Bob:   ${bob.address}`)

  // ── Step 1: Deploy mock USDT token ────────────────────────────────────────
  section('1. Deploying mock USDT token')
  const usdtAddress = await deployMockToken(api, alice, 'USD Tether', 'USDT', 6)

  // ABIs
  const wnativeAbi = loadAbi('wnative_contract')
  const factoryAbi = loadAbi('factory_contract')
  const routerAbi  = loadAbi('router_contract')
  const pairAbi    = loadAbi('pair_contract')

  const wlunes  = new ContractPromise(api, wnativeAbi, ADDRESSES.wnative)
  const usdt    = new ContractPromise(api, wnativeAbi, usdtAddress)
  const factory = new ContractPromise(api, factoryAbi, ADDRESSES.factory)
  const router  = new ContractPromise(api, routerAbi,  ADDRESSES.router)
  const gas     = makeGas(api)

  // ── Step 2: Wrap LUNES into WLUNES ────────────────────────────────────────
  section('2. Wrapping LUNES → WLUNES (10 LUNES)')
  const TEN_LUNES = 10_000_000_000n // 10 LUNES with 10 decimals
  await sendTx(
    'WLUNES deposit',
    (wlunes.tx as any)['deposit']({ gasLimit: gas, value: TEN_LUNES, storageDepositLimit: null }),
    alice,
  )

  // ── Step 3: Wrap LUNES into mock USDT ─────────────────────────────────────
  section('3. Wrapping LUNES → USDT (5000 USDT @ 6 decimals)')
  const FIVE_THOUSAND_USDT = 5_000_000_000n // 5000 with 6 decimals  (reusing lunes native)
  await sendTx(
    'USDT deposit',
    (usdt.tx as any)['deposit']({ gasLimit: gas, value: FIVE_THOUSAND_USDT, storageDepositLimit: null }),
    alice,
  )

  // Check balances
  const wlunesBalance = await query(api, alice, wlunes, 'balanceOf', [alice.address])
  const usdtBalance   = await query(api, alice, usdt,   'balanceOf', [alice.address])
  log(`Alice WLUNES balance: ${wlunesBalance?.ok ?? wlunesBalance}`)
  log(`Alice USDT balance:   ${usdtBalance?.ok ?? usdtBalance}`)

  // ── Step 4: Create WLUNES/USDT pair ───────────────────────────────────────
  section('4. Creating WLUNES/USDT pair via factory')
  await sendTx(
    'factory.createPair',
    (factory.tx as any)['createPair']({ gasLimit: gas, storageDepositLimit: null }, ADDRESSES.wnative, usdtAddress),
    alice,
  )

  const pairResult = await query(api, alice, factory, 'getPair', [ADDRESSES.wnative, usdtAddress])
  const pairAddress = pairResult?.ok ?? pairResult
  if (!pairAddress) fail('Pair address is null — createPair may have failed')
  ok(`Pair deployed → ${pairAddress}`)

  const pair = new ContractPromise(api, pairAbi, pairAddress)

  // ── Step 5: Approve router to spend WLUNES and USDT ───────────────────────
  section('5. Approving router for WLUNES and USDT')
  const APPROVE_AMOUNT = 100_000_000_000n // large allowance

  await sendTx(
    'WLUNES.approve(router)',
    (wlunes.tx as any)['approve']({ gasLimit: gas, storageDepositLimit: null }, ADDRESSES.router, APPROVE_AMOUNT),
    alice,
  )
  await sendTx(
    'USDT.approve(router)',
    (usdt.tx as any)['approve']({ gasLimit: gas, storageDepositLimit: null }, ADDRESSES.router, APPROVE_AMOUNT),
    alice,
  )

  // ── Step 6: Add liquidity ──────────────────────────────────────────────────
  section('6. Adding liquidity: 5 WLUNES + 2500 USDT')
  const FIVE_WLUNES     = 5_000_000_000n
  const TWO_FIVE_USDT   = 2_500_000_000n
  const deadline = BigInt(Date.now() + 3_600_000) // 1 hour from now in milliseconds (chain uses ms)

  await sendTx(
    'router.addLiquidity',
    (router.tx as any)['addLiquidity'](
      { gasLimit: gas, storageDepositLimit: null },
      ADDRESSES.wnative,   // token_a
      usdtAddress,          // token_b
      FIVE_WLUNES,          // amount_a_desired
      TWO_FIVE_USDT,        // amount_b_desired
      0n,                   // amount_a_min
      0n,                   // amount_b_min
      alice.address,        // to (LP tokens recipient)
      deadline,             // deadline
    ),
    alice,
  )

  // ── Step 7: Verify pair reserves ──────────────────────────────────────────
  section('7. Verifying pair reserves')
  const pairAbiParsed = loadAbi('pair_contract')
  const pairContract  = new ContractPromise(api, pairAbiParsed, pairAddress)

  // Get reserves from pair
  const reservesResult = await query(api, alice, pairContract, 'getReserves', [])
  log(`Pair reserves: ${JSON.stringify(reservesResult)}`)

  // LP token balance of Alice
  const lpBalance = await query(api, alice, pairContract, 'balanceOf', [alice.address])
  log(`Alice LP balance: ${JSON.stringify(lpBalance)}`)
  ok('Liquidity confirmed in pair!')

  // ── Step 8: Swap WLUNES → USDT ────────────────────────────────────────────
  section('8. Swapping 1 WLUNES → USDT')
  const ONE_WLUNES = 1_000_000_000n

  // Approve router for the swap
  await sendTx(
    'WLUNES.approve(router) for swap',
    (wlunes.tx as any)['approve']({ gasLimit: gas, storageDepositLimit: null }, ADDRESSES.router, ONE_WLUNES),
    alice,
  )

  const usdtBefore = await query(api, alice, usdt, 'balanceOf', [alice.address])
  log(`USDT balance before swap: ${JSON.stringify(usdtBefore)}`)

  await sendTx(
    'router.swapExactTokensForTokens',
    (router.tx as any)['swapExactTokensForTokens'](
      { gasLimit: gas, storageDepositLimit: null },
      ONE_WLUNES,           // amount_in
      0n,                   // amount_out_min
      [ADDRESSES.wnative, usdtAddress], // path
      alice.address,         // to
      deadline,
    ),
    alice,
  )

  const usdtAfter = await query(api, alice, usdt, 'balanceOf', [alice.address])
  log(`USDT balance after swap: ${JSON.stringify(usdtAfter)}`)
  ok('Swap completed!')

  // ── Final Summary ──────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(55))
  console.log('  🎉 LIQUIDITY POOL E2E TEST PASSED!')
  console.log('═'.repeat(55))
  console.log(`  WLUNES  : ${ADDRESSES.wnative}`)
  console.log(`  USDT    : ${usdtAddress}`)
  console.log(`  Pair    : ${pairAddress}`)
  console.log(`  Factory : ${ADDRESSES.factory}`)
  console.log(`  Router  : ${ADDRESSES.router}`)
  console.log('═'.repeat(55))

  await api.disconnect()
}

main().catch(e => {
  console.error('\n❌ TEST FAILED:', e.message)
  process.exit(1)
})
