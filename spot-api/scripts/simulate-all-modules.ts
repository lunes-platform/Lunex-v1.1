/**
 * Lunex DEX — Simulação Completa Multi-Módulo
 *
 * Módulos cobertos:
 * 1. Candles / OHLCV
 * 2. Margin Trading (collateral, long, short, close, liquidação)
 * 3. Social (perfis, follows, leaderboard)
 * 4. Copy Trading (vaults, sinais, seguidores)
 * 5. Affiliates (referrals, dashboard, payouts)
 * 6. Stress Test (alta frequência)
 */

import { Keyring } from '@polkadot/keyring'
import { cryptoWaitReady } from '@polkadot/util-crypto'

const API = 'http://localhost:4000/api/v1'
const NONCE_BASE = Math.floor(Date.now() / 1000)

// ─── HTTP Helpers ─────────────────────────────────────────────────────────────

async function get(path: string): Promise<any> {
  const r = await fetch(`${API}${path}`)
  if (!r.ok) {
    const text = await r.text()
    throw new Error(`GET ${path} → ${r.status}: ${text.slice(0, 120)}`)
  }
  return r.json() as Promise<any>
}

async function post(path: string, body: object): Promise<any> {
  const r = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await r.json()) as any
  if (!r.ok) throw new Error(`POST ${path} → ${r.status}: ${JSON.stringify(data).slice(0, 200)}`)
  return data
}

async function del(path: string, body?: object): Promise<any> {
  const r = await fetch(`${API}${path}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = (await r.json()) as any
  if (!r.ok) throw new Error(`DELETE ${path} → ${r.status}: ${JSON.stringify(data).slice(0, 120)}`)
  return data
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function section(title: string) {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  ${title}`)
  console.log(`${'═'.repeat(60)}`)
}

function ok(msg: string) { console.log(`  ✅ ${msg}`) }
function fail(msg: string) { console.log(`  ❌ ${msg}`) }
function info(msg: string) { console.log(`  ℹ  ${msg}`) }

// ─── Trader Setup ─────────────────────────────────────────────────────────────

interface Account {
  name: string
  address: string
  sign: (msg: string) => string
  nonce: number
}

function createAccount(keyring: Keyring, seed: string, name: string, nonceOffset = 0): Account {
  const pair = keyring.addFromUri(seed)
  return {
    name,
    address: pair.address,
    sign: (msg: string) => `0x${Buffer.from(pair.sign(msg)).toString('hex')}`,
    nonce: NONCE_BASE + nonceOffset,
  }
}

function buildWalletActionMessage(input: {
  action: string
  address: string
  nonce: string
  timestamp: number
  fields?: Record<string, string | number | boolean | Array<string | number> | undefined | null>
}) {
  const lines = [
    `lunex-auth:${input.action}`,
    `address:${input.address}`,
  ]

  const orderedFields = Object.entries(input.fields ?? {})
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([left], [right]) => left.localeCompare(right))

  for (const [key, value] of orderedFields) {
    lines.push(`${key}:${Array.isArray(value) ? value.join(',') : String(value)}`)
  }

  lines.push(`nonce:${input.nonce}`)
  lines.push(`timestamp:${input.timestamp}`)
  return lines.join('\n')
}

function createSignedAction(account: Account, input: {
  action: string
  address: string
  fields?: Record<string, string | number | boolean | Array<string | number> | undefined | null>
}) {
  const nonce = String(account.nonce++)
  const timestamp = Date.now()
  const message = buildWalletActionMessage({
    action: input.action,
    address: input.address,
    nonce,
    timestamp,
    fields: input.fields,
  })

  return {
    nonce,
    timestamp,
    signature: account.sign(message),
  }
}

// ─── Order helpers (reutiliza lógica do simulate-volume) ──────────────────────

async function placeOrder(
  acc: Account,
  pairSymbol: string,
  side: 'BUY' | 'SELL',
  price: number,
  amount: number,
): Promise<any | null> {
  const nonce = String(acc.nonce++)
  const priceStr = String(Math.round(price))
  const amountStr = String(Math.round(amount))
  const message = `lunex-order:${pairSymbol}:${side}:LIMIT:${priceStr}:0:${amountStr}:${nonce}`

  try {
    return await post('/orders', {
      pairSymbol, makerAddress: acc.address, side, type: 'LIMIT',
      price: priceStr, amount: amountStr, nonce, signature: acc.sign(message),
    })
  } catch {
    return null
  }
}

