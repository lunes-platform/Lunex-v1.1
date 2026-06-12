/**
 * Lunex DEX — Multi-User ON-CHAIN Volume Simulator
 * ===================================================
 *
 * Simula volume REAL on-chain no par WLUNES/LUSDT usando o router ink!.
 * Cada "trader" é uma conta Substrate sr25519 própria (//Trader1..//Trader5),
 * que ASSINA suas próprias transações. Nada de orderbook off-chain — todas as
 * operações são swaps / add_liquidity / remove_liquidity / stake reais.
 *
 * Fluxo:
 *  1. Cria 5 traders (seeds determinísticas //Trader1..//Trader5 — documentadas).
 *  2. Funda cada um a partir de Alice:
 *       - ~100 LUNES nativo (balances.transferKeepAlive)
 *       - cada trader faz wrap (deposit) de parte do nativo → WLUNES (paga ele mesmo)
 *       - Alice transfere LUSDT (PSP22 transfer) para cada trader
 *     Saldos confirmados via balance_of / system.account.
 *  3. Várias rodadas (DEFAULT 4). Em cada rodada cada trader faz um MIX:
 *       - swap WLUNES->LUSDT e/ou LUSDT->WLUNES (approve + swap_exact_tokens_for_tokens)
 *       - >=2 traders fazem add_liquidity
 *       - 1 trader faz remove_liquidity
 *       - 1 trader faz stake (se staking deployado e mensagem stake existir)
 *  4. Entre rodadas: lê reservas (get_reserves), preço implícito e volume acumulado.
 *  5. Relatório final: usuários, swaps por direção, volume WLUNES/LUSDT,
 *     reservas inicial vs final, preço inicial vs final (impacto), add/remove,
 *     stakes, e TODAS as falhas com motivo.
 *
 * Robustez:
 *  - dry-run (.query) antes de cada tx que move fundo → captura revert cedo.
 *  - cada tx espera isInBlock || isFinalized. Como é simulação de volume LOCAL,
 *    isInBlock é aceitável (mais rápido; finalização vem logo a seguir no dev node).
 *  - try/catch por operação: falha não aborta a simulação, é registrada e segue.
 *  - nonce gerenciado pelo polkadot.js (signAndSend sequencial POR conta).
 *
 * Decimais (confirmados on-chain):
 *   WLUNES = 8 decimais (1 WLUNES = 1e8)   |   LUSDT = 6 decimais (1 LUSDT = 1e6)
 *
 * Result unwrap:
 *   balance_of / get_pair / token_x  → { ok: V }            (1 camada)
 *   get_reserves                     → { ok: [r0,r1,ts] }   (1 camada)
 *   get_amount_out                   → { ok: { ok: N } }    (2 CAMADAS — desempacote as duas)
 *
 * Uso:  cd spot-api && npx ts-node scripts/simulate-onchain-volume.ts
 */

import { ApiPromise, WsProvider, Keyring } from '@polkadot/api'
import { ContractPromise } from '@polkadot/api-contract'
import type { KeyringPair } from '@polkadot/keyring/types'
import { cryptoWaitReady } from '@polkadot/util-crypto'
import { readFileSync } from 'fs'
import { join } from 'path'

// ─── Config ─────────────────────────────────────────────────────────────────
const WS_URL = 'ws://127.0.0.1:9944'
const ARTIFACTS = join(__dirname, '../../target/ink')
const ADDRESSES_FILE = join(__dirname, '../deployed-addresses.json')
const N_TRADERS = 5
const N_ROUNDS = 4

// Decimais on-chain
const WLUNES_DEC = 8n
const LUSDT_DEC = 6n
const W = (n: number) => BigInt(Math.round(n * 1e8))    // WLUNES (8 dec)
const L = (n: number) => BigInt(Math.round(n * 1e6))    // LUSDT  (6 dec)
const NATIVE = (n: number) => BigInt(n) * 10n ** 12n    // LUNES nativo (12 dec)

// Funding por trader
const FUND_NATIVE = NATIVE(100)        // 100 LUNES nativo
const WRAP_AMOUNT = NATIVE(30)         // cada trader embrulha 30 LUNES -> WLUNES
const FUND_LUSDT = L(50_000)           // 50 000 LUSDT por trader (vindos de Alice)

