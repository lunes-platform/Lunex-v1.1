import { NextFunction, Router, Request, Response } from 'express';
import { tradeService } from '../services/tradeService';
import {
  RetryTradeSettlementsSchema,
  TradeSettlementQuerySchema,
} from '../utils/validation';
import { verifyWalletReadSignature } from '../middleware/auth';
import { requireAdmin } from '../middleware/adminGuard';
import { z } from 'zod';

const router = Router();

const SignedTradesReadSchema = z.object({
  address: z.string().min(8).max(128),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  nonce: z.string().min(8),
  timestamp: z.coerce.number().int().positive(),
  signature: z.string().min(8),
});

router.get(
  '/settlement/status',
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = TradeSettlementQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }
      const trades = await tradeService.getTradesBySettlementStatus(
        parsed.data.status,
        parsed.data.limit,
        parsed.data.offset,
      );
      res.json({ trades });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/settlement/retry',
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = RetryTradeSettlementsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }
      const result = await tradeService.retryTradeSettlements(
        parsed.data.limit,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/:symbol',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const symbol = (req.query.symbol as string) ?? req.params.symbol;
      const limit = Math.min(
        parseInt(req.query.limit as string, 10) || 50,
        200,
      );
      const trades = await tradeService.getRecentTrades(symbol, limit);
      res.json({ trades });
    } catch (err) {
      next(err);
    }
  },
);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // If ?symbol= is provided, return recent trades for that pair
    if (req.query.symbol && typeof req.query.symbol === 'string') {
      const limit = Math.min(
        parseInt(req.query.limit as string, 10) || 50,
        200,
      );
      const trades = await tradeService.getRecentTrades(
        req.query.symbol,
        limit,
      );
      return res.json({ trades });
    }
    const parsed = SignedTradesReadSchema.safeParse(req.query);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const auth = await verifyWalletReadSignature({
      action: 'trades.list',
      address: parsed.data.address,
      nonce: parsed.data.nonce,
      timestamp: parsed.data.timestamp,
      signature: parsed.data.signature,
      fields: {
        limit: parsed.data.limit,
        offset: parsed.data.offset,
      },
    });
    if (!auth.ok) {
      return res.status(401).json({ error: auth.error });
    }
    const trades = await tradeService.getUserTrades(
      parsed.data.address,
      parsed.data.limit,
      parsed.data.offset,
    );
    res.json({ trades });
  } catch (err) {
    next(err);
  }
});

export default router;
