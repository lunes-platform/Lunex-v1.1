/**
 * Lunex DEX — Token Deploy & Fund Script
 *
 * 1. Deploys LUSDT (PSP22, 6 decimals, 10 000 000 initial supply)
 * 2. Wraps LUNES → WLUNES for Alice
 * 3. Creates WLUNES/LUSDT pair on the factory (if not exists)
 * 4. Approves router & adds initial liquidity
 * 5. Transfers tokens to the TEST_WALLET
 * 6. Updates .env and deployed-addresses.json
 *
 * Usage:
 *   npx ts-node scripts/deploy-tokens.ts
 */

import { ApiPromise, WsProvider, Keyring } from '@polkadot/api'
import { ContractPromise, CodePromise } from '@polkadot/api-contract'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

// ── Config ────────────────────────────────────────────────────────────────────

const WS_URL       = 'ws://127.0.0.1:9944'
const ARTIFACTS    = join(__dirname, '../../target/ink')
const ADDR_FILE    = join(__dirname, '../deployed-addresses.json')
const ENV_FILE_DEX = join(__dirname, '../../lunes-dex-main/.env')
const ENV_FILE_API = join(__dirname, '../.env')

/** Test wallet to receive tokens after setup */
const TEST_WALLET = '5HYVGHPrMmG6TKeczuTjhaGcRTkW8sMhWfppaFrTCAvKFfBb'

// Supply amounts (WLUNES=8 decimals: 1 WLUNES=10^8, LUSDT=6 decimals: 1 LUSDT=10^6)
const LUSDT_INITIAL_SUPPLY = 10_000_000_000_000n   // 10 000 000 LUSDT  (10M * 10^6)
const WLUNES_TO_WRAP       =     10_000_000_000n   //       100 WLUNES   (100 * 10^8)
const LIQ_WLUNES           =      5_000_000_000n   //        50 WLUNES    (50 * 10^8)
const LIQ_LUSDT            =    100_000_000_000n   //   100 000 LUSDT   (100K * 10^6)
const SEND_WLUNES          =      1_000_000_000n   //        10 WLUNES    (10 * 10^8)
const SEND_LUSDT           =      5_000_000_000n   //     5 000 LUSDT    (5K * 10^6)

// ── Helpers ───────────────────────────────────────────────────────────────────

const ok      = (m: string) => console.log(`  ✅ ${m}`)
const log     = (m: string) => console.log(`  ℹ  ${m}`)
const section = (m: string) => console.log(`\n  📦 ${m}`)

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
        reject(new Error(`${label}: ${msg}`))
        return
      }
      if (status.isInBlock || status.isFinalized) {
        ok(`${label}`)
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
  const raw = output?.toJSON() as any
  if (raw && typeof raw === 'object' && 'ok' in raw) return raw.ok
  return raw
}

/** Deploy PSP22 token using the psp22_token contract (mintable) */
async function deployPSP22(
  api: ApiPromise,
  deployer: any,
  name: string,
  symbol: string,
  decimals: number,
  initialSupply: bigint,
): Promise<string> {
  log(`Deploying ${symbol} (PSP22)...`)
  const artifactPath = join(ARTIFACTS, 'psp22_token', 'psp22_token.contract')
  const abi  = JSON.parse(readFileSync(artifactPath, 'utf8'))
  const code = new CodePromise(api, abi, abi.source.wasm)
  const gas  = makeGas(api)

  return new Promise((resolve, reject) => {
    const tx = (code.tx as any)['new'](
      { gasLimit: gas, storageDepositLimit: null },
      name ? { some: name } : { none: null },
      symbol ? { some: symbol } : { none: null },
      decimals,
      initialSupply,
    )
    let unsub: (() => void) | null = null
    tx.signAndSend(deployer, (result: any) => {
      const { status, contract, dispatchError } = result
      if (dispatchError) {
        if (unsub) unsub()
        reject(new Error(`deploy ${symbol}: ${dispatchError.toString()}`))
        return
      }
      if ((status.isInBlock || status.isFinalized) && contract?.address) {
        ok(`${symbol} deployed → ${contract.address.toString()}`)
        if (unsub) unsub()
        resolve(contract.address.toString())
      }
    }).then((u: () => void) => { unsub = u }).catch(reject)
  })
}

