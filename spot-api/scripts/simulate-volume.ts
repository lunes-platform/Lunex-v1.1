/**
 * Lunex DEX — Volume Simulation Script
 *
 * Simula atividade realista de trading:
 * - Múltiplos traders com keypairs reais do Substrate (//Alice, //Bob, //Charlie, //Dave, //Eve)
 * - Ordens LIMIT cruzadas que geram trades (market maker vs taker)
 * - Ordens MARKET que consomem liquidez
 * - Estatísticas de volume, spread e profundidade do orderbook
 */

import { Keyring } from '@polkadot/keyring'
import { cryptoWaitReady } from '@polkadot/util-crypto'

const API_BASE = 'http://localhost:4000/api/v1'

// ─── Utilitários ──────────────────────────────────────────────────────────────

function buildOrderMessage(params: {
  pairSymbol: string
  side: 'BUY' | 'SELL'
  type: 'LIMIT' | 'MARKET'
  price: string
  amount: string
  nonce: string
}): string {
  return `lunex-order:${params.pairSymbol}:${params.side}:${params.type}:${params.price}:0:${params.amount}:${params.nonce}`
}

async function get(path: string): Promise<any> {
  const r = await fetch(`${API_BASE}${path}`)
  return r.json() as Promise<any>
}

async function post(path: string, body: object): Promise<any> {
  const r = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await r.json() as any
  if (!r.ok) throw new Error(JSON.stringify(data))
  return data
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min
}

// ─── Core ─────────────────────────────────────────────────────────────────────

interface Trader {
  name: string
  address: string
  sign: (msg: string) => string
  nonce: number
  ordersPlaced: number
  tradesExecuted: number
  volumeBase: number
}

// Nonce base: timestamp em segundos para garantir unicidade entre runs
const NONCE_BASE = Math.floor(Date.now() / 1000)

async function createTrader(keyring: Keyring, seed: string, name: string, nonceOffset: number): Promise<Trader> {
  const pair = keyring.addFromUri(seed)
  return {
    name,
    address: pair.address,
    sign: (msg: string) => {
      const sig = pair.sign(msg)
      return Buffer.from(sig).toString('hex')
    },
    nonce: NONCE_BASE + nonceOffset,
    ordersPlaced: 0,
    tradesExecuted: 0,
    volumeBase: 0,
  }
}

async function placeOrder(
  trader: Trader,
  pairSymbol: string,
  side: 'BUY' | 'SELL',
  type: 'LIMIT' | 'MARKET',
  price: number,
  amount: number,
): Promise<{ id: string; matched: boolean } | null> {
  const nonce = String(trader.nonce++)
  const priceStr = type === 'MARKET' ? '0' : String(Math.round(price))
  const amountStr = String(Math.round(amount))

  const message = buildOrderMessage({
    pairSymbol,
    side,
    type,
    price: priceStr,
    amount: amountStr,
    nonce,
  })

  const signature = `0x${trader.sign(message)}`

  try {
    const result = await post('/orders', {
      pairSymbol,
      makerAddress: trader.address,
      side,
      type,
      price: priceStr,
      amount: amountStr,
      nonce,
      signature,
    })

    trader.ordersPlaced++
    const matched = result.order?.status === 'FILLED' || result.order?.status === 'PARTIAL'
    if (matched) trader.tradesExecuted++
    trader.volumeBase += amount / 1e8

    return { id: result.order?.id, matched }
  } catch (e: any) {
    // Ignora rate-limit (esperado em simulação intensa)
    if (!e.message?.includes('rate limit') && !e.message?.includes('Too many')) {
      console.error(`  ✗ ${trader.name} ${side} ${type} falhou: ${e.message?.slice(0, 80)}`)
    }
    return null
  }
}

async function printOrderbook(pairSymbol: string) {
  const data = await get(`/orderbook/${encodeURIComponent(pairSymbol)}`)
  const bids: any[] = data.bids?.slice(0, 5) || []
  const asks: any[] = data.asks?.slice(0, 5) || []

  console.log(`\n  📊 Orderbook ${pairSymbol}`)
  console.log(`  ASKS (venda):`)
  ;[...asks].reverse().forEach((a) =>
    console.log(`    ${Number(a.price).toLocaleString().padStart(12)} | ${Number(a.amount).toFixed(2)} LUNES`),
  )
  console.log(`  ──────────────────────────────`)
  bids.forEach((b) =>
    console.log(`    ${Number(b.price).toLocaleString().padStart(12)} | ${Number(b.amount).toFixed(2)} LUNES`),
  )
  console.log(`  BIDS (compra):`)

  if (bids.length > 0 && asks.length > 0) {
    const bestBid = Number(bids[0].price)
    const bestAsk = Number(asks[0].price)
    const spread = bestAsk - bestBid
    const spreadPct = (spread / bestBid) * 100
    console.log(`\n  Spread: ${spread.toFixed(0)} (${spreadPct.toFixed(2)}%)`)
  }
}

