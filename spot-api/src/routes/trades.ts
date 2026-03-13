import { NextFunction, Router, Request, Response } from 'express'
import { tradeService } from '../services/tradeService'
import { PaginationSchema, RetryTradeSettlementsSchema, TradeSettlementQuerySchema } from '../utils/validation'

const router = Router()

router.get('/settlement/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = TradeSettlementQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues })
    }
    const trades = await tradeService.getTradesBySettlementStatus(
      parsed.data.status, parsed.data.limit, parsed.data.offset,
    )
    res.json({ trades })
  } catch (err) { next(err) }
})

router.post('/settlement/retry', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = RetryTradeSettlementsSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues })
    }
    const result = await tradeService.retryTradeSettlements(parsed.data.limit)
    res.json(result)
  } catch (err) { next(err) }
})

router.get('/:symbol', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const symbol = (req.query.symbol as string) ?? req.params.symbol
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200)
    const trades = await tradeService.getRecentTrades(symbol, limit)
    res.json({ trades })
  } catch (err) { next(err) }
})

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // If ?symbol= is provided, return recent trades for that pair
    if (req.query.symbol && typeof req.query.symbol === 'string') {
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200)
      const trades = await tradeService.getRecentTrades(req.query.symbol, limit)
      return res.json({ trades })
    }
    const { address } = req.query
    if (!address || typeof address !== 'string') {
      return res.status(400).json({ error: 'address required' })
    }
    const pagination = PaginationSchema.safeParse(req.query)
    const limit = pagination.success ? pagination.data.limit : 50
    const offset = pagination.success ? pagination.data.offset : 0
    const trades = await tradeService.getUserTrades(address, limit, offset)
    res.json({ trades })
  } catch (err) { next(err) }
})

export default router
