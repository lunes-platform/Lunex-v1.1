import { NextFunction, Router, Request, Response } from 'express';
import { ListingTier, ListingStatus } from '@prisma/client';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import {
  getAllTierConfigs,
  createListing,
  activateListing,
  rejectListing,
  getListingById,
  getListingByToken,
  getListings,
  getOwnerListings,
  withdrawLock,
  getListingStats,
  processExpiredLocks,
  CreateListingInput,
  ActivateListingInput,
  TIER_CONFIG,
  TierKey,
} from '../services/listingService';
import { requireAdmin } from '../middleware/adminGuard';
import { verifyWalletActionSignature } from '../middleware/auth';
import { z } from 'zod';

const router = Router();

// ─── Logo upload config ──────────────────────────────────────────
const TOKENS_DIR = path.join(__dirname, '..', '..', 'public', 'tokens');
fs.mkdirSync(TOKENS_DIR, { recursive: true });

const ALLOWED_MIMES = ['image/svg+xml', 'image/png', 'image/webp'];
const MAX_LOGO_SIZE = 200 * 1024; // 200 KB

const logoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, TOKENS_DIR),
  filename: (req, file, cb) => {
    const rawAddress =
      typeof req.body?.tokenAddress === 'string'
        ? req.body.tokenAddress
        : 'unknown';
    const addr =
      rawAddress.toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'token';
    const ext =
      file.mimetype === 'image/svg+xml'
        ? '.svg'
        : file.mimetype === 'image/webp'
          ? '.webp'
          : '.png';
    cb(null, `${addr}${ext}`);
  },
});

const logoUpload = multer({
  storage: logoStorage,
  limits: { fileSize: MAX_LOGO_SIZE },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIMES.includes(file.mimetype)) {
      return cb(new Error('Invalid file type. Accepted: SVG, PNG, WebP'));
    }
    cb(null, true);
  },
});

// ─── Validation schemas ────────────────────────────────────────────

const SignedActionSchema = z.object({
  nonce: z.string().min(8),
  timestamp: z.coerce.number().int().positive(),
  signature: z.string().min(8),
});

const CreateListingSchema = z
  .object({
    ownerAddress: z.string().min(8).max(128),
    tokenAddress: z.string().min(3).max(128),
    tokenName: z.string().min(1).max(120),
    tokenSymbol: z.string().min(1).max(32),
    tokenDecimals: z.coerce.number().optional(),
    tier: z.enum(['BASIC', 'VERIFIED', 'FEATURED']),
    lunesLiquidity: z.union([z.string(), z.number()]),
    tokenLiquidity: z.union([z.string(), z.number()]),
    description: z.string().max(2000).optional(),
    website: z.string().trim().url().max(300).optional().or(z.literal('')),
  })
  .merge(SignedActionSchema);

const WithdrawLockSchema = z
  .object({
    ownerAddress: z.string().min(8).max(128),
    txHash: z.string().max(128).optional(),
  })
  .merge(SignedActionSchema);

// ── GET /api/v1/listing/tiers ─────────────────────────────────────
// Public: returns all tier configs with fee distribution breakdown
router.get(
  '/tiers',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const tiers = await getAllTierConfigs();
      res.json({ tiers });
    } catch (err) {
      next(err);
    }
  },
);

// ── GET /api/v1/listing/stats ─────────────────────────────────────
// Public: aggregate stats (total locked, by tier/status)
router.get(
  '/stats',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const stats = await getListingStats();
      res.json(stats);
    } catch (err) {
      next(err);
    }
  },
);

// ── GET /api/v1/listing ───────────────────────────────────────────
// Public: paginated listing index
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tier = req.query.tier as ListingTier | undefined;
    const status = req.query.status as ListingStatus | undefined;
    const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10), 100);
    const offset = parseInt(String(req.query.offset ?? '0'), 10);

    const listings = await getListings({ tier, status, limit, offset });
    res.json({ listings, limit, offset });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/listing/token/:tokenAddress ───────────────────────
router.get(
  '/token/:tokenAddress',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const listing = await getListingByToken(req.params.tokenAddress);
      if (!listing) return res.status(404).json({ error: 'Token not listed' });
      res.json(listing);
    } catch (err) {
      next(err);
    }
  },
);