// ─── Addresses ───────────────────────────────────────────────────────────────
type Addresses = {
  wnative: string; factory: string; router: string
  lusdt: string; pairWlunesLusdt: string; staking?: string
}
const ADDR: Addresses = JSON.parse(readFileSync(ADDRESSES_FILE, 'utf8'))
for (const k of ['wnative', 'factory', 'router', 'lusdt', 'pairWlunesLusdt'] as const) {
  if (!ADDR[k]) throw new Error(`Missing ${k} in deployed-addresses.json`)
}

// ─── ABIs ────────────────────────────────────────────────────────────────────
function loadAbi(n: string) {
  return JSON.parse(readFileSync(join(ARTIFACTS, n, n + '.json'), 'utf8'))
}

// ─── Logging ─────────────────────────────────────────────────────────────────
function section(m: string) { console.log(`\n${'═'.repeat(64)}\n  ${m}\n${'═'.repeat(64)}`) }
function ok(m: string) { console.log(`  ✅ ${m}`) }
function info(m: string) { console.log(`  ℹ  ${m}`) }
function warn(m: string) { console.log(`  ⚠️  ${m}`) }

// ─── Gas ─────────────────────────────────────────────────────────────────────
function makeGas(api: ApiPromise) {
  return api.registry.createType('WeightV2', { refTime: 300_000_000_000n, proofSize: 10_000_000n }) as any
}
// Dry-run de swaps multi-hop faz chamadas cross-contract (factory→pair→psp22).
// proofSize baixo causa ContractTrapped (module 24, err 0x02) no dry-run.
// Usamos um teto generoso, igual/maior que o da tx real.
function makeDryGas(api: ApiPromise) {
  return api.registry.createType('WeightV2', { refTime: 500_000_000_000n, proofSize: 5_000_000n }) as any
}

// ─── tx / query helpers ──────────────────────────────────────────────────────
/** Assina e envia uma extrinsic genérica; resolve quando isInBlock||isFinalized. */
function sendRaw(label: string, tx: any, signer: KeyringPair): Promise<void> {
  return new Promise((resolve, reject) => {
    let unsub: (() => void) | null = null
    tx.signAndSend(signer, (result: any) => {
      const { status, dispatchError } = result
      if (dispatchError) {
        const msg = dispatchError.isModule ? dispatchError.asModule.toString() : dispatchError.toString()
        if (unsub) unsub()
        reject(new Error(`${label}: ${msg}`)); return
      }
      if (status.isInBlock || status.isFinalized) {
        if (unsub) unsub()
        resolve()
      }
    }).then((u: () => void) => { unsub = u }).catch(reject)
  })
}

/** Dry-run de uma mensagem contract (captura revert antes de gastar gas). */
async function dryRun(api: ApiPromise, caller: KeyringPair, c: ContractPromise, method: string, args: any[] = [], value?: bigint) {
  const opts: any = { gasLimit: makeDryGas(api) }
  if (value !== undefined) opts.value = value
  const { result, output } = await (c.query as any)[method](caller.address, opts, ...args)
  if (result.isErr) throw new Error(`dry-run ${method}: ${result.asErr.toString()}`)
  const json: any = output?.toJSON()
  // contract-level revert (Result::Err) — desembrulha 1 ou 2 camadas
  if (json && typeof json === 'object' && 'err' in json) throw new Error(`dry-run ${method} reverted: ${JSON.stringify(json.err)}`)
  if (json && typeof json === 'object' && 'ok' in json && json.ok && typeof json.ok === 'object' && 'err' in json.ok)
    throw new Error(`dry-run ${method} reverted: ${JSON.stringify(json.ok.err)}`)
  return json
}

/** Envia uma mensagem contract (tx) com dry-run prévio. */
async function sendContract(api: ApiPromise, signer: KeyringPair, c: ContractPromise, method: string, args: any[] = [], value?: bigint) {
  await dryRun(api, signer, c, method, args, value)   // revert cedo
  const opts: any = { gasLimit: makeGas(api), storageDepositLimit: null }
  if (value !== undefined) opts.value = value
  const tx = (c.tx as any)[method](opts, ...args)
  await sendRaw(`${method}`, tx, signer)
}

