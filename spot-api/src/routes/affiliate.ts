import { NextFunction, Router, Request, Response } from 'express';
import { affiliateService } from '../services/affiliateService';
import prisma from '../db';
import { z } from 'zod';
import {
  verifyWalletActionSignature,
  verifyWalletReadSignature,
} from '../middleware/auth';
import { requireAdmin } from '../middleware/adminGuard';

const router = Router();

const SignedActionSchema = z.object({
  nonce: z.string().min(8),
  timestamp: z.coerce.number().int().positive(),
  signature: z.string().min(8),
});

const RegisterReferralSchema = SignedActionSchema.extend({
  refereeAddress: z.string().min(3),
  referralCode: z.string().min(4).max(16),
});

const AddressQuerySchema = SignedActionSchema.extend({
  address: z.string().min(3),
});

router.post(
  '/register',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = RegisterReferralSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }
      const auth = await verifyWalletActionSignature({
        action: 'affiliate.register',
        address: parsed.data.refereeAddress,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
        signature: parsed.data.signature,
        fields: { referralCode: parsed.data.referralCode },
      });
      if (!auth.ok) return res.status(401).json({ error: auth.error });
      const referral = await affiliateService.registerReferral(
        parsed.data.refereeAddress,
        parsed.data.referralCode,
      );
      res.status(201).json({ referral });
    } catch (err) {
      next(err);
    }
  },
);

router.get('/code', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = AddressQuerySchema.safeParse(req.query);
    if (!parsed.success)
      return res.status(400).json({ error: 'address required' });
    const auth = await verifyWalletReadSignature({
      action: 'affiliate.code',
      address: parsed.data.address,
      nonce: parsed.data.nonce,
      timestamp: parsed.data.timestamp,
      signature: parsed.data.signature,
    });
    if (!auth.ok) return res.status(401).json({ error: auth.error });
    const code = await affiliateService.getOrCreateReferralCode(
      parsed.data.address,
    );
    res.json({ code, link: `https://lunex.io/?ref=${code}` });
  } catch (err) {
    next(err);
  }
});

router.get(
  '/dashboard',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = AddressQuerySchema.safeParse(req.query);
      if (!parsed.success)
        return res.status(400).json({ error: 'address required' });
      const auth = await verifyWalletReadSignature({
        action: 'affiliate.dashboard',
        address: parsed.data.address,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
        signature: parsed.data.signature,
      });
      if (!auth.ok) return res.status(401).json({ error: auth.error });
      const dashboard = await affiliateService.getDashboard(
        parsed.data.address,
      );
      res.json({ dashboard });
    } catch (err) {
      next(err);
    }
  },
);

router.get('/tree', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = AddressQuerySchema.safeParse(req.query);
    if (!parsed.success)
      return res.status(400).json({ error: 'address required' });
    const depth = Math.min(parseInt(req.query.depth as string) || 3, 5);
    const auth = await verifyWalletReadSignature({
      action: 'affiliate.tree',
      address: parsed.data.address,
      nonce: parsed.data.nonce,
      timestamp: parsed.data.timestamp,
      signature: parsed.data.signature,
      fields: { depth },
    });
    if (!auth.ok) return res.status(401).json({ error: auth.error });
    const tree = await affiliateService.getReferralTree(
      parsed.data.address,
      depth,
    );
    res.json({ tree });
  } catch (err) {
    next(err);
  }
});

router.get(
  '/payouts',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = AddressQuerySchema.safeParse(req.query);
      if (!parsed.success)
        return res.status(400).json({ error: 'address required' });
      const limit =
        req.pagination?.limit ??
        Math.min(parseInt(req.query.limit as string) || 20, 100);
      const auth = await verifyWalletReadSignature({
        action: 'affiliate.payouts',
        address: parsed.data.address,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
        signature: parsed.data.signature,
        fields: { limit },
      });
      if (!auth.ok) return res.status(401).json({ error: auth.error });
      const payouts = await affiliateService.getPayoutHistory(
        parsed.data.address,
        limit,
      );
      res.json({ payouts });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/payout/process',
  requireAdmin,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await affiliateService.processPayoutBatch();
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// Global affiliate program stats (admin panel)
router.get(
  '/stats',
  requireAdmin,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [
        totalCommissions,
        unpaidCommissions,
        totalReferrals,
        levelBreakdown,
        commissionsBySource,
      ] = await Promise.all([
        prisma.affiliateCommission.aggregate({
          _sum: { commissionAmount: true },
          _count: { id: true },
        }),
        prisma.affiliateCommission.aggregate({
          where: { isPaid: false },
          _sum: { commissionAmount: true },
          _count: { id: true },
        }),
        prisma.referral.count(),
        prisma.referral.groupBy({
          by: ['level'],
          _count: { id: true },
        }),
        prisma.affiliateCommission.groupBy({
          by: ['sourceType'],
          _sum: { commissionAmount: true },
          _count: { id: true },
        }),
      ]);

      res.json({
        stats: {
          totalCommissions: parseFloat(
            totalCommissions._sum.commissionAmount?.toString() || '0',
          ),
          totalTransactions: totalCommissions._count.id,
          unpaidCommissions: parseFloat(
            unpaidCommissions._sum.commissionAmount?.toString() || '0',
          ),
          unpaidCount: unpaidCommissions._count.id,
          totalReferrals,
          levelBreakdown: levelBreakdown.map((l) => ({
            level: l.level,
            count: l._count.id,
          })),
          bySource: commissionsBySource.map((s) => ({
            sourceType: s.sourceType,
            total: parseFloat(s._sum.commissionAmount?.toString() || '0'),
            count: s._count.id,
          })),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// Top affiliates by total commission earned (admin panel)
router.get(
  '/top',
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

      const [topAffiliates, referralCounts] = await Promise.all([
        prisma.affiliateCommission.groupBy({
          by: ['beneficiaryAddr'],
          _sum: { commissionAmount: true },
          _count: { id: true },
          orderBy: { _sum: { commissionAmount: 'desc' } },
          take: limit,
        }),
        prisma.referral.groupBy({
          by: ['referrerAddress'],
          _count: { id: true },
        }),
      ]);

      const referralMap = Object.fromEntries(
        referralCounts.map((r) => [r.referrerAddress, r._count.id]),
      );

      res.json({
        top: topAffiliates.map((aff, i) => ({
          rank: i + 1,
          address: aff.beneficiaryAddr,
          totalCommission: parseFloat(
            aff._sum.commissionAmount?.toString() || '0',
          ),
          transactions: aff._count.id,
          referrals: referralMap[aff.beneficiaryAddr] ?? 0,
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