// ═══════════════════════════════════════════════════════
// MÓDULO 1: CANDLES / OHLCV
// ═══════════════════════════════════════════════════════

async function simulateCandles() {
  section('MÓDULO 1: Candles / OHLCV')

  const timeframes = ['1m', '5m', '15m', '1h', '4h', '1d']

  for (const tf of timeframes) {
    try {
      const data = await get(`/candles/LUNES%2FUSDT?timeframe=${tf}&limit=5`)
      const candles = data.candles || []
      if (candles.length > 0) {
        const c = candles[0]
        ok(`${tf.padEnd(4)} | O:${c.open} H:${c.high} L:${c.low} C:${c.close} V:${Number(c.volume).toLocaleString()} (${c.tradeCount} trades)`)
      } else {
        info(`${tf.padEnd(4)} | sem dados ainda`)
      }
    } catch (e: any) {
      fail(`${tf}: ${e.message.slice(0, 60)}`)
    }
  }

  // Candles de outros pares
  for (const pair of ['LUNES/BTC', 'LUNES/ETH']) {
    try {
      const data = await get(`/candles/${encodeURIComponent(pair)}?timeframe=1h&limit=1`)
      const candles = data.candles || []
      if (candles.length > 0) {
        const c = candles[0]
        ok(`${pair} 1h | O:${c.open} H:${c.high} L:${c.low} C:${c.close} (${c.tradeCount} trades)`)
      } else {
        info(`${pair} 1h | sem dados`)
      }
    } catch (e: any) {
      fail(`${pair}: ${e.message.slice(0, 60)}`)
    }
  }
}

// ═══════════════════════════════════════════════════════
// MÓDULO 2: MARGIN TRADING
// ═══════════════════════════════════════════════════════

