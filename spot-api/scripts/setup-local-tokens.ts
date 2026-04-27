/**
 * Lunex DEX — Local Token Setup
 *
 * Deploys a mock LUSDT token, creates the WLUNES/LUSDT pair,
 * wraps LUNES into WLUNES and LUSDT, and seeds initial liquidity.
 *
 * Run once after deploying the core contracts.
 * Outputs the LUSDT address to update .env with.
 *
 * Usage:
 *   npx ts-node scripts/setup-local-tokens.ts
 */

import { ApiPromise, WsProvider, Keyring } from '@polkadot/api'
import { ContractPromise, CodePromise } from '@polkadot/api-contract'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const WS_URL    = 'ws://127.0.0.1:9944'
const ARTIFACTS = join(__dirname, '../../target/ink')
const ADDRESSES_FILE = join(__dirname, '../deployed-addresses.json')
const ENV_FILE  = join(__dirname, '../../lunes-dex-main/.env')

function ok(msg: string)      { console.log(`  ✅ ${msg}`) }
function log(msg: string)     { console.log(`  ℹ  ${msg}`) }
function section(msg: string) { console.log(`\n  📦 ${msg}`) }

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
  // Unwrap Result<T,E> — output.toJSON() returns { ok: T } or { err: E }
  const raw = output?.toJSON() as any
  if (raw && typeof raw === 'object' && 'ok' in raw) return raw.ok
  return raw
}

async function deployToken(
  api: ApiPromise,
  deployer: any,
  name: string,
  symbol: string,
  decimals: number,
): Promise<string> {
  log(`Deploying ${symbol}...`)
  const abi  = JSON.parse(readFileSync(
    join(ARTIFACTS, 'wnative_contract', 'wnative_contract.contract'), 'utf8'))
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
      if (dispatchError) { if (unsub) unsub(); reject(new Error(dispatchError.toString())); return }
      if ((status.isInBlock || status.isFinalized) && contract?.address) {
        ok(`${symbol} deployed → ${contract.address.toString()}`)
        if (unsub) unsub()
        resolve(contract.address.toString())
      }
    }).then((u: () => void) => { unsub = u }).catch(reject)
  })
}

function updateEnvFile(key: string, value: string) {
  let content = readFileSync(ENV_FILE, 'utf8')
  const regex = new RegExp(`^(${key}=).*$`, 'm')
  if (regex.test(content)) {
    content = content.replace(regex, `$1${value}`)
  } else {
    content += `\n${key}=${value}`
  }
  writeFileSync(ENV_FILE, content)
}

