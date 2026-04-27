import { ApiPromise, WsProvider } from '@polkadot/api'
import { readFileSync } from 'fs'
import { join } from 'path'

const ADDRESSES_FILE = join(__dirname, '../deployed-addresses.json')

function loadContracts(): Record<string, string> {
  const raw = JSON.parse(readFileSync(ADDRESSES_FILE, 'utf8')) as Record<string, unknown>
  return Object.fromEntries(
    Object.entries(raw).filter(([, value]) => typeof value === 'string' && value.startsWith('5')),
  ) as Record<string, string>
}

async function main() {
  const api = await ApiPromise.create({ provider: new WsProvider('ws://127.0.0.1:9944') })
  const block = await api.rpc.chain.getBlock()
  const contracts = loadContracts()
  let missing = 0

  console.log(`Block: #${parseInt(block.block.header.number.toString())}`)
  for (const [name, addr] of Object.entries(contracts)) {
    const info = await (api.query.contracts as any).contractInfoOf(addr)
    const exists = !info.isEmpty
    if (!exists) missing += 1
    console.log(`${exists ? '✅' : '❌'} ${name}: ${addr.slice(0, 12)}...`)
  }

  await api.disconnect()
  if (missing > 0) process.exit(1)
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