async function printStats(pair: string, traders: Trader[]) {
  const trades = await get(`/trades/${encodeURIComponent(pair)}?limit=100`)
  const tradeList: any[] = trades.trades || []
  const totalVol = tradeList.reduce((s: number, t: any) => s + Number(t.amount), 0)
  const totalQuote = tradeList.reduce((s: number, t: any) => s + Number(t.quoteAmount), 0)

  console.log(`\n${'═'.repeat(55)}`)
  console.log(`📈 RELATÓRIO FINAL — ${pair}`)
  console.log(`${'═'.repeat(55)}`)
  console.log(`  Trades executados:   ${tradeList.length}`)
  console.log(`  Volume base (LUNES): ${totalVol.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}`)
  console.log(`  Volume quote:        ${totalQuote.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}`)
  if (tradeList.length > 0) {
    const prices = tradeList.map((t: any) => Number(t.price))
    console.log(`  Preço mín:           ${Math.min(...prices).toLocaleString()}`)
    console.log(`  Preço máx:           ${Math.max(...prices).toLocaleString()}`)
    console.log(`  Último preço:        ${Number(tradeList[0].price).toLocaleString()}`)
  }
  console.log()
  console.log(`  Trader            Ordens  Trades  Vol(LUNES)`)
  console.log(`  ${'─'.repeat(48)}`)
  traders.forEach((t) =>
    console.log(
      `  ${t.name.padEnd(16)}  ${String(t.ordersPlaced).padStart(6)}  ${String(t.tradesExecuted).padStart(6)}  ${t.volumeBase.toFixed(4).padStart(10)}`,
    ),
  )
  console.log(`${'═'.repeat(55)}\n`)
}

// ─── Cenários de Simulação ────────────────────────────────────────────────────

async function scenarioMarketMaking(traders: Trader[], pairSymbol: string, midPrice: number, rounds: number) {
  console.log(`\n🏦 Fase 1: Market Making (${rounds} rounds, mid=${midPrice})`)

  const [alice, bob] = traders
  const spread = midPrice * 0.002 // 0.2% spread

  for (let i = 0; i < rounds; i++) {
    const jitter = randomBetween(-0.001, 0.001) * midPrice
    const bid = Math.round(midPrice - spread / 2 + jitter)
    const ask = Math.round(midPrice + spread / 2 + jitter)
    const size = Math.round(randomBetween(50_000_000, 500_000_000)) // 0.5–5 LUNES

    await placeOrder(alice, pairSymbol, 'BUY', 'LIMIT', bid, size)
    await placeOrder(bob, pairSymbol, 'SELL', 'LIMIT', ask, size)
    await sleep(80)
  }
  console.log(`  ✓ ${rounds * 2} ordens colocadas`)
}

async function scenarioMarketOrders(traders: Trader[], pairSymbol: string, midPrice: number, count: number) {
  console.log(`\n⚡ Fase 2: Market Orders — compradores e vendedores (${count} cada)`)

  const [, , charlie, dave] = traders
  const size = Math.round(randomBetween(100_000_000, 300_000_000))

  for (let i = 0; i < count; i++) {
    // Charlie é comprador agressivo
    await placeOrder(charlie, pairSymbol, 'BUY', 'LIMIT', Math.round(midPrice * 1.003), size)
    // Dave é vendedor agressivo
    await placeOrder(dave, pairSymbol, 'SELL', 'LIMIT', Math.round(midPrice * 0.997), size)
    await sleep(120)
  }
  console.log(`  ✓ ${count * 2} ordens market enviadas`)
}

async function scenarioWhale(traders: Trader[], pairSymbol: string, midPrice: number) {
  console.log(`\n🐋 Fase 3: Whale — ordem grande comprando ${pairSymbol}`)
  const [, , , , eve] = traders

  const whaleBuy = Math.round(midPrice * 1.005)
  const whaleSize = Math.round(2_000_000_000) // 20 LUNES

  const r = await placeOrder(eve, pairSymbol, 'BUY', 'LIMIT', whaleBuy, whaleSize)
  console.log(`  ✓ Whale order: ${r ? (r.matched ? 'MATCHED' : 'aberta no book') : 'falhou'}`)

  // Reação: outros vendem
  await sleep(200)
  const [, bob] = traders
  await placeOrder(bob, pairSymbol, 'SELL', 'LIMIT', Math.round(midPrice * 1.004), Math.round(1_000_000_000))
  await sleep(200)
}

