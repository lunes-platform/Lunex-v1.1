#!/usr/bin/env ts-node
/**
 * deploy-remaining-contracts.ts
 *
 * Deploys the 6 remaining Lunex ink! contracts to the sandbox testnet:
 *   1. LiquidityLock
 *   2. ListingManager  (requires LiquidityLock address + WLUNES token)
 *   3. SpotSettlement
 *   4. CopyVault       (template instance — deployer as leader)
 *   5. AsymmetricPair  (WLUNES/LUSDT template pair)
 *   6. AssetWrapper    (one instance per pallet-asset defined in ASSETS_TO_WRAP)
 *
 * Usage:
 *   RELAYER_SEED="//Alice" \
 *   LUNES_WS_URL="wss://sandbox.lunes.io/ws" \
 *   WLUNES_ADDRESS="5DqvK3i..." \
 *   LUSDT_ADDRESS="5CdLQGe..." \
 *   npx ts-node scripts/deploy-remaining-contracts.ts
 *
 * Optional overrides:
 *   TREASURY_ADDRESS       — defaults to deployer
 *   REWARDS_POOL_ADDRESS   — defaults to deployer
 *   STAKING_POOL_ADDRESS   — defaults to deployer
 *   DRY_RUN=true           — skip on-chain txs
 */

import { ApiPromise, WsProvider, Keyring } from '@polkadot/api'
import { CodePromise, ContractPromise } from '@polkadot/api-contract'
import { cryptoWaitReady } from '@polkadot/util-crypto'
import { BN } from '@polkadot/util'
import * as fs from 'fs'
import * as path from 'path'

// ── Config ────────────────────────────────────────────────────────

const WS_URL    = process.env.LUNES_WS_URL   || 'wss://sandbox.lunes.io/ws'
const SEED      = process.env.RELAYER_SEED   || '//Alice'
const DRY_RUN   = process.env.DRY_RUN === 'true'

const ROOT_DIR      = path.resolve(__dirname, '..')
const TARGET_INK    = path.join(ROOT_DIR, 'target', 'ink')
const CONTRACTS_DIR = path.join(ROOT_DIR, 'Lunex', 'contracts')

// Deployed addresses from previous session (deploy-lunes.ts)
const WLUNES_ADDRESS = process.env.WLUNES_ADDRESS || '5DqvK3iPYW3R7LK1DrS3bz5RFjxkk3ziBXmoyKTyigtFAnBL'
const LUSDT_ADDRESS  = process.env.LUSDT_ADDRESS  || '5CdLQGeA89rffQrfckqB8cX3qQkMauszo7rqt5QaNYChsXsf'

// Gas limits
const GAS_DEPLOY    = { refTime: new BN('10000000000'), proofSize: new BN('1048576') }
const GAS_CALL      = { refTime: new BN('10000000000'), proofSize: new BN('1048576') }
const STORAGE_LIMIT = new BN('2000000000000')

// Pallet-assets to wrap (asset_wrapper instances)
const ASSETS_TO_WRAP = [
  { id: 1, name: 'Wrapped PIDCHAT',       symbol: 'wPIDCHAT', decimals: 8 },
  { id: 2, name: 'Wrapped Lunes Dollar',  symbol: 'wLUSDT',   decimals: 6 },
  { id: 3, name: 'Wrapped Groovy Gang',   symbol: 'wGGNG',    decimals: 8 },
]

// ── Types ─────────────────────────────────────────────────────────

interface DeployResult {
  name:    string
  address: string
  txHash:  string
  block:   string
}

type Deployer = ReturnType<Keyring['addFromUri']>

// ── Helpers ───────────────────────────────────────────────────────

function log(msg: string) { console.log(`[deploy] ${msg}`) }
function err(msg: string) { console.error(`[deploy] ❌ ${msg}`) }

