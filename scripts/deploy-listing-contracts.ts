#!/usr/bin/env ts-node
/**
 * deploy-listing-contracts.ts
 *
 * Builds and deploys LiquidityLock + ListingManager ink! contracts to the
 * Lunes testnet (or mainnet) and automatically writes the resulting addresses
 * into spot-api/.env and docker/.env.docker.
 *
 * Usage:
 *   RELAYER_SEED="//Alice" npx ts-node scripts/deploy-listing-contracts.ts
 *   RELAYER_SEED="//Alice" NETWORK=testnet npx ts-node scripts/deploy-listing-contracts.ts
 *   RELAYER_SEED="//Alice" DRY_RUN=true npx ts-node scripts/deploy-listing-contracts.ts
 *
 * Environment variables:
 *   RELAYER_SEED        — sr25519 seed phrase / URI  (required)
 *   LUNES_WS_URL        — node WebSocket URL         (default: ws://127.0.0.1:9944)
 *   NETWORK             — testnet | mainnet | local  (default: local)
 *   TREASURY_ADDRESS    — treasury wallet            (default: deployer address)
 *   REWARDS_POOL_ADDRESS— rewards pool wallet        (default: deployer address)
 *   LUNES_TOKEN_ADDRESS — WLUNES PSP22 address       (required for non-local)
 *   DRY_RUN             — true = skip on-chain tx    (default: false)
 */

import { ApiPromise, WsProvider, Keyring } from '@polkadot/api'
import { CodePromise, ContractPromise } from '@polkadot/api-contract'
import { BN } from '@polkadot/util'
import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'

// ── Config ────────────────────────────────────────────────────────

const NETWORK_ENDPOINTS: Record<string, string> = {
  local:   'ws://127.0.0.1:9944',
  testnet: process.env.LUNES_WS_URL || 'wss://ws-test.lunes.io',
  mainnet: 'wss://ws.lunes.io',
}

const NETWORK  = process.env.NETWORK || 'local'
const WS_URL   = process.env.LUNES_WS_URL || NETWORK_ENDPOINTS[NETWORK] || NETWORK_ENDPOINTS.local
const DRY_RUN  = process.env.DRY_RUN === 'true'
const SEED     = process.env.RELAYER_SEED || ''

const ROOT_DIR     = path.resolve(__dirname, '..')
const CONTRACTS_DIR = path.join(ROOT_DIR, 'Lunex', 'contracts')

const CONTRACT_PATHS = {
  liquidity_lock:  path.join(CONTRACTS_DIR, 'liquidity_lock'),
  listing_manager: path.join(CONTRACTS_DIR, 'listing_manager'),
}

// Gas / storage defaults (conservative upper bounds)
const GAS_DEPLOY     = new BN('5000000000000')
const STORAGE_DEPLOY = new BN('2000000000000')

// ── Types ─────────────────────────────────────────────────────────

interface DeployResult {
  name:    string
  address: string
  txHash:  string
  block:   string
}

// ── Helpers ───────────────────────────────────────────────────────

function log(msg: string) {
  console.log(`[deploy] ${msg}`)
}

function err(msg: string) {
  console.error(`[deploy] ❌ ${msg}`)
}

/**
 * Runs `cargo contract build` in the given contract directory.
 * Returns the path to the generated .contract bundle.
 */
function buildContract(contractDir: string, contractName: string): string {
  log(`Building ${contractName}…`)

  if (DRY_RUN) {
    log(`DRY RUN — skipping cargo build for ${contractName}`)
    return path.join(contractDir, 'target', 'ink', `${contractName}.contract`)
  }

  execSync(`cargo contract build --release --manifest-path ${path.join(contractDir, 'Cargo.toml')}`, {
    stdio: 'inherit',
    cwd:   ROOT_DIR,
  })

  const bundle = path.join(contractDir, 'target', 'ink', `${contractName}.contract`)
  if (!fs.existsSync(bundle)) {
    throw new Error(`Build artifact not found: ${bundle}`)
  }

  log(`✅ Built ${contractName} → ${bundle}`)
  return bundle
}

/**
 * Instantiates an ink! contract using CodePromise.
 * Returns the on-chain address.
 */
