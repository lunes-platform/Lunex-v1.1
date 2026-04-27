import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/adminGuard';
import { walletRiskService } from '../services/walletRiskService';

const router = Router();

const BanWalletSchema = z.object({
  reason: z.string().trim().min(1, 'Ban reason is required'),
  bannedBy: z.string().trim().min(1, 'Admin user id is required'),
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

export default router;
