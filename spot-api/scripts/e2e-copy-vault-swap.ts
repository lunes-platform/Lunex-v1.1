/**
 * Lunex DEX — Copy Vault swap_through_router E2E (P0-2 fix proof)
 *
 * Prova on-chain que o copy_vault executa um swap REAL via Router:
 *  1. Upload + instantiate do copy_vault recém-buildado (target/ink/copy_vault)
 *  2. set_router(router) — admin Alice
 *  3. Financia o vault: deposit() nativo (equity p/ risk caps) +
 *     transfer PSP22 de WLUNES para o address do vault (token_in)
 *  4. swap_through_router(WLUNES, LUSDT, amount_in, min_out)
 *  5. PROVA com balance_of antes/depois que o vault recebeu LUSDT
 *
 * Requisitos: node dev em ws://127.0.0.1:9944, contratos do
 * spot-api/deployed-addresses.json no ar com par WLUNES/LUSDT líquido.
 */

import { ApiPromise, WsProvider, Keyring } from '@polkadot/api'
import { ContractPromise, CodePromise } from '@polkadot/api-contract'
import { readFileSync } from 'fs'
import { join } from 'path'

const WS_URL = 'ws://127.0.0.1:9944'
const ARTIFACTS = join(__dirname, '../../target/ink')
const ADDRESSES_FILE = join(__dirname, '../deployed-addresses.json')

const ADDRESSES = JSON.parse(readFileSync(ADDRESSES_FILE, 'utf8')) as {
  wnative: string
  router: string
  lusdt: string
  pairWlunesLusdt: string
}

function ok(msg: string) { console.log(`  ✅ ${msg}`) }
function fail(msg: string): never { console.log(`  ❌ ${msg}`); throw new Error(msg) }
function log(msg: string) { console.log(`  ℹ  ${msg}`) }
function section(msg: string) { console.log(`\n  📦 ${msg}`) }

function okBalance(value: any): bigint {
  return BigInt((value?.ok ?? value).toString())
}

function loadAbi(name: string) {
  return JSON.parse(readFileSync(join(ARTIFACTS, name, `${name}.json`), 'utf8'))
}

function makeGas(api: ApiPromise) {
  return api.registry.createType('WeightV2', {
    refTime: 300_000_000_000n,
    proofSize: 10_000_000n,
  }) as any
}

