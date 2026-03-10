import { NextFunction, Router, Request, Response } from 'express'
import { candleService } from '../services/candleService'
import { CandleQuerySchema } from '../utils/validation'

const router = Router()

router.get('/:symbol', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = CandleQuerySchema.safeParse(req.query)
    const timeframe = parsed.success ? parsed.data.timeframe : '1h'
    const limit = parsed.success ? parsed.data.limit : 200

    const candles = await candleService.getCandles(req.params.symbol, timeframe, limit)
    res.json({ candles })
  } catch (err) { next(err) }
})

export default router
