import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface LeaderSeed {
  name: string
  username: string
  address: string
  avatar: string
  isAi: boolean
  isVerified: boolean
  bio: string
  memberSince: Date
  roi30d: number
  roi90d: number
  totalAum: number
  drawdown: number
  followersCount: number
  winRate: number
  avgProfit: number
  sharpe: number
  performanceFeeBps: number
  pnlHistory: number[]
  tags: string[]
  vault: {
    name: string
    collateralToken: string
    totalEquity: number
    totalShares: number
    totalDeposits: number
    totalWithdrawals: number
    minDeposit: number
    twapThreshold: number
    maxSlippageBps: number
  }
  trades: Array<{
    pairSymbol: string
    side: 'BUY' | 'SELL'
    entryPrice: number
    exitPrice?: number
    pnlPct: number
    status: 'OPEN' | 'CLOSED'
    openedAt: Date
    closedAt?: Date
  }>
  ideas: Array<{
    title: string
    description: string
    pairSymbol: string
    direction: 'Bullish' | 'Bearish'
    likesCount: number
    commentsCount: number
    tags: string[]
    createdAt: Date
  }>
}

async function main() {
  console.log('Seeding database...')

  // Deactivate legacy pairs that have no real contract addresses
  await prisma.pair.updateMany({
    where: { symbol: { in: ['LUNES/USDT', 'LUNES/BTC', 'LUNES/ETH'] } },
    data: { isActive: false },
  })

  // Deployed contracts on the local testnet (PSP22)
  const LUSDT = process.env.LUSDT_ADDRESS || '5CdLQGeA89rffQrfckqB8cX3qQkMauszo7rqt5QaNYChsXsf'
  const LBTC = process.env.LBTC_ADDRESS || '5FvT73acgKALbPEqwAdah8pY28LL5EE4fNBzCgmgjTkmdsMg'
  const LETH = process.env.LETH_ADDRESS || '5DhVzePc99qpcmmm9yA8ZzSRPuLXp8dEc8nSZmQVyczHRGNS'
  const GMC = process.env.GMC_ADDRESS || '5CfB22jZ43hkK5ZPhaaVk9wefMgTnERsawE8e9urdkMNEMRJ'
  const LUP = process.env.LUP_ADDRESS || '5ELQTeXGvjijzJ7zUtTtLmm6rf44ogMnFBsT7tfYzDuzuvW3'
  const WLUNES = process.env.WLUNES_ADDRESS || '5HRAv1VDeWkLnmkZAjgo6oigU5179nUDBgjKX4u5wztM7tTo'
  const LEANDRO_SANDER_ADDRESS = process.env.LEADER_LEANDRO_SANDER_ADDRESS || '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'
  const AIALPHA_BOT_ADDRESS = process.env.LEADER_AIALPHA_BOT_ADDRESS || '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty'
  const OPENCLAW_AGENT_ADDRESS = process.env.LEADER_OPENCLAW_AGENT_ADDRESS || '5HGjWAeFDfFCWPsjFQdVV2Msvz2XtMktvgocEZcCj68kUMaw'

  const pairs = [
    {
      symbol: 'LUNES/LUSDT',
      baseToken: 'native',
      quoteToken: LUSDT,
      baseName: 'LUNES',
      quoteName: 'LUSDT',
      baseDecimals: 8,
      quoteDecimals: 6,
      isNativeBase: true,
      isNativeQuote: false,
      makerFeeBps: 10,
      takerFeeBps: 25,
    },
    {
      symbol: 'LBTC/LUSDT',
      baseToken: LBTC,
      quoteToken: LUSDT,
      baseName: 'LBTC',
      quoteName: 'LUSDT',
      baseDecimals: 8,
      quoteDecimals: 6,
      isNativeBase: false,
      isNativeQuote: false,
      makerFeeBps: 10,
      takerFeeBps: 25,
    },
    {
      symbol: 'LETH/LUSDT',
      baseToken: LETH,
      quoteToken: LUSDT,
      baseName: 'LETH',
      quoteName: 'LUSDT',
      baseDecimals: 8,
      quoteDecimals: 6,
      isNativeBase: false,
      isNativeQuote: false,
      makerFeeBps: 10,
      takerFeeBps: 25,
    },
    {
      symbol: 'GMC/LUSDT',
      baseToken: GMC,
      quoteToken: LUSDT,
      baseName: 'GMC',
      quoteName: 'LUSDT',
      baseDecimals: 8,
      quoteDecimals: 6,
      isNativeBase: false,
      isNativeQuote: false,
      makerFeeBps: 10,
      takerFeeBps: 25,
    },
    {
      symbol: 'LUP/LUSDT',
      baseToken: LUP,
      quoteToken: LUSDT,
      baseName: 'LUP',
      quoteName: 'LUSDT',
      baseDecimals: 8,
      quoteDecimals: 6,
      isNativeBase: false,
      isNativeQuote: false,
      makerFeeBps: 10,
      takerFeeBps: 25,
    },
    // ─── LUNES-based pairs ───
    {
      symbol: 'LUNES/LUP',
      baseToken: 'native',
      quoteToken: LUP,
      baseName: 'LUNES',
      quoteName: 'LUP',
      baseDecimals: 8,
      quoteDecimals: 8,
      isNativeBase: true,
      isNativeQuote: false,
      makerFeeBps: 10,
      takerFeeBps: 25,
    },
    {
      symbol: 'LUNES/GMC',
      baseToken: 'native',
      quoteToken: GMC,
      baseName: 'LUNES',
      quoteName: 'GMC',
      baseDecimals: 8,
      quoteDecimals: 8,
      isNativeBase: true,
      isNativeQuote: false,
      makerFeeBps: 10,
      takerFeeBps: 25,
    },
    {
      symbol: 'LUNES/WLUNES',
      baseToken: 'native',
      quoteToken: WLUNES,
      baseName: 'LUNES',
      quoteName: 'WLUNES',
      baseDecimals: 8,
      quoteDecimals: 8,
      isNativeBase: true,
      isNativeQuote: false,
      makerFeeBps: 10,
      takerFeeBps: 25,
    },
  ]

  for (const pair of pairs) {
    await prisma.pair.upsert({
      where: { symbol: pair.symbol },
      update: pair,
      create: pair,
    })
    console.log(`  Created pair: ${pair.symbol}`)
  }

  const leaders: LeaderSeed[] = [
    {
      name: 'LeandroSander',
      username: 'leandrosander',
      address: LEANDRO_SANDER_ADDRESS,
      avatar: '',
      isAi: false,
      isVerified: true,
      bio: 'Professional swing trader. 8 years of experience. Focus on BTC, ETH and large-cap altcoins. Technical analysis + on-chain.',
      memberSince: new Date('2025-03-01T00:00:00Z'),
      roi30d: 310.5,
      roi90d: 580.2,
      totalAum: 2500000,
      drawdown: -4.2,
      followersCount: 1250,
      winRate: 72,
      avgProfit: 14.3,
      sharpe: 2.8,
      performanceFeeBps: 1500,
      pnlHistory: [0, 12, 8, 25, 18, 35, 28, 42, 38, 55, 48, 72, 65, 88, 82, 95, 110, 105, 128, 135, 142, 155, 168, 175, 190, 205, 220, 245, 260, 310],
      tags: ['Top 3', 'Verified', 'Swing'],
      vault: {
        name: 'LeandroSander Vault',
        collateralToken: 'USDT',
        totalEquity: 2500000,
        totalShares: 2500000,
        totalDeposits: 2200000,
        totalWithdrawals: 180000,
        minDeposit: 100,
        twapThreshold: 50000,
        maxSlippageBps: 100,
      },
      trades: [
        { pairSymbol: 'BTC/USDT', side: 'BUY', entryPrice: 62500, exitPrice: 68200, pnlPct: 9.12, status: 'CLOSED', openedAt: new Date('2025-03-05T12:00:00Z'), closedAt: new Date('2025-03-05T18:00:00Z') },
        { pairSymbol: 'ETH/USDT', side: 'BUY', entryPrice: 3450, exitPrice: 3680, pnlPct: 6.67, status: 'CLOSED', openedAt: new Date('2025-03-04T12:00:00Z'), closedAt: new Date('2025-03-04T20:00:00Z') },
        { pairSymbol: 'LUNES/LUSDT', side: 'BUY', entryPrice: 0.025, exitPrice: 0.032, pnlPct: 28.0, status: 'CLOSED', openedAt: new Date('2025-03-01T09:00:00Z'), closedAt: new Date('2025-03-01T22:00:00Z') },
      ],
      ideas: [
        { title: 'BTC heading to 75K — Golden Pocket confirmed', description: 'Technical analysis shows confluence at the Fibonacci golden pocket with sustained buying flow.', pairSymbol: 'BTC/USDT', direction: 'Bullish', likesCount: 342, commentsCount: 58, tags: ['BTC', 'Fibonacci', 'Swing'], createdAt: new Date('2025-03-05T10:00:00Z') },
        { title: 'ETH/BTC recovery imminent', description: 'The ETH/BTC pair is at a historical support zone and could lead the next rotation.', pairSymbol: 'ETH/BTC', direction: 'Bullish', likesCount: 128, commentsCount: 22, tags: ['ETH', 'Altseason'], createdAt: new Date('2025-03-03T14:00:00Z') },
      ],
    },
    {
      name: 'AIAlpha Bot',
      username: 'aialpha',
      address: AIALPHA_BOT_ADDRESS,
      avatar: '',
      isAi: true,
      isVerified: true,
      bio: 'Multi-timeframe quantitative model with ML. 24/7 operation. Optimized for high-volatility cryptocurrency markets.',
      memberSince: new Date('2025-01-01T00:00:00Z'),
      roi30d: 185.3,
      roi90d: 420.7,
      totalAum: 4100000,
      drawdown: -2.1,
      followersCount: 2340,
      winRate: 68,
      avgProfit: 8.5,
      sharpe: 3.2,
      performanceFeeBps: 2000,
      pnlHistory: [0, 5, 15, 12, 22, 30, 28, 38, 45, 42, 55, 60, 58, 70, 78, 85, 92, 88, 100, 108, 115, 125, 132, 140, 148, 155, 162, 170, 178, 185],
      tags: ['AI Agent', 'Top 3', '24/7'],
      vault: {
        name: 'AIAlpha Vault',
        collateralToken: 'USDT',
        totalEquity: 4100000,
        totalShares: 3900000,
        totalDeposits: 3500000,
        totalWithdrawals: 250000,
        minDeposit: 50,
        twapThreshold: 80000,
        maxSlippageBps: 80,
      },
      trades: [
        { pairSymbol: 'BTC/USDT', side: 'BUY', entryPrice: 63100, exitPrice: 65800, pnlPct: 4.28, status: 'CLOSED', openedAt: new Date('2025-03-05T10:00:00Z'), closedAt: new Date('2025-03-05T16:00:00Z') },
        { pairSymbol: 'ETH/USDT', side: 'SELL', entryPrice: 3620, exitPrice: 3580, pnlPct: 1.10, status: 'CLOSED', openedAt: new Date('2025-03-05T11:00:00Z'), closedAt: new Date('2025-03-05T13:00:00Z') },
        { pairSymbol: 'SOL/USDT', side: 'BUY', entryPrice: 135, exitPrice: 142, pnlPct: 5.19, status: 'CLOSED', openedAt: new Date('2025-03-04T08:00:00Z'), closedAt: new Date('2025-03-04T15:00:00Z') },
      ],
      ideas: [],
    },
    {
      name: 'OpenClaw Trader',
      username: 'openclaw',
      address: OPENCLAW_AGENT_ADDRESS,
      avatar: '',
      isAi: true,
      isVerified: true,
      bio: 'Autonomous agent based on the OpenClaw framework. Decisions via LLM with real-time on-chain data. No human intervention.',
      memberSince: new Date('2025-02-01T00:00:00Z'),
      roi30d: 64.8,
      roi90d: 155.3,
      totalAum: 1200000,
      drawdown: -3.8,
      followersCount: 890,
      winRate: 65,
      avgProfit: 6.2,
      sharpe: 2.1,
      performanceFeeBps: 1800,
      pnlHistory: [0, 2, 5, 3, 8, 12, 10, 15, 20, 18, 25, 28, 30, 35, 32, 38, 42, 40, 45, 48, 52, 55, 50, 54, 58, 60, 62, 63, 64, 65],
      tags: ['AI Agent', 'Autonomous', 'OpenClaw'],
      vault: {
        name: 'OpenClaw Vault',
        collateralToken: 'USDT',
        totalEquity: 1200000,
        totalShares: 1150000,
        totalDeposits: 1000000,
        totalWithdrawals: 80000,
        minDeposit: 25,
        twapThreshold: 30000,
        maxSlippageBps: 120,
      },
      trades: [
        { pairSymbol: 'LUNES/LUSDT', side: 'BUY', entryPrice: 0.028, exitPrice: 0.031, pnlPct: 10.71, status: 'CLOSED', openedAt: new Date('2025-03-05T06:00:00Z'), closedAt: new Date('2025-03-05T14:00:00Z') },
      ],
      ideas: [],
    },
  ]

  for (const leaderData of leaders) {
    const leader = await prisma.leader.upsert({
      where: { username: leaderData.username },
      update: {
        name: leaderData.name,
        address: leaderData.address,
        avatar: leaderData.avatar,
        isAi: leaderData.isAi,
        isVerified: leaderData.isVerified,
        bio: leaderData.bio,
        memberSince: leaderData.memberSince,
        roi30d: leaderData.roi30d,
        roi90d: leaderData.roi90d,
        totalAum: leaderData.totalAum,
        drawdown: leaderData.drawdown,
        followersCount: leaderData.followersCount,
        winRate: leaderData.winRate,
        avgProfit: leaderData.avgProfit,
        sharpe: leaderData.sharpe,
        performanceFeeBps: leaderData.performanceFeeBps,
        pnlHistory: leaderData.pnlHistory,
        tags: leaderData.tags,
      },
      create: {
        name: leaderData.name,
        username: leaderData.username,
        address: leaderData.address,
        avatar: leaderData.avatar,
        isAi: leaderData.isAi,
        isVerified: leaderData.isVerified,
        bio: leaderData.bio,
        memberSince: leaderData.memberSince,
        roi30d: leaderData.roi30d,
        roi90d: leaderData.roi90d,
        totalAum: leaderData.totalAum,
        drawdown: leaderData.drawdown,
        followersCount: leaderData.followersCount,
        winRate: leaderData.winRate,
        avgProfit: leaderData.avgProfit,
        sharpe: leaderData.sharpe,
        performanceFeeBps: leaderData.performanceFeeBps,
        allowApiTrading: leaderData.isAi,
        pnlHistory: leaderData.pnlHistory,
        tags: leaderData.tags,
      },
    })

    await prisma.copyVault.upsert({
      where: { leaderId: leader.id },
      update: {
        name: leaderData.vault.name,
        collateralToken: leaderData.vault.collateralToken,
        totalEquity: leaderData.vault.totalEquity,
        totalShares: leaderData.vault.totalShares,
        totalDeposits: leaderData.vault.totalDeposits,
        totalWithdrawals: leaderData.vault.totalWithdrawals,
        minDeposit: leaderData.vault.minDeposit,
        twapThreshold: leaderData.vault.twapThreshold,
        maxSlippageBps: leaderData.vault.maxSlippageBps,
      },
      create: {
        leaderId: leader.id,
        name: leaderData.vault.name,
        collateralToken: leaderData.vault.collateralToken,
        totalEquity: leaderData.vault.totalEquity,
        totalShares: leaderData.vault.totalShares,
        totalDeposits: leaderData.vault.totalDeposits,
        totalWithdrawals: leaderData.vault.totalWithdrawals,
        minDeposit: leaderData.vault.minDeposit,
        twapThreshold: leaderData.vault.twapThreshold,
        maxSlippageBps: leaderData.vault.maxSlippageBps,
      },
    })

    await prisma.leaderTrade.deleteMany({ where: { leaderId: leader.id } })
    for (const trade of leaderData.trades) {
      const pair = await prisma.pair.findUnique({ where: { symbol: trade.pairSymbol } })
      await prisma.leaderTrade.create({
        data: {
          leaderId: leader.id,
          pairId: pair?.id,
          pairSymbol: trade.pairSymbol,
          side: trade.side,
          entryPrice: trade.entryPrice,
          exitPrice: trade.exitPrice,
          pnlPct: trade.pnlPct,
          status: trade.status,
          openedAt: trade.openedAt,
          closedAt: trade.closedAt,
        },
      })
    }

    await prisma.socialIdea.deleteMany({ where: { leaderId: leader.id } })
    for (const idea of leaderData.ideas) {
      const pair = await prisma.pair.findUnique({ where: { symbol: idea.pairSymbol } })
      await prisma.socialIdea.create({
        data: {
          leaderId: leader.id,
          pairId: pair?.id,
          title: idea.title,
          description: idea.description,
          pairSymbol: idea.pairSymbol,
          direction: idea.direction,
          likesCount: idea.likesCount,
          commentsCount: idea.commentsCount,
          tags: idea.tags,
          createdAt: idea.createdAt,
        },
      })
    }

    console.log(`  Seeded leader: ${leader.username}`)
  }

  // ─── Seed Candles for Chart ─────────────────────────────
  await seedCandles()

  console.log('Seeding complete!')
}