async function main() {
  console.log('\n🔧 Lunex DEX — Local Token Setup')
  console.log('═'.repeat(55))

  // Load existing addresses
  const addresses = JSON.parse(readFileSync(ADDRESSES_FILE, 'utf8'))
  log(`WLUNES:  ${addresses.wnative}`)
  log(`Factory: ${addresses.factory}`)
  log(`Router:  ${addresses.router}`)

  const provider = new WsProvider(WS_URL)
  const api      = await ApiPromise.create({ provider })
  await api.isReady
  log(`Connected to chain`)

  const keyring = new Keyring({ type: 'sr25519' })
  const alice   = keyring.addFromUri('//Alice')
  log(`Using Alice: ${alice.address}`)

  const wnativeAbi = JSON.parse(readFileSync(
    join(ARTIFACTS, 'wnative_contract', 'wnative_contract.json'), 'utf8'))
  const factoryAbi = JSON.parse(readFileSync(
    join(ARTIFACTS, 'factory_contract', 'factory_contract.json'), 'utf8'))
  const routerAbi  = JSON.parse(readFileSync(
    join(ARTIFACTS, 'router_contract', 'router_contract.json'), 'utf8'))

  const wlunes  = new ContractPromise(api, wnativeAbi, addresses.wnative)
  const factory = new ContractPromise(api, factoryAbi, addresses.factory)
  const router  = new ContractPromise(api, routerAbi,  addresses.router)
  const gas     = makeGas(api)

  // ── Step 1: Deploy mock LUSDT ─────────────────────────────────────────────
  section('1. Deploying mock LUSDT (6 decimals)')
  const lusdtAddress = await deployToken(api, alice, 'Lunes USD Tether', 'LUSDT', 6)
  const lusdt = new ContractPromise(api, wnativeAbi, lusdtAddress)

  // ── Step 2: Wrap LUNES → WLUNES ───────────────────────────────────────────
  section('2. Wrapping LUNES → WLUNES (50 LUNES)')
  const FIFTY_WLUNES = 50_000_000_000n   // 50 × 10^9 (8 decimals)
  await sendTx(
    'WLUNES deposit',
    (wlunes.tx as any)['deposit']({ gasLimit: gas, value: FIFTY_WLUNES, storageDepositLimit: null }),
    alice,
  )

  // ── Step 3: Wrap LUNES → LUSDT ────────────────────────────────────────────
  section('3. Minting LUSDT (100 000 LUSDT)')
  const HUNDRED_K_LUSDT = 100_000_000_000n  // 100 000 × 10^6 (6 decimals)
  await sendTx(
    'LUSDT deposit',
    (lusdt.tx as any)['deposit']({ gasLimit: gas, value: HUNDRED_K_LUSDT, storageDepositLimit: null }),
    alice,
  )

  const wlunesBalance = await query(api, alice, wlunes, 'balanceOf', [alice.address])
  const lusdtBalance  = await query(api, alice, lusdt,  'balanceOf', [alice.address])
  log(`Alice WLUNES: ${wlunesBalance}`)
  log(`Alice LUSDT:  ${lusdtBalance}`)

  // ── Step 4: Create WLUNES/LUSDT pair ──────────────────────────────────────
  section('4. Creating WLUNES/LUSDT pair')

  // Zero AccountId (no pair) in Substrate ss58
  const ZERO_ADDRESS = '5C4hrfjw9DjXZTzV3MwzrrAr9P1MJhSrvWGWqi1eSuYmJFpN'
  let pairAddress: string

  const existingPair = await query(api, alice, factory, 'getPair', [addresses.wnative, lusdtAddress])
  log(`getPair result: ${existingPair}`)

  if (existingPair && existingPair !== ZERO_ADDRESS) {
    ok(`Pair already exists → ${existingPair}`)
    pairAddress = existingPair
  } else {
    await sendTx(
      'factory.createPair',
      (factory.tx as any)['createPair'](
        { gasLimit: gas, storageDepositLimit: null },
        addresses.wnative,
        lusdtAddress,
      ),
      alice,
    )
    pairAddress = await query(api, alice, factory, 'getPair', [addresses.wnative, lusdtAddress])
    ok(`Pair created → ${pairAddress}`)
  }

  // ── Step 5: Approve router ────────────────────────────────────────────────
  section('5. Approving router')
  const APPROVE_AMOUNT = 100_000_000_000_000n

  await sendTx(
    'WLUNES.approve(router)',
    (wlunes.tx as any)['approve'](
      { gasLimit: gas, storageDepositLimit: null },
      addresses.router,
      APPROVE_AMOUNT,
    ),
    alice,
  )
  await sendTx(
    'LUSDT.approve(router)',
    (lusdt.tx as any)['approve'](
      { gasLimit: gas, storageDepositLimit: null },
      addresses.router,
      APPROVE_AMOUNT,
    ),
    alice,
  )

  // ── Step 6: Add liquidity (20 WLUNES + 50 000 LUSDT → price 2500 LUSDT/WLUNES)
  section('6. Adding initial liquidity: 20 WLUNES + 50 000 LUSDT')
  const TWENTY_WLUNES  = 20_000_000_000n   // 20 × 10^9 (8 dec)
  const FIFTY_K_LUSDT  = 50_000_000_000n   // 50 000 × 10^6 (6 dec)
  const deadline = BigInt(Date.now() + 3_600_000)

  await sendTx(
    'router.addLiquidity',
    (router.tx as any)['addLiquidity'](
      { gasLimit: gas, storageDepositLimit: null },
      addresses.wnative,
      lusdtAddress,
      TWENTY_WLUNES,
      FIFTY_K_LUSDT,
      0n,
      0n,
      alice.address,
      deadline,
    ),
    alice,
  )

  // ── Step 7: Verify ────────────────────────────────────────────────────────
  section('7. Verifying')
  const pairAbi = JSON.parse(readFileSync(
    join(ARTIFACTS, 'pair_contract', 'pair_contract.json'), 'utf8'))
  const pair = new ContractPromise(api, pairAbi, pairAddress)

  const reserves = await query(api, alice, pair, 'getReserves', [])
  log(`Reserves: ${JSON.stringify(reserves)}`)
  if ((pair.query as any)['balanceOf']) {
    const lpBalance = await query(api, alice, pair, 'balanceOf', [alice.address])
    log(`Alice LP:  ${lpBalance}`)
  } else {
    log('Alice LP:  unavailable in local pair metadata')
  }

  // ── Update .env and deployed-addresses.json ───────────────────────────────
  section('8. Updating .env and deployed-addresses.json')

  // Save LUSDT to deployed-addresses
  addresses.lusdt = lusdtAddress
  addresses.pairWlunesLusdt = pairAddress
  writeFileSync(ADDRESSES_FILE, JSON.stringify(addresses, null, 2))
  ok(`deployed-addresses.json updated`)

  // Update .env
  updateEnvFile('REACT_APP_TOKEN_WLUNES', addresses.wnative)
  updateEnvFile('REACT_APP_TOKEN_LUSDT', lusdtAddress)
  updateEnvFile('REACT_APP_LP_TOKEN_WLUNES_LUSDT', pairAddress)
  ok(`.env updated`)

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(55))
  console.log('  🎉 LOCAL TOKEN SETUP COMPLETE!')
  console.log('═'.repeat(55))
  console.log(`  WLUNES  : ${addresses.wnative}`)
  console.log(`  LUSDT   : ${lusdtAddress}`)
  console.log(`  Pair    : ${pairAddress}`)
  console.log(`  Initial price: 1 WLUNES = 2500 LUSDT`)
  console.log('═'.repeat(55))
  console.log('\n  Next: cd lunes-dex-main && npm start')
  console.log('═'.repeat(55))

  await api.disconnect()
}

main().catch(e => {
  console.error('\n❌ SETUP FAILED:', e.message)
  process.exit(1)
})
