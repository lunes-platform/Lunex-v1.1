/**
 * fund_tester.ts
 * 1. Deploy novo token PSP22 não-listado (LTEST — Lunex Test Token)
 *    → 100% do supply vai para o tester (para testar o fluxo de listing)
 * 2. Envia quantidades generosas de todos os tokens existentes para o tester
 */
import { ApiPromise, WsProvider, Keyring } from '@polkadot/api'
import { ContractPromise, CodePromise } from '@polkadot/api-contract'
import BN from 'bn.js'
import * as fs from 'fs'
import * as path from 'path'

const WS_URL   = 'ws://127.0.0.1:9944'
const TESTER   = '5HYVGHPrMmG6TKeczuTjhaGcRTkW8sMhWfppaFrTCAvKFfBb'
const ARTIFACTS = path.resolve(__dirname, '..', 'target/ink')

const PSP22_ABI    = JSON.parse(
  fs.readFileSync(path.join(ARTIFACTS, 'psp22_token', 'psp22_token.contract'), 'utf8')
)
const WNATIVE_ABI  = JSON.parse(
  fs.readFileSync(path.join(ARTIFACTS, 'wnative_contract', 'wnative_contract.contract'), 'utf8')
)

function gas(api: ApiPromise) {
  return api.registry.createType('WeightV2', {
    refTime: BigInt('300000000000'),
    proofSize: BigInt('10000000'),
  }) as any
}

function ok(msg: string)  { console.log(`  ✅ ${msg}`) }
function inf(msg: string) { console.log(`  ℹ  ${msg}`) }

/** PSP22 transfer helper */
async function psp22Transfer(
  api: ApiPromise,
  sender: any,
  contractAddr: string,
  to: string,
  amount: BN,
  symbol: string,
) {
  const c = new ContractPromise(api as any, PSP22_ABI, contractAddr)

  // dry-run
  const { gasRequired, result: dry } = await c.query['transfer'](
    sender.address,
    { gasLimit: gas(api) },
    to, amount, [],
  )
  if (dry.isErr) {
    console.log(`  ❌ ${symbol} dry-run: ${dry.asErr.toString()}`)
    return
  }

  await new Promise<void>((resolve, reject) => {
    c.tx['transfer']({ gasLimit: gasRequired }, to, amount, [])
      .signAndSend(sender, ({ status, dispatchError }: any) => {
        if (status.isInBlock) {
          if (dispatchError) { reject(new Error(dispatchError.toString())); return }
          ok(`${symbol} transferred`)
          resolve()
        }
      }).catch(reject)
  })
}

