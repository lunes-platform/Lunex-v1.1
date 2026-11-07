import { NextFunction, Router, Request, Response } from 'express';
import { ListingTier, ListingStatus } from '@prisma/client';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
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
  finalizeWithdrawLockByOnChainId,
  getListingStats,
  processExpiredLocks,
  CreateListingInput,
  ActivateListingInput,
  TIER_CONFIG,
  TierKey,
} from '../services/listingService';
import { requireAdmin } from '../middleware/adminGuard';
import {
  getSignedAuthInput,
  verifyWalletActionSignature,
  verifyWalletReadSignature,
} from '../middleware/auth';
import {
  readAuthSchema,
  verifyWalletReadAccess,
} from '../middleware/readSession';
import { z } from 'zod';
import { optionalHttpsUrl } from '../utils/validation';

const router = Router();

// ─── Logo upload config ──────────────────────────────────────────
const TOKENS_DIR = path.join(__dirname, '..', '..', 'public', 'tokens');
fs.mkdirSync(TOKENS_DIR, { recursive: true });

const ALLOWED_MIMES = ['image/png', 'image/webp'];
const MAX_LOGO_SIZE = 200 * 1024; // 200 KB

// Memory storage: nothing touches the disk until the wallet signature has
// been verified (BE-23). Limits bound every multipart dimension — busboy's
// defaults allow unlimited fields of up to 1 MB each.
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_LOGO_SIZE,
    files: 1,
    fields: 30,
    fieldSize: 4 * 1024,
    fieldNameSize: 64,
    parts: 32,
    headerPairs: 50,
  },
  fileFilter: (_req, file, cb) => {
    if (file.fieldname !== 'logo' || !ALLOWED_MIMES.includes(file.mimetype)) {
      return cb(new Error('Invalid file type. Accepted: PNG, WebP'));
    }
    cb(null, true);
  },
});

/** Multer wrapper: limit/type violations become 4xx instead of 500. */
function parseLogoUpload(req: Request, res: Response, next: NextFunction) {
  logoUpload.single('logo')(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const tooLarge =
        err.code === 'LIMIT_FILE_SIZE' ||
        err.code === 'LIMIT_FIELD_VALUE' ||
        err.code === 'LIMIT_PART_COUNT' ||
        err.code === 'LIMIT_FIELD_COUNT' ||
        err.code === 'LIMIT_FILE_COUNT';
      return res.status(tooLarge ? 413 : 400).json({
        error: 'Invalid upload',
        code: err.code,
      });
    }
    if (err instanceof Error && err.message.startsWith('Invalid file type')) {
      return res
        .status(400)
        .json({ error: err.message, code: 'INVALID_FILE_TYPE' });
    }
    return next(err);
  });
}

type LogoKind = 'png' | 'webp';

/** Content sniffing — the client-declared mimetype is not trusted. */
function detectLogoKind(file: Express.Multer.File): LogoKind | null {
  const buffer = file.buffer;
  if (!buffer) return null;
  const isPng =
    file.mimetype === 'image/png' &&
    buffer.length >= 8 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (isPng) return 'png';
  const isWebp =
    file.mimetype === 'image/webp' &&
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  return isWebp ? 'webp' : null;
}

/**
 * Persists a verified logo under a random name (no client-controlled path
 * component) and returns its public URI. `wx` refuses to overwrite.
 */
function persistLogo(file: Express.Multer.File, kind: LogoKind): string {
  const name = `${crypto.randomBytes(16).toString('hex')}.${kind}`;
  const target = path.join(TOKENS_DIR, name);
  if (path.dirname(target) !== TOKENS_DIR) {
    throw new Error('Invalid logo path');
  }
  fs.writeFileSync(target, file.buffer, { flag: 'wx' });
  return `/tokens/${name}`;
}

function removePersistedLogo(logoURI?: string) {
  if (!logoURI) return;
  try {
    fs.unlinkSync(path.join(TOKENS_DIR, path.basename(logoURI)));
  } catch {
    // Best-effort cleanup only.
  }
}

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
    website: optionalHttpsUrl,
    // On-chain list_token result (fee paid + LP lock). Optional for
    // backwards compatibility; when present they are covered by the wallet
    // signature. Activation still only happens from the chain event.
    txHash: z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/)
      .optional(),
    pairAddress: z.string().min(40).max(64).optional(),
    lpTokenAddress: z.string().min(40).max(64).optional(),
    lpAmount: z
      .string()
      .regex(/^\d+(\.\d+)?$/)
      .max(80)
      .optional(),
    onChainListingId: z.coerce.number().int().min(0).optional(),
  })
  .merge(SignedActionSchema);