/** Query pura (read-only), retorna output.toJSON(). */
async function query(api: ApiPromise, caller: KeyringPair, c: ContractPromise, method: string, args: any[] = []) {
  const { result, output } = await (c.query as any)[method](caller.address, { gasLimit: makeDryGas(api) }, ...args)
  if (result.isErr) throw new Error(`query ${method}: ${result.asErr.toString()}`)
  return output?.toJSON()
}

// unwrap helpers
const unwrap1 = (r: any) => (r && typeof r === 'object' && 'ok' in r) ? r.ok : r
const unwrap2 = (r: any) => {
  const a = unwrap1(r)
  return (a && typeof a === 'object' && 'ok' in a) ? a.ok : a
}
const toBig = (v: any) => BigInt(typeof v === 'string' ? v : v ?? 0)

// ─── Trader model ─────────────────────────────────────────────────────────────
interface Trader {
  name: string
  seed: string
  pair: KeyringPair
  swapsWtoL: number
  swapsLtoW: number
  addLiq: number
  removeLiq: number
  stakes: number
}

// ─── Estatísticas globais ──────────────────────────────────────────────────────
const stats = {
  swapsWtoL: 0, swapsLtoW: 0,
  volWlunes: 0n,    // total WLUNES movimentado em swaps (amount_in W->L + amount_out L->W)
  volLusdt: 0n,     // total LUSDT movimentado em swaps
  addLiq: 0, removeLiq: 0, stakes: 0,
  failures: [] as { who: string; op: string; reason: string }[],
}
function recordFail(who: string, op: string, e: any) {
  const reason = (e && e.message) ? e.message : String(e)
  stats.failures.push({ who, op, reason })
  warn(`FALHA [${who}] ${op}: ${reason}`)
}

// ─── Leitura de reservas / preço ────────────────────────────────────────────────
async function readReserves(api: ApiPromise, caller: KeyringPair, pair: ContractPromise) {
  const r = unwrap1(await query(api, caller, pair, 'getReserves')) as any[]
  const r0 = toBig(r[0]) // WLUNES (token0)
  const r1 = toBig(r[1]) // LUSDT  (token1)
  return { r0, r1 }
}
/** Preço implícito = LUSDT por WLUNES, normalizado pelos decimais. */
function impliedPrice(r0: bigint, r1: bigint): number {
  if (r0 === 0n) return 0
  // (r1 / 1e6) / (r0 / 1e8) = r1 * 1e8 / (r0 * 1e6) = r1*100/r0
  return Number(r1) * 100 / Number(r0)
}

async function getAmountOut(api: ApiPromise, caller: KeyringPair, router: ContractPromise, amtIn: bigint, rIn: bigint, rOut: bigint): Promise<bigint> {
  const raw = await query(api, caller, router, 'getAmountOut', [amtIn, rIn, rOut])
  return toBig(unwrap2(raw)) // DUPLA camada {ok:{ok:N}}
}

