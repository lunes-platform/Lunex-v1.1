import { NextFunction, Router, Request, Response } from 'express';
import { orderService } from '../services/orderService';
import { CreateOrderSchema, CancelOrderSchema } from '../utils/validation';
import {
  buildSpotOrderMessage,
  verifyWalletActionSignature,
  verifyWalletReadSignature,
  verifyAddressSignature,
  consumeNonce,
  isNonceUsed,
} from '../middleware/auth';
import { checkRedisRateLimit } from '../utils/redisRateLimit';
import { z } from 'zod';

const SIGNED_ORDER_TTL_MS = 5 * 60 * 1000;

const router = Router();

const SignedReadSchema = z.object({
  makerAddress: z.string().min(8).max(128),
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  nonce: z.string().min(8),
  timestamp: z.coerce.number().int().positive(),
  signature: z.string().min(8),
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = CreateOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: 'Validation failed', details: parsed.error.issues });
    }

    // Validate timestamp freshness
    if (Math.abs(Date.now() - parsed.data.timestamp) > SIGNED_ORDER_TTL_MS) {
      return res.status(401).json({ error: 'Expired order signature' });
    }

    // Prevent nonce replay
    const nonceKey = `nonce:spot-order:${parsed.data.makerAddress}:${parsed.data.nonce}`;
    if (await isNonceUsed(nonceKey)) {
      return res.status(401).json({ error: 'Order nonce already used' });
    }

    const isValid = await verifyAddressSignature(
      buildSpotOrderMessage({
        pairSymbol: parsed.data.pairSymbol,
        side: parsed.data.side,
        type: parsed.data.type,
        price: parsed.data.price,
        stopPrice: parsed.data.stopPrice,
        amount: parsed.data.amount,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
      }),
      parsed.data.signature,
      parsed.data.makerAddress,
    );
    if (!isValid) return res.status(401).json({ error: 'Invalid signature' });

    const consumeResult = await consumeNonce(nonceKey);
    if (!consumeResult.ok) {
      return res.status(consumeResult.error === 'replay' ? 401 : 503).json({
        error:
          consumeResult.error === 'replay'
            ? 'Order nonce already used'
            : 'Nonce store unavailable',
      });
    }

    const order = await orderService.createOrder(parsed.data);
    res.status(201).json({ order });
  } catch (err) {
    next(err);
  }
});

// ─── Anti-Spoofing: cancel rate limiter (max 20 cancels/min per address) ─────
// Backed by Redis sliding-window counters so the limit holds across process
// restarts and horizontally scaled API replicas.
const CANCEL_RATE_WINDOW_MS = 60_000;
const CANCEL_RATE_MAX = 20;

async function isCancelRateLimited(address: string): Promise<boolean> {
  const result = await checkRedisRateLimit({
    key: `ratelimit:cancel:${address}`,
    limit: CANCEL_RATE_MAX,
    windowMs: CANCEL_RATE_WINDOW_MS,
  });
  return !result.allowed;
}

router.delete(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = CancelOrderSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }

      // Anti-spoofing: rate limit cancellations (Redis-backed sliding window)
      if (await isCancelRateLimited(parsed.data.makerAddress)) {
        return res
          .status(429)
          .json({ error: 'Too many cancellations. Max 20 per minute.' });
      }

      const auth = await verifyWalletActionSignature({
        action: 'orders.cancel',
        address: parsed.data.makerAddress,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
        signature: parsed.data.signature,
        fields: {
          orderId: req.params.id,
        },
      });
      if (!auth.ok) return res.status(401).json({ error: auth.error });

      const order = await orderService.cancelOrder(
        req.params.id,
        parsed.data.makerAddress,
      );
      res.json({ order });
    } catch (err) {
      next(err);
    }
  },
);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = SignedReadSchema.safeParse(req.query);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const auth = await verifyWalletReadSignature({
      action: 'orders.list',
      address: parsed.data.makerAddress,
      nonce: parsed.data.nonce,
      timestamp: parsed.data.timestamp,
      signature: parsed.data.signature,
      fields: {
        status: parsed.data.status,
        limit: parsed.data.limit,
        offset: parsed.data.offset,
      },
    });
    if (!auth.ok) {
      return res.status(401).json({ error: auth.error });
    }

    const orders = await orderService.getUserOrders(
      parsed.data.makerAddress,
      parsed.data.status,
      parsed.data.limit,
      parsed.data.offset,
    );
    res.json({ orders });
  } catch (err) {
    next(err);
  }
});

export default router;