async function deployContract(
  api:          ApiPromise,
  deployer:     ReturnType<Keyring['addFromUri']>,
  name:         string,
  bundlePath:   string,
  constructor:  string,
  args:         unknown[],
): Promise<DeployResult> {
  log(`Deploying ${name} via constructor "${constructor}"…`)

  if (DRY_RUN) {
    const fake = `5DRY_RUN_${name.toUpperCase().slice(0, 6)}XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`
    log(`DRY RUN — fake address: ${fake}`)
    return { name, address: fake, txHash: 'dry-run', block: '0' }
  }

  const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'))
  const code   = new CodePromise(api as any, bundle, bundle.source?.wasm ?? bundle.wasm)

  // Dry-run to get accurate gas
  let gasLimit = GAS_DEPLOY
  try {
    const dry = await (code.tx[constructor] as any)(
      { gasLimit: GAS_DEPLOY, storageDepositLimit: STORAGE_DEPLOY },
      ...args,
    ).dryRun(deployer)
    if ((dry as any).gasRequired) {
      gasLimit = (dry as any).gasRequired
      log(`Gas estimate for ${name}: ${gasLimit.toString()}`)
    }
  } catch {
    log(`Gas dry-run failed for ${name}, using default: ${GAS_DEPLOY.toString()}`)
  }

  return new Promise((resolve, reject) => {
    let address = ''
    let block   = ''
    let txHash  = ''

    ;(code.tx[constructor] as any)(
      { gasLimit, storageDepositLimit: STORAGE_DEPLOY },
      ...args,
    ).signAndSend(deployer, ({ events = [], status, txHash: hash }: any) => {
      txHash = hash.toString()

      if (status.isInBlock) {
        block = status.asInBlock.toString()
        log(`${name} in block ${block}`)

        for (const { event: { data, method, section } } of events) {
          if (section === 'contracts' && method === 'Instantiated') {
            address = data[1].toString()
            log(`${name} address: ${address}`)
          }
          if (section === 'system' && method === 'ExtrinsicFailed') {
            reject(new Error(`${name} instantiation failed — ExtrinsicFailed`))
          }
        }
      }

      if (status.isFinalized) {
        if (!address) {
          reject(new Error(`${name}: finalized but no Instantiated event found`))
        } else {
          log(`✅ ${name} finalized — address: ${address}`)
          resolve({ name, address, txHash, block })
        }
      }
    }).catch(reject)
  })
}

/**
 * Updates a key=value line in an .env file.
 * Adds the line if it doesn't exist.
 */