const WithdrawLockSchema = z
  .object({
    ownerAddress: z.string().min(8).max(128),
    txHash: z.string().min(8).max(128),
  })
  .merge(SignedActionSchema);

const ListListingsQuerySchema = z.object({
  tier: z.nativeEnum(ListingTier).optional(),
  status: z.nativeEnum(ListingStatus).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

const SignedOwnerReadSchema = SignedActionSchema.extend({
  address: z.string().min(8).max(128),
});

const ActivateListingSchema = z.object({
  onChainListingId: z.coerce.number().int().nonnegative(),
  onChainLockId: z.coerce.number().int().nonnegative(),
  pairAddress: z.string().min(8).max(128),
  lpTokenAddress: z.string().min(8).max(128),
  lpAmount: z.union([z.string(), z.number()]).transform(String),
  txHash: z.string().min(8).max(128),
});

const FinalizeWithdrawSchema = z.object({
  ownerAddress: z.string().min(8).max(128),
  txHash: z.string().min(8).max(128),
});

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
    // Strict query schema: qs objects (`status[not]=…`) never reach Prisma.
    const query = ListListingsQuerySchema.safeParse(req.query);
    if (!query.success) {
      return res.status(400).json({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: query.error.issues,
      });
    }
    const { tier, status, limit, offset } = query.data;

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
      const parsed = readAuthSchema(req, SignedOwnerReadSchema).safeParse({
        ...req.query,
        ...getSignedAuthInput(req),
        address: req.params.address,
      });
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }
      const auth = await verifyWalletReadAccess(req, {
        action: 'listing.owner',
        address: parsed.data.address,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
        signature: parsed.data.signature,
      });
      if (!auth.ok) return res.status(401).json({ error: auth.error });

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
  parseLogoUpload,
  async (req: Request, res: Response, next: NextFunction) => {
    let logoURI: string | undefined;
    try {
      const parsed = CreateListingSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }

      const logoKind = req.file ? detectLogoKind(req.file) : null;
      if (req.file && !logoKind) {
        return res.status(400).json({ error: 'Invalid logo file content' });
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
          txHash: parsed.data.txHash,
          pairAddress: parsed.data.pairAddress,
          lpTokenAddress: parsed.data.lpTokenAddress,
          lpAmount: parsed.data.lpAmount,
          onChainListingId: parsed.data.onChainListingId,
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

      // Signature verified — only now does the logo reach the disk.
      if (req.file && logoKind) {
        logoURI = persistLogo(req.file, logoKind);
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
      removePersistedLogo(logoURI);
      if (msg.includes('already listed') || msg.includes('Insufficient')) {
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
      const parsed = ActivateListingSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'On-chain listing proof is required before activation',
          details: parsed.error.issues,
        });
      }
      const input: ActivateListingInput = {
        ...parsed.data,
      };
      const listing = await activateListing(req.params.id, input);
      res.json({ message: 'Listing activated', listing });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (
        msg.includes('On-chain listing proof') ||
        msg.includes('Finalized') ||
        msg.includes('requires SUBQUERY') ||
        msg.includes('must be PENDING') ||
        msg.includes('must be a') ||
        msg.includes('Listing not found')
      ) {
        return res.status(400).json({ error: msg });
      }
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
  '/lock/onchain/:onChainLockId/withdraw-finalized',
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const onChainLockId = z.coerce
        .number()
        .int()
        .nonnegative()
        .parse(req.params.onChainLockId);
      const parsed = FinalizeWithdrawSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }

      const lock = await finalizeWithdrawLockByOnChainId(
        onChainLockId,
        parsed.data.ownerAddress,
        parsed.data.txHash,
      );
      res.json({ message: 'Lock withdrawal finalized', lock });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (
        msg.includes('Lock not found') ||
        msg.includes('Not the lock owner') ||
        msg.includes('Already withdrawn') ||
        msg.includes('Finalized') ||
        msg.includes('requires SUBQUERY')
      ) {
        return res.status(400).json({ error: msg });
      }
      next(err);
    }
  },
);

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
        msg.includes('expires') ||
        msg.includes('txHash is required') ||
        msg.includes('Finalized') ||
        msg.includes('requires SUBQUERY')
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
