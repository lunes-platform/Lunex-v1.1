import { ApiPromise, WsProvider, Keyring } from '@polkadot/api'
import { ContractPromise } from '@polkadot/api-contract'
import * as fs from 'fs'
import * as path from 'path'

async function main() {
  const api = await ApiPromise.create({ provider: new WsProvider('ws://127.0.0.1:9944') })
  const keyring = new Keyring({ type: 'sr25519' })
  const alice = keyring.addFromUri('//Alice')
  console.log('Alice:', alice.address)

  const PSP22_ABI = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', 'target/ink/psp22_token/psp22_token.json'), 'utf8')
  )

  const tokens: Record<string, string> = {
    LUSDT:  '5CdLQGeA89rffQrfckqB8cX3qQkMauszo7rqt5QaNYChsXsf',
    WLUNES: '5HRAv1VDeWkLnmkZAjgo6oigU5179nUDBgjKX4u5wztM7tTo',
    LBTC:   '5FvT73acgKALbPEqwAdah8pY28LL5EE4fNBzCgmgjTkmdsMg',
  }

  for (const [sym, addr] of Object.entries(tokens)) {
    try {
      const c = new ContractPromise(api as any, PSP22_ABI, addr)
      const gasLimit = api.registry.createType('WeightV2', { refTime: BigInt('10000000000'), proofSize: BigInt('100000') }) as any
      const res = await (c.query as any)['psp22::balanceOf'](alice.address, { gasLimit }, alice.address)
      console.log(`${sym} Alice balance:`, res.output?.toString() ?? 'null')
    } catch(e: any) {
      console.log(`${sym} error:`, e.message)
    }
  }

  await api.disconnect()
  process.exit(0)
}
main().catch(e => { console.error(e.message); process.exit(1) })