// ── GET /api/v1/listing/owner/:address ───────────────────────────
router.get(
  '/owner/:address',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const listings = await getOwnerListings(req.params.address);
      res.json({ listings });
    } catch (err) {
      next(err);
    }
  },
);

// ── GET /api/v1/listing/:id ───────────────────────────────────────
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const listing = await getListingById(req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    res.json(listing);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/listing ──────────────────────────────────────────
// Create a new token listing with optional logo upload
router.post(
  '/',
  logoUpload.single('logo'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = CreateListingSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }

      const auth = await verifyWalletActionSignature({
        action: 'listing.create',
        address: parsed.data.ownerAddress,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
        signature: parsed.data.signature,
        fields: {
          tokenAddress: parsed.data.tokenAddress,
          tokenName: parsed.data.tokenName,
          tokenSymbol: parsed.data.tokenSymbol,
          tier: parsed.data.tier,
          lunesLiquidity: parsed.data.lunesLiquidity,
          tokenLiquidity: parsed.data.tokenLiquidity,
        },
      });
      if (!auth.ok) {
        return res.status(401).json({ error: auth.error });
      }

      const { tier, ...rest } = parsed.data;
      const tierKey = tier.toUpperCase() as TierKey;
      if (!TIER_CONFIG[tierKey]) {
        return res.status(400).json({
          error: `Invalid tier. Valid values: BASIC, VERIFIED, FEATURED`,
        });
      }

      // Build logoURI from uploaded file
      let logoURI: string | undefined;
      if (req.file) {
        logoURI = `/tokens/${req.file.filename}`;
      }

      const listing = await createListing({
        ...rest,
        tier: tierKey,
        logoURI,
      } as CreateListingInput);

      res.status(201).json({
        message: 'Listing created — pending on-chain confirmation',
        listing,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('already listed') || msg.includes('Insufficient')) {
        return res.status(400).json({ error: msg });
      }
      if (msg.includes('Invalid file type') || msg.includes('File too large')) {
        return res.status(400).json({ error: msg });
      }
      next(err);
    }
  },
);

// ── POST /api/v1/listing/:id/activate ────────────────────────────
// B2 FIX: requires admin auth — called by trusted relayer after on-chain confirmation
router.post(
  '/:id/activate',
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        onChainListingId,
        pairAddress,
        lpTokenAddress,
        lpAmount,
        txHash,
      } = req.body;
      const input: ActivateListingInput = {
        onChainListingId,
        pairAddress,
        lpTokenAddress,
        lpAmount,
        txHash,
      };
      const listing = await activateListing(req.params.id, input);
      res.json({ message: 'Listing activated', listing });
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /api/v1/listing/:id/reject ──────────────────────────────
// B2 FIX: requires admin auth
router.post(
  '/:id/reject',
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const listing = await rejectListing(req.params.id);
      res.json({ message: 'Listing rejected', listing });
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /api/v1/listing/lock/:lockId/withdraw ────────────────────
router.post(
  '/lock/:lockId/withdraw',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = WithdrawLockSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }

      const auth = await verifyWalletActionSignature({
        action: 'listing.lock.withdraw',
        address: parsed.data.ownerAddress,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
        signature: parsed.data.signature,
        fields: {
          lockId: req.params.lockId,
          txHash: parsed.data.txHash,
        },
      });
      if (!auth.ok) {
        return res.status(401).json({ error: auth.error });
      }

      const lock = await withdrawLock(
        req.params.lockId,
        parsed.data.ownerAddress,
        parsed.data.txHash,
      );
      res.json({ message: 'Lock withdrawn', lock });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (
        msg.includes('Not the lock owner') ||
        msg.includes('Already withdrawn') ||
        msg.includes('expires')
      ) {
        return res.status(400).json({ error: msg });
      }
      next(err);
    }
  },
);

// ── POST /api/v1/listing/admin/process-expired-locks ─────────────
// B2 FIX: requires admin auth — cron trigger, must not be public
router.post(
  '/admin/process-expired-locks',
  requireAdmin,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const count = await processExpiredLocks();
      res.json({ message: `Processed ${count} expired locks` });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