async function simulateMargin(accounts: Account[]) {
  section('MÓDULO 2: Margin Trading')

  const [alice, bob, charlie, dave] = accounts
  const positions: string[] = []

  // 2.0 — Gerar volume fresco para mark price < 120s
  console.log('\n  🔄 2.0 Atualizando mark price com trades frescos')
  for (let i = 0; i < 4; i++) {
    await placeOrder(alice, 'LUNES/USDT', 'BUY',  5030 + i * 5, 80_000_000)
    await placeOrder(bob,   'LUNES/USDT', 'SELL', 5025 + i * 5, 80_000_000)
    await sleep(80)
  }
  await sleep(500) // aguarda DB persistir
  ok('Mark price atualizado')

  // 2.1 — Depositar collateral
  console.log('\n  📥 2.1 Depósito de Collateral')
  for (const [acc, amount] of [[alice, '10000'], [bob, '5000'], [charlie, '2000']] as const) {
    const signedAction = createSignedAction(acc, {
      action: 'margin.collateral.deposit',
      address: acc.address,
      fields: {
        token: 'USDT',
        amount,
      },
    })
    try {
      const result = await post('/margin/collateral/deposit', {
        address: acc.address, token: 'USDT', amount, ...signedAction,
      })
      ok(`${acc.name} depositou ${amount} USDT | saldo: ${result.available ?? '?'}`)
    } catch (e: any) {
      if (e.message.includes('already')) info(`${acc.name} collateral já depositado`)
      else fail(`${acc.name} deposit: ${e.message.slice(0, 80)}`)
    }
  }

  await sleep(200)

  // 2.2 — Abrir posições LONG e SHORT
  console.log('\n  📈 2.2 Abrindo Posições')
  const positionConfigs = [
    { acc: alice, side: 'BUY' as const,  collateral: '2000', leverage: '5', label: 'LONG 5x'  },
    { acc: bob,   side: 'SELL' as const, collateral: '1000', leverage: '3', label: 'SHORT 3x' },
    { acc: charlie, side: 'BUY' as const, collateral: '500', leverage: '7', label: 'LONG 7x'  },
  ]

  for (const { acc, side, collateral, leverage, label } of positionConfigs) {
    const signedAction = createSignedAction(acc, {
      action: 'margin.position.open',
      address: acc.address,
      fields: {
        pairSymbol: 'LUNES/USDT',
        side,
        collateralAmount: collateral,
        leverage,
      },
    })
    try {
      const result = await post('/margin/positions', {
        address: acc.address, pairSymbol: 'LUNES/USDT',
        side, collateralAmount: collateral, leverage, ...signedAction,
      })
      const pos = result.position
      if (pos?.id) {
        positions.push(pos.id)
        ok(`${acc.name} ${label} | entrada: ${pos.entryPrice} | liquidação: ${pos.liquidationPrice} | size: ${pos.quantity}`)
      }
    } catch (e: any) {
      fail(`${acc.name} open ${label}: ${e.message.slice(0, 100)}`)
    }
    await sleep(150)
  }

  // 2.3 — Overview de posições abertas
  console.log('\n  📊 2.3 Overview de Posições')
  for (const acc of [alice, bob, charlie]) {
    try {
      const overview = await get(`/margin?address=${acc.address}`)
      const openPos = (overview.positions || []).filter((p: any) => p.status === 'OPEN')
      if (openPos.length > 0) {
        const p = openPos[0]
        const pnl = p.unrealizedPnl ? `PnL: ${Number(p.unrealizedPnl).toFixed(4)}` : 'PnL: N/A'
        ok(`${acc.name} | ${openPos.length} pos abertas | ${pnl} | mark: ${p.markPrice ?? '?'}`)
      } else {
        info(`${acc.name} | nenhuma posição aberta`)
      }
    } catch (e: any) {
      fail(`${acc.name} overview: ${e.message.slice(0, 80)}`)
    }
  }

  // 2.4 — Gerar mais volume para atualizar mark price e fechar posições
  console.log('\n  🔄 2.4 Gerando volume para atualizar mark price')
  for (let i = 0; i < 3; i++) {
    await placeOrder(alice, 'LUNES/USDT', 'BUY',  5040 + i * 5, 100_000_000)
    await placeOrder(bob,   'LUNES/USDT', 'SELL', 5035 + i * 5, 100_000_000)
    await sleep(100)
  }
  ok('6 ordens geradas para atualização de preço')

  // 2.5 — Fechar posições
  console.log('\n  📤 2.5 Fechando Posições')
  const openPositions: any[] = []
  for (const acc of [alice, bob, charlie]) {
    try {
      const overview = await get(`/margin?address=${acc.address}`)
      const open = (overview.positions || []).filter((p: any) => p.status === 'OPEN')
      for (const pos of open) {
        openPositions.push({ acc, pos })
      }
    } catch {}
  }

  for (const { acc, pos } of openPositions.slice(0, 2)) {
    const signedAction = createSignedAction(acc, {
      action: 'margin.position.close',
      address: acc.address,
      fields: {
        positionId: pos.id,
      },
    })
    try {
      const result = await post(`/margin/positions/${pos.id}/close`, {
        address: acc.address, ...signedAction,
      })
      const closed = result.position
      const pnl = closed?.realizedPnl ? Number(closed.realizedPnl).toFixed(4) : '?'
      ok(`${acc.name} fechou pos | PnL realizado: ${pnl}`)
    } catch (e: any) {
      fail(`${acc.name} close: ${e.message.slice(0, 100)}`)
    }
    await sleep(150)
  }

  // 2.6 — Price Health
  console.log('\n  💊 2.6 Price Health Monitor')
  try {
    const health = await get('/margin/price-health')
    const pairs = health.pairs || []
    ok(`Pairs rastreados: ${pairs.length}`)
    pairs.forEach((p: any) => info(`  ${p.pairSymbol} | status: ${p.status} | healthy: ${p.status === 'HEALTHY'} | source: ${p.lastResolvedSource ?? '?'} | price: ${p.lastResolvedPrice ?? '?'}`))
  } catch (e: any) {
    fail(`price-health: ${e.message.slice(0, 80)}`)
  }
}

// ═══════════════════════════════════════════════════════
// MÓDULO 3: SOCIAL
// ═══════════════════════════════════════════════════════