function updateEnvFile(filePath: string, key: string, value: string) {
  if (!fs.existsSync(filePath)) {
    log(`⚠ ${filePath} not found — skipping env update`)
    return
  }

  let content = fs.readFileSync(filePath, 'utf8')
  const pattern = new RegExp(`^${key}=.*$`, 'm')

  if (pattern.test(content)) {
    content = content.replace(pattern, `${key}=${value}`)
  } else {
    content += `\n${key}=${value}\n`
  }

  fs.writeFileSync(filePath, content, 'utf8')
  log(`Updated ${path.basename(filePath)}: ${key}=${value}`)
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  if (!SEED && !DRY_RUN) {
    err('RELAYER_SEED is required. Set it in your environment:\n  export RELAYER_SEED="//Alice"')
    process.exit(1)
  }

  log(`Network: ${NETWORK} (${WS_URL})`)
  log(`Dry run: ${DRY_RUN}`)

  // ── Connect ────────────────────────────────────────────────────
  log('Connecting to node…')
  const provider = new WsProvider(WS_URL)
  const api      = await ApiPromise.create({ provider })
  await api.isReady
  log('Connected ✅')

  const keyring  = new Keyring({ type: 'sr25519' })
  const deployer = keyring.addFromUri(SEED || '//Alice')

  log(`Deployer address: ${deployer.address}`)

  if (!DRY_RUN) {
    const acct = await api.query.system.account(deployer.address)
    const free = (acct as any).data.free.toBigInt()
    log(`Deployer balance: ${(free / 1_000_000_000_000n).toString()} LUNES`)
    if (free < 50_000_000_000_000n) {
      err('Balance too low. Need at least 50 LUNES to deploy both contracts.')
      process.exit(1)
    }
  }

  // ── Resolve constructor args ────────────────────────────────────
  const treasuryAddr    = process.env.TREASURY_ADDRESS     || deployer.address
  const rewardsPoolAddr = process.env.REWARDS_POOL_ADDRESS || deployer.address
  const lunesTokenAddr  = process.env.LUNES_TOKEN_ADDRESS  || deployer.address

  if (NETWORK !== 'local' && !process.env.LUNES_TOKEN_ADDRESS) {
    log('⚠ LUNES_TOKEN_ADDRESS not set — using deployer address as placeholder for non-local deploy')
  }

  // ── Step 1: Build contracts ─────────────────────────────────────
  log('─────────────────────────────────────────')
  log('Step 1: Build contracts')
  log('─────────────────────────────────────────')

  const lockBundle    = buildContract(CONTRACT_PATHS.liquidity_lock,  'liquidity_lock')
  const managerBundle = buildContract(CONTRACT_PATHS.listing_manager, 'listing_manager')

  // ── Step 2: Deploy LiquidityLock ───────────────────────────────
  log('─────────────────────────────────────────')
  log('Step 2: Deploy LiquidityLock')
  log('─────────────────────────────────────────')
  log('Constructor: new(manager: AccountId)')
  log(`Manager arg: ${deployer.address} (will be updated to ListingManager after step 3)`)

  const lockResult = await deployContract(
    api,
    deployer,
    'LiquidityLock',
    lockBundle,
    'new',
    [deployer.address], // manager — updated below after ListingManager is deployed
  )

  // ── Step 3: Deploy ListingManager ──────────────────────────────
  log('─────────────────────────────────────────')
  log('Step 3: Deploy ListingManager')
  log('─────────────────────────────────────────')
  const stakingPoolAddr = process.env.STAKING_POOL_ADDRESS || deployer.address

  log(`Constructor args:`)
  log(`  lunes_token:    ${lunesTokenAddr}`)
  log(`  liquidity_lock: ${lockResult.address}`)
  log(`  treasury:       ${treasuryAddr}`)
  log(`  rewards_pool:   ${rewardsPoolAddr}`)
  log(`  staking_pool:   ${stakingPoolAddr}`)

  const managerResult = await deployContract(
    api,
    deployer,
    'ListingManager',
    managerBundle,
    'new',
    [lunesTokenAddr, lockResult.address, treasuryAddr, rewardsPoolAddr, stakingPoolAddr],
  )

  // ── Step 4: Update LiquidityLock manager to ListingManager ─────
  if (!DRY_RUN) {
    log('─────────────────────────────────────────')
    log('Step 4: Update LiquidityLock.set_manager → ListingManager')
    log('─────────────────────────────────────────')

    const lockBundle2 = JSON.parse(fs.readFileSync(lockBundle, 'utf8'))
    const lockContract = new ContractPromise(api as any, lockBundle2, lockResult.address)

    await new Promise<void>((resolve, reject) => {
      ;(lockContract.tx['set_manager'] as any)(
        { gasLimit: new BN('1000000000000'), storageDepositLimit: null },
        managerResult.address,
      ).signAndSend(deployer, ({ status }: any) => {
        if (status.isFinalized) {
          log(`✅ LiquidityLock manager updated to ${managerResult.address}`)
          resolve()
        }
        if (status.isDropped || status.isInvalid) {
          reject(new Error('set_manager tx dropped/invalid'))
        }
      }).catch(reject)
    })
  } else {
    log('DRY RUN — skipping set_manager call')
  }

  // ── Step 5: Write addresses to .env files ──────────────────────
  log('─────────────────────────────────────────')
  log('Step 5: Write addresses to .env files')
  log('─────────────────────────────────────────')

  const envFiles = [
    path.join(ROOT_DIR, 'spot-api', '.env'),
    path.join(ROOT_DIR, 'docker', '.env.docker'),
  ]

  for (const envFile of envFiles) {
    updateEnvFile(envFile, 'LISTING_MANAGER_CONTRACT_ADDRESS', managerResult.address)
    updateEnvFile(envFile, 'LIQUIDITY_LOCK_CONTRACT_ADDRESS',  lockResult.address)
  }

  // ── Step 6: Print deployment summary ───────────────────────────
  log('─────────────────────────────────────────')
  log('DEPLOYMENT SUMMARY')
  log('─────────────────────────────────────────')

  const summary = {
    network:             NETWORK,
    wsUrl:               WS_URL,
    deployer:            deployer.address,
    liquidity_lock: {
      address: lockResult.address,
      txHash:  lockResult.txHash,
      block:   lockResult.block,
    },
    listing_manager: {
      address: managerResult.address,
      txHash:  managerResult.txHash,
      block:   managerResult.block,
    },
    env_updates: {
      LISTING_MANAGER_CONTRACT_ADDRESS: managerResult.address,
      LIQUIDITY_LOCK_CONTRACT_ADDRESS:  lockResult.address,
    },
    next_steps: [
      'Restart the spot-api to pick up the new env vars',
      'Run: POST /api/v1/listing/:id/activate after each on-chain listing confirmation',
      'Or start the listing-relayer: npx ts-node scripts/listing-relayer.ts',
    ],
  }

  console.log('\n' + JSON.stringify(summary, null, 2))

  // Save summary to file
  const summaryPath = path.join(ROOT_DIR, 'deployment', `listing-deploy-${Date.now()}.json`)
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true })
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2))
  log(`Summary saved to ${summaryPath}`)

  await api.disconnect()
  log('Done ✅')
}

main().catch((e) => {
  err(String(e))
  process.exit(1)
})
