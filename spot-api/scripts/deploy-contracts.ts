/**
 * Lunex DEX — Contract Deployment Script
 * Deploy ordem: wnative → pair(upload code) → factory → router → staking → rewards
 */

import { ApiPromise, WsProvider, Keyring } from '@polkadot/api'
import { CodePromise } from '@polkadot/api-contract'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { blake2AsHex } from '@polkadot/util-crypto'

const WS_URL   = 'ws://127.0.0.1:9944'
const ARTIFACTS = join(__dirname, '../../target/ink')
const ENV_FILE  = join(__dirname, '../../lunes-dex-main/.env')

function loadContract(name: string) {
  const path = join(ARTIFACTS, name, `${name}.contract`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

function ok(msg: string)   { console.log(`  ✅ ${msg}`) }
function fail(msg: string) { console.log(`  ❌ ${msg}`) }
function log(msg: string)  { console.log(`  ℹ  ${msg}`) }

function makeGas(api: ApiPromise) {
  return api.registry.createType('WeightV2', {
    refTime: 300_000_000_000,
    proofSize: 10_000_000,
  }) as any
}

async function instantiate(
  api: ApiPromise,
  deployer: any,
  name: string,
  ctorArgs: unknown[],
  ctorName = 'new',
): Promise<string> {
  log(`Deploying ${name}...`)
  const abi = loadContract(name)
  const code = new CodePromise(api, abi, abi.source.wasm)
  const gas  = makeGas(api)

  return new Promise((resolve, reject) => {
    const tx = (code.tx as any)[ctorName]({ gasLimit: gas, storageDepositLimit: null }, ...ctorArgs)
    tx.signAndSend(deployer, ({ status, contract, dispatchError }: any) => {
      if (dispatchError) {
        const msg = dispatchError.isModule
          ? api.registry.findMetaError(dispatchError.asModule).docs.join(' ')
          : dispatchError.toString()
        reject(new Error(`${name}: ${msg}`)); return
      }
      if ((status.isInBlock || status.isFinalized) && contract?.address) {
        ok(`${name} → ${contract.address.toString()}`)
        resolve(contract.address.toString())
      }
    }).catch(reject)
  })
}

/** Upload apenas o código (sem instanciar) — retorna o code hash */
async function uploadCode(api: ApiPromise, deployer: any, name: string): Promise<string> {
  log(`Uploading code: ${name}...`)
  const abi = loadContract(name)
  const wasm = Buffer.from(abi.source.wasm.replace('0x', ''), 'hex')
  const codeHash = blake2AsHex(wasm, 256)
  log(`  Expected code hash: ${codeHash}`)

  return new Promise((resolve, reject) => {
    api.tx.contracts
      .uploadCode(abi.source.wasm, null, 'Deterministic')
      .signAndSend(deployer, ({ status, dispatchError, events }: any) => {
        if (dispatchError) {
          const msg = dispatchError.isModule
            ? api.registry.findMetaError(dispatchError.asModule).docs.join(' ')
            : dispatchError.toString()
          if (msg.includes('CodeAlreadyExists') || msg.includes('already')) {
            ok(`${name} code already uploaded, hash: ${codeHash}`)
            resolve(codeHash); return
          }
          reject(new Error(`${name} upload: ${msg}`)); return
        }
        if (status.isInBlock || status.isFinalized) {
          let hash = codeHash
          for (const { event } of events) {
            if (event.section === 'contracts' && event.method === 'CodeStored') {
              hash = event.data[0]?.toString() ?? codeHash
            }
          }
          ok(`${name} code uploaded → ${hash}`)
          resolve(hash)
        }
      }).catch(reject)
  })
}

async function main() {
  console.log('\n🚀 Lunex DEX — Contract Deployment')
  console.log('═'.repeat(50))

  const provider = new WsProvider(WS_URL)
  const api = await ApiPromise.create({ provider })
  await api.isReady

  const chain   = await api.rpc.system.chain()
  const version = await api.rpc.system.version()
  console.log(`  Chain: ${chain} | Version: ${version}`)

  const keyring = new Keyring({ type: 'sr25519' })
  const alice   = keyring.addFromUri('//Alice')
  log(`Deployer: ${alice.address}`)

  const { data: { free } } = await api.query.system.account(alice.address) as any
  log(`Alice balance: ${(BigInt(free.toString()) / BigInt(1e10)).toLocaleString()} LUNES`)

  const addresses: Record<string, string> = {}

  try {
    // 1. wnative — WLUNES token
    console.log('\n  📦 1. WNative (WLUNES)')
    addresses.wnative = await instantiate(api, alice, 'wnative_contract', [
      'Wrapped Lunes',
      'WLUNES',
      8,
    ])

    // 2. Upload pair code only (factory uses code hash to create pairs)
    console.log('\n  📦 2. Pair Contract (upload code)')
    const pairCodeHash = await uploadCode(api, alice, 'pair_contract')
    addresses.pairCodeHash = pairCodeHash

    // 3. factory
    console.log('\n  📦 3. Factory')
    addresses.factory = await instantiate(api, alice, 'factory_contract', [
      alice.address,
      pairCodeHash,
    ])

    // 4. router
    console.log('\n  📦 4. Router')
    addresses.router = await instantiate(api, alice, 'router_contract', [
      addresses.factory,
      addresses.wnative,
    ])

    // 5. staking
    console.log('\n  📦 5. Staking')
    addresses.staking = await instantiate(api, alice, 'staking_contract', [alice.address])

    // 6. rewards
    console.log('\n  📦 6. Trading Rewards')
    addresses.rewards = await instantiate(api, alice, 'trading_rewards_contract', [
      alice.address,
      addresses.router,
    ])

  } catch (err: any) {
    fail(`Deploy falhou: ${err.message}`)
    await api.disconnect()
    process.exit(1)
  }

  // Atualizar frontend .env
  console.log('\n  📝 Atualizando frontend .env...')
  let envContent = readFileSync(ENV_FILE, 'utf8')

  const updates: Record<string, string> = {
    REACT_APP_WNATIVE_CONTRACT: addresses.wnative,
    REACT_APP_FACTORY_CONTRACT: addresses.factory,
    REACT_APP_ROUTER_CONTRACT:  addresses.router,
    REACT_APP_STAKING_CONTRACT: addresses.staking,
    REACT_APP_REWARDS_CONTRACT: addresses.rewards,
    REACT_APP_RPC_TESTNET:      'ws://127.0.0.1:9944',
    REACT_APP_NETWORK:          'testnet',
    REACT_APP_DEV_MODE:         'false',
  }

  for (const [key, val] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}=.*$`, 'm')
    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, `${key}=${val}`)
    } else {
      envContent += `\n${key}=${val}`
    }
  }
  writeFileSync(ENV_FILE, envContent)
  ok('.env do frontend atualizado')

  writeFileSync(join(__dirname, '../deployed-addresses.json'), JSON.stringify(addresses, null, 2))

  console.log('\n' + '═'.repeat(50))
  console.log('  📋 ENDEREÇOS DEPLOYADOS:')
  console.log('═'.repeat(50))
  Object.entries(addresses).forEach(([k, v]) => console.log(`  ${k.padEnd(16)}: ${v}`))
  console.log('═'.repeat(50))

  await api.disconnect()
  console.log('\n✅ Deploy completo!\n')
}

main().catch(e => {
  console.error('\n❌ ERRO:', e.message)
  process.exit(1)
})