async function balanceOf(api: ApiPromise, caller: KeyringPair, token: ContractPromise, who: string): Promise<bigint> {
  return toBig(unwrap1(await query(api, caller, token, 'balanceOf', [who])))
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  await cryptoWaitReady()
  section('Lunex DEX — Multi-User ON-CHAIN Volume Simulator')
  info(`Node: ${WS_URL}`)
  info(`Par WLUNES/LUSDT: ${ADDR.pairWlunesLusdt}`)
  info(`Router: ${ADDR.router} | Factory: ${ADDR.factory}`)
  info(`Traders: ${N_TRADERS} | Rodadas: ${N_ROUNDS}`)

  const api = await ApiPromise.create({ provider: new WsProvider(WS_URL) })
  const keyring = new Keyring({ type: 'sr25519' })
  const alice = keyring.addFromUri('//Alice')

  // ABIs / contracts (WLUNES e LUSDT são instâncias wnative_contract; LUSDT funde via PSP22 transfer)
  const wAbi = loadAbi('wnative_contract')
  const pAbi = loadAbi('pair_contract')
  const wlunes = new ContractPromise(api, wAbi, ADDR.wnative)
  const lusdt = new ContractPromise(api, wAbi, ADDR.lusdt)
  const router = new ContractPromise(api, loadAbi('router_contract'), ADDR.router)
  const pair = new ContractPromise(api, pAbi, ADDR.pairWlunesLusdt)

  // staking opcional
  let staking: ContractPromise | null = null
  let stakingHasStake = false
  if (ADDR.staking) {
    try {
      const stAbi = loadAbi('staking_contract')
      stakingHasStake = stAbi.spec.messages.some((m: any) => m.label === 'stake')
      staking = new ContractPromise(api, stAbi, ADDR.staking)
      info(`Staking: ${ADDR.staking} (mensagem stake: ${stakingHasStake ? 'sim' : 'não'})`)
    } catch (e: any) { warn(`Staking indisponível: ${e.message}`) }
  }

  // ── 1. Criar traders ────────────────────────────────────────────────────────
  section('1. Criando 5 traders (sr25519 //Trader1..//Trader5)')
  const traders: Trader[] = []
  for (let i = 1; i <= N_TRADERS; i++) {
    const seed = `//Trader${i}`
    const kp = keyring.addFromUri(seed)
    traders.push({ name: `Trader${i}`, seed, pair: kp, swapsWtoL: 0, swapsLtoW: 0, addLiq: 0, removeLiq: 0, stakes: 0 })
    ok(`${seed} → ${kp.address}`)
  }

  // ── 2. Fundar traders ────────────────────────────────────────────────────────
  section('2. Fundando traders a partir de Alice')
  // 2a. nativo (transferKeepAlive) — sequencial por conta Alice (nonce gerido pelo polkadot)
  for (const t of traders) {
    try {
      await sendRaw(`fund native ${t.name}`, api.tx.balances.transferKeepAlive(t.pair.address, FUND_NATIVE), alice)
      ok(`${t.name} recebeu ${Number(FUND_NATIVE) / 1e12} LUNES nativo`)
    } catch (e) { recordFail(t.name, 'fund-native', e) }
  }
  // 2b. cada trader embrulha parte do nativo -> WLUNES (paga ele mesmo, dry-run antes)
  for (const t of traders) {
    try {
      await sendContract(api, t.pair, wlunes, 'deposit', [], WRAP_AMOUNT)
      ok(`${t.name} embrulhou ${Number(WRAP_AMOUNT) / 1e12} LUNES → WLUNES`)
    } catch (e) { recordFail(t.name, 'wrap-WLUNES', e) }
  }
  // 2c. Alice transfere LUSDT (PSP22 transfer(to, value, data)) para cada trader
  for (const t of traders) {
    try {
      await sendContract(api, alice, lusdt, 'transfer', [t.pair.address, FUND_LUSDT, []])
      ok(`${t.name} recebeu ${Number(FUND_LUSDT) / 1e6} LUSDT de Alice`)
    } catch (e) { recordFail(t.name, 'fund-LUSDT', e) }
  }
  // 2d. confirmar saldos
  info('Confirmando saldos dos traders:')
  for (const t of traders) {
    const nat = (await api.query.system.account(t.pair.address) as any).data.free.toString()
    const wbal = await balanceOf(api, t.pair, wlunes, t.pair.address)
    const lbal = await balanceOf(api, t.pair, lusdt, t.pair.address)
    info(`  ${t.name}: ${Number(nat) / 1e12} LUNES | ${Number(wbal) / 1e8} WLUNES | ${Number(lbal) / 1e6} LUSDT`)
  }

  // approve do router para WLUNES e LUSDT (allowance grande, uma vez por trader)
  section('2e. Approve do router (WLUNES + LUSDT) por trader')
  const BIG_ALLOWANCE = W(1_000_000)  // valor grande
  for (const t of traders) {
    try {
      await sendContract(api, t.pair, wlunes, 'approve', [ADDR.router, BIG_ALLOWANCE])
      await sendContract(api, t.pair, lusdt, 'approve', [ADDR.router, L(100_000_000)])
      ok(`${t.name} aprovou router p/ WLUNES e LUSDT`)
    } catch (e) { recordFail(t.name, 'approve-router', e) }
  }

  // ── 3-4. Rodadas ─────────────────────────────────────────────────────────────
  const init = await readReserves(api, alice, pair)
  const priceInit = impliedPrice(init.r0, init.r1)
  section('3. Estado inicial do par')
  info(`Reservas: ${Number(init.r0) / 1e8} WLUNES | ${Number(init.r1) / 1e6} LUSDT`)
  info(`Preço implícito inicial: ${priceInit.toFixed(4)} LUSDT/WLUNES`)

  const deadline = () => BigInt(Date.now() + 3_600_000) // 1h em ms

  for (let round = 1; round <= N_ROUNDS; round++) {
    section(`Rodada ${round}/${N_ROUNDS}`)

    for (let idx = 0; idx < traders.length; idx++) {
      const t = traders[idx]

      // --- SWAP WLUNES -> LUSDT (amount varia por trader/rodada) ---
      try {
        const amtIn = W(0.5 + idx * 0.25 + round * 0.1) // varia
        const { r0, r1 } = await readReserves(api, t.pair, pair)
        const expOut = await getAmountOut(api, t.pair, router, amtIn, r0, r1)
        if (expOut <= 0n) throw new Error('expected out <= 0')
        await sendContract(api, t.pair, router, 'swapExactTokensForTokens',
          [amtIn, 0n, [ADDR.wnative, ADDR.lusdt], t.pair.address, deadline()])
        t.swapsWtoL++; stats.swapsWtoL++
        stats.volWlunes += amtIn; stats.volLusdt += expOut
        ok(`${t.name} swap ${Number(amtIn) / 1e8} WLUNES → ~${(Number(expOut) / 1e6).toFixed(2)} LUSDT`)
      } catch (e) { recordFail(t.name, `swap W→L r${round}`, e) }

      // --- SWAP LUSDT -> WLUNES ---
      try {
        const amtIn = L(300 + idx * 100 + round * 50)
        const { r0, r1 } = await readReserves(api, t.pair, pair)
        const expOut = await getAmountOut(api, t.pair, router, amtIn, r1, r0) // rin=LUSDT, rout=WLUNES
        if (expOut <= 0n) throw new Error('expected out <= 0')
        await sendContract(api, t.pair, router, 'swapExactTokensForTokens',
          [amtIn, 0n, [ADDR.lusdt, ADDR.wnative], t.pair.address, deadline()])
        t.swapsLtoW++; stats.swapsLtoW++
        stats.volLusdt += amtIn; stats.volWlunes += expOut
        ok(`${t.name} swap ${Number(amtIn) / 1e6} LUSDT → ~${(Number(expOut) / 1e8).toFixed(4)} WLUNES`)
      } catch (e) { recordFail(t.name, `swap L→W r${round}`, e) }

      // --- ADD LIQUIDITY: traders 0 e 1 (>=2 usuários) em todas as rodadas ---
      if (idx === 0 || idx === 1) {
        try {
          const { r0, r1 } = await readReserves(api, t.pair, pair)
          const amtW = W(1)
          // proporção atual para casar o ratio (amount_b = amount_a * r1 / r0)
          const amtL = (amtW * r1) / r0
          await sendContract(api, t.pair, router, 'addLiquidity',
            [ADDR.wnative, ADDR.lusdt, amtW, amtL, 0n, 0n, t.pair.address, deadline()])
          t.addLiq++; stats.addLiq++
          ok(`${t.name} add_liquidity ${Number(amtW) / 1e8} WLUNES + ~${(Number(amtL) / 1e6).toFixed(2)} LUSDT`)
        } catch (e) { recordFail(t.name, `add_liquidity r${round}`, e) }
      }
    }

    // --- REMOVE LIQUIDITY: 1 trader (Trader1 = idx 0) após acumular LP, a partir da rodada 2 ---
    if (round >= 2) {
      const t = traders[0]
      try {
        const lpBal = toBig(unwrap1(await query(api, t.pair, pair, 'balanceOf', [t.pair.address])))
        if (lpBal > 0n) {
          const lpRemove = lpBal / 4n // remove 25% do LP
          // approve do router para gastar LP do trader
          await sendContract(api, t.pair, pair, 'approve', [ADDR.router, lpRemove])
          await sendContract(api, t.pair, router, 'removeLiquidity',
            [ADDR.wnative, ADDR.lusdt, lpRemove, 0n, 0n, t.pair.address, deadline()])
          t.removeLiq++; stats.removeLiq++
          ok(`${t.name} remove_liquidity ${lpRemove} LP (25%)`)
        } else {
          info(`${t.name} sem LP para remover (lpBal=0)`)
        }
      } catch (e) { recordFail(t.name, `remove_liquidity r${round}`, e) }
    }

    // --- STAKE: 1 trader (Trader5 = idx 4) na rodada 1, se disponível ---
    if (round === 1 && staking && stakingHasStake) {
      const t = traders[4]
      try {
        // stake(duration) é payable — envia LUNES nativo. duration em BLOCOS:
        // MIN_DURATION = 7*24*60*30 = 302400 (7 dias). Usamos 30 dias.
        const STAKE_DURATION = 30 * 24 * 60 * 30 // 1_296_000 blocos
        await sendContract(api, t.pair, staking, 'stake', [STAKE_DURATION], NATIVE(10))
        t.stakes++; stats.stakes++
        ok(`${t.name} stake 10 LUNES`)
      } catch (e) { recordFail(t.name, 'stake', e) }
    }

    // --- snapshot entre rodadas ---
    const snap = await readReserves(api, alice, pair)
    const p = impliedPrice(snap.r0, snap.r1)
    info(`[r${round}] reservas: ${(Number(snap.r0) / 1e8).toFixed(4)} WLUNES | ${(Number(snap.r1) / 1e6).toFixed(2)} LUSDT | preço ${p.toFixed(4)} LUSDT/WLUNES`)
    info(`[r${round}] volume acumulado: ${(Number(stats.volWlunes) / 1e8).toFixed(4)} WLUNES | ${(Number(stats.volLusdt) / 1e6).toFixed(2)} LUSDT`)
  }

  // ── 5. Relatório final ─────────────────────────────────────────────────────────
  const fin = await readReserves(api, alice, pair)
  const priceFin = impliedPrice(fin.r0, fin.r1)
  section('RELATÓRIO FINAL DE VOLUME')
  console.log(`  Usuários de trade (contas Substrate próprias): ${N_TRADERS}`)
  console.log(`  Rodadas executadas: ${N_ROUNDS}`)
  console.log('')
  console.log(`  Swaps WLUNES→LUSDT: ${stats.swapsWtoL}`)
  console.log(`  Swaps LUSDT→WLUNES: ${stats.swapsLtoW}`)
  console.log(`  Swaps totais:       ${stats.swapsWtoL + stats.swapsLtoW}`)
  console.log('')
  console.log(`  Volume WLUNES movimentado: ${(Number(stats.volWlunes) / 1e8).toFixed(4)} WLUNES`)
  console.log(`  Volume LUSDT movimentado:  ${(Number(stats.volLusdt) / 1e6).toFixed(2)} LUSDT`)
  console.log('')
  console.log(`  add_liquidity:    ${stats.addLiq}`)
  console.log(`  remove_liquidity: ${stats.removeLiq}`)
  console.log(`  stakes:           ${stats.stakes}`)
  console.log('')
  console.log(`  Reservas INICIAL: ${(Number(init.r0) / 1e8).toFixed(4)} WLUNES | ${(Number(init.r1) / 1e6).toFixed(2)} LUSDT`)
  console.log(`  Reservas FINAL:   ${(Number(fin.r0) / 1e8).toFixed(4)} WLUNES | ${(Number(fin.r1) / 1e6).toFixed(2)} LUSDT`)
  console.log(`  Preço INICIAL: ${priceInit.toFixed(4)} LUSDT/WLUNES`)
  console.log(`  Preço FINAL:   ${priceFin.toFixed(4)} LUSDT/WLUNES`)
  const impact = priceInit ? ((priceFin - priceInit) / priceInit) * 100 : 0
  console.log(`  Impacto no preço: ${impact >= 0 ? '+' : ''}${impact.toFixed(4)}%`)
  console.log('')
  console.log('  Por trader:')
  for (const t of traders) {
    console.log(`    ${t.name}: W→L=${t.swapsWtoL} L→W=${t.swapsLtoW} add=${t.addLiq} remove=${t.removeLiq} stake=${t.stakes}`)
  }
  console.log('')
  if (stats.failures.length === 0) {
    console.log('  Falhas: NENHUMA ✅')
  } else {
    console.log(`  Falhas: ${stats.failures.length}`)
    for (const f of stats.failures) console.log(`    ❌ [${f.who}] ${f.op}: ${f.reason}`)
  }
  console.log('═'.repeat(64))

  await api.disconnect()
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
