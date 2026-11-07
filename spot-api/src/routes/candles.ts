import { NextFunction, Router, Request, Response } from 'express';
import { candleService } from '../services/candleService';
import { CandleQuerySchema, parsePairSymbol } from '../utils/validation';

const router = Router();

function handleCandles(req: Request, res: Response, next: NextFunction) {
  try {
    const resolved = parsePairSymbol(req.query.symbol, req.params.symbol);
    if (!resolved.ok) {
      return res
        .status(400)
        .json({ error: 'Valid symbol required', code: 'VALIDATION_ERROR' });
    }
    const { symbol } = resolved;
    const parsed = CandleQuerySchema.safeParse(req.query);
    const timeframe = parsed.success ? parsed.data.timeframe : '1h';
    const limit = parsed.success ? parsed.data.limit : 200;

    candleService
      .getCandles(symbol, timeframe, limit)
      .then((candles) => {
        res.json({ candles });
      })
      .catch(next);
  } catch (err) {
    next(err);
  }
}

// Support both ?symbol=LUNES/LUSDT and /:symbol (URL-encoded: LUNES%2FLUSDT)
router.get('/', handleCandles);
router.get('/:symbol', handleCandles);

export default router;
