import { NextFunction, Router, Request, Response } from 'express';
import { orderService } from '../services/orderService';
import {
  CreateOrderSchema,
  CancelOrderSchema,
  ss58Address,
} from '../utils/validation';
import {
  checkSignedTimestamp,
  verifySpotOrderSignature,
  verifyWalletActionSignature,
  consumeNonce,
  isNonceUsed,
  getSignedAuthInput,
} from '../middleware/auth';
import {
  readAuthSchema,
  verifyWalletReadAccess,
} from '../middleware/readSession';
import { checkRedisRateLimit } from '../utils/redisRateLimit';
import { z } from 'zod';

const router = Router();

const SignedReadSchema = z.object({
  makerAddress: ss58Address,
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

    // Validate timestamp freshness (±5 min past, small future skew only)
    const freshness = checkSignedTimestamp(parsed.data.timestamp);
    if (freshness !== 'ok') {
      return res.status(401).json({
        error:
          freshness === 'future'
            ? 'Order timestamp in the future'
            : 'Expired order signature',
      });
    }

    // Prevent nonce replay
    const nonceKey = `nonce:spot-order:${parsed.data.makerAddress}:${parsed.data.nonce}`;
    if (await isNonceUsed(nonceKey)) {
      return res.status(401).json({ error: 'Order nonce already used' });
    }

    // v3 (domain + chain bound). Unbound v2/v1 only with SIGNING_ACCEPT_LEGACY.
    const version = await verifySpotOrderSignature(
      parsed.data,
      parsed.data.signature,
      parsed.data.makerAddress,
    );
    if (!version) return res.status(401).json({ error: 'Invalid signature' });

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

      // Authenticate FIRST: the cancel quota is keyed by wallet, so counting
      // unauthenticated attempts would let anyone exhaust a victim's quota
      // (BE-08). Unauthenticated spam is bounded by the per-IP orderLimiter.
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

      // Anti-spoofing: rate limit authenticated cancellations per wallet
      if (await isCancelRateLimited(parsed.data.makerAddress)) {
        return res.status(429).json({
          error: 'Too many cancellations. Max 20 per minute.',
          code: 'RATE_LIMITED',
        });
      }

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
    const parsed = readAuthSchema(req, SignedReadSchema).safeParse({
        ...req.query,
        ...getSignedAuthInput(req),
      });
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const auth = await verifyWalletReadAccess(req, {
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
