import { NextFunction, Request, Response, Router } from 'express';
import { rewardDistributionService } from '../services/rewardDistributionService';
import { rewardScheduler } from '../services/rewardScheduler';
import {
  verifyWalletActionSignature,
  verifyWalletReadSignature,
} from '../middleware/auth';
import { requireAdmin } from '../middleware/adminGuard';
import { z } from 'zod';

const router = Router();

const SignedReadSchema = z.object({
  address: z.string().min(8).max(128),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  nonce: z.string().min(8),
  timestamp: z.coerce.number().int().positive(),
  signature: z.string().min(8),
});

const RankingsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  segment: z.enum(['all', 'traders', 'bots']).optional(),
  week: z.enum(['current', 'previous']).optional(),
});

// ─── Public ──────────────────────────────────────────────────────────────

/** Current week reward pool info + countdown to next distribution. */
router.get(
  '/pool',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = await rewardDistributionService.getRewardPool();
      res.json({ pool });
    } catch (err) {
      next(err);
    }
  },
);

/** Public reward-engine rankings for leaders and spot traders. */
router.get(
  '/rankings',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = RankingsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }

      const rankings = await rewardDistributionService.getPublicRankings({
        limit: parsed.data.limit,
        segment: parsed.data.segment,
        week: parsed.data.week,
      });

      res.json({ rankings });
    } catch (err) {
      next(err);
    }
  },
);

/** User's pending (unclaimed) rewards. */
router.get(
  '/pending',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = SignedReadSchema.safeParse(req.query);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }
      const auth = await verifyWalletReadSignature({
        action: 'rewards.pending',
        address: parsed.data.address,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
        signature: parsed.data.signature,
      });
      if (!auth.ok) {
        return res.status(401).json({ error: auth.error });
      }
      const pending = await rewardDistributionService.getPendingRewards(
        parsed.data.address,
      );
      res.json({ pending });
    } catch (err) {
      next(err);
    }
  },
);

/** User's reward history (claimed + unclaimed). */
router.get(
  '/history',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = SignedReadSchema.safeParse(req.query);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }
      const auth = await verifyWalletReadSignature({
        action: 'rewards.history',
        address: parsed.data.address,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
        signature: parsed.data.signature,
        fields: { limit: parsed.data.limit ?? 50 },
      });
      if (!auth.ok) {
        return res.status(401).json({ error: auth.error });
      }
      const history = await rewardDistributionService.getRewardHistory(
        parsed.data.address,
        parsed.data.limit ?? 50,
      );
      res.json({ history });
    } catch (err) {
      next(err);
    }
  },
);

/** Past distributed weeks stats. */
router.get(
  '/weeks',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = parseInt((req.query.limit as string) || '10', 10);
      const weeks = await rewardDistributionService.getDistributedWeeks(limit);
      res.json({ weeks });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Authenticated ──────────────────────────────────────────────────────

/** Claim all pending rewards — requires wallet signature. */
router.post(
  '/claim',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { address, nonce, timestamp, signature } = req.body;

      if (!address || !nonce || !timestamp || !signature) {
        return res.status(400).json({
          error:
            'Missing required fields: address, nonce, timestamp, signature',
        });
      }

      const auth = await verifyWalletActionSignature({
        action: 'rewards.claim',
        address,
        nonce,
        timestamp,
        signature,
        fields: {},
      });

      if (!auth.ok) {
        return res.status(401).json({ error: auth.error });
      }

      const result = await rewardDistributionService.claimRewards(address);
      res.json({ result });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Admin ──────────────────────────────────────────────────────────────

/** Force distribution (admin only — for testing). */
router.post(
  '/distribute',
  requireAdmin,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await rewardScheduler.forceDistribute();
      res.json({ result });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