function bundlePath(contractName: string): string {
  // Try target/ink/<name>/<name>.contract first
  const candidates = [
    path.join(TARGET_INK, contractName, `${contractName}.contract`),
    path.join(CONTRACTS_DIR, contractName, 'target', 'ink', `${contractName}.contract`),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  throw new Error(`Bundle not found for ${contractName}. Build first with:\n  cargo contract build --release --manifest-path Lunex/contracts/${contractName}/Cargo.toml`)
}

function weightV2(api: ApiPromise, gas: typeof GAS_DEPLOY) {
  return api.registry.createType('WeightV2', gas) as any
}

async function deployContract(
  api:      ApiPromise,
  deployer: Deployer,
  name:     string,
  bundle:   string,
  ctor:     string,
  args:     unknown[],
): Promise<DeployResult> {
  log(`Deploying ${name}…`)

  if (DRY_RUN) {
    const fake = `5DRY_RUN_${name.toUpperCase().slice(0, 6).padEnd(6, 'X')}XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`
    log(`DRY RUN → ${fake}`)
    return { name, address: fake, txHash: 'dry-run', block: '0' }
  }

  const data  = JSON.parse(fs.readFileSync(bundle, 'utf8'))
  const code  = new CodePromise(api as any, data, data.source?.wasm ?? data.wasm)
  const gas   = weightV2(api, GAS_DEPLOY)

  return new Promise((resolve, reject) => {
    let address = ''
    let txHash  = ''
    let block   = ''

    ;(code.tx[ctor] as any)(
      { gasLimit: gas, storageDepositLimit: STORAGE_LIMIT },
      ...args,
    ).signAndSend(deployer, ({ events = [], status, txHash: hash }: any) => {
      txHash = hash?.toString() || ''

      if (status.isInBlock) {
        block = status.asInBlock.toString()
        log(`${name} in block ${block}`)

        for (const { event: { data: d, method, section } } of events) {
          if (section === 'contracts' && method === 'Instantiated') {
            address = d[1].toString()
            log(`${name} → ${address}`)
          }
          if (section === 'system' && method === 'ExtrinsicFailed') {
            reject(new Error(`${name} ExtrinsicFailed`))
          }
        }
      }

      if (status.isFinalized) {
        if (!address) reject(new Error(`${name}: finalized but no Instantiated event`))
        else { log(`✅ ${name} finalized: ${address}`); resolve({ name, address, txHash, block }) }
      }
    }).catch(reject)
  })
}

async function callContract(
  api:      ApiPromise,
  deployer: Deployer,
  label:    string,
  contract: ContractPromise,
  method:   string,
  args:     unknown[],
): Promise<void> {
  if (DRY_RUN) { log(`DRY RUN — skip ${label}`); return }

  log(`Calling ${label}…`)
  const gas = weightV2(api, GAS_CALL)

  await new Promise<void>((resolve, reject) => {
    let settled = false

    ;(contract.tx[method] as any)(
      { gasLimit: gas, storageDepositLimit: STORAGE_LIMIT },
      ...args,
    ).signAndSend(deployer, ({ status, events = [] }: any) => {
      if (settled) return

      if (status.isInBlock) {
        log(`${label} in block ${status.asInBlock.toString()}`)
        for (const { event: { method: m, section } } of events) {
          if (section === 'system' && m === 'ExtrinsicFailed') {
            settled = true
            reject(new Error(`${label} ExtrinsicFailed`))
            return
          }
        }
      }

      if (status.isFinalized) {
        settled = true
        log(`✅ ${label} done`)
        resolve()
      }
    }).catch((e: Error) => { if (!settled) { settled = true; reject(e) } })
  })
}

function updateEnvFile(filePath: string, key: string, value: string) {
  if (!fs.existsSync(filePath)) return
  let content = fs.readFileSync(filePath, 'utf8')
  const re = new RegExp(`^${key}=.*$`, 'm')
  content = re.test(content)
    ? content.replace(re, `${key}=${value}`)
    : content + `\n${key}=${value}\n`
  fs.writeFileSync(filePath, content, 'utf8')
  log(`  ${path.basename(filePath)}: ${key}=${value}`)
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  await cryptoWaitReady()

  log(`Network : ${WS_URL}`)
  log(`Dry run : ${DRY_RUN}`)
  log(`WLUNES  : ${WLUNES_ADDRESS}`)
  log(`LUSDT   : ${LUSDT_ADDRESS}`)

  log('Connecting…')
  const provider = new WsProvider(WS_URL)
  const api      = await ApiPromise.create({ provider })
  await api.isReady
  log('Connected ✅')

  const keyring  = new Keyring({ type: 'sr25519' })
  const deployer = keyring.addFromUri(SEED)
  log(`Deployer: ${deployer.address}`)

  if (!DRY_RUN) {
    const acct = await api.query.system.account(deployer.address)
    const free = (acct as any).data.free.toBigInt()
    log(`Balance : ${(free / 1_000_000_000_000n)} LUNES`)
    if (free < 100_000_000_000_000n) {
      err('Balance too low. Need at least 100 LUNES.')
      process.exit(1)
    }
  }

  const treasury    = process.env.TREASURY_ADDRESS     || deployer.address
  const rewardsPool = process.env.REWARDS_POOL_ADDRESS || deployer.address
  const stakingPool = process.env.STAKING_POOL_ADDRESS || deployer.address

  const results: Record<string, DeployResult> = {}

  // ── 1. LiquidityLock ───────────────────────────────────────────
  log('\n── Step 1: LiquidityLock ──')
  results.liquidity_lock = await deployContract(
    api, deployer, 'LiquidityLock',
    bundlePath('liquidity_lock'),
    'new',
    [deployer.address], // manager → will be updated to ListingManager
  )

  // ── 2. ListingManager ──────────────────────────────────────────
  log('\n── Step 2: ListingManager ──')
  log(`  lunes_token   : ${WLUNES_ADDRESS}`)
  log(`  liquidity_lock: ${results.liquidity_lock.address}`)
  log(`  treasury      : ${treasury}`)
  log(`  rewards_pool  : ${rewardsPool}`)
  log(`  staking_pool  : ${stakingPool}`)

  results.listing_manager = await deployContract(
    api, deployer, 'ListingManager',
    bundlePath('listing_manager'),
    'new',
    [WLUNES_ADDRESS, results.liquidity_lock.address, treasury, rewardsPool, stakingPool],
  )

  // ── 2b. Update LiquidityLock.manager → ListingManager ─────────
  log('\n── Step 2b: LiquidityLock.set_manager → ListingManager ──')
  if (!DRY_RUN) {
    const lockData     = JSON.parse(fs.readFileSync(bundlePath('liquidity_lock'), 'utf8'))
    const lockContract = new ContractPromise(api as any, lockData, results.liquidity_lock.address)
    await callContract(api, deployer, 'LiquidityLock.set_manager', lockContract, 'setManager', [
      results.listing_manager.address,
    ])
  }

  // ── 3. SpotSettlement ──────────────────────────────────────────
  log('\n── Step 3: SpotSettlement ──')
  results.spot_settlement = await deployContract(
    api, deployer, 'SpotSettlement',
    bundlePath('spot_settlement_contract'),
    'new',
    [treasury],
  )

  // ── 4. CopyVault (template instance) ──────────────────────────
  log('\n── Step 4: CopyVault (template) ──')
  results.copy_vault = await deployContract(
    api, deployer, 'CopyVault',
    bundlePath('copy_vault'),
    'new',
    [deployer.address, 1000], // leader=deployer, performance_fee=10%
  )

  // ── 5. AsymmetricPair (WLUNES/LUSDT template) ─────────────────
  log('\n── Step 5: AsymmetricPair (WLUNES/LUSDT) ──')
  results.asymmetric_pair = await deployContract(
    api, deployer, 'AsymmetricPair',
    bundlePath('asymmetric_pair'),
    'new',
    [
      WLUNES_ADDRESS, // base_token
      LUSDT_ADDRESS,  // quote_token
      2,              // buy_gamma  (1-5, curvature)
      1_000_000_000_000_000n, // buy_max_capacity (10M tokens)
      30,             // buy_fee_bps  (0.3%)
      2,              // sell_gamma
      1_000_000_000_000_000n, // sell_max_capacity
      30,             // sell_fee_bps (0.3%)
    ],
  )

  // ── 6. AssetWrappers (one per pallet-asset) ────────────────────
  log('\n── Step 6: AssetWrappers ──')
  const wrapperBundle = bundlePath('asset_wrapper_contract')
  const wrapperResults: DeployResult[] = []

  for (const asset of ASSETS_TO_WRAP) {
    log(`  → wrapping pallet-asset #${asset.id} (${asset.symbol})`)
    const r = await deployContract(
      api, deployer, `AssetWrapper_${asset.symbol}`,
      wrapperBundle,
      'new',
      [
        asset.id,           // asset_id: u32
        deployer.address,   // admin (relayer)
        asset.name,         // name: Option<String>
        asset.symbol,       // symbol: Option<String>
        asset.decimals,     // decimals: u8
        0,                  // mint_cap: 0 = unlimited
      ],
    )
    wrapperResults.push(r)
    results[`asset_wrapper_${asset.symbol.toLowerCase()}`] = r
  }

  // ── Write addresses to env files ──────────────────────────────
  log('\n── Writing addresses to env files ──')

  const envFiles = [
    path.join(ROOT_DIR, 'docker', '.env.sandbox.example'),
    path.join(ROOT_DIR, 'spot-api', '.env'),
    path.join(ROOT_DIR, 'docker', '.env.docker'),
  ]

  for (const f of envFiles) {
    updateEnvFile(f, 'SANDBOX_LISTING_MANAGER_CONTRACT', results.listing_manager.address)
    updateEnvFile(f, 'SANDBOX_LIQUIDITY_LOCK_CONTRACT',  results.liquidity_lock.address)
    updateEnvFile(f, 'SANDBOX_SPOT_SETTLEMENT_CONTRACT', results.spot_settlement.address)
    updateEnvFile(f, 'SANDBOX_COPY_VAULT_CONTRACT',      results.copy_vault.address)
    updateEnvFile(f, 'SANDBOX_ASYMMETRIC_PAIR_CONTRACT', results.asymmetric_pair.address)
    updateEnvFile(f, 'LISTING_MANAGER_CONTRACT_ADDRESS', results.listing_manager.address)
    updateEnvFile(f, 'LIQUIDITY_LOCK_CONTRACT_ADDRESS',  results.liquidity_lock.address)
  }

  // ── Summary ───────────────────────────────────────────────────
  const summary = {
    network:   WS_URL,
    deployer:  deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      liquidity_lock:  results.liquidity_lock.address,
      listing_manager: results.listing_manager.address,
      spot_settlement: results.spot_settlement.address,
      copy_vault:      results.copy_vault.address,
      asymmetric_pair: results.asymmetric_pair.address,
      asset_wrappers:  wrapperResults.map(r => ({ name: r.name, address: r.address })),
    },
  }

  console.log('\n' + JSON.stringify(summary, null, 2))

  const outFile = path.join(ROOT_DIR, 'deployment', `remaining-deploy-${Date.now()}.json`)
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, JSON.stringify(summary, null, 2))
  log(`Summary saved → ${outFile}`)

  await api.disconnect()
  log('\nDone ✅')
}

main().catch(e => { err(String(e)); process.exit(1) })