async function simulateSocial(accounts: Account[]) {
  section('MÓDULO 3: Social — Perfis & Leaderboard')

  const [alice, bob, charlie, dave] = accounts
  const leaderIds: string[] = []

  // 3.1 — Criar perfis de líderes
  console.log('\n  👤 3.1 Criando Perfis de Líderes')
  const profiles = [
    { acc: alice,   name: 'Alice DeFi',  username: 'alice_defi',   bio: 'Market maker profissional na Lunes DEX. Especialista em AMM e liquidez.', fee: 10 },
    { acc: bob,     name: 'Bob Scalper', username: 'bob_scalper',  bio: 'Scalping e trading de alta frequência. ROI consistente há 2 anos.',         fee: 15 },
    { acc: charlie, name: 'Charlie HODLer', username: 'charlie_h', bio: 'Estratégias de longo prazo. Foco em LUNES e tokens nativos.',               fee: 8  },
  ]

  for (const { acc, name, username, bio, fee } of profiles) {
    try {
      const result = await post('/social/leaders/profile', {
        address: acc.address, name, username, bio, fee,
      })
      const leader = result.leader || result
      if (leader?.id) {
        leaderIds.push(leader.id)
        ok(`${acc.name} → @${username} (fee ${fee}%) | id: ${leader.id.slice(0, 8)}...`)
      } else {
        ok(`${acc.name} → @${username} criado`)
      }
    } catch (e: any) {
      // Pode já existir
      if (e.message.includes('already') || e.message.includes('409') || e.message.includes('Unique')) {
        info(`${acc.name} → perfil já existe`)
        // Buscar ID existente
        try {
          const found = await get(`/social/leaders/by-address?address=${acc.address}`)
          if (found?.leader?.id) leaderIds.push(found.leader.id)
        } catch {}
      } else {
        fail(`${acc.name} profile: ${e.message.slice(0, 80)}`)
      }
    }
    await sleep(100)
  }

  // 3.2 — Follow leaders
  console.log('\n  👥 3.2 Seguindo Líderes')
  if (leaderIds.length > 0) {
    for (const leaderId of leaderIds.slice(0, 2)) {
      try {
        await post(`/social/leaders/${leaderId}/follow`, { address: dave.address })
        ok(`${dave.name} seguiu líder ${leaderId.slice(0, 8)}...`)
      } catch (e: any) {
        if (e.message.includes('already') || e.message.includes('duplicate')) {
          info(`${dave.name} já segue este líder`)
        } else {
          fail(`follow: ${e.message.slice(0, 80)}`)
        }
      }
      await sleep(100)
    }
  }

  // 3.3 — Leaderboard
  console.log('\n  🏆 3.3 Leaderboard')
  try {
    const data = await get('/social/leaderboard?limit=5')
    const leaders = data.leaderboard || data.leaders || []
    if (leaders.length > 0) {
      leaders.forEach((l: any) =>
        ok(`@${l.username || l.name} | followers: ${l.followers ?? l.followerCount ?? 0} | ROI30d: ${l.roi30d ?? 'N/A'}%`)
      )
    } else {
      info('Leaderboard vazio (dados de performance ainda não calculados)')
    }
  } catch (e: any) {
    fail(`leaderboard: ${e.message.slice(0, 80)}`)
  }

  // 3.4 — Stats globais
  console.log('\n  📊 3.4 Stats Globais')
  try {
    const res = await get('/social/stats')
    const stats = res.stats || res
    ok(`Traders ativos: ${stats.activeTraders ?? stats.totalLeaders ?? 0} | Total followers: ${stats.totalFollowers ?? 0} | AUM: ${stats.totalAum ?? 0}`)
  } catch (e: any) {
    fail(`stats: ${e.message.slice(0, 80)}`)
  }

  return leaderIds
}

// ═══════════════════════════════════════════════════════
// MÓDULO 4: COPY TRADING
// ═══════════════════════════════════════════════════════