async function scenarioPriceDiscovery(traders: Trader[], pairSymbol: string, startPrice: number, rounds: number) {
  console.log(`\n📉 Fase 4: Price Discovery — tendência de alta (${rounds} rounds)`)
  const [alice, bob, charlie] = traders
  let price = startPrice

  for (let i = 0; i < rounds; i++) {
    price = Math.round(price * (1 + randomBetween(0, 0.003)))
    const size = Math.round(randomBetween(50_000_000, 200_000_000))

    await placeOrder(alice, pairSymbol, 'BUY', 'LIMIT', price, size)
    await placeOrder(charlie, pairSymbol, 'SELL', 'LIMIT', Math.round(price * 1.001), size)
    await sleep(100)
  }

  console.log(`  ✓ Preço: ${startPrice.toLocaleString()} → ${price.toLocaleString()} (+${(((price - startPrice) / startPrice) * 100).toFixed(2)}%)`)
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  await cryptoWaitReady()
  const keyring = new Keyring({ type: 'sr25519' })

  console.log('🚀 Lunex DEX — Simulação de Volume')
  console.log(`${'═'.repeat(55)}`)

  // Cria traders com test accounts do Substrate
  const traders = await Promise.all([
    createTrader(keyring, '//Alice', 'Alice (MM)', 0),
    createTrader(keyring, '//Bob', 'Bob (MM)', 1000),
    createTrader(keyring, '//Charlie', 'Charlie (taker)', 2000),
    createTrader(keyring, '//Dave', 'Dave (taker)', 3000),
    createTrader(keyring, '//Eve', 'Eve (whale)', 4000),
  ])

  console.log('  Traders registrados:')
  traders.forEach((t) => console.log(`  • ${t.name}: ${t.address}`))

  // Verifica pares disponíveis
  const pairsData = await get('/pairs')
  const pairs: any[] = pairsData.pairs || []
  const lunesUsdt = pairs.find((p: any) => p.symbol === 'LUNES/USDT')
  const lunesBtc = pairs.find((p: any) => p.symbol === 'LUNES/BTC')

  if (!lunesUsdt) {
    console.error('❌ Par LUNES/USDT não encontrado. Execute: npm run db:seed')
    process.exit(1)
  }

  // ── Simulação LUNES/USDT ──────────────────────────────────────────
  const midUSDT = 5_000 // 0.00005 USDT/LUNES (price com 8 decimais → 5000 = 0.00005 USDT)
  console.log(`\n${'─'.repeat(55)}`)
  console.log(`🎯 Simulando: LUNES/USDT  (mid price: ${midUSDT})`)
  console.log(`${'─'.repeat(55)}`)

  await scenarioMarketMaking(traders, 'LUNES/USDT', midUSDT, 8)
  await sleep(300)
  await scenarioMarketOrders(traders, 'LUNES/USDT', midUSDT, 5)
  await sleep(300)
  await scenarioWhale(traders, 'LUNES/USDT', midUSDT)
  await sleep(300)
  await scenarioPriceDiscovery(traders, 'LUNES/USDT', midUSDT, 6)

  await printOrderbook('LUNES/USDT')
  await printStats('LUNES/USDT', traders)

  // ── Simulação LUNES/BTC ───────────────────────────────────────────
  if (lunesBtc) {
    const midBTC = 100 // preço com 8 decimais
    console.log(`${'─'.repeat(55)}`)
    console.log(`🎯 Simulando: LUNES/BTC  (mid price: ${midBTC})`)
    console.log(`${'─'.repeat(55)}`)

    // Resetar nonces não é necessário — cada conta tem sequência independente
    await scenarioMarketMaking(traders, 'LUNES/BTC', midBTC, 5)
    await sleep(300)
    await scenarioMarketOrders(traders, 'LUNES/BTC', midBTC, 3)
    await sleep(300)

    await printStats('LUNES/BTC', traders)
  }

  console.log('✅ Simulação concluída!\n')
}

main().catch((e) => {
  console.error('ERRO FATAL:', e)
  process.exit(1)
})
