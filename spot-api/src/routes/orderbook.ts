import { NextFunction, Router, Request, Response } from 'express';
import { orderbookManager } from '../utils/orderbook';
import { parsePairSymbol } from '../utils/validation';

const router = Router();

function handleOrderbook(req: Request, res: Response, next: NextFunction) {
  try {
    const resolved = parsePairSymbol(req.query.symbol, req.params.symbol);
    if (!resolved.ok) {
      return res
        .status(400)
        .json({ error: 'Valid symbol required', code: 'VALIDATION_ERROR' });
    }
    const { symbol } = resolved;
    const depth = Math.min(parseInt(req.query.depth as string, 10) || 25, 200);
    const book = orderbookManager.get(symbol);

    if (!book) return res.json({ bids: [], asks: [], spread: null });

    const snapshot = book.getSnapshot(depth);
    res.json({
      ...snapshot,
      spread: book.getSpread(),
      bestBid: book.getBestBid(),
      bestAsk: book.getBestAsk(),
    });
  } catch (err) {
    next(err);
  }
}

// Support both ?symbol=LUNES/LUSDT and /:symbol (URL-encoded: LUNES%2FLUSDT)
router.get('/', handleOrderbook);
router.get('/:symbol', handleOrderbook);

export default router;
