import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/adminGuard';
import { walletRiskService } from '../services/walletRiskService';
import { emergencyService } from '../services/emergencyService';
import { log } from '../utils/logger';

const router = Router();

const BanWalletSchema = z.object({
  reason: z.string().trim().min(1, 'Ban reason is required'),
  bannedBy: z.string().trim().min(1, 'Admin user id is required'),
});

const EmergencyActionSchema = z.object({
  reason: z.string().trim().min(1, 'A reason is required for audit log'),
  performedBy: z
    .string()
    .trim()
    .min(1, 'Admin identifier required for audit log'),
});

router.post(
  '/wallets/:address/ban',
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = BanWalletSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }

      const wallet = await walletRiskService.banWallet(
        req.params.address,
        parsed.data.reason,
        parsed.data.bannedBy,
      );

      res.json({ wallet });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  '/wallets/:address/ban',
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const wallet = await walletRiskService.unbanWallet(req.params.address);
      res.json({ wallet });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Emergency Controls ─────────────────────────────────────────────────────
// Wraps the on-chain pause/unpause messages of spot_settlement. The contract
// rejects orders + settlements when paused. copy_vault and staking are
// reported as "not wired" until their pause flow is integrated here.

router.get(
  '/emergency/status',
  requireAdmin,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const status = await emergencyService.getStatus();
      res.json(status);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/emergency/spot/pause',
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = EmergencyActionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }

      log.warn(
        { performedBy: parsed.data.performedBy, reason: parsed.data.reason },
        '[Emergency] PAUSE requested by admin',
      );

      const result = await emergencyService.pauseSpot();
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/emergency/spot/unpause',
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = EmergencyActionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }

      log.warn(
        { performedBy: parsed.data.performedBy, reason: parsed.data.reason },
        '[Emergency] UNPAUSE requested by admin',
      );

      const result = await emergencyService.unpauseSpot();
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
