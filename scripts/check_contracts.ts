import { ApiPromise, WsProvider } from '@polkadot/api'

async function main() {
  const api = await ApiPromise.create({ provider: new WsProvider('ws://127.0.0.1:9944') })
  
  const addrs = [
    '5CdLQGeA89rffQrfckqB8cX3qQkMauszo7rqt5QaNYChsXsf', // LUSDT
    '5FvT73acgKALbPEqwAdah8pY28LL5EE4fNBzCgmgjTkmdsMg', // LBTC
    '5D7pe8YhnMpdBHnVobrPooomnM1ikgRJ4vDRyfcppFonCuK2', // factory
    '5GSR7WUo53S2UpqSW7sMccSYNeP2dmAakfUnoK9BCY3YMb2B', // router
  ]

  // Check if contract info exists
  for (const addr of addrs) {
    const info = await (api.query as any).contracts?.contractInfoOf?.(addr)
    const balance = await api.query.system.account(addr)
    console.log(addr.slice(0,8), '| balance:', (balance as any).data?.free?.toHuman(), '| contractInfo:', info?.isSome ? 'EXISTS' : 'EMPTY/GONE')
  }

  // Also check current block
  const header = await api.rpc.chain.getHeader()
  console.log('Current block:', header.number.toNumber())

  await api.disconnect(); process.exit(0)
}
main().catch(e => { console.error(e.message); process.exit(1) })
