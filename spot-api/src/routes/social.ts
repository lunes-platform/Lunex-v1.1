import { NextFunction, Request, Response, Router } from 'express';
import { socialService } from '../services/socialService';
import { socialAnalyticsService } from '../services/socialAnalyticsService';
import {
  verifyWalletActionSignature,
  verifyWalletReadSignature,
} from '../middleware/auth';
import { requireAdmin } from '../middleware/adminGuard';
import prisma from '../db';
import { z } from 'zod';
import {
  CreateIdeaCommentSchema,
  FollowLeaderSchema,
  LeaderProfileByAddressSchema,
  PaginationSchema,
  SocialLeadersQuerySchema,
  UpsertLeaderProfileSchema,
} from '../utils/validation';

const router = Router();

const COPYTRADE_DEPRECATION_RESPONSE = {
  error: 'Deprecated route',
  message:
    'Social vault operations were moved to /api/v1/copytrade/vaults/:leaderId/*',
  replacement: {
    deposit: '/api/v1/copytrade/vaults/:leaderId/deposit',
    withdraw: '/api/v1/copytrade/vaults/:leaderId/withdraw',
  },
};

async function getVerifiedViewerAddress(
  req: Request,
  res: Response,
  action: string,
  fields?: Record<string, string>,
) {
  const viewerAddress =
    typeof req.query.viewerAddress === 'string'
      ? req.query.viewerAddress
      : undefined;
  if (!viewerAddress) return undefined;

  const parsed = z
    .object({
      viewerAddress: z.string().min(8).max(128),
      nonce: z.string().min(8),
      timestamp: z.coerce.number().int().positive(),
      signature: z.string().min(8),
    })
    .safeParse(req.query);

  if (!parsed.success) {
    res
      .status(400)
      .json({ error: 'Validation failed', details: parsed.error.issues });
    return null;
  }

  const auth = await verifyWalletReadSignature({
    action,
    address: parsed.data.viewerAddress,
    nonce: parsed.data.nonce,
    timestamp: parsed.data.timestamp,
    signature: parsed.data.signature,
    fields,
  });
  if (!auth.ok) {
    res.status(401).json({ error: auth.error });
    return null;
  }

  return parsed.data.viewerAddress;
}

// ─── Analytics ──────────────────────────────────────────────────

