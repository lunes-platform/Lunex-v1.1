import { ApiPromise, WsProvider, Keyring } from '@polkadot/api'
import { ContractPromise } from '@polkadot/api-contract'
import { readFileSync } from 'fs'
import { join } from 'path'

const WS = 'ws://127.0.0.1:9944'
const TARGET = '5DCZfzyZ7F2kthgmRdkCfFEpYcM5PG8kzs8aiGHrLonKzzei'
const ART = join(__dirname, '../../target/ink')
const ADDR = JSON.parse(readFileSync(join(__dirname, '../deployed-addresses.json'), 'utf8'))
const loadAbi = (n: string) => JSON.parse(readFileSync(join(ART, n, `${n}.json`), 'utf8'))

function gas(api: ApiPromise) { return api.registry.createType('WeightV2', { refTime: 300_000_000_000, proofSize: 5_000_000 }) as any }
function send(api: ApiPromise, label: string, tx: any, signer: any): Promise<void> {
  return new Promise((res, rej) => {
    tx.signAndSend(signer, ({ status, dispatchError }: any) => {
      if (dispatchError) { const m = dispatchError.isModule ? api.registry.findMetaError(dispatchError.asModule).docs.join(' ') : dispatchError.toString(); rej(new Error(`${label}: ${m}`)); return }
      if (status.isInBlock || status.isFinalized) { console.log(`  ✅ ${label}`); res() }
    }).catch(rej)
  })
}

async function main() {
  const api = await ApiPromise.create({ provider: new WsProvider(WS) }); await api.isReady
  const kr = new Keyring({ type: 'sr25519' }); const alice = kr.addFromUri('//Alice')
  const wAbi = loadAbi('wnative_contract'); const lusdtAbi = loadAbi('psp22_token')
  const WLUNES = ADDR.wnative; const LUSDT = ADDR.lusdt
  const wlunes = new ContractPromise(api, wAbi, WLUNES)
  const lusdt = new ContractPromise(api, lusdtAbi, LUSDT)
  const g = gas(api)
  console.log('Fundando', TARGET)
  // 1. Nativo: 500 LUNES (gas)
  await send(api, '500 LUNES nativo', api.tx.balances.transferKeepAlive(TARGET, 50_000_000_000n), alice)
  // 2. Alice faz wrap de 200 LUNES -> WLUNES e transfere 100 WLUNES ao alvo
  await send(api, 'Alice deposit 200 WLUNES', (wlunes.tx as any).deposit({ gasLimit: g, storageDepositLimit: null, value: 20_000_000_000n }), alice)
  await send(api, 'transfer 100 WLUNES -> alvo', (wlunes.tx as any).transfer({ gasLimit: g, storageDepositLimit: null }, TARGET, 10_000_000_000n, []), alice)
  // 3. LUSDT: transfere 50.000 LUSDT (6 dec)
  await send(api, 'transfer 50000 LUSDT -> alvo', (lusdt.tx as any).transfer({ gasLimit: g, storageDepositLimit: null }, TARGET, 50_000_000_000n, []), alice)
  // verifica
  const q = async (c: any, m: string, who: string) => { const { output } = await c.query[m](alice.address, { gasLimit: g }, who); const j: any = output?.toJSON(); let v = j; while (v && typeof v === 'object' && 'ok' in v) v = v.ok; return v }
  const wb = await q(wlunes, 'balanceOf', TARGET); const lb = await q(lusdt, 'balanceOf', TARGET)
  const nat = await api.query.system.account(TARGET) as any
  console.log('SALDOS DO ALVO:')
  console.log('  nativo LUNES:', (BigInt(nat.data.free.toString()) / 100_000_000n).toString())
  console.log('  WLUNES:', (BigInt(String(wb)) / 100_000_000n).toString())
  console.log('  LUSDT:', (BigInt(String(lb)) / 1_000_000n).toString())
  await api.disconnect(); process.exit(0)
}
main().catch(e => { console.error('FALHA:', e.message); process.exit(1) })