async function main() {
  const wsProvider = new WsProvider(WS_URL)
  const api        = await ApiPromise.create({ provider: wsProvider })
  const keyring    = new Keyring({ type: 'sr25519' })
  const alice      = keyring.addFromUri('//Alice')

  console.log('\n══════════════════════════════════════════════')
  console.log(' Lunex DEX — Tester Funding Script')
  console.log('══════════════════════════════════════════════')
  inf(`Deployer (Alice): ${alice.address}`)
  inf(`Tester address  : ${TESTER}`)

  // ── 1. Deploy LTEST (Lunex Test Token) ──────────────────────────────────
  console.log('\n── 1. Deploying LTEST (novo token não-listado) ──')
  const LTEST_SUPPLY = new BN('50000000').mul(new BN(10).pow(new BN(8))) // 50 million, 8 decimals
  const code = new CodePromise(api as any, PSP22_ABI, PSP22_ABI.source.wasm)

  const ltestAddr: string = await new Promise((resolve, reject) => {
    code.tx['new']!(
      { gasLimit: gas(api), storageDepositLimit: null },
      { some: 'Lunex Test Token' },  // name (Option<String>)
      { some: 'LTEST' },             // symbol (Option<String>)
      8,                             // decimals (u8)
      LTEST_SUPPLY,                  // initial_supply (u128) → mint para Alice
    ).signAndSend(alice, ({ status, contract, dispatchError }: any) => {
      if (dispatchError) {
        const msg = dispatchError.isModule
          ? api.registry.findMetaError(dispatchError.asModule).docs.join(' ')
          : dispatchError.toString()
        reject(new Error(msg)); return
      }
      if ((status.isInBlock || status.isFinalized) && contract?.address) {
        ok(`LTEST deployed → ${contract.address.toString()}`)
        resolve(contract.address.toString())
      }
    }).catch(reject)
  })

  // Transfer 100% do supply para o tester
  inf(`Sending 50,000,000 LTEST → tester`)
  await psp22Transfer(api, alice, ltestAddr, TESTER, LTEST_SUPPLY, '50,000,000 LTEST')

  // ── 2. Envio generoso dos tokens existentes ──────────────────────────────
  console.log('\n── 2. Enviando tokens existentes (quantidades generosas) ──')

  // Ler endereços atualizados do .env
  const envContent = fs.readFileSync(path.resolve(__dirname, '../spot-api/.env'), 'utf8')
  function envVar(key: string) {
    const m = envContent.match(new RegExp(`^${key}=(.+)$`, 'm'))
    return m ? m[1].trim() : null
  }

  const wlunesAddr  = envVar('WLUNES_ADDRESS')!
  const TOKENS: { symbol: string; address: string; amount: string; decimals: number; isWnative?: boolean }[] = [
    { symbol: 'LUSDT',  address: envVar('LUSDT_ADDRESS')!,  amount: '1000000',  decimals: 6  },
    { symbol: 'WLUNES', address: wlunesAddr,                 amount: '5000000',  decimals: 8, isWnative: true },
    { symbol: 'LBTC',   address: envVar('LBTC_ADDRESS')!,   amount: '50',       decimals: 8  },
    { symbol: 'LETH',   address: envVar('LETH_ADDRESS')!,   amount: '500',      decimals: 8  },
    { symbol: 'GMC',    address: envVar('GMC_ADDRESS')!,    amount: '50000000', decimals: 8  },
    { symbol: 'LUP',    address: envVar('LUP_ADDRESS')!,    amount: '100000000',decimals: 8  },
  ]

  for (const t of TOKENS) {
    if (!t.address) { console.log(`  ⚠️  ${t.symbol}: address not found in .env, skip`); continue }
    const raw = new BN(t.amount).mul(new BN(10).pow(new BN(t.decimals)))
    inf(`Sending ${t.amount} ${t.symbol}...`)

    if (t.isWnative) {
      // Para WLUNES: depositar LUNES nativo primeiro para ter saldo suficiente
      const wc = new ContractPromise(api as any, WNATIVE_ABI, t.address)
      const depositRaw = new BN(t.amount).mul(new BN(10).pow(new BN(t.decimals)))
      const gl = gas(api)
      await new Promise<void>((resolve, reject) => {
        wc.tx['deposit']({ gasLimit: gl, value: depositRaw }, )
          .signAndSend(alice, ({ status, dispatchError }: any) => {
            if (status.isInBlock) {
              if (dispatchError) { reject(new Error(dispatchError.toString())); return }
              inf('LUNES depositado → WLUNES')
              resolve()
            }
          }).catch(reject)
      })
      await psp22Transfer(api, alice, t.address, TESTER, raw, `${t.amount} ${t.symbol}`)
    } else {
      await psp22Transfer(api, alice, t.address, TESTER, raw, `${t.amount} ${t.symbol}`)
    }
  }

  // ── 3. Mais LUNES nativo ─────────────────────────────────────────────────
  console.log('\n── 3. Enviando LUNES nativo adicional ──')
  const extraLunes = new BN('500000').mul(new BN(10).pow(new BN(12))) // +500K LUNES
  await new Promise<void>((resolve, reject) => {
    api.tx.balances.transferKeepAlive(TESTER, extraLunes)
      .signAndSend(alice, ({ status, dispatchError }: any) => {
        if (status.isInBlock) {
          if (dispatchError) { reject(new Error(dispatchError.toString())); return }
          ok('500,000 LUNES nativos enviados')
          resolve()
        }
      }).catch(reject)
  })

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════')
  console.log(' Resumo do que foi enviado para:')
  console.log(` ${TESTER}`)
  console.log('══════════════════════════════════════════════')
  console.log('  LUNES (nativo)    1,000,000  (500K já enviados + 500K agora)')
  console.log('  LUSDT              1,000,000')
  console.log('  WLUNES             5,000,000')
  console.log('  LBTC                      50')
  console.log('  LETH                     500')
  console.log('  GMC               50,000,000')
  console.log('  LUP              100,000,000')
  console.log(`  LTEST (NOVO)      50,000,000  → ${ltestAddr}`)
  console.log('══════════════════════════════════════════════')
  console.log('\n📌 LTEST é o token não-listado para testar o fluxo de listing.')
  console.log(`   Endereço do contrato: ${ltestAddr}`)
  console.log('   Use este endereço na página /listing do DEX.')
  console.log('══════════════════════════════════════════════\n')

  await api.disconnect()
  process.exit(0)
}

main().catch(err => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
