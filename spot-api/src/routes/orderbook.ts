import { NextFunction, Router, Request, Response } from 'express'
import { orderbookManager } from '../utils/orderbook'

const router = Router()

router.get('/:symbol', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { symbol } = req.params
    const depth = Math.min(parseInt(req.query.depth as string, 10) || 25, 200)
    const book = orderbookManager.get(symbol)

    if (!book) return res.json({ bids: [], asks: [], spread: null })

    const snapshot = book.getSnapshot(depth)
    res.json({
      ...snapshot,
      spread: book.getSpread(),
      bestBid: book.getBestBid(),
      bestAsk: book.getBestAsk(),
    })
  } catch (err) { next(err) }
})

export default router
