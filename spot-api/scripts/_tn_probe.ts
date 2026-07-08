import { ApiPromise, WsProvider, Keyring } from '@polkadot/api'
import * as fs from 'fs'; import * as path from 'path'
function envSeed(): string {
  try {
    const e = fs.readFileSync(path.resolve(__dirname,'..','.env'),'utf8')
    const m = e.match(/^RELAYER_SEED\s*=\s*"?([^"\n]+)"?/m); return m?m[1]:''
  } catch { return '' }
}
async function bal(api:ApiPromise,addr:string){const a:any=await api.query.system.account(addr);return a.data.free.toBigInt()}
async function main(){
  const api = await ApiPromise.create({ provider: new WsProvider('wss://ws-test.lunes.io') })
  await api.isReady
  const chain=(await api.rpc.system.chain()).toString()
  const ver=(await api.rpc.system.version()).toString()
  console.log('chain=',chain,'| version=',ver)
  console.log('has pallet-contracts?', !!api.tx.contracts, '| contractsApi?', !!api.call.contractsApi)
  const kr=new Keyring({type:'sr25519'})
  const seed=envSeed()
  if(seed){const d=kr.addFromUri(seed);console.log('RELAYER addr=',d.address,'| balance=',(await bal(api,d.address)).toString())}
  else console.log('no RELAYER_SEED in spot-api/.env')
  const alice=kr.addFromUri('//Alice')
  console.log('//Alice addr=',alice.address,'| balance=',(await bal(api,alice.address)).toString())
  await api.disconnect()
}
main().catch(e=>{console.error('ERR',String(e?.message??e));process.exit(1)})
