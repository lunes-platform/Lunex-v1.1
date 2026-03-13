import { ApiPromise, WsProvider, Keyring } from '@polkadot/api'
import { ContractPromise } from '@polkadot/api-contract'
import * as fs from 'fs'; import * as path from 'path'

async function main() {
  const api = await ApiPromise.create({ provider: new WsProvider('ws://127.0.0.1:9944') })
  const keyring = new Keyring({ type: 'sr25519' })
  const alice = keyring.addFromUri('//Alice')
  const PSP22_ABI = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'target/ink/psp22_token/psp22_token.json'), 'utf8'))
  const c = new ContractPromise(api as any, PSP22_ABI, '5CdLQGeA89rffQrfckqB8cX3qQkMauszo7rqt5QaNYChsXsf')
  const gl = api.registry.createType('WeightV2', { refTime: BigInt('10000000000'), proofSize: BigInt('100000') }) as any

  // Try total_supply first
  const ts = await c.query['totalSupply'](alice.address, { gasLimit: gl })
  console.log('totalSupply result:', JSON.stringify(ts.result?.toHuman()), 'output:', ts.output?.toJSON())

  // Try balance_of for alice
  const bal = await c.query['balanceOf'](alice.address, { gasLimit: gl }, alice.address)
  console.log('balanceOf alice:', JSON.stringify(bal.result?.toHuman()), 'output:', bal.output?.toJSON())

  await api.disconnect(); process.exit(0)
}
main().catch(e => { console.error(e.message); process.exit(1) })
