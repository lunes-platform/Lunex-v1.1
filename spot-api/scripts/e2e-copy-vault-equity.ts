/**
 * Lunex DEX — Copy Vault multi-asset equity E2E (ADR-002 / P0-3 proof)
 *
 * Prova on-chain que o copy_vault redesenhado:
 *  1. Upload + instantiate do copy_vault recém-buildado (target/ink/copy_vault)
 *  2. set_router(router) + set_valuation_infra(factory, wnative) — admin Alice
 *  3. deposit() nativo (20 LUNES) + transfer de 300 WLUNES ao vault
 *  4. swap_through_router(WLUNES → LUSDT) — vault adquire PSP22
 *  5. LUSDT entra AUTOMATICAMENTE na lista de tracked tokens
 *  6. get_vault_equity / get_equity_breakdown INCLUEM a valuation do
 *     LUSDT via cotação on-chain (factory.get_pair + pair.get_reserves
 *     + router.get_amount_out) — decomposição impressa
 *  7. withdraw parcial (1% das shares) com sucesso
 *  8. withdraw acima da liquidez nativa falha EXPLICITAMENTE com
 *     InsufficientNativeLiquidity (nunca paga parcial / nunca "vale 0")
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
const LEGACY_ARTIFACTS = join(__dirname, '../../artifacts')
const ADDRESSES_FILE = join(__dirname, '../deployed-addresses.json')

const ADDRESSES = JSON.parse(readFileSync(ADDRESSES_FILE, 'utf8')) as {
  wnative: string
  factory: string
  router: string
  lusdt: string
  pairWlunesLusdt: string
}

const LUNES = 100_000_000n // 1 LUNES = 10^8

function ok(msg: string) { console.log(`  ✅ ${msg}`) }
function fail(msg: string): never { console.log(`  ❌ ${msg}`); throw new Error(msg) }
function log(msg: string) { console.log(`  ℹ  ${msg}`) }
function section(msg: string) { console.log(`\n  📦 ${msg}`) }

function fmt(v: bigint): string {
  return `${v} (${Number(v) / Number(LUNES)} LUNES)`
}

/** Unwrap MessageResult + Result<T, VaultError> de um output.toJSON() */
function unwrapResult(out: any): any {
  const m = out?.ok !== undefined ? out.ok : out // MessageResult layer
  if (m && typeof m === 'object' && m.err !== undefined && m.err !== null) {
    throw new Error(`Contract Err: ${JSON.stringify(m.err)}`)
  }
  if (m && typeof m === 'object' && m.ok !== undefined) return m.ok
  return m
}

function toBig(v: any): bigint {
  return BigInt(v.toString())
}

function loadAbi(name: string, dir = ARTIFACTS) {
  const base = dir === ARTIFACTS ? join(dir, name) : dir
  return JSON.parse(readFileSync(join(base, `${name}.json`), 'utf8'))
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
  return output?.toJSON()
}

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

async function printBreakdown(
  api: ApiPromise,
  alice: any,
  vault: ContractPromise,
  label: string,
): Promise<{ native: bigint; entries: [string, bigint, bigint][]; total: bigint }> {
  const raw = unwrapResult(await query(api, alice, vault, 'getEquityBreakdown'))
  const [nativeRaw, entriesRaw, totalRaw] = raw
  const native = toBig(nativeRaw)
  const total = toBig(totalRaw)
  const entries: [string, bigint, bigint][] = (entriesRaw as any[]).map(
    (e: any[]) => [String(e[0]), toBig(e[1]), toBig(e[2])],
  )
  console.log(`     ── Decomposição do equity (${label}) ──`)
  console.log(`     nativo                : ${fmt(native)}`)
  for (const [token, balance, value] of entries) {
    const name =
      token === ADDRESSES.wnative ? 'WLUNES' :
      token === ADDRESSES.lusdt ? 'LUSDT ' : token.slice(0, 8)
    console.log(`     ${name} balance=${balance} → valor ${fmt(value)}`)
  }
  console.log(`     TOTAL                 : ${fmt(total)}`)
  return { native, entries, total }
}

