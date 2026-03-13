/**
 * QA Phases 5, 8, 9, 11, 12
 * Spot Trading, CopyTrade, Agents, Social, Affiliates
 */
import { Keyring } from '@polkadot/keyring'
import { cryptoWaitReady } from '@polkadot/util-crypto'
import { u8aToHex } from '@polkadot/util'
import fetch from 'node-fetch'

const API = 'http://localhost:4000/api/v1'
const NONCE_BASE = Math.floor(Date.now() / 1000)

function ok(msg: string)   { console.log('  ✅', msg) }
function fail(msg: string) { console.log('  ❌', msg) }
function info(msg: string) { console.log('  ℹ️ ', msg) }
function warn(msg: string) { console.log('  ⚠️ ', msg) }
function section(t: string) { console.log(`\n${'─'.repeat(50)}\n${t}\n${'─'.repeat(50)}`) }

async function get(path: string) {
  const r = await fetch(`${API}${path}`)
  return { status: r.status, body: await r.json() as any }
}

async function post(path: string, body: any, token?: string) {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const r = await fetch(`${API}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  return { status: r.status, body: await r.json() as any }
}

async function signOrder(signer: any, params: {
  pairSymbol: string, side: string, type: string, price: number, amount: number, nonce: number
}) {
  const msg = `lunex-order:${params.pairSymbol}:${params.side}:${params.type}:${params.price}:0:${params.amount}:${params.nonce}`
  const sig = signer.sign(Buffer.from(msg))
  return {
    message: msg,
    signature: u8aToHex(sig),
    makerAddress: signer.address,
    price: String(params.price),
    amount: String(params.amount),
    nonce: String(params.nonce),
  }
}

async function main() {
  await cryptoWaitReady()
  const keyring = new Keyring({ type: 'sr25519' })
  const alice = keyring.addFromUri('//Alice')
  const bob   = keyring.addFromUri('//Bob')
  const charlie = keyring.addFromUri('//Charlie')
  const dave  = keyring.addFromUri('//Dave')

  // ── Phase 5: Spot Trading Engine ─────────────────────────────────────
  section('PHASE 5 — Spot Trading Engine')

  // 5.1 Check orderbook
  const ob = await get('/orderbook?symbol=LUNES/LUSDT')
  if (ob.status === 200) {
    ok(`Orderbook LUNES/LUSDT: ${ob.body.bids?.length ?? 0} bids, ${ob.body.asks?.length ?? 0} asks`)
  } else {
    fail(`Orderbook LUNES/LUSDT: HTTP ${ob.status}`)
  }

  // 5.2 Check pairs
  const pairs = await get('/pairs')
  if (pairs.status === 200 && pairs.body.pairs?.length > 0) {
    ok(`Active pairs: ${pairs.body.pairs.map((p: any) => p.symbol).join(', ')}`)
  } else {
    fail('No active pairs found')
  }

  // 5.3 Place LIMIT BUY (Alice)
  const buyNonce = NONCE_BASE + 1
  const buySig = await signOrder(alice, { pairSymbol: 'LUNES/LUSDT', side: 'BUY', type: 'LIMIT', price: 1.05, amount: 100, nonce: buyNonce })
  const buyRes = await post('/orders', { pairSymbol: 'LUNES/LUSDT', side: 'BUY', type: 'LIMIT', ...buySig })
  if (buyRes.status === 201 || buyRes.status === 200) {
    ok(`Alice BUY LIMIT 100 @ 1.05 placed (order id: ${buyRes.body.order?.id?.slice(0,8) ?? 'ok'})`)
  } else {
    fail(`Alice BUY LIMIT: HTTP ${buyRes.status} — ${JSON.stringify(buyRes.body).slice(0,100)}`)
  }

  // 5.4 Place LIMIT SELL (Bob) — should match Alice's BUY
  const sellNonce = NONCE_BASE + 2
  const sellSig = await signOrder(bob, { pairSymbol: 'LUNES/LUSDT', side: 'SELL', type: 'LIMIT', price: 1.00, amount: 50, nonce: sellNonce })
  const sellRes = await post('/orders', { pairSymbol: 'LUNES/LUSDT', side: 'SELL', type: 'LIMIT', ...sellSig })
  if (sellRes.status === 201 || sellRes.status === 200) {
    ok(`Bob SELL LIMIT 50 @ 1.00 placed/matched`)
  } else {
    fail(`Bob SELL LIMIT: HTTP ${sellRes.status} — ${JSON.stringify(sellRes.body).slice(0,100)}`)
  }

  // 5.5 Check trades created
  await new Promise(r => setTimeout(r, 500))
  const trades = await get('/trades?address=' + alice.address)
  const tradeCount = trades.body.trades?.length ?? 0
  if (tradeCount > 0) {
    ok(`Trades for Alice: ${tradeCount} (latest: ${trades.body.trades[0]?.quoteAmount ?? '?'} quote)`)
  } else {
    warn('No trades found for Alice — match may not have executed yet')
  }

  // 5.6 Place MARKET order (Charlie)
  const mktNonce = NONCE_BASE + 3
  const mktSig = await signOrder(charlie, { pairSymbol: 'LUNES/LUSDT', side: 'BUY', type: 'MARKET', price: 0, amount: 10, nonce: mktNonce })
  const mktRes = await post('/orders', { pairSymbol: 'LUNES/LUSDT', side: 'BUY', type: 'MARKET', ...mktSig })
  if (mktRes.status === 201 || mktRes.status === 200) {
    ok('Charlie MARKET BUY 10 placed')
  } else if (mktRes.status === 400 && mktRes.body?.error?.includes('No liquidity')) {
    warn('Charlie MARKET BUY: No liquidity — expected in thin orderbook')
  } else {
    fail(`Charlie MARKET BUY: HTTP ${mktRes.status} — ${JSON.stringify(mktRes.body).slice(0,100)}`)
  }

  // 5.7 Cancel order test
  const cancelNonce = NONCE_BASE + 4
  const cancelSig = await signOrder(dave, { pairSymbol: 'LUNES/LUSDT', side: 'BUY', type: 'LIMIT', price: 0.95, amount: 20, nonce: cancelNonce })
  const cancelOrderRes = await post('/orders', { pairSymbol: 'LUNES/LUSDT', side: 'BUY', type: 'LIMIT', ...cancelSig })
  if (cancelOrderRes.status === 201 || cancelOrderRes.status === 200) {
    const orderId = cancelOrderRes.body.order?.id
    if (orderId) {
      const cancelMsg = `lunex-cancel:${orderId}:${NONCE_BASE + 5}`
      const cancelSignature = dave.sign(Buffer.from(cancelMsg))
      const headers: any = { 'Content-Type': 'application/json' }
      const cancelResult = await fetch(`${API}/orders/${orderId}`, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ makerAddress: dave.address, signature: u8aToHex(cancelSignature) }),
      })
      const cancelBody = await cancelResult.json() as any
      if (cancelResult.status === 200) {
        ok(`Dave order ${orderId.slice(0,8)} cancelled successfully`)
      } else {
        warn(`Cancel: HTTP ${cancelResult.status} — ${JSON.stringify(cancelBody).slice(0,80)}`)
      }
    }
  }

  // 5.8 Check candles
  const candles = await get('/candles?symbol=LUNES/LUSDT&timeframe=1h&limit=5')
  if (candles.status === 200) {
    ok(`Candles LUNES/LUSDT 1h: ${candles.body.candles?.length ?? 0} returned`)
  } else {
    fail(`Candles: HTTP ${candles.status}`)
  }

  // ── Phase 8: Copy Trading ─────────────────────────────────────────────
  section('PHASE 8 — Copy Trading')

  // 8.1 List vaults
  const vaults = await get('/copytrade/vaults')
  if (vaults.status === 200) {
    const count = vaults.body.vaults?.length ?? 0
    ok(`CopyTrade vaults: ${count}`)
    if (count > 0) {
      const v = vaults.body.vaults[0]
      info(`  Top vault: ${v.name} | TVL=${v.totalValueLocked ?? v.totalEquity ?? 0} | shares=${v.totalShares ?? 0}`)
    }
  } else {
    fail(`CopyTrade vaults: HTTP ${vaults.status}`)
  }

  // 8.2 Recent copytrade activity
  const activity = await get('/copytrade/activity')
  if (activity.status === 200) {
    ok(`CopyTrade activity: ${activity.body.executions?.length ?? activity.body.activity?.length ?? 0} entries`)
  } else {
    warn(`CopyTrade activity: HTTP ${activity.status}`)
  }

  // 8.3 Get positions
  const positions = await get('/copytrade/positions?address=' + alice.address)
  if (positions.status === 200) {
    ok(`CopyTrade positions for Alice: ${positions.body.positions?.length ?? 0}`)
  } else {
    warn(`CopyTrade positions: HTTP ${positions.status} — ${JSON.stringify(positions.body).slice(0,80)}`)
  }

  // ── Phase 9: Agent Infrastructure ─────────────────────────────────────
  section('PHASE 9 — Agent Infrastructure')

  // 9.1 Register agent using verifyWalletActionSignature format
  // Message: lunex-auth:agents.register\naddress:<addr>\nagentType:<type>\nframework:<fw>\nnonce:<n>\ntimestamp:<ts>
  const ts9 = Date.now()
  const nonce9 = `qa-register-${ts9}`
  const agentFields = { agentType: 'AI_AGENT', framework: 'lunex-sdk', strategyDescription: 'QA test agent mean reversion' }
  const sortedFields = Object.entries(agentFields).sort(([a], [b]) => a.localeCompare(b))
  const regMsgLines = [
    `lunex-auth:agents.register`,
    `address:${alice.address}`,
    ...sortedFields.map(([k, v]) => `${k}:${v}`),
    `nonce:${nonce9}`,
    `timestamp:${ts9}`,
  ]
  const regMsg = regMsgLines.join('\n')
  const regSig = alice.sign(Buffer.from(regMsg))
  const agentRes = await post('/agents/register', {
    walletAddress: alice.address,
    agentType: 'AI_AGENT',
    framework: 'lunex-sdk',
    strategyDescription: 'QA test agent mean reversion',
    nonce: nonce9,
    timestamp: ts9,
    signature: u8aToHex(regSig),
  })
  let agentId: string | null = null
  if (agentRes.status === 201) {
    agentId = agentRes.body.agent?.id
    ok(`Agent registered: id=${agentId?.slice(0,8)}`)
  } else if (agentRes.status === 409) {
    ok('Agent already registered (idempotent)')
  } else {
    fail(`Agent register: HTTP ${agentRes.status} — ${JSON.stringify(agentRes.body).slice(0,120)}`)
  }

  // 9.2 Get agent profile by wallet address
  const agentByWallet = await get('/agents/by-wallet/' + alice.address)
  if (agentByWallet.status === 200 && agentByWallet.body.agent) {
    const a = agentByWallet.body.agent
    agentId = agentId ?? a.id
    ok(`Agent profile: type=${a.agentType}, tier=${a.stakingTier}, active=${a.isActive}, banned=${a.isBanned}`)
  } else {
    warn(`Agent by-wallet: HTTP ${agentByWallet.status}`)
  }

  // 9.3 Bootstrap API key (first key creation via wallet sig — no existing API key needed)
  if (agentId) {
    const ts9k = Date.now()
    const nonce9k = `qa-apikey-${ts9k}`
    const keyFields = { agentId, expiresInDays: '30', label: 'qa-test', permissions: 'TRADE_SPOT' }
    const sortedKeyFields = Object.entries(keyFields).sort(([a], [b]) => a.localeCompare(b))
    const keyMsgLines = [
      `lunex-auth:agents.create-api-key`,
      `address:${alice.address}`,
      ...sortedKeyFields.map(([k, v]) => `${k}:${v}`),
      `nonce:${nonce9k}`,
      `timestamp:${ts9k}`,
    ]
    const keyMsg = keyMsgLines.join('\n')
    const keySig = alice.sign(Buffer.from(keyMsg))
    const keyRes = await post(`/agents/${agentId}/api-keys`, {
      walletAddress: alice.address,
      permissions: ['TRADE_SPOT'],
      label: 'qa-test',
      expiresInDays: 30,
      nonce: nonce9k,
      timestamp: ts9k,
      signature: u8aToHex(keySig),
    })
    if (keyRes.status === 201 && keyRes.body.key) {
      ok(`API key issued: ${keyRes.body.key.slice(0,16)}...`)
    } else if (keyRes.status === 403 && keyRes.body?.error?.includes('Existing API keys')) {
      ok('Agent already has active API keys (idempotent)')
    } else {
      warn(`API key creation: HTTP ${keyRes.status} — ${JSON.stringify(keyRes.body).slice(0,100)}`)
    }
  } else {
    warn('Skipping API key test — no agentId available')
  }

  // ── Phase 11: Social Trading ──────────────────────────────────────────
  section('PHASE 11 — Social Trading')

  // 11.1 Stats
  const socialStats = await get('/social/stats')
  if (socialStats.status === 200) {
    const s = socialStats.body.stats ?? socialStats.body
    ok(`Social stats: traders=${s.activeTraaders ?? s.activeTraders ?? 0}, followers=${s.totalFollowers ?? 0}, AUM=${s.totalAum ?? s.aum ?? 0}`)
  } else {
    fail(`Social stats: HTTP ${socialStats.status}`)
  }

  // 11.2 Leaderboard
  const leaderboard = await get('/social/leaderboard')
  const leaders = leaderboard.body.leaderboard ?? leaderboard.body.leaders ?? []
  if (leaderboard.status === 200) {
    ok(`Leaderboard: ${leaders.length} leaders`)
    leaders.slice(0,3).forEach((l: any) => {
      info(`  ${l.name ?? l.username} | followers=${l.followers ?? l.followersCount ?? 0} | ROI=${l.roi30d ?? 0}%`)
    })
  } else {
    fail(`Leaderboard: HTTP ${leaderboard.status}`)
  }

  // 11.3 Upsert leader profile — POST /social/leaders/profile
  // Uses SignedWalletActionSchema: nonce (min 8), timestamp (int positive), signature
  const tsP = Date.now(), nonceP = `qa-profile-${tsP}`
  const profileFields = { avatar: '', bio: 'QA test profile', discordUrl: '', fee: '10', name: 'QA Trader Bob', telegramUrl: '', twitterUrl: '', username: 'qa_bob_2' }
  const sortedPF = Object.entries(profileFields).sort(([a],[b]) => a.localeCompare(b))
  const profileMsgLines = [
    'lunex-auth:social.upsert-profile',
    `address:${bob.address}`,
    ...sortedPF.map(([k,v]) => `${k}:${v}`),
    `nonce:${nonceP}`,
    `timestamp:${tsP}`,
  ]
  const profileMsg = profileMsgLines.join('\n')
  const profileSig = bob.sign(Buffer.from(profileMsg))
  const profileRes = await post('/social/leaders/profile', {
    address: bob.address,
    name: 'QA Trader Bob',
    username: 'qa_bob_2',
    bio: 'QA test profile',
    fee: 10,
    nonce: nonceP,
    timestamp: tsP,
    signature: u8aToHex(profileSig),
  })
  if (profileRes.status === 200 || profileRes.status === 201) {
    ok(`Bob leader profile upserted: id=${profileRes.body.leader?.id?.slice(0,8)}`)
  } else {
    warn(`Profile upsert: HTTP ${profileRes.status} — ${JSON.stringify(profileRes.body).slice(0,100)}`)
  }

  // Re-fetch leaderboard to get updated list including Bob
  const lb2 = await get('/social/leaderboard')
  const allLeaders = lb2.body.leaderboard ?? lb2.body.leaders ?? leaders

  // 11.4 Follow a leader
  if (allLeaders.length > 0) {
    const targetId = allLeaders[0].id
    const tsF = Date.now(), nonceF = `qa-follow-${tsF}`
    const followMsgLines = [
      'lunex-auth:social.follow-leader',
      `address:${alice.address}`,
      `leaderId:${targetId}`,
      `nonce:${nonceF}`,
      `timestamp:${tsF}`,
    ]
    const followMsg = followMsgLines.join('\n')
    const followSig = alice.sign(Buffer.from(followMsg))
    const followRes = await post(`/social/leaders/${targetId}/follow`, {
      address: alice.address,
      nonce: nonceF,
      timestamp: tsF,
      signature: u8aToHex(followSig),
    })
    if (followRes.status === 200) {
      ok(`Alice followed leader ${allLeaders[0].name} (already=${followRes.body.alreadyFollowing ?? false})`)
    } else {
      warn(`Follow leader: HTTP ${followRes.status} — ${JSON.stringify(followRes.body).slice(0,100)}`)
    }
  }

  // 11.5 Check ideas list (no POST /ideas route exists)
  const ideasRes = await get('/social/ideas')
  if (ideasRes.status === 200) {
    ok(`Social ideas: ${ideasRes.body.ideas?.length ?? 0} total`)
  } else {
    warn(`Social ideas: HTTP ${ideasRes.status}`)
  }

  // ── Phase 12: Affiliate System ─────────────────────────────────────────
  section('PHASE 12 — Affiliate System')

  // 12.1 Get referral code
  const codeRes = await get('/affiliate/code?address=' + alice.address)
  if (codeRes.status === 200) {
    ok(`Alice referral code: ${codeRes.body.code} → ${codeRes.body.link}`)

    // 12.2 Register referral (Bob referred by Alice)
    const refRes = await post('/affiliate/register', {
      refereeAddress: bob.address,
      referralCode: codeRes.body.code,
    })
    if (refRes.status === 201 || refRes.status === 200) {
      ok(`Bob registered under Alice's referral code`)
    } else if (refRes.status === 400 && refRes.body?.error?.includes('already has a referrer')) {
      ok('Bob already referred (idempotent)')
    } else {
      warn(`Referral register: HTTP ${refRes.status} — ${JSON.stringify(refRes.body).slice(0,80)}`)
    }

    // 12.3 Dashboard
    const dash = await get('/affiliate/dashboard?address=' + alice.address)
    if (dash.status === 200) {
      ok(`Alice affiliate dashboard: referrals=${dash.body.dashboard?.directReferrals ?? 0}, unpaid=${dash.body.dashboard?.totalUnpaid ?? 0}`)
    } else {
      fail(`Affiliate dashboard: HTTP ${dash.status}`)
    }
  } else {
    fail(`Referral code: HTTP ${codeRes.status}`)
  }

  // 12.4 Stats (new route)
  const statsRes = await get('/affiliate/stats')
  if (statsRes.status === 200) {
    ok(`Affiliate stats: referrals=${statsRes.body.stats?.totalReferrals ?? 0}, commissions=${statsRes.body.stats?.totalCommissions ?? 0}`)
  } else {
    fail(`Affiliate stats: HTTP ${statsRes.status}`)
  }

  // 12.5 Top affiliates (new route)
  const topRes = await get('/affiliate/top?limit=5')
  if (topRes.status === 200) {
    ok(`Affiliate top: ${topRes.body.top?.length ?? 0} affiliates`)
  } else {
    fail(`Affiliate top: HTTP ${topRes.status}`)
  }

  console.log('\n✅ Phases 5, 8, 9, 11, 12 complete.')
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1) })
