import { NextFunction, Router, Request, Response } from 'express';
import { tradeService } from '../services/tradeService';
import {
  parsePairSymbol,
  RetryTradeSettlementsSchema,
  TradeSettlementQuerySchema,
  ss58Address,
} from '../utils/validation';
import { getSignedAuthInput } from '../middleware/auth';
import {
  readAuthSchema,
  verifyWalletReadAccess,
} from '../middleware/readSession';
import { requireAdmin } from '../middleware/adminGuard';
import { z } from 'zod';

const router = Router();

const SignedTradesReadSchema = z.object({
  address: ss58Address,
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
      const resolved = parsePairSymbol(req.query.symbol, req.params.symbol);
      if (!resolved.ok) {
        return res
          .status(400)
          .json({ error: 'Valid symbol required', code: 'VALIDATION_ERROR' });
      }
      const { symbol } = resolved;
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
    if (req.query.symbol !== undefined) {
      const resolved = parsePairSymbol(req.query.symbol, undefined);
      if (!resolved.ok) {
        return res
          .status(400)
          .json({ error: 'Valid symbol required', code: 'VALIDATION_ERROR' });
      }
      const limit = Math.min(
        parseInt(req.query.limit as string, 10) || 50,
        200,
      );
      const trades = await tradeService.getRecentTrades(
        resolved.symbol,
        limit,
      );
      return res.json({ trades });
    }
    const parsed = readAuthSchema(req, SignedTradesReadSchema).safeParse({
        ...req.query,
        ...getSignedAuthInput(req),
      });
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const auth = await verifyWalletReadAccess(req, {
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
