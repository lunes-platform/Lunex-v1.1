/**
 * Balances API
 *
 * GET /api/v1/balances            — spendable balances for every token
 * GET /api/v1/balances/:token     — spendable balance for one token
 *
 * Each entry: { token, total, locked, available } where
 *   available = total − locked   (locked = funds reserved by resting orders).
 *
 * Auth: wallet-signed read (sr25519 signature + single-use Redis nonce +
 * fresh timestamp), via `verifyWalletReadSignature`. The signing address is
 * passed in the `address` query field — the same pattern as orders.list.
 */
import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import { z } from 'zod';
import { balanceService } from '../services/balanceService';
import {
  verifyWalletReadSignature,
  getSignedAuthInput,
} from '../middleware/auth';

const router = Router();

const SignedReadSchema = z.object({
  address: z.string().min(8).max(128),
  nonce: z.string().min(8),
  timestamp: z.coerce.number().int().positive(),
  signature: z.string().min(8),
});

// ─── List all balances ──────────────────────────────────────────
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = SignedReadSchema.safeParse({
      ...req.query,
      ...getSignedAuthInput(req),
    });
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const auth = await verifyWalletReadSignature({
      action: 'balances.list',
      address: parsed.data.address,
      nonce: parsed.data.nonce,
      timestamp: parsed.data.timestamp,
      signature: parsed.data.signature,
    });
    if (!auth.ok) {
      return res.status(401).json({ error: auth.error });
    }

    const balances = await balanceService.getBalances(parsed.data.address);
    res.json({ balances });
  } catch (err) {
    next(err);
  }
});

// ─── Single-token balance ───────────────────────────────────────
router.get(
  '/:token',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = SignedReadSchema.safeParse({
        ...req.query,
        ...getSignedAuthInput(req),
      });
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }

      const token = req.params.token;

      const auth = await verifyWalletReadSignature({
        action: 'balances.get',
        address: parsed.data.address,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
        signature: parsed.data.signature,
        fields: { token },
      });
      if (!auth.ok) {
        return res.status(401).json({ error: auth.error });
      }

      const balances = await balanceService.getBalances(
        parsed.data.address,
        token,
      );
      const balance = balances[0] ?? {
        token,
        total: '0',
        locked: '0',
        available: '0',
      };
      res.json({ balance });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