function updateEnvFile(file: string, key: string, value: string) {
  let content = readFileSync(file, 'utf8')
  const regex = new RegExp(`^(${key}=).*$`, 'm')
  if (regex.test(content)) {
    content = content.replace(regex, `$1${value}`)
  } else {
    content += `\n${key}=${value}`
  }
  writeFileSync(file, content)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🚀 Lunex DEX — Token Deploy & Fund')
  console.log('═'.repeat(55))

  const addresses = JSON.parse(readFileSync(ADDR_FILE, 'utf8'))
  log(`WLUNES  : ${addresses.wnative}`)
  log(`Factory : ${addresses.factory}`)
  log(`Router  : ${addresses.router}`)

  const provider = new WsProvider(WS_URL)
  const api      = await ApiPromise.create({ provider })
  await api.isReady
  log(`Connected to ${WS_URL}`)

  const keyring = new Keyring({ type: 'sr25519' })
  const alice   = keyring.addFromUri('//Alice')
  log(`Deployer: ${alice.address} (Alice)`)
  log(`Funded  : ${TEST_WALLET}`)

  // Load ABIs
  const wnativeAbi  = JSON.parse(readFileSync(join(ARTIFACTS, 'wnative_contract', 'wnative_contract.json'), 'utf8'))
  const psp22Abi    = JSON.parse(readFileSync(join(ARTIFACTS, 'psp22_token', 'psp22_token.json'), 'utf8'))
  const factoryAbi  = JSON.parse(readFileSync(join(ARTIFACTS, 'factory_contract', 'factory_contract.json'), 'utf8'))
  const routerAbi   = JSON.parse(readFileSync(join(ARTIFACTS, 'router_contract', 'router_contract.json'), 'utf8'))
  const pairAbi     = JSON.parse(readFileSync(join(ARTIFACTS, 'pair_contract', 'pair_contract.json'), 'utf8'))

  const wlunes  = new ContractPromise(api, wnativeAbi, addresses.wnative)
  const factory = new ContractPromise(api, factoryAbi, addresses.factory)
  const router  = new ContractPromise(api, routerAbi,  addresses.router)
  const gas     = makeGas(api)

  // ── 1. Deploy LUSDT ───────────────────────────────────────────────────────
  section('1. Deploying LUSDT (PSP22, 6 decimals, 10M initial supply)')
  const lusdtAddress = await deployPSP22(
    api, alice,
    'Lunes USD Tether', 'LUSDT',
    6,
    LUSDT_INITIAL_SUPPLY,
  )
  const lusdt = new ContractPromise(api, psp22Abi, lusdtAddress)

  // ── 2. Wrap LUNES → WLUNES ───────────────────────────────────────────────
  section('2. Wrapping LUNES → WLUNES (100 LUNES)')
  await sendTx(
    'WLUNES deposit (100 LUNES)',
    (wlunes.tx as any)['deposit']({ gasLimit: gas, value: WLUNES_TO_WRAP, storageDepositLimit: null }),
    alice,
  )

  const wlunesBalance = await query(api, alice, wlunes, 'balanceOf', [alice.address])
  const lusdtBalance  = await query(api, alice, lusdt,  'balanceOf', [alice.address])
  log(`Alice WLUNES: ${BigInt(wlunesBalance) / BigInt(10 ** 8)} WLUNES (raw: ${wlunesBalance})`)
  log(`Alice LUSDT : ${BigInt(lusdtBalance) / BigInt(10 ** 6)} LUSDT  (raw: ${lusdtBalance})`)

  // ── 3. Create WLUNES/LUSDT pair ───────────────────────────────────────────
  section('3. Creating WLUNES/LUSDT pair')
  const ZERO = '5C4hrfjw9DjXZTzV3MwzrrAr9P1MJhSrvWGWqi1eSuYmJFpN'

  let pairAddress: string
  const existingPair = await query(api, alice, factory, 'getPair', [addresses.wnative, lusdtAddress])
  log(`getPair → ${existingPair}`)

  if (existingPair && existingPair !== ZERO) {
    ok(`Pair already exists → ${existingPair}`)
    pairAddress = existingPair
  } else {
    await sendTx(
      'factory.createPair(WLUNES, LUSDT)',
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

  // ── 4. Approve router ─────────────────────────────────────────────────────
  section('4. Approving router for WLUNES and LUSDT')
  const MAX = BigInt('340282366920938463463374607431768211455') // u128::MAX

  await sendTx(
    'WLUNES.approve(router)',
    (wlunes.tx as any)['approve']({ gasLimit: gas, storageDepositLimit: null }, addresses.router, MAX),
    alice,
  )
  await sendTx(
    'LUSDT.approve(router)',
    (lusdt.tx as any)['approve']({ gasLimit: gas, storageDepositLimit: null }, addresses.router, MAX),
    alice,
  )

  // ── 5. Add liquidity ──────────────────────────────────────────────────────
  section('5. Adding liquidity: 50 WLUNES + 100 000 LUSDT (price: 2 000 LUSDT/WLUNES)')
  const deadline = BigInt(Date.now() + 3_600_000)

  await sendTx(
    'router.addLiquidity',
    (router.tx as any)['addLiquidity'](
      { gasLimit: gas, storageDepositLimit: null },
      addresses.wnative,
      lusdtAddress,
      LIQ_WLUNES,
      LIQ_LUSDT,
      0n,
      0n,
      alice.address,
      deadline,
    ),
    alice,
  )

  // Verify reserves
  const pair     = new ContractPromise(api, pairAbi, pairAddress)
  const reserves = await query(api, alice, pair, 'getReserves', [])
  log(`Reserves: ${JSON.stringify(reserves)}`)
  const lpBalance = await query(api, alice, pair, 'balanceOf', [alice.address])
  log(`Alice LP tokens: ${lpBalance}`)

  // ── 6. Fund test wallet ───────────────────────────────────────────────────
  section(`6. Sending tokens to TEST_WALLET: ${TEST_WALLET}`)

  await sendTx(
    `WLUNES.transfer(${SEND_WLUNES / BigInt(10 ** 8)} WLUNES → test wallet)`,
    (wlunes.tx as any)['transfer'](
      { gasLimit: gas, storageDepositLimit: null },
      TEST_WALLET,
      SEND_WLUNES,
      [],
    ),
    alice,
  )

  await sendTx(
    `LUSDT.transfer(${SEND_LUSDT / BigInt(10 ** 6)} LUSDT → test wallet)`,
    (lusdt.tx as any)['transfer'](
      { gasLimit: gas, storageDepositLimit: null },
      TEST_WALLET,
      SEND_LUSDT,
      [],
    ),
    alice,
  )

  // Also send native LUNES (existential deposit + some for gas)
  const NATIVE_SEND = 10_000_000_000n // 100 LUNES (8 decimals)
  await sendTx(
    `Native LUNES (100 LUNES → test wallet)`,
    api.tx.balances.transferKeepAlive(TEST_WALLET, NATIVE_SEND),
    alice,
  )

  // Verify test wallet balances
  const twWlunes = await query(api, alice, wlunes, 'balanceOf', [TEST_WALLET])
  const twLusdt  = await query(api, alice, lusdt,  'balanceOf', [TEST_WALLET])
  log(`Test wallet WLUNES: ${BigInt(twWlunes) / BigInt(10 ** 8)} WLUNES`)
  log(`Test wallet LUSDT : ${BigInt(twLusdt) / BigInt(10 ** 6)} LUSDT`)

  // ── 7. Update config files ────────────────────────────────────────────────
  section('7. Updating config files')

  addresses.lusdt          = lusdtAddress
  addresses.pairWlunesLusdt = pairAddress
  writeFileSync(ADDR_FILE, JSON.stringify(addresses, null, 2))
  ok('deployed-addresses.json updated')

  // Update frontend .env
  updateEnvFile(ENV_FILE_DEX, 'REACT_APP_TOKEN_WLUNES', addresses.wnative)
  updateEnvFile(ENV_FILE_DEX, 'REACT_APP_TOKEN_LUSDT', lusdtAddress)
  updateEnvFile(ENV_FILE_DEX, 'REACT_APP_LP_TOKEN_WLUNES_LUSDT', pairAddress)
  ok('lunes-dex-main/.env updated')

  // Update spot-api .env
  updateEnvFile(ENV_FILE_API, 'LUSDT_ADDRESS', lusdtAddress)
  updateEnvFile(ENV_FILE_API, 'WLUNES_ADDRESS', addresses.wnative)
  ok('spot-api/.env updated')

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(55))
  console.log('  🎉 DEPLOY COMPLETE!')
  console.log('═'.repeat(55))
  console.log(`  WLUNES      : ${addresses.wnative}`)
  console.log(`  LUSDT       : ${lusdtAddress}`)
  console.log(`  Pair        : ${pairAddress}`)
  console.log(`  Price       : 1 WLUNES = 2 000 LUSDT`)
  console.log()
  console.log(`  Test wallet : ${TEST_WALLET}`)
  console.log(`    WLUNES    : ${Number(SEND_WLUNES) / 10 ** 8} WLUNES`)
  console.log(`    LUSDT     : ${Number(SEND_LUSDT)  / 10 ** 6} LUSDT`)
  console.log(`    LUNES     : 100 LUNES (native)`)
  console.log('═'.repeat(55))

  await api.disconnect()
}

main().catch(e => {
  console.error('\n❌ DEPLOY FAILED:', e.message || e)
  process.exit(1)
})