async function main() {
  console.log('\n🔬 Lunex DEX — Copy Vault multi-asset equity E2E (ADR-002 / P0-3)')
  console.log('═'.repeat(64))

  const provider = new WsProvider(WS_URL)
  const api = await ApiPromise.create({ provider })
  await api.isReady
  log(`Connected to: ${await api.rpc.system.chain()}`)

  const keyring = new Keyring({ type: 'sr25519' })
  const alice = keyring.addFromUri('//Alice') // admin (deployer) + leader
  log(`Alice (admin/leader): ${alice.address}`)
  log(`Router  : ${ADDRESSES.router}`)
  log(`Factory : ${ADDRESSES.factory}`)
  log(`WLUNES  : ${ADDRESSES.wnative}`)
  log(`LUSDT   : ${ADDRESSES.lusdt}`)

  const wnativeAbi = loadAbi('wnative_contract')
  const copyVaultAbi = loadAbi('copy_vault')
  const pairAbi = JSON.parse(
    readFileSync(join(LEGACY_ARTIFACTS, 'pair_contract.json'), 'utf8'),
  )
  const wlunes = new ContractPromise(api, wnativeAbi, ADDRESSES.wnative)
  const lusdt = new ContractPromise(api, wnativeAbi, ADDRESSES.lusdt) // PSP22 surface
  const pair = new ContractPromise(api, pairAbi, ADDRESSES.pairWlunesLusdt)
  const gas = makeGas(api)

  // ── 0. Pré-condição: par WLUNES/LUSDT líquido ───────────────────────────
  section('0. Reservas do par WLUNES/LUSDT')
  const reservesRaw = await query(api, alice, pair, 'getReserves')
  const reserves = unwrapResult(reservesRaw)
  log(`reservas: ${JSON.stringify(reserves)}`)

  // ── 1. Upload + instantiate copy_vault novo ────────────────────────────
  section('1. Upload + instantiate copy_vault (artifact ADR-002)')
  const vaultAddress = await deployCopyVault(api, alice, alice.address, 1000)
  ok(`copy_vault deployed → ${vaultAddress}`)
  const vault = new ContractPromise(api, copyVaultAbi, vaultAddress)

  // ── 2. set_router + set_valuation_infra ────────────────────────────────
  section('2. set_router(router) + set_valuation_infra(factory, wnative)')
  await sendTx(
    'vault.setRouter',
    (vault.tx as any)['setRouter']({ gasLimit: gas, storageDepositLimit: null }, ADDRESSES.router),
    alice,
  )
  await sendTx(
    'vault.setValuationInfra',
    (vault.tx as any)['setValuationInfra'](
      { gasLimit: gas, storageDepositLimit: null },
      ADDRESSES.factory, ADDRESSES.wnative,
    ),
    alice,
  )
  const infra = await query(api, alice, vault, 'getValuationInfra')
  const infraVal = infra?.ok ?? infra
  if (infraVal?.[0] !== ADDRESSES.factory || infraVal?.[1] !== ADDRESSES.wnative) {
    fail(`valuation infra mismatch: ${JSON.stringify(infra)}`)
  }
  ok(`valuation infra confirmada: factory + wnative`)

  // ── 3. Financiar o vault ───────────────────────────────────────────────
  // Pouco nativo (20 LUNES) + muito WLUNES (300) — deixa a maior parte
  // do equity em PSP22 para provar o fail explícito do withdraw depois.
  section('3a. deposit() nativo no vault (20 LUNES)')
  const NATIVE_DEPOSIT = 20n * LUNES
  await sendTx(
    'vault.deposit (payable)',
    (vault.tx as any)['deposit']({ gasLimit: gas, value: NATIVE_DEPOSIT, storageDepositLimit: null }),
    alice,
  )

  section('3b. Wrap + transfer de 300 WLUNES para o vault')
  const WLUNES_FUND = 300n * LUNES
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

  // ── 4. Equity ANTES do swap ────────────────────────────────────────────
  section('4. Equity ANTES do swap (nativo + WLUNES 1:1)')
  const equityBefore = toBig(unwrapResult(await query(api, alice, vault, 'getVaultEquity')))
  const before = await printBreakdown(api, alice, vault, 'antes do swap')
  if (equityBefore !== before.total) fail('getVaultEquity ≠ total do breakdown')
  if (equityBefore < NATIVE_DEPOSIT + WLUNES_FUND) {
    fail(`equity ${equityBefore} não inclui o WLUNES (esperado ≥ ${NATIVE_DEPOSIT + WLUNES_FUND})`)
  }
  ok(`equity inclui WLUNES 1:1: ${fmt(equityBefore)}`)

  // ── 5. swap_through_router(WLUNES → LUSDT) ─────────────────────────────
  // 1 WLUNES — ~2% das reservas do par (cap de price impact do router)
  // e ≪ 20% do equity (risk caps do vault).
  section('5. swap_through_router(WLUNES → LUSDT, 1 WLUNES)')
  const AMOUNT_IN = 1n * LUNES
  const MIN_OUT = 1n

  const dry = await (vault.query as any)['swapThroughRouter'](
    alice.address, { gasLimit: makeGas(api), storageDepositLimit: null },
    ADDRESSES.wnative, ADDRESSES.lusdt, AMOUNT_IN, MIN_OUT,
  )
  if (dry.result.isErr) {
    let decoded = dry.result.asErr.toString()
    try {
      const err = dry.result.asErr
      if (err.isModule) {
        const meta = api.registry.findMetaError(err.asModule)
        decoded = `${meta.section}.${meta.name}: ${meta.docs.join(' ')}`
      }
    } catch { /* keep raw */ }
    fail(`dry-run falhou: ${decoded}`)
  }
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

  const lusdtBal = toBig(unwrapResult(await query(api, alice, lusdt, 'balanceOf', [vaultAddress])))
  if (lusdtBal <= 0n) fail('vault não recebeu LUSDT no swap')
  ok(`vault adquiriu ${lusdtBal} LUSDT (PSP22)`)

  // ── 6. LUSDT auto-rastreado + equity inclui valuation ──────────────────
  section('6. PROVA P0-3: equity inclui a valuation on-chain do LUSDT')
  const tracked = await query(api, alice, vault, 'getTrackedTokens')
  const trackedList: string[] = (tracked?.ok ?? tracked) as string[]
  log(`tracked tokens: ${JSON.stringify(trackedList)}`)
  if (!trackedList.includes(ADDRESSES.lusdt)) {
    fail('LUSDT não entrou automaticamente na lista de tracked tokens')
  }
  ok('LUSDT auto-rastreado no swap (invariante 1)')

  const lusdtValuation = toBig(unwrapResult(await query(api, alice, vault, 'getTokenValuation', [ADDRESSES.lusdt])))
  if (lusdtValuation <= 0n) fail('valuation do LUSDT é 0 — P0-3 NÃO corrigido')
  ok(`get_token_valuation(LUSDT) = ${fmt(lusdtValuation)} via router`)

  const equityAfter = toBig(unwrapResult(await query(api, alice, vault, 'getVaultEquity')))
  const after = await printBreakdown(api, alice, vault, 'depois do swap')
  if (equityAfter !== after.total) fail('getVaultEquity ≠ total do breakdown')

  const lusdtEntry = after.entries.find(([t]) => t === ADDRESSES.lusdt)
  if (!lusdtEntry) fail('LUSDT ausente do breakdown do equity')
  if (lusdtEntry![2] !== lusdtValuation) fail('breakdown ≠ get_token_valuation')
  ok(`equity TOTAL ${fmt(equityAfter)} inclui LUSDT valendo ${fmt(lusdtEntry![2])}`)

  // Sanidade: o swap não pode ter "sumido" com valor (só fee/slippage)
  const drift = equityBefore > equityAfter
    ? equityBefore - equityAfter
    : equityAfter - equityBefore
  log(`drift de equity pelo swap (fee+slippage): ${fmt(drift)}`)

  // ── 7. Withdraw parcial (1%) com sucesso ───────────────────────────────
  section('7. withdraw parcial (1% das shares) — caminho feliz')
  const infoBefore = unwrapResult(await query(api, alice, vault, 'getDepositorInfo', [alice.address]))
  const sharesTotal = toBig(infoBefore[0])
  log(`shares de Alice: ${sharesTotal}`)
  const SMALL = sharesTotal / 100n // 1%

  const drySmall = await (vault.query as any)['withdraw'](
    alice.address, { gasLimit: makeDryGas(api) }, SMALL,
  )
  const drySmallOut = drySmall.output?.toJSON()
  if (drySmallOut?.ok?.err !== undefined && drySmallOut?.ok?.err !== null) {
    fail(`withdraw 1% deveria passar, retornou: ${JSON.stringify(drySmallOut.ok.err)}`)
  }
  await sendTx(
    `vault.withdraw(${SMALL})`,
    (vault.tx as any)['withdraw']({ gasLimit: gas, storageDepositLimit: null }, SMALL),
    alice,
  )
  const infoMid = unwrapResult(await query(api, alice, vault, 'getDepositorInfo', [alice.address]))
  const sharesMid = toBig(infoMid[0])
  if (sharesMid !== sharesTotal - SMALL) fail(`shares não reduziram: ${sharesMid}`)
  ok(`withdraw parcial OK — shares ${sharesTotal} → ${sharesMid}`)

  // ── 8. Withdraw acima da liquidez nativa → erro EXPLÍCITO ──────────────
  section('8. withdraw acima da liquidez nativa → InsufficientNativeLiquidity')
  // 9% das shares ⇒ payout ≈ 9% do equity (~28 LUNES) ≫ nativo restante
  // (~18 LUNES). Não dispara cooldown (só >10% é "large").
  const BIG = (sharesMid * 9n) / 100n
  const { data: { free: vaultNative } } = await api.query.system.account(vaultAddress) as any
  log(`liquidez nativa do vault : ${fmt(toBig(vaultNative))}`)
  log(`tentando sacar ${BIG} shares (~9% do equity)`)

  const dryBig = await (vault.query as any)['withdraw'](
    alice.address, { gasLimit: makeDryGas(api) }, BIG,
  )
  if (dryBig.result.isErr) fail(`dry-run do withdraw grande falhou no runtime: ${dryBig.result.asErr.toString()}`)
  const dryBigOut = dryBig.output?.toJSON()
  log(`dry-run output: ${JSON.stringify(dryBigOut)}`)
  const errStr = JSON.stringify(dryBigOut?.ok?.err ?? null)
  if (!/insufficientnativeliquidity/i.test(errStr)) {
    fail(`esperado Err(InsufficientNativeLiquidity), veio: ${JSON.stringify(dryBigOut)}`)
  }
  ok('withdraw acima da liquidez nativa falha com Err(InsufficientNativeLiquidity)')

  // Mesmo enviando a tx, o estado não muda — Err na mensagem ink! faz o
  // pallet-contracts rejeitar com ContractReverted (dispatchError).
  const reverted = await new Promise<boolean>((resolve, reject) => {
    let unsub: (() => void) | null = null
    ;(vault.tx as any)['withdraw']({ gasLimit: gas, storageDepositLimit: null }, BIG)
      .signAndSend(alice, (result: any) => {
        const { status, dispatchError } = result
        if (dispatchError) {
          let name = dispatchError.toString()
          try {
            if (dispatchError.isModule) {
              const meta = api.registry.findMetaError(dispatchError.asModule)
              name = `${meta.section}.${meta.name}`
            }
          } catch { /* keep raw */ }
          log(`tx on-chain rejeitada como esperado: ${name}`)
          if (unsub) unsub()
          resolve(/ContractReverted/i.test(name))
          return
        }
        if (status.isInBlock || status.isFinalized) {
          if (unsub) unsub()
          resolve(false) // não reverteu — inesperado
        }
      })
      .then((u: () => void) => { unsub = u })
      .catch(reject)
  })
  if (!reverted) fail('tx do withdraw grande NÃO reverteu (esperado ContractReverted)')
  ok('tx on-chain revertida (ContractReverted) — fundos protegidos')
  const infoEnd = unwrapResult(await query(api, alice, vault, 'getDepositorInfo', [alice.address]))
  const sharesEnd = toBig(infoEnd[0])
  if (sharesEnd !== sharesMid) fail(`shares mudaram após withdraw revertido: ${sharesEnd}`)
  ok(`estado intacto após o revert — shares: ${sharesEnd}`)

  console.log('\n' + '═'.repeat(64))
  console.log('  🎉 ADR-002 PROVADO ON-CHAIN:')
  console.log('     • equity = nativo + WLUNES(1:1) + valuation router do LUSDT')
  console.log('     • token adquirido via swap entra AUTOMATICAMENTE no equity')
  console.log('     • withdraw parcial OK; acima da liquidez nativa → erro explícito')
  console.log('═'.repeat(64))
  console.log(`  Vault   : ${vaultAddress}`)
  console.log(`  Equity  : ${fmt(equityAfter)}`)
  console.log(`  LUSDT   : balance=${lusdtBal} valor=${fmt(lusdtValuation)}`)
  console.log('═'.repeat(64))

  await api.disconnect()
}

main().catch((e) => {
  console.error('\n❌ E2E FAILED:', e.message)
  process.exit(1)
})