router.get(
  '/analytics/status',
  requireAdmin,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const analytics = await socialAnalyticsService.getPipelineStatus();
      res.json({ analytics });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/analytics/recompute',
  requireAdmin,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await socialAnalyticsService.recomputeLeaderSnapshots();
      res.json({ result });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/analytics/resync-followers',
  requireAdmin,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const leaders = await prisma.leader.findMany({ select: { id: true } });
      let updated = 0;
      for (const leader of leaders) {
        const count = await prisma.leaderFollow.count({
          where: { leaderId: leader.id },
        });
        await prisma.leader.update({
          where: { id: leader.id },
          data: { followersCount: count },
        });
        updated++;
      }
      res.json({
        updated,
        message: 'followersCount resynced from LeaderFollow table',
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Stats & Leaders ─────────────────────────────────────────────

router.get(
  '/stats',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const stats = await socialService.getStats();
      res.json({ stats });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/leaders',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = SocialLeadersQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }
      const leaders = await socialService.listLeaders(parsed.data);
      res.json({ leaders });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/leaderboard',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pagination = PaginationSchema.safeParse(req.query);
      const limit = pagination.success ? pagination.data.limit : 10;
      const leaderboard = await socialService.getLeaderboard(limit);
      res.json({ leaderboard });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/following',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = z
        .object({
          address: z.string().min(8).max(128),
          nonce: z.string().min(8),
          timestamp: z.coerce.number().int().positive(),
          signature: z.string().min(8),
        })
        .safeParse(req.query);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }
      const auth = await verifyWalletReadSignature({
        action: 'social.following',
        address: parsed.data.address,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
        signature: parsed.data.signature,
      });
      if (!auth.ok) return res.status(401).json({ error: auth.error });
      const leaders = await socialService.getFollowedLeaders(
        parsed.data.address,
      );
      res.json({ leaders });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/leaders/by-address',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = LeaderProfileByAddressSchema.safeParse(req.query);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }
      const viewerAddress = await getVerifiedViewerAddress(
        req,
        res,
        'social.leader-profile-by-address',
        {
          address: parsed.data.address,
        },
      );
      if (viewerAddress === null) return;
      const leader = await socialService.getLeaderProfileByAddress(
        parsed.data.address,
        viewerAddress,
      );
      res.json({ leader });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/leaders/:leaderId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const viewerAddress = await getVerifiedViewerAddress(
        req,
        res,
        'social.leader-profile',
        {
          leaderId: req.params.leaderId,
        },
      );
      if (viewerAddress === null) return;
      const leader = await socialService.getLeaderProfile(
        req.params.leaderId,
        viewerAddress,
      );
      res.json({ leader });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/leaders/:leaderId/followers',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pagination = PaginationSchema.safeParse(req.query);
      const limit = pagination.success ? pagination.data.limit : 20;
      const followers = await socialService.getLeaderFollowers(
        req.params.leaderId,
        limit,
      );
      res.json({ followers });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Ideas ───────────────────────────────────────────────────────

router.get(
  '/ideas',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pagination = PaginationSchema.safeParse(req.query);
      const limit = pagination.success ? pagination.data.limit : 50;
      const ideas = await socialService.listIdeas(limit);
      res.json({ ideas });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/ideas/:ideaId/comments',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pagination = PaginationSchema.safeParse(req.query);
      const limit = pagination.success ? pagination.data.limit : 50;
      const comments = await socialService.getIdeaComments(
        req.params.ideaId,
        limit,
      );
      res.json({ comments });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/ideas/:ideaId/like',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = FollowLeaderSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }
      const auth = await verifyWalletActionSignature({
        action: 'social.like-idea',
        address: parsed.data.address,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
        signature: parsed.data.signature,
        fields: { ideaId: req.params.ideaId },
      });
      if (!auth.ok) return res.status(401).json({ error: auth.error });

      const result = await socialService.likeIdea(
        req.params.ideaId,
        parsed.data.address,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  '/ideas/:ideaId/like',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = FollowLeaderSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }
      const auth = await verifyWalletActionSignature({
        action: 'social.unlike-idea',
        address: parsed.data.address,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
        signature: parsed.data.signature,
        fields: { ideaId: req.params.ideaId },
      });
      if (!auth.ok) return res.status(401).json({ error: auth.error });

      const result = await socialService.unlikeIdea(
        req.params.ideaId,
        parsed.data.address,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/ideas/:ideaId/comments',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = CreateIdeaCommentSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }
      const auth = await verifyWalletActionSignature({
        action: 'social.comment-idea',
        address: parsed.data.address,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
        signature: parsed.data.signature,
        fields: { ideaId: req.params.ideaId, content: parsed.data.content },
      });
      if (!auth.ok) return res.status(401).json({ error: auth.error });

      const comment = await socialService.commentOnIdea(
        req.params.ideaId,
        parsed.data.address,
        parsed.data.content,
      );
      res.status(201).json({ comment });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Leader Profiles & Social Actions ────────────────────────────

router.post(
  '/leaders/profile',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = UpsertLeaderProfileSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }
      const auth = await verifyWalletActionSignature({
        action: 'social.upsert-profile',
        address: parsed.data.address,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
        signature: parsed.data.signature,
        fields: {
          name: parsed.data.name,
          username: parsed.data.username,
          bio: parsed.data.bio,
          avatar: parsed.data.avatar || '',
          fee: parsed.data.fee,
          twitterUrl: parsed.data.twitterUrl || '',
          telegramUrl: parsed.data.telegramUrl || '',
          discordUrl: parsed.data.discordUrl || '',
        },
      });
      if (!auth.ok) return res.status(401).json({ error: auth.error });

      const leader = await socialService.upsertLeaderProfile(parsed.data);
      res.status(201).json({ leader });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/leaders/:leaderId/follow',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = FollowLeaderSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }
      const auth = await verifyWalletActionSignature({
        action: 'social.follow-leader',
        address: parsed.data.address,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
        signature: parsed.data.signature,
        fields: { leaderId: req.params.leaderId },
      });
      if (!auth.ok) return res.status(401).json({ error: auth.error });

      const result = await socialService.followLeader(
        req.params.leaderId,
        parsed.data.address,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  '/leaders/:leaderId/follow',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = FollowLeaderSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }
      const auth = await verifyWalletActionSignature({
        action: 'social.unfollow-leader',
        address: parsed.data.address,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
        signature: parsed.data.signature,
        fields: { leaderId: req.params.leaderId },
      });
      if (!auth.ok) return res.status(401).json({ error: auth.error });

      const result = await socialService.unfollowLeader(
        req.params.leaderId,
        parsed.data.address,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Legacy Vault Routes ─────────────────────────────────────────

router.post('/vaults/:leaderId/deposit', (_req: Request, res: Response) => {
  res.status(410).json(COPYTRADE_DEPRECATION_RESPONSE);
});

router.post('/vaults/:leaderId/withdraw', (_req: Request, res: Response) => {
  res.status(410).json(COPYTRADE_DEPRECATION_RESPONSE);
});

export default router;
