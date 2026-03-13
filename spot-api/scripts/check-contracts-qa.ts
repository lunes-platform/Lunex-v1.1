import { ApiPromise, WsProvider } from '@polkadot/api'

const CONTRACTS: Record<string, string> = {
  wnative: '5HRAv1VDeWkLnmkZAjgo6oigU5179nUDBgjKX4u5wztM7tTo',
  factory: '5D7pe8YhnMpdBHnVobrPooomnM1ikgRJ4vDRyfcppFonCuK2',
  router:  '5GSR7WUo53S2UpqSW7sMccSYNeP2dmAakfUnoK9BCY3YMb2B',
  staking: '5DuuYUtUhgCsqfBFpGgxiqncU5JrsvDJDxQDmbSx8KWAXyqK',
  rewards: '5EiX7yUapZmL8LRSb2kbpmohig1rYqyG973ENR9mgdV7Ry6r',
  LUSDT:   '5CdLQGeA89rffQrfckqB8cX3qQkMauszo7rqt5QaNYChsXsf',
  LBTC:    '5FvT73acgKALbPEqwAdah8pY28LL5EE4fNBzCgmgjTkmdsMg',
  LETH:    '5DhVzePc99qpcmmm9yA8ZzSRPuLXp8dEc8nSZmQVyczHRGNS',
  GMC:     '5CfB22jZ43hkK5ZPhaaVk9wefMgTnERsawE8e9urdkMNEMRJ',
  LUP:     '5ELQTeXGvjijzJ7zUtTtLmm6rf44ogMnFBsT7tfYzDuzuvW3',
}

async function main() {
  const api = await ApiPromise.create({ provider: new WsProvider('ws://127.0.0.1:9944') })
  const block = await api.rpc.chain.getBlock()
  console.log(`Block: #${parseInt(block.block.header.number.toString())}`)
  for (const [name, addr] of Object.entries(CONTRACTS)) {
    const info = await (api.query.contracts as any).contractInfoOf(addr)
    const exists = !info.isEmpty
    console.log(`${exists ? '✅' : '❌'} ${name}: ${addr.slice(0, 12)}...`)
  }
  await api.disconnect()
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