// Price configs per pair for realistic candle generation
const PAIR_PRICE_CONFIG: Record<string, { basePrice: number; volatility: number; drift: number }> = {
  'LUNES/LUSDT': { basePrice: 0.02345, volatility: 0.004, drift: 0.00002 },
  'GMC/LUSDT': { basePrice: 0.155, volatility: 0.012, drift: 0.0001 },
  'LUP/LUSDT': { basePrice: 0.0085, volatility: 0.0008, drift: 0.00001 },
  'LBTC/LUSDT': { basePrice: 68250, volatility: 800, drift: 5 },
  'LETH/LUSDT': { basePrice: 3580, volatility: 60, drift: 2 },
  'LUNES/LUP': { basePrice: 2.76, volatility: 0.15, drift: 0.001 },
  'LUNES/GMC': { basePrice: 0.151, volatility: 0.008, drift: 0.00005 },
  'LUNES/WLUNES': { basePrice: 1.0, volatility: 0.005, drift: 0.0 },
}

async function seedCandles() {
  console.log('  Seeding candles...')

  const allPairs = await prisma.pair.findMany({ where: { isActive: true } })

  for (const pair of allPairs) {
    const config = PAIR_PRICE_CONFIG[pair.symbol]
    if (!config) continue

    // Delete existing candles for this pair
    await prisma.candle.deleteMany({ where: { pairId: pair.id } })

    const now = Date.now()
    let close = config.basePrice

    // Generate candles for multiple timeframes
    const timeframes: Array<{ tf: string; count: number; intervalMs: number }> = [
      { tf: '1m', count: 120, intervalMs: 60 * 1000 },
      { tf: '5m', count: 120, intervalMs: 5 * 60 * 1000 },
      { tf: '15m', count: 120, intervalMs: 15 * 60 * 1000 },
      { tf: '1h', count: 200, intervalMs: 60 * 60 * 1000 },
      { tf: '4h', count: 120, intervalMs: 4 * 60 * 60 * 1000 },
      { tf: '1d', count: 90, intervalMs: 24 * 60 * 60 * 1000 },
    ]

    for (const { tf, count, intervalMs } of timeframes) {
      close = config.basePrice
      const candles = []

      for (let i = 0; i < count; i++) {
        const openTime = new Date(now - (count - i) * intervalMs)
        const open = close
        const change = (Math.random() - 0.48) * config.volatility + config.drift
        close = Math.max(config.basePrice * 0.5, open + change)
        const high = Math.max(open, close) + Math.random() * config.volatility * 0.3
        const low = Math.min(open, close) - Math.random() * config.volatility * 0.3
        const volume = Math.random() * 50000 + 5000
        const quoteVolume = volume * ((open + close) / 2)
        const tradeCount = Math.floor(Math.random() * 80) + 10

        candles.push({
          pairId: pair.id,
          timeframe: tf,
          openTime,
          open,
          high,
          low: Math.max(low, config.basePrice * 0.3),
          close,
          volume,
          quoteVolume,
          tradeCount,
        })
      }

      await prisma.candle.createMany({ data: candles })
    }

    console.log(`    ${pair.symbol}: candles seeded (6 timeframes)`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
