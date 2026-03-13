import { NextFunction, Router, Request, Response } from 'express'
import { candleService } from '../services/candleService'
import { CandleQuerySchema } from '../utils/validation'

const router = Router()

function handleCandles(req: Request, res: Response, next: NextFunction) {
  try {
    const symbol = (req.query.symbol as string) ?? req.params.symbol
    if (!symbol) return res.status(400).json({ error: 'symbol required' })
    const parsed = CandleQuerySchema.safeParse(req.query)
    const timeframe = parsed.success ? parsed.data.timeframe : '1h'
    const limit = parsed.success ? parsed.data.limit : 200

    candleService.getCandles(symbol, timeframe, limit).then(candles => {
      res.json({ candles })
    }).catch(next)
  } catch (err) { next(err) }
}

// Support both ?symbol=LUNES/LUSDT and /:symbol (URL-encoded: LUNES%2FLUSDT)
router.get('/', handleCandles)
router.get('/:symbol', handleCandles)

export default router
