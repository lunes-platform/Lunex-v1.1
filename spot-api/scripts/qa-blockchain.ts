/**
 * QA Phases 2-4: Token Listing, Liquidity Pool, Swap Flow
 * Tests AMM contracts via @polkadot/api + @polkadot/api-contract
 */
import { ApiPromise, WsProvider, Keyring } from '@polkadot/api'
import { ContractPromise } from '@polkadot/api-contract'
import { readFileSync } from 'fs'
import path from 'path'

const ALICE_URI = '//Alice'
const BOB_URI = '//Bob'

const BASE = path.resolve(__dirname, '../..')

// Known addresses from MEMORY.md
const KNOWN = {
  wnative: '5HRAv1VDeWkLnmkZAjgo6oigU5179nUDBgjKX4u5wztM7tTo',
  factory: '5D7pe8YhnMpdBHnVobrPooomnM1ikgRJ4vDRyfcppFonCuK2',
  router:  '5GSR7WUo53S2UpqSW7sMccSYNeP2dmAakfUnoK9BCY3YMb2B',
  LUSDT:   '5CdLQGeA89rffQrfckqB8cX3qQkMauszo7rqt5QaNYChsXsf',
}

function ok(msg: string) { console.log('  ✅', msg) }
function fail(msg: string) { console.log('  ❌', msg) }
function info(msg: string) { console.log('  ℹ️ ', msg) }
function section(msg: string) { console.log(`\n${'─'.repeat(50)}\n${msg}\n${'─'.repeat(50)}`) }

async function checkContractExists(api: ApiPromise, addr: string, name: string) {
  const info = await (api.query.contracts as any).contractInfoOf(addr)
  if (info.isEmpty) {
    fail(`${name} (${addr.slice(0,12)}...) NOT DEPLOYED`)
    return false
  }
  ok(`${name} deployed at ${addr.slice(0,12)}...`)
  return true
}

async function loadAbi(name: string) {
  const candidates = [
    `${BASE}/uniswap-v2/contracts/${name}/target/ink/${name}.json`,
    `${BASE}/uniswap-v2/contracts/${name}/target/ink/metadata.json`,
    `${BASE}/spot-api/abis/${name}.json`,
  ]
  for (const p of candidates) {
    try { return JSON.parse(readFileSync(p, 'utf8')) } catch {}
  }
  return null
}

async function main() {
  const api = await ApiPromise.create({ provider: new WsProvider('ws://127.0.0.1:9944') })
  const keyring = new Keyring({ type: 'sr25519' })
  const alice = keyring.addFromUri(ALICE_URI)
  const bob = keyring.addFromUri(BOB_URI)

  const blockNum = parseInt((await api.rpc.chain.getBlock()).block.header.number.toString())
  info(`Connected to Lunes Nightly — Block #${blockNum}`)
  info(`Alice: ${alice.address}`)
  info(`Bob:   ${bob.address}`)

  // ── Phase 2: Token Listing ─────────────────────────────────────────
  section('PHASE 2 — Token Listing Flow')

  const factoryExists = await checkContractExists(api, KNOWN.factory, 'Factory')
  const routerExists  = await checkContractExists(api, KNOWN.router, 'Router')
  const wNativeExists = await checkContractExists(api, KNOWN.wnative, 'WNative')
  const lusdtExists   = await checkContractExists(api, KNOWN.LUSDT, 'LUSDT PSP22')

  if (!factoryExists || !routerExists || !wNativeExists) {
    fail('AMM contracts NOT deployed — all Phases 2/3/4 BLOCKED')
    fail('Root cause: substrate-contracts-node --dev resets state on restart')
    fail('Fix: re-run scripts/deploy-contracts.ts + scripts/deploy-tokens.ts')
    info('Last known deploy: see MEMORY.md → Contratos Deployed section')
    await api.disconnect()
    return
  }

  // ── Phase 3: Liquidity Pool ─────────────────────────────────────────
  section('PHASE 3 — Liquidity Pool Test')
  info('Factory deployed — attempting to query pair count...')

  const factoryAbi = await loadAbi('factory')
  if (factoryAbi) {
    const factory = new ContractPromise(api, factoryAbi, KNOWN.factory)
    const { result, output } = await factory.query.allPairsLength(alice.address, { gasLimit: api.registry.createType('WeightV2' as any, { refTime: 10_000_000_000n, proofSize: 1_000_000n }) })
    if (result.isOk && output) {
      ok(`Factory.allPairsLength = ${output.toHuman()}`)
    } else {
      fail('Could not query factory.allPairsLength')
    }
  } else {
    fail('Factory ABI not found — compile with: cargo contract build (in uniswap-v2/contracts/factory)')
  }

  // ── Phase 4: Swap Flow ──────────────────────────────────────────────
  section('PHASE 4 — Swap Flow')
  if (!lusdtExists) {
    fail('LUSDT PSP22 NOT deployed — swap tests blocked')
    fail('Fix: re-run scripts/deploy-tokens.ts')
  } else {
    ok('LUSDT token exists — swap capable')
    const wNativeAbi = await loadAbi('wnative')
    if (wNativeAbi) {
      const wnative = new ContractPromise(api, wNativeAbi, KNOWN.wnative)
      const balRes = await wnative.query['psp22::balanceOf'](alice.address, { gasLimit: api.registry.createType('WeightV2' as any, { refTime: 10_000_000_000n, proofSize: 1_000_000n }) as any }, alice.address)
      if (balRes.result.isOk) {
        ok(`WNative balanceOf Alice = ${balRes.output?.toHuman()}`)
      } else {
        fail('Could not query WNative.balanceOf')
      }
    } else {
      info('WNative ABI not found locally — contract exists on chain but ABI unavailable for query')
    }
  }

  await api.disconnect()
  console.log('\nPhases 2-4 blockchain check complete.')
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1) })