function makeDryGas(api: ApiPromise) {
  return api.registry.createType('WeightV2', {
    refTime: 100_000_000_000n,
    proofSize: 3_000_000n,
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

/** Upload + instantiate copy_vault from fresh artifact */
async function deployCopyVault(
  api: ApiPromise,
  deployer: any,
  leader: string,
  performanceFeeBps: number,
): Promise<string> {
  const artifact = JSON.parse(
    readFileSync(join(ARTIFACTS, 'copy_vault', 'copy_vault.contract'), 'utf8'),
  )
  const code = new CodePromise(api, artifact, artifact.source.wasm)
  const gas = makeGas(api)

  return new Promise((resolve, reject) => {
    const tx = (code.tx as any)['new'](
      { gasLimit: gas, storageDepositLimit: null },
      leader, performanceFeeBps,
    )
    let unsub: (() => void) | null = null
    tx.signAndSend(deployer, (result: any) => {
      const { status, contract, dispatchError } = result
      if (dispatchError) {
        if (unsub) unsub()
        reject(new Error(`copy_vault instantiate: ${dispatchError.toString()}`)); return
      }
      if ((status.isInBlock || status.isFinalized) && contract?.address) {
        if (unsub) unsub()
        resolve(contract.address.toString())
      }
    }).then((u: () => void) => { unsub = u }).catch(reject)
  })
}

async function main() {
  console.log('\n🔬 Lunex DEX — Copy Vault swap_through_router E2E (P0-2)')
  console.log('═'.repeat(60))

  const provider = new WsProvider(WS_URL)
  const api = await ApiPromise.create({ provider })
  await api.isReady
  log(`Connected to: ${await api.rpc.system.chain()}`)

  const keyring = new Keyring({ type: 'sr25519' })
  const alice = keyring.addFromUri('//Alice') // admin (deployer) + leader
  log(`Alice (admin/leader): ${alice.address}`)
  log(`Router : ${ADDRESSES.router}`)
  log(`WLUNES : ${ADDRESSES.wnative}`)
  log(`LUSDT  : ${ADDRESSES.lusdt}`)

  const wnativeAbi = loadAbi('wnative_contract')
  const copyVaultAbi = loadAbi('copy_vault')
  const wlunes = new ContractPromise(api, wnativeAbi, ADDRESSES.wnative)
  const lusdt = new ContractPromise(api, wnativeAbi, ADDRESSES.lusdt) // PSP22 surface (balance_of/transfer selectors padrão)
  const gas = makeGas(api)

  // ── 1. Upload + instantiate copy_vault novo ────────────────────────────
  section('1. Upload + instantiate copy_vault (artifact recém-buildado)')
  const vaultAddress = await deployCopyVault(api, alice, alice.address, 1000)
  ok(`copy_vault deployed → ${vaultAddress}`)
  const vault = new ContractPromise(api, copyVaultAbi, vaultAddress)

  // ── 2. set_router (admin Alice) ────────────────────────────────────────
  section('2. set_router(router)')
  await sendTx(
    'vault.setRouter',
    (vault.tx as any)['setRouter']({ gasLimit: gas, storageDepositLimit: null }, ADDRESSES.router),
    alice,
  )
  const configured = await query(api, alice, vault, 'routerAddress')
  if ((configured?.ok ?? configured) !== ADDRESSES.router) {
    fail(`router_address mismatch: ${JSON.stringify(configured)}`)
  }
  ok(`router_address confirmado: ${configured?.ok ?? configured}`)

  // ── 3. Financiar o vault ───────────────────────────────────────────────
  // 3a. deposit() nativo — define a equity usada pelos risk caps
  //     (max 20% por trade / 40% por bloco).
  section('3a. deposit() nativo no vault (100 LUNES de equity)')
  const NATIVE_DEPOSIT = 100_000_000_000n
  await sendTx(
    'vault.deposit (payable)',
    (vault.tx as any)['deposit']({ gasLimit: gas, value: NATIVE_DEPOSIT, storageDepositLimit: null }),
    alice,
  )
  const equity = await query(api, alice, vault, 'getVaultEquity')
  log(`Vault equity (nativo): ${equity?.ok ?? equity}`)

  // 3b. Alice embrulha LUNES → WLUNES e transfere para o vault (token_in)
  section('3b. Wrap + transfer de 2 WLUNES para o vault')
  const WLUNES_FUND = 200_000_000n // 2 WLUNES
  await sendTx(
    'wlunes.deposit (wrap)',
    (wlunes.tx as any)['deposit']({ gasLimit: gas, value: WLUNES_FUND, storageDepositLimit: null }),
    alice,
  )
  await sendTx(
    'wlunes.transfer(vault)',
    (wlunes.tx as any)['transfer']({ gasLimit: gas, storageDepositLimit: null }, vaultAddress, WLUNES_FUND, []),
    alice,
  )

  // ── 4. Saldos ANTES ────────────────────────────────────────────────────
  section('4. Saldos do vault ANTES do swap')
  const wlunesBefore = okBalance(await query(api, alice, wlunes, 'balanceOf', [vaultAddress]))
  const lusdtBefore = okBalance(await query(api, alice, lusdt, 'balanceOf', [vaultAddress]))
  console.log(`     WLUNES(vault) antes : ${wlunesBefore}`)
  console.log(`     LUSDT (vault) antes : ${lusdtBefore}`)
  if (wlunesBefore < WLUNES_FUND) fail('Vault não recebeu WLUNES')

  // ── 5. swap_through_router ─────────────────────────────────────────────
  section('5. swap_through_router(WLUNES → LUSDT)')
  const AMOUNT_IN = 100_000_000n // 1 WLUNES (1% das reservas; ≪ 20% da equity)
  const MIN_OUT = 1n

  // Dry-run primeiro para surfacear o Result do contrato
  const dry = await (vault.query as any)['swapThroughRouter'](
    alice.address, { gasLimit: makeDryGas(api) },
    ADDRESSES.wnative, ADDRESSES.lusdt, AMOUNT_IN, MIN_OUT,
  )
  if (dry.result.isErr) fail(`dry-run falhou: ${dry.result.asErr.toString()}`)
  const dryOut = dry.output?.toJSON()
  log(`dry-run output: ${JSON.stringify(dryOut)}`)
  if (dryOut?.ok?.err !== undefined && dryOut?.ok?.err !== null) {
    fail(`contrato retornou Err no dry-run: ${JSON.stringify(dryOut.ok.err)}`)
  }

  await sendTx(
    'vault.swapThroughRouter',
    (vault.tx as any)['swapThroughRouter'](
      { gasLimit: gas, storageDepositLimit: null },
      ADDRESSES.wnative, ADDRESSES.lusdt, AMOUNT_IN, MIN_OUT,
    ),
    alice,
  )

  // ── 6. Saldos DEPOIS + prova ───────────────────────────────────────────
  section('6. Saldos do vault DEPOIS do swap')
  const wlunesAfter = okBalance(await query(api, alice, wlunes, 'balanceOf', [vaultAddress]))
  const lusdtAfter = okBalance(await query(api, alice, lusdt, 'balanceOf', [vaultAddress]))
  console.log(`     WLUNES(vault) depois: ${wlunesAfter}`)
  console.log(`     LUSDT (vault) depois: ${lusdtAfter}`)
  console.log(`     Δ WLUNES: ${wlunesAfter - wlunesBefore}`)
  console.log(`     Δ LUSDT : ${lusdtAfter - lusdtBefore}`)

  if (wlunesAfter !== wlunesBefore - AMOUNT_IN) {
    fail(`WLUNES do vault não diminuiu em amount_in (esperado -${AMOUNT_IN})`)
  }
  if (lusdtAfter <= lusdtBefore) {
    fail('LUSDT do vault NÃO aumentou — swap não creditou o vault')
  }
  ok(`Vault gastou ${AMOUNT_IN} WLUNES e recebeu ${lusdtAfter - lusdtBefore} LUSDT`)

  const trades = await query(api, alice, vault, 'getRecentTrades', [1])
  log(`Trade registrado no histórico: ${JSON.stringify(trades?.ok ?? trades)?.slice(0, 200)}`)

  console.log('\n' + '═'.repeat(60))
  console.log('  🎉 P0-2 PROVADO: swap real on-chain via Router executado pelo vault')
  console.log('═'.repeat(60))
  console.log(`  Vault   : ${vaultAddress}`)
  console.log(`  Router  : ${ADDRESSES.router}`)
  console.log(`  WLUNES  : ${wlunesBefore} → ${wlunesAfter}`)
  console.log(`  LUSDT   : ${lusdtBefore} → ${lusdtAfter}`)
  console.log('═'.repeat(60))

  await api.disconnect()
}

main().catch((e) => {
  console.error('\n❌ E2E FAILED:', e.message)
  process.exit(1)
})
