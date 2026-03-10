/**
 * Lunex DEX — Deploy Additional Tokens
 *
 * Deploys LBTC, LETH, GMC, LUP as PSP22 contracts, creates AMM pairs
 * with LUSDT, adds liquidity, and updates config files.
 *
 * Usage:
 *   npx ts-node scripts/deploy-additional-tokens.ts
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

// ── Token definitions ─────────────────────────────────────────────────────────
// All tokens use 8 decimals (1 token = 10^8 raw units)
// LUSDT uses 6 decimals (1 LUSDT = 10^6 raw units)

interface TokenConfig {
  name: string
  symbol: string
  decimals: number
  supply: bigint       // initial supply (raw)
  liqToken: bigint     // liquidity: amount of this token
  liqLusdt: bigint     // liquidity: amount of LUSDT
  priceLabel: string
  addrKey: string      // key in deployed-addresses.json
  envKey: string       // REACT_APP_TOKEN_xxx
}

const TOKENS: TokenConfig[] = [
  {
    name: 'Lunes Bitcoin',
    symbol: 'LBTC',
    decimals: 8,
    supply:    2_100_000_000_000n,    // 21 000 LBTC
    liqToken:      500_000_000n,      //      5 LBTC  (5 * 10^8)
    liqLusdt:  400_000_000_000n,      // 400 000 LUSDT (400K * 10^6)
    priceLabel: '1 LBTC = 80 000 LUSDT',
    addrKey: 'lbtc',
    envKey: 'REACT_APP_TOKEN_LBTC',
  },
  {
    name: 'Lunes Ethereum',
    symbol: 'LETH',
    decimals: 8,
    supply:  100_000_000_000_000n,    // 1 000 000 LETH
    liqToken:   10_000_000_000n,      //       100 LETH (100 * 10^8)
    liqLusdt:  300_000_000_000n,      //   300 000 LUSDT
    priceLabel: '1 LETH = 3 000 LUSDT',
    addrKey: 'leth',
    envKey: 'REACT_APP_TOKEN_LETH',
  },
  {
    name: 'Game Coin',
    symbol: 'GMC',
    decimals: 8,
    supply: 10_000_000_000_000_000n,  // 100 000 000 GMC
    liqToken: 20_000_000_000_000n,    //     200 000 GMC (200K * 10^8)
    liqLusdt:   100_000_000_000n,     //     100 000 LUSDT
    priceLabel: '1 GMC = 0.50 LUSDT',
    addrKey: 'gmc',
    envKey: 'REACT_APP_TOKEN_GMC',
  },
  {
    name: 'Lunes UP',
    symbol: 'LUP',
    decimals: 8,
    supply: 1_000_000_000_000_000_000n, // 10 000 000 000 LUP
    liqToken:   500_000_000_000_000n,   //   5 000 000 LUP (5M * 10^8)
    liqLusdt:       50_000_000_000n,    //      50 000 LUSDT
    priceLabel: '1 LUP = 0.01 LUSDT',
    addrKey: 'lup',
    envKey: 'REACT_APP_TOKEN_LUP',
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

const ok      = (m: string) => console.log(`  ✅ ${m}`)
const log     = (m: string) => console.log(`  ℹ  ${m}`)
const section = (n: number, m: string) => console.log(`\n  📦 ${n}. ${m}`)

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
        ok(label)
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

async function deployPSP22(
  api: ApiPromise,
  deployer: any,
  cfg: TokenConfig,
): Promise<string> {
  log(`Deploying ${cfg.symbol} (PSP22, ${cfg.decimals} decimals)...`)
  const artifactPath = join(ARTIFACTS, 'psp22_token', 'psp22_token.contract')
  const abi  = JSON.parse(readFileSync(artifactPath, 'utf8'))
  const code = new CodePromise(api, abi, abi.source.wasm)
  const gas  = makeGas(api)

  return new Promise((resolve, reject) => {
    const tx = (code.tx as any)['new'](
      { gasLimit: gas, storageDepositLimit: null },
      { some: cfg.name },
      { some: cfg.symbol },
      cfg.decimals,
      cfg.supply,
    )
    let unsub: (() => void) | null = null
    tx.signAndSend(deployer, (result: any) => {
      const { status, contract, dispatchError } = result
      if (dispatchError) {
        if (unsub) unsub()
        reject(new Error(`deploy ${cfg.symbol}: ${dispatchError.toString()}`))
        return
      }
      if ((status.isInBlock || status.isFinalized) && contract?.address) {
        ok(`${cfg.symbol} deployed → ${contract.address.toString()}`)
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
  console.log('\n🚀 Lunex DEX — Deploy Additional Tokens (LBTC, LETH, GMC, LUP)')
  console.log('═'.repeat(65))

  const addresses = JSON.parse(readFileSync(ADDR_FILE, 'utf8'))
  const lusdtAddress = addresses.lusdt
  if (!lusdtAddress) throw new Error('LUSDT address not found in deployed-addresses.json — run deploy-tokens.ts first')

  log(`LUSDT   : ${lusdtAddress}`)
  log(`Factory : ${addresses.factory}`)
  log(`Router  : ${addresses.router}`)

  const provider = new WsProvider(WS_URL)
  const api      = await ApiPromise.create({ provider })
  await api.isReady
  log(`Connected to ${WS_URL}`)

  const keyring = new Keyring({ type: 'sr25519' })
  const alice   = keyring.addFromUri('//Alice')
  log(`Deployer: ${alice.address} (Alice)`)

  // Load ABIs
  const psp22Abi   = JSON.parse(readFileSync(join(ARTIFACTS, 'psp22_token', 'psp22_token.json'), 'utf8'))
  const factoryAbi = JSON.parse(readFileSync(join(ARTIFACTS, 'factory_contract', 'factory_contract.json'), 'utf8'))
  const routerAbi  = JSON.parse(readFileSync(join(ARTIFACTS, 'router_contract', 'router_contract.json'), 'utf8'))
  const pairAbi    = JSON.parse(readFileSync(join(ARTIFACTS, 'pair_contract', 'pair_contract.json'), 'utf8'))

  const factory = new ContractPromise(api, factoryAbi, addresses.factory)
  const router  = new ContractPromise(api, routerAbi,  addresses.router)
  const lusdt   = new ContractPromise(api, psp22Abi,   lusdtAddress)
  const gas     = makeGas(api)
  const MAX     = BigInt('340282366920938463463374607431768211455') // u128::MAX
  const ZERO    = '5C4hrfjw9DjXZTzV3MwzrrAr9P1MJhSrvWGWqi1eSuYmJFpN'

  const deployedTokens: Record<string, string> = {}
  const deployedPairs:  Record<string, string> = {}

  let step = 1

  for (const cfg of TOKENS) {
    // ── Deploy token ────────────────────────────────────────────────────────
    section(step++, `Deploy ${cfg.symbol}`)
    const tokenAddress = await deployPSP22(api, alice, cfg)
    deployedTokens[cfg.symbol] = tokenAddress
    const token = new ContractPromise(api, psp22Abi, tokenAddress)

    const bal = await query(api, alice, token, 'balanceOf', [alice.address])
    log(`Alice ${cfg.symbol}: ${BigInt(bal) / BigInt(10 ** cfg.decimals)} ${cfg.symbol}`)

    // ── Create AMM pair ──────────────────────────────────────────────────────
    section(step++, `Create ${cfg.symbol}/LUSDT pair on factory`)
    const existing = await query(api, alice, factory, 'getPair', [tokenAddress, lusdtAddress])
    let pairAddress: string

    if (existing && existing !== ZERO) {
      ok(`Pair already exists → ${existing}`)
      pairAddress = existing
    } else {
      await sendTx(
        `factory.createPair(${cfg.symbol}, LUSDT)`,
        (factory.tx as any)['createPair'](
          { gasLimit: gas, storageDepositLimit: null },
          tokenAddress,
          lusdtAddress,
        ),
        alice,
      )
      pairAddress = await query(api, alice, factory, 'getPair', [tokenAddress, lusdtAddress])
      ok(`Pair created → ${pairAddress}`)
    }
    deployedPairs[cfg.symbol] = pairAddress

    // ── Approve router ───────────────────────────────────────────────────────
    section(step++, `Approve router for ${cfg.symbol}`)
    await sendTx(
      `${cfg.symbol}.approve(router, MAX)`,
      (token.tx as any)['approve']({ gasLimit: gas, storageDepositLimit: null }, addresses.router, MAX),
      alice,
    )
    // Re-approve LUSDT in case allowance ran low
    await sendTx(
      'LUSDT.approve(router, MAX)',
      (lusdt.tx as any)['approve']({ gasLimit: gas, storageDepositLimit: null }, addresses.router, MAX),
      alice,
    )

    // ── Add liquidity ────────────────────────────────────────────────────────
    section(step++, `Add liquidity: ${cfg.symbol}/LUSDT (${cfg.priceLabel})`)
    const deadline = BigInt(Date.now() + 3_600_000)
    await sendTx(
      `router.addLiquidity(${cfg.symbol}/LUSDT)`,
      (router.tx as any)['addLiquidity'](
        { gasLimit: gas, storageDepositLimit: null },
        tokenAddress,
        lusdtAddress,
        cfg.liqToken,
        cfg.liqLusdt,
        0n,
        0n,
        alice.address,
        deadline,
      ),
      alice,
    )

    const pair     = new ContractPromise(api, pairAbi, pairAddress)
    const reserves = await query(api, alice, pair, 'getReserves', [])
    log(`Reserves: ${JSON.stringify(reserves)}`)
  }

  // ── Update config files ──────────────────────────────────────────────────────
  section(step++, 'Updating config files')

  for (const cfg of TOKENS) {
    addresses[cfg.addrKey] = deployedTokens[cfg.symbol]
    addresses[`pair${cfg.symbol}Lusdt`] = deployedPairs[cfg.symbol]
  }
  writeFileSync(ADDR_FILE, JSON.stringify(addresses, null, 2))
  ok('deployed-addresses.json updated')

  for (const cfg of TOKENS) {
    updateEnvFile(ENV_FILE_DEX, cfg.envKey, deployedTokens[cfg.symbol])
    updateEnvFile(ENV_FILE_API, `${cfg.symbol}_ADDRESS`, deployedTokens[cfg.symbol])
  }
  ok('lunes-dex-main/.env updated')
  ok('spot-api/.env updated')

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(65))
  console.log('  🎉 DEPLOY COMPLETE!')
  console.log('═'.repeat(65))
  for (const cfg of TOKENS) {
    console.log(`  ${cfg.symbol.padEnd(6)}: ${deployedTokens[cfg.symbol]}`)
    console.log(`  ${(cfg.symbol + '/LUSDT Pair').padEnd(16)}: ${deployedPairs[cfg.symbol]}`)
    console.log(`  Liquidity : ${cfg.priceLabel}`)
    console.log()
  }
  console.log('═'.repeat(65))

  await api.disconnect()
}

main().catch(e => {
  console.error('\n❌ DEPLOY FAILED:', e.message || e)
  process.exit(1)
})
