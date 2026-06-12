import { ApiPromise, WsProvider } from '@polkadot/api'
import { ContractPromise } from '@polkadot/api-contract'
import { readFileSync } from 'fs'
import { join } from 'path'
const WS='ws://127.0.0.1:9944'
const TARGET='5DCZfzyZ7F2kthgmRdkCfFEpYcM5PG8kzs8aiGHrLonKzzei'
const ADDR=JSON.parse(readFileSync(join(__dirname,'../deployed-addresses.json'),'utf8'))
const abi=(n:string)=>JSON.parse(readFileSync(join(__dirname,`../../target/ink/${n}/${n}.json`),'utf8'))
async function main(){
  const api=await ApiPromise.create({provider:new WsProvider(WS)});await api.isReady
  const g=api.registry.createType('WeightV2',{refTime:5_000_000_000,proofSize:2_000_000})
  const w=new ContractPromise(api,abi('wnative_contract'),ADDR.wnative)
  const l=new ContractPromise(api,abi('psp22_token'),ADDR.lusdt)
  const q=async(c:any,who:string)=>{const{output}=await c.query.balanceOf(who,{gasLimit:g},who);let j:any=output?.toJSON();while(j&&typeof j==='object'&&'ok'in j)j=j.ok;return BigInt(String(j).replace(/,/g,''))}
  const wb=await q(w,TARGET);const lb=await q(l,TARGET)
  console.log('WLUNES:',(Number(wb)/1e8).toFixed(4))
  console.log('LUSDT :',(Number(lb)/1e6).toFixed(2))
  await api.disconnect();process.exit(0)
}
main().catch(e=>{console.error('ERR',e.message);process.exit(1)})
