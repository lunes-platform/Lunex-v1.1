import { NextFunction, Router, Request, Response } from 'express'
import prisma from '../db'
import { orderbookManager } from '../utils/orderbook'
import { factoryService } from '../services/factoryService'
import { config } from '../config'
import { log } from '../utils/logger'

const router = Router()

// ─── Auth middleware for admin routes ────────────────────────────

function requireAdmin(req: Request, res: Response, next: () => void) {
  const secret = config.adminSecret
  if (!secret) {
    return res.status(503).json({ error: 'Admin secret not configured on this server' })
  }
  const auth = req.headers['authorization'] ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token || token !== secret) return res.status(401).json({ error: 'Unauthorized' })
  next()
}

// ─── Public routes ───────────────────────────────────────────────

router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const pairs = await prisma.pair.findMany({
      where: { isActive: true },
      orderBy: { symbol: 'asc' },
    })
    res.json({ pairs })
  } catch (err) { next(err) }
})

router.get('/:symbol/ticker', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { symbol } = req.params
    const pair = await prisma.pair.findUnique({ where: { symbol } })
    if (!pair) return res.status(404).json({ error: 'Pair not found' })

    const since = new Date(Date.now() - 86_400_000)
    const trades = await prisma.trade.findMany({
      where: { pairId: pair.id, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
    })

    const book = orderbookManager.get(symbol)
    const lastPrice = trades.length > 0 ? parseFloat(trades[0].price.toString()) : 0
    const firstPrice = trades.length > 0 ? parseFloat(trades[trades.length - 1].price.toString()) : 0
    const high24h = trades.length > 0 ? Math.max(...trades.map(t => parseFloat(t.price.toString()))) : 0
    const low24h = trades.length > 0 ? Math.min(...trades.map(t => parseFloat(t.price.toString()))) : 0
    const volume24h = trades.reduce((sum, t) => sum + parseFloat(t.amount.toString()), 0)
    const quoteVolume24h = trades.reduce((sum, t) => sum + parseFloat(t.quoteAmount.toString()), 0)
    const change24h = firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0

    res.json({
      symbol: pair.symbol,
      lastPrice, high24h, low24h, volume24h, quoteVolume24h,
      change24h: parseFloat(change24h.toFixed(2)),
      tradeCount: trades.length,
      bestBid: book?.getBestBid() ?? null,
      bestAsk: book?.getBestAsk() ?? null,
      spread: book?.getSpread() ?? null,
    })
  } catch (err) { next(err) }
})

// ─── Admin routes ────────────────────────────────────────────────

router.get('/on-chain', requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    if (!config.blockchain.factoryContractAddress) {
      return res.status(503).json({
        error: 'FACTORY_CONTRACT_ADDRESS not set. On-chain discovery unavailable.',
      })
    }
    const [length, pairs] = await Promise.all([
      factoryService.getAllPairsLength(),
      factoryService.getAllPairs(),
    ])
    res.json({ totalOnChain: length, pairs })
  } catch (err) { next(err) }
})

router.post('/register', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      symbol, baseToken, quoteToken, baseName, quoteName,
      baseDecimals = 8, quoteDecimals = 8,
      isNativeBase = false, isNativeQuote = false,
      makerFeeBps = 10, takerFeeBps = 25,
    } = req.body

    if (!symbol || !baseToken || !quoteToken || !baseName || !quoteName) {
      return res.status(400).json({
        error: 'Missing required fields: symbol, baseToken, quoteToken, baseName, quoteName',
      })
    }

    const existing = await prisma.pair.findUnique({ where: { symbol } })
    if (existing) {
      return res.status(409).json({ error: `Pair "${symbol}" is already registered`, pair: existing })
    }

    let pairAddress: string | null = null
    if (config.blockchain.factoryContractAddress) {
      pairAddress = await factoryService.getPair(baseToken, quoteToken)
      if (!pairAddress) {
        return res.status(400).json({
          error: `Pair (${baseToken} / ${quoteToken}) not found on-chain. Call factory.create_pair first.`,
          hint: 'Use polkadot.js apps or the Lunex admin CLI to call create_pair on the Factory contract.',
        })
      }
      log.info({ pairAddress }, '[Pairs] On-chain validation passed')
    } else {
      log.warn('[Pairs] FACTORY_CONTRACT_ADDRESS not set — skipping on-chain validation')
    }

    const pair = await prisma.pair.create({
      data: {
        symbol, baseToken, quoteToken, pairAddress,
        baseName, quoteName, baseDecimals, quoteDecimals,
        isNativeBase, isNativeQuote, makerFeeBps, takerFeeBps, isActive: true,
      },
    })

    log.info({ symbol, pairAddress: pairAddress ?? 'N/A' }, '[Pairs] Registered pair')
    res.status(201).json({ pair })
  } catch (err) { next(err) }
})

router.patch('/:symbol/sync', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { symbol } = req.params
    const pair = await prisma.pair.findUnique({ where: { symbol } })
    if (!pair) return res.status(404).json({ error: 'Pair not found' })

    if (!config.blockchain.factoryContractAddress) {
      return res.status(503).json({ error: 'FACTORY_CONTRACT_ADDRESS not configured' })
    }

    const pairAddress = await factoryService.getPair(pair.baseToken, pair.quoteToken)
    if (!pairAddress) {
      return res.status(400).json({
        error: `Pair not found on-chain for tokens (${pair.baseToken} / ${pair.quoteToken})`,
      })
    }

    const updated = await prisma.pair.update({ where: { symbol }, data: { pairAddress } })
    res.json({ pair: updated })
  } catch (err) { next(err) }
})

export default router