async function simulateCopytrade(accounts: Account[], leaderIds: string[]) {
  section('MÓDULO 4: Copy Trading — Vaults & Sinais')

  const [alice, bob, charlie, dave] = accounts

  // 4.1 — Listar vaults existentes
  console.log('\n  💼 4.1 Vaults Disponíveis')
  try {
    const data = await get('/copytrade/vaults')
    const vaults = data.vaults || data || []
    if (Array.isArray(vaults) && vaults.length > 0) {
      vaults.slice(0, 3).forEach((v: any) =>
        ok(`Vault ${v.leaderId?.slice(0, 8)}... | TVL: ${v.totalValueLocked ?? 0} | followers: ${v.followerCount ?? 0}`)
      )
    } else {
      info('Nenhum vault criado ainda — criando via líderes registrados')
    }
  } catch (e: any) {
    fail(`vaults list: ${e.message.slice(0, 80)}`)
  }

  // 4.2 — Depositar em vaults
  console.log('\n  📥 4.2 Depósitos em Vaults')
  if (leaderIds.length > 0) {
    const leaderId = leaderIds[0]
    const deposits = [
      { acc: dave,    amount: '1000', token: 'USDT' },
    ]

    for (const { acc, amount, token } of deposits) {
      try {
        const result = await post(`/copytrade/vaults/${leaderId}/deposit`, {
          followerAddress: acc.address, token, amount,
        })
        ok(`${acc.name} depositou ${amount} ${token} no vault ${leaderId.slice(0, 8)}...`)
      } catch (e: any) {
        fail(`${acc.name} vault deposit: ${e.message.slice(0, 80)}`)
      }
      await sleep(100)
    }
  }

  // 4.3 — Obter API Key via challenge e enviar sinais
  console.log('\n  📡 4.3 Trade Signals (via API Key)')
  if (leaderIds.length > 0) {
    const leaderId = leaderIds[0]
    let apiKey: string | null = null

    // Challenge-response para obter API key
    try {
      const challenge = await get(`/copytrade/leaders/${leaderId}/api-key/challenge?leaderAddress=${alice.address}`)
      const { challengeId, message } = challenge
      info(`Challenge: ${challengeId?.slice(0, 12)}...`)

      if (challengeId && message) {
        // Assina a mensagem completa retornada pelo challenge
        const keyResult = await post(`/copytrade/leaders/${leaderId}/api-key`, {
          leaderAddress: alice.address,
          challengeId,
          signature: alice.sign(message),
        })
        apiKey = keyResult.apiKey || keyResult.key
        ok(`API Key obtida: ${apiKey?.slice(0, 12)}...`)
      }
    } catch (e: any) {
      fail(`API key challenge: ${e.message.slice(0, 100)}`)
    }

    // Enviar sinais com API key
    if (apiKey) {
      const signals = [
        { pairSymbol: 'LUNES/USDT', side: 'BUY'  as const, amountIn: '500', amountOutMin: '490', tag: 'breakout' },
        { pairSymbol: 'LUNES/USDT', side: 'SELL' as const, amountIn: '300', amountOutMin: '295', tag: 'take-profit' },
      ]

      for (const sig of signals) {
        try {
          const r = await fetch(`${API}/copytrade/vaults/${leaderId}/signals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
            body: JSON.stringify({
              leaderId, pairSymbol: sig.pairSymbol, side: sig.side,
              source: 'API', strategyTag: sig.tag,
              amountIn: sig.amountIn, amountOutMin: sig.amountOutMin, maxSlippageBps: 100,
            }),
          })
          const data = await r.json() as any
          if (r.ok) ok(`Sinal ${sig.side} ${sig.pairSymbol} | tag: ${sig.tag}`)
          else fail(`signal: ${JSON.stringify(data).slice(0, 80)}`)
        } catch (e: any) {
          fail(`signal: ${e.message.slice(0, 80)}`)
        }
        await sleep(100)
      }
    }
  }

  // 4.4 — Posições abertas de copy
  console.log('\n  📋 4.4 Posições de Copy')
  try {
    const data = await get(`/copytrade/positions?address=${dave.address}`)
    const positions = data.positions || []
    if (positions.length > 0) {
      positions.slice(0, 3).forEach((p: any) => {
        const vaultName = p.vault?.name ?? 'vault desconhecido'
        const balance = p.shareBalance ?? p.currentValue ?? p.amount ?? '?'
        const pnl = p.realizedPnl !== undefined ? ` | PnL: ${p.realizedPnl}` : ''
        ok(`${vaultName} | balance: ${balance}${pnl}`)
      })
    } else {
      info('Nenhuma posição de copy aberta (sinais pendentes de execução)')
    }
  } catch (e: any) {
    fail(`positions: ${e.message.slice(0, 80)}`)
  }

  // 4.5 — Execuções
  if (leaderIds.length > 0) {
    try {
      const data = await get(`/copytrade/vaults/${leaderIds[0]}/executions?limit=5`)
      const execs = data.executions || []
      ok(`Execuções do vault: ${execs.length}`)
      execs.forEach((e: any) => info(`  ${e.pairSymbol} ${e.side} | ${e.status}`))
    } catch (e: any) {
      fail(`executions: ${e.message.slice(0, 80)}`)
    }
  }
}

// ═══════════════════════════════════════════════════════
// MÓDULO 5: AFFILIATES
// ═══════════════════════════════════════════════════════

async function simulateAffiliates(accounts: Account[]) {
  section('MÓDULO 5: Affiliate Program')

  const [alice, bob, charlie, dave] = accounts

  // 5.1 — Gerar código de referral para Alice
  console.log('\n  🔗 5.1 Gerando Código de Referral')
  try {
    const data = await get(`/affiliate/code?address=${alice.address}`)
    const code = data.code || data.referralCode
    if (code) {
      ok(`Alice → código: ${code}`)

      // 5.2 — Registrar novos usuários com referral
      console.log('\n  📝 5.2 Registrando Referrals')
      const referees = [bob, charlie, dave]
      for (const referee of referees) {
        try {
          await post('/affiliate/register', {
            refereeAddress: referee.address,
            referralCode: code,
          })
          ok(`${referee.name} registrado via código de Alice`)
        } catch (e: any) {
          if (e.message.includes('already') || e.message.includes('409') || e.message.includes('duplicate')) {
            info(`${referee.name} já registrado`)
          } else {
            fail(`${referee.name} register: ${e.message.slice(0, 80)}`)
          }
        }
        await sleep(80)
      }
    } else {
      info('Código de referral não retornado')
    }
  } catch (e: any) {
    fail(`get code: ${e.message.slice(0, 80)}`)
  }

  // 5.3 — Dashboard de affiliates
  console.log('\n  📊 5.3 Dashboard')
  try {
    const dash = await get(`/affiliate/dashboard?address=${alice.address}`)
    ok(`Referrals totais: ${dash.totalReferrals ?? 0}`)
    ok(`Comissões acumuladas: ${dash.totalCommissions ?? 0} USDT`)
    ok(`Volume gerado: ${dash.totalVolume ?? 0}`)
  } catch (e: any) {
    fail(`dashboard: ${e.message.slice(0, 80)}`)
  }

  // 5.4 — Árvore de referrals
  console.log('\n  🌳 5.4 Árvore de Referrals')
  try {
    const tree = await get(`/affiliate/tree?address=${alice.address}`)
    const nodes = tree.tree || []
    ok(`Nós na árvore: ${nodes.length}`)
    nodes.slice(0, 3).forEach((n: any) =>
      info(`  ${n.address?.slice(0, 12)}... | depth: ${n.depth ?? 0} | vol: ${n.totalFeeGenerated ?? 0}`)
    )
  } catch (e: any) {
    fail(`tree: ${e.message.slice(0, 80)}`)
  }

  // 5.5 — Processar payouts
  console.log('\n  💸 5.5 Processando Payouts')
  try {
    const payouts = await get(`/affiliate/payouts?address=${alice.address}`)
    const pendingPayouts = (payouts.payouts || []).filter((p: any) => p.status === 'PENDING')
    ok(`Payouts pendentes: ${pendingPayouts.length}`)

    if (pendingPayouts.length > 0) {
      await post('/affiliate/payout/process', {})
      ok('Payouts processados')
    }
  } catch (e: any) {
    fail(`payouts: ${e.message.slice(0, 80)}`)
  }
}

// ═══════════════════════════════════════════════════════
// MÓDULO 6: STRESS TEST
// ═══════════════════════════════════════════════════════

async function simulateStress(accounts: Account[]) {
  section('MÓDULO 6: Stress Test — Alta Frequência')

  const [alice, bob, charlie, dave] = accounts
  const pair = 'LUNES/USDT'
  let accepted = 0
  let rejected = 0
  const START = Date.now()

  console.log('\n  ⚡ 6.1 Burst de 40 ordens simultâneas (rate-limit test)')
  const burst = []
  for (let i = 0; i < 10; i++) {
    const price = 5000 + (i % 5) * 10
    burst.push(placeOrder(alice,   pair, 'BUY',  price,       50_000_000 + i * 1_000_000))
    burst.push(placeOrder(bob,     pair, 'SELL', price + 20,  50_000_000 + i * 1_000_000))
    burst.push(placeOrder(charlie, pair, 'BUY',  price - 10,  30_000_000 + i * 500_000))
    burst.push(placeOrder(dave,    pair, 'SELL', price + 30,  30_000_000 + i * 500_000))
  }

  const results = await Promise.allSettled(burst)
  results.forEach(r => r.status === 'fulfilled' && r.value ? accepted++ : rejected++)
  const elapsed = Date.now() - START
  ok(`${accepted} aceitas | ${rejected} rejeitadas (rate-limit) | ${elapsed}ms`)

  console.log('\n  📈 6.2 Sequência de 20 ordens com spread decrescente')
  await sleep(3000) // aguarda rate-limit do burst anterior
  let spread = 100
  let accepted2 = 0
  for (let i = 0; i < 20; i++) {
    const midPrice = 5000 + Math.floor(i / 4) * 10
    const bid = midPrice - spread / 2
    const ask = midPrice + spread / 2
    const size = 20_000_000 + Math.round(Math.random() * 30_000_000)

    const r1 = await placeOrder(alice, pair, 'BUY',  bid, size)
    const r2 = await placeOrder(bob,   pair, 'SELL', ask, size)
    if (r1) accepted2++
    if (r2) accepted2++

    spread = Math.max(2, spread - 5) // spread vai fechando
    await sleep(50)
  }
  ok(`${accepted2} ordens aceitas com spread final de ${spread} (eficiência de mercado)`)

  // Snapshot do orderbook após stress
  console.log('\n  📊 6.3 Orderbook após Stress')
  await sleep(4000) // aguarda rate-limit window resetar
  try {
    const ob = await get(`/orderbook/${encodeURIComponent(pair)}`)
    const bidCount = ob.bids?.length ?? 0
    const askCount = ob.asks?.length ?? 0
    const bestBid = ob.bestBid ? Number(ob.bestBid) : 0
    const bestAsk = ob.bestAsk ? Number(ob.bestAsk) : 0
    const spread = bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : '?'
    ok(`Bids: ${bidCount} | Asks: ${askCount} | Best bid: ${bestBid} | Best ask: ${bestAsk} | Spread: ${spread}`)
  } catch (e: any) {
    fail(`orderbook: ${e.message.slice(0, 80)}`)
  }

  // Relatório de trades acumulados
  console.log('\n  📈 6.4 Relatório Acumulado de Trades')
  for (const sym of ['LUNES/USDT', 'LUNES/BTC']) {
    try {
      const data = await get(`/trades/${encodeURIComponent(sym)}?limit=1000`)
      const trades = data.trades || []
      const vol = trades.reduce((s: number, t: any) => s + Number(t.amount), 0)
      const qvol = trades.reduce((s: number, t: any) => s + Number(t.quoteAmount), 0)
      if (trades.length > 0) {
        const prices = trades.map((t: any) => Number(t.price))
        ok(`${sym} | ${trades.length} trades | Vol: ${vol.toLocaleString()} | Quote: ${qvol.toLocaleString()} | Range: ${Math.min(...prices)}–${Math.max(...prices)}`)
      }
    } catch {}
  }
}

// ═══════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════

async function main() {
  await cryptoWaitReady()
  const keyring = new Keyring({ type: 'sr25519' })

  console.log('🚀 Lunex DEX — Simulação Completa Multi-Módulo')
  console.log(`${'═'.repeat(60)}`)
  console.log(`  NONCE_BASE: ${NONCE_BASE}`)

  const accounts = [
    createAccount(keyring, '//Alice',   'Alice',   5000),
    createAccount(keyring, '//Bob',     'Bob',     6000),
    createAccount(keyring, '//Charlie', 'Charlie', 7000),
    createAccount(keyring, '//Dave',    'Dave',    8000),
    createAccount(keyring, '//Eve',     'Eve',     9000),
  ]

  console.log('  Accounts:')
  accounts.forEach(a => console.log(`  • ${a.name}: ${a.address}`))

  // Verificar backend
  try {
    await get('/pairs')
    ok('Backend respondendo')
  } catch (e) {
    console.error('❌ Backend offline. Inicie com: npm run dev')
    process.exit(1)
  }

  // Executar módulos
  await simulateCandles()
  await simulateMargin(accounts)
  const leaderIds = await simulateSocial(accounts)
  await simulateCopytrade(accounts, leaderIds)
  await simulateAffiliates(accounts)
  await simulateStress(accounts)

  console.log(`\n${'═'.repeat(60)}`)
  console.log('  ✅ SIMULAÇÃO COMPLETA CONCLUÍDA')
  console.log(`${'═'.repeat(60)}\n`)
}

main().catch(e => {
  console.error('\n❌ ERRO FATAL:', e.message)
  process.exit(1)
})
