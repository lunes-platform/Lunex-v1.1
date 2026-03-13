/**
 * QA Phases 14-15: Security Tests + Data Consistency
 */
import { Keyring } from '@polkadot/keyring'
import { cryptoWaitReady } from '@polkadot/util-crypto'
import { u8aToHex } from '@polkadot/util'
import fetch from 'node-fetch'
import prisma from '../src/db'

const API = 'http://localhost:4000/api/v1'
const NONCE_BASE = Math.floor(Date.now() / 1000) + 9000

function ok(msg: string)   { console.log('  ✅', msg) }
function fail(msg: string) { console.log('  ❌', msg) }
function warn(msg: string) { console.log('  ⚠️ ', msg) }
function section(t: string) { console.log(`\n${'─'.repeat(50)}\n${t}\n${'─'.repeat(50)}`) }

async function post(path: string, body: any, token?: string) {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const r = await fetch(`${API}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  return { status: r.status, body: await r.json() as any }
}
async function del(path: string, body: any) {
  const r = await fetch(`${API}${path}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { status: r.status, body: await r.json() as any }
}

async function main() {
  await cryptoWaitReady()
  const keyring = new Keyring({ type: 'sr25519' })
  const alice = keyring.addFromUri('//Alice')
  const eve   = keyring.addFromUri('//Eve')

  // ── Phase 14: Security Tests ─────────────────────────────────────────
  section('PHASE 14 — Security Tests')

  // 14.1 Replay attack — same nonce twice
  const replayNonce = NONCE_BASE + 1
  const replayMsg = `lunex-order:LUNES/LUSDT:BUY:LIMIT:1.00:0:5:${replayNonce}`
  const replaySig = alice.sign(Buffer.from(replayMsg))
  const order1 = await post('/orders', {
    pairSymbol: 'LUNES/LUSDT', side: 'BUY', type: 'LIMIT',
    makerAddress: alice.address, price: '1.00', amount: '5', nonce: String(replayNonce),
    message: replayMsg, signature: u8aToHex(replaySig),
  })
  const order2 = await post('/orders', {
    pairSymbol: 'LUNES/LUSDT', side: 'BUY', type: 'LIMIT',
    makerAddress: alice.address, price: '1.00', amount: '5', nonce: String(replayNonce),
    message: replayMsg, signature: u8aToHex(replaySig),
  })
  if (order1.status === 201 && (order2.status === 400 || order2.status === 409)) {
    ok(`Replay attack blocked: first=201, replay=${order2.status} — "${order2.body?.error}"`)
  } else {
    fail(`Replay attack NOT blocked: first=${order1.status}, replay=${order2.status}`)
  }

  // 14.2 Invalid signature
  const badSig = '0x' + 'de'.repeat(64)
  const invRes = await post('/orders', {
    pairSymbol: 'LUNES/LUSDT', side: 'BUY', type: 'LIMIT',
    makerAddress: alice.address, price: '1.00', amount: '5', nonce: String(NONCE_BASE + 2),
    message: `lunex-order:LUNES/LUSDT:BUY:LIMIT:1.00:0:5:${NONCE_BASE + 2}`,
    signature: badSig,
  })
  if (invRes.status === 401 || invRes.status === 400) {
    ok(`Invalid signature rejected: HTTP ${invRes.status}`)
  } else {
    fail(`Invalid signature accepted: HTTP ${invRes.status}`)
  }

  // 14.3 Wrong signer (Eve signs for Alice)
  const mismatchNonce = NONCE_BASE + 3
  const mismatchMsg = `lunex-order:LUNES/LUSDT:BUY:LIMIT:1.00:0:5:${mismatchNonce}`
  const eveSig = eve.sign(Buffer.from(mismatchMsg))
  const mismatchRes = await post('/orders', {
    pairSymbol: 'LUNES/LUSDT', side: 'BUY', type: 'LIMIT',
    makerAddress: alice.address, price: '1.00', amount: '5', nonce: String(mismatchNonce),
    message: mismatchMsg, signature: u8aToHex(eveSig),
  })
  if (mismatchRes.status === 401) {
    ok(`Cross-signer attack rejected: HTTP 401 (Eve cannot sign for Alice)`)
  } else {
    fail(`Cross-signer attack NOT rejected: HTTP ${mismatchRes.status} — ${JSON.stringify(mismatchRes.body).slice(0,80)}`)
  }

  // 14.4 Cancel order owned by different user
  // Alice places an order, then Eve tries to cancel it
  const ownNonce = NONCE_BASE + 4
  const ownMsg = `lunex-order:LUNES/LUSDT:BUY:LIMIT:0.90:0:15:${ownNonce}`
  const ownSig = alice.sign(Buffer.from(ownMsg))
  const ownOrder = await post('/orders', {
    pairSymbol: 'LUNES/LUSDT', side: 'BUY', type: 'LIMIT',
    makerAddress: alice.address, price: '0.90', amount: '15', nonce: String(ownNonce),
    message: ownMsg, signature: u8aToHex(ownSig),
  })
  if (ownOrder.status === 201) {
    const orderId = ownOrder.body.order?.id
    if (orderId) {
      const eveCancelSig = eve.sign(Buffer.from(`lunex-cancel:${orderId}`))
      const eveCancel = await del(`/orders/${orderId}`, {
        makerAddress: eve.address, signature: u8aToHex(eveCancelSig),
      })
      if (eveCancel.status === 401 || eveCancel.status === 403) {
        ok(`Cross-user cancel blocked: HTTP ${eveCancel.status}`)
      } else {
        fail(`Cross-user cancel NOT blocked: HTTP ${eveCancel.status}`)
      }
    }
  }

  // 14.5 Admin endpoint without auth returns 401
  const adminRes = await post('/pairs/register', { symbol: 'TEST/LUSDT', baseName: 'TEST', quoteName: 'LUSDT', baseDecimals: 8, quoteDecimals: 6 })
  if (adminRes.status === 401) {
    ok(`Admin endpoint /pairs/register returns 401 without Bearer token`)
  } else {
    fail(`Admin endpoint /pairs/register returns ${adminRes.status} — expected 401`)
  }

  // 14.6 SQL injection attempt in symbol
  const sqlRes = await fetch(`${API}/orderbook?symbol=LUNES' OR '1'='1`)
  if (sqlRes.status === 400 || sqlRes.status === 200) {
    const body = await sqlRes.json() as any
    if (body.error || (body.bids && body.asks)) {
      ok(`SQL injection in symbol: safely handled (${sqlRes.status}) — no DB error`)
    } else {
      warn(`SQL injection: unusual response ${sqlRes.status}`)
    }
  }

  // 14.7 XSS payload in order fields
  const xssNonce = NONCE_BASE + 7
  const xssMsg = `lunex-order:<script>alert(1)</script>/LUSDT:BUY:LIMIT:1.00:0:1:${xssNonce}`
  const xssSig = alice.sign(Buffer.from(xssMsg))
  const xssRes = await post('/orders', {
    pairSymbol: '<script>alert(1)</script>/LUSDT', side: 'BUY', type: 'LIMIT',
    makerAddress: alice.address, price: '1.00', amount: '1', nonce: String(xssNonce),
    message: xssMsg, signature: u8aToHex(xssSig),
  })
  if (xssRes.status === 400 || xssRes.status === 422) {
    ok(`XSS payload in pairSymbol rejected: HTTP ${xssRes.status}`)
  } else if (xssRes.status === 401) {
    ok(`XSS payload rejected at sig validation: HTTP 401 (pair not found → sig invalid)`)
  } else {
    warn(`XSS payload: HTTP ${xssRes.status} — check if <script> is stored unescaped`)
  }

  // 14.8 Negative amount
  const negNonce = NONCE_BASE + 8
  const negMsg = `lunex-order:LUNES/LUSDT:BUY:LIMIT:1.00:0:-100:${negNonce}`
  const negSig = alice.sign(Buffer.from(negMsg))
  const negRes = await post('/orders', {
    pairSymbol: 'LUNES/LUSDT', side: 'BUY', type: 'LIMIT',
    makerAddress: alice.address, price: '1.00', amount: '-100', nonce: String(negNonce),
    message: negMsg, signature: u8aToHex(negSig),
  })
  if (negRes.status === 400) {
    ok(`Negative amount rejected: HTTP 400`)
  } else {
    fail(`Negative amount NOT rejected: HTTP ${negRes.status}`)
  }

  // ── Phase 15: Data Consistency ─────────────────────────────────────────
  section('PHASE 15 — Data Consistency')

  // 15.1 Order count vs trades
  const [orderCount, tradeCount, openOrderCount] = await Promise.all([
    prisma.order.count(),
    prisma.trade.count(),
    prisma.order.count({ where: { status: 'OPEN' } }),
  ])
  ok(`Orders: ${orderCount} total, ${openOrderCount} open | Trades: ${tradeCount}`)

  // 15.2 Check for orphaned trades (no matching order)
  const orphanedTrades = await prisma.$queryRaw<{count: bigint}[]>`
    SELECT COUNT(*) as count FROM "Trade" t
    WHERE NOT EXISTS (SELECT 1 FROM "Order" o WHERE o.id = t."makerOrderId")
    AND t."makerOrderId" IS NOT NULL
  `
  const orphaned = Number(orphanedTrades[0]?.count ?? 0)
  if (orphaned === 0) {
    ok('No orphaned trades (all trades have matching maker orders)')
  } else {
    fail(`${orphaned} orphaned trades (missing makerOrderId reference)`)
  }

  // 15.3 Check partial fill consistency
  const inconsistentOrders = await prisma.$queryRaw<{count: bigint}[]>`
    SELECT COUNT(*) as count FROM "Order"
    WHERE "filledAmount" > amount
  `
  const inconsistent = Number(inconsistentOrders[0]?.count ?? 0)
  if (inconsistent === 0) {
    ok('No over-filled orders (filledAmount ≤ amount for all)')
  } else {
    fail(`${inconsistent} orders have filledAmount > amount (data corruption)`)
  }

  // 15.4 Leader follower count vs actual follows
  const leaders = await prisma.leader.findMany({ select: { id: true, name: true, followersCount: true } })
  const realCounts = await prisma.leaderFollow.groupBy({
    by: ['leaderId'],
    _count: { id: true },
  })
  const realMap = new Map(realCounts.map(r => [r.leaderId, r._count.id]))
  let staleFollowers = 0
  for (const l of leaders) {
    const real = realMap.get(l.id) ?? 0
    if (l.followersCount !== real) {
      staleFollowers++
      warn(`Leader "${l.name}": followersCount=${l.followersCount} but actual follows=${real} (stale cache)`)
    }
  }
  if (staleFollowers === 0) {
    ok(`Leader followersCount consistent for all ${leaders.length} leaders`)
  } else {
    fail(`${staleFollowers} leaders have stale followersCount`)
  }

  // 15.5 Margin positions consistency
  const [openPos, marginAccounts] = await Promise.all([
    prisma.marginPosition.count({ where: { status: 'OPEN' } }),
    prisma.marginAccount.count(),
  ])
  ok(`Margin: ${openPos} open positions, ${marginAccounts} accounts`)

  // 15.6 Pair count DB vs backend
  const [dbPairs, activePairs] = await Promise.all([
    prisma.pair.count(),
    prisma.pair.count({ where: { isActive: true } }),
  ])
  const apiPairsRes = await fetch(`${API}/pairs`)
  const apiPairsBody = await apiPairsRes.json() as any
  const apiCount = apiPairsBody.pairs?.length ?? 0
  if (apiCount === activePairs) {
    ok(`Pair counts consistent: DB active=${activePairs}, API=${apiCount} (total=${dbPairs})`)
  } else {
    fail(`Pair count mismatch: DB active=${activePairs} vs API=${apiCount}`)
  }

  // 15.7 Candle data freshness
  const lulesPair = await prisma.pair.findFirst({ where: { symbol: 'LUNES/LUSDT' } })
  const latestCandle = lulesPair ? await prisma.candle.findFirst({
    where: { pairId: lulesPair.id, timeframe: '1h' },
    orderBy: { openTime: 'desc' },
  }) : null
  if (latestCandle) {
    const ageMin = Math.round((Date.now() - latestCandle.openTime.getTime()) / 60000)
    if (ageMin < 120) {
      ok(`LUNES/LUSDT 1h candle fresh: ${ageMin} min old, close=${latestCandle.close}`)
    } else {
      warn(`LUNES/LUSDT 1h candle stale: ${ageMin} min old`)
    }
  } else {
    warn('No candles found for LUNES/LUSDT 1h')
  }

  // 15.8 Trade fees consistency (maker + taker fees should both be present)
  const tradesWithFees = await prisma.trade.findMany({ take: 5, orderBy: { createdAt: 'desc' } })
  let feeMismatches = 0
  for (const t of tradesWithFees) {
    if (t.makerFee === null || t.takerFee === null) feeMismatches++
  }
  if (feeMismatches === 0) {
    ok(`All recent trades have both makerFee and takerFee set`)
  } else {
    warn(`${feeMismatches}/${tradesWithFees.length} recent trades missing fee fields`)
  }

  // 15.9 Settlement status
  const settledTrades = await prisma.trade.count({ where: { settlementStatus: 'SETTLED' } })
  const pendingTrades = await prisma.trade.count({ where: { settlementStatus: 'PENDING' } })
  const skippedTrades = await prisma.trade.count({ where: { settlementStatus: 'SKIPPED' } })
  ok(`Settlement: SETTLED=${settledTrades}, PENDING=${pendingTrades}, SKIPPED=${skippedTrades}`)
  if (skippedTrades > 0) {
    warn(`${skippedTrades} trades SKIPPED settlement (SPOT_CONTRACT_ADDRESS not configured)`)
  }

  await prisma.$disconnect()
  console.log('\n✅ Phases 14, 15 complete.')
}

main().catch(async e => {
  console.error('FATAL:', e.message)
  await prisma.$disconnect()
  process.exit(1)
})
