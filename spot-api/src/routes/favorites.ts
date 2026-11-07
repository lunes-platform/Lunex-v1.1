/**
 * Favorite Pairs API
 *
 * GET    /api/v1/user/:address/favorites          — list all favorites
 * POST   /api/v1/user/:address/favorites          — add a favorite
 * DELETE /api/v1/user/:address/favorites/:symbol   — remove a favorite
 */

import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import {
  verifyWalletActionSignature,
  getSignedAuthInput,
} from '../middleware/auth';
import {
  readAuthSchema,
  verifyWalletReadAccess,
} from '../middleware/readSession';

const prisma = new PrismaClient();
const router = Router({ mergeParams: true });

const SignedActionSchema = z.object({
  nonce: z.string().min(8),
  timestamp: z.coerce.number().int().positive(),
  signature: z.string().min(8),
});

const AddFavoriteSchema = SignedActionSchema.extend({
  pairSymbol: z.string().min(1).max(32),
});

/**
 * Authorizes the favorites LIST read (accepts a read session). Writes never
 * come through here: they use verifyWalletActionSignature (write nonce
 * namespace + walletRiskService ban check, BE-20).
 */
async function authorizeFavoriteRead(req: Request, res: Response) {
  const parsed = readAuthSchema(req, SignedActionSchema).safeParse({
    ...(req.query as Record<string, unknown>),
    ...getSignedAuthInput(req, 'query'),
  });
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: 'Validation failed', details: parsed.error.issues });
    return null;
  }

  const auth = await verifyWalletReadAccess(req, {
    action: 'favorites.list',
    address: req.params.address,
    nonce: parsed.data.nonce,
    timestamp: parsed.data.timestamp,
    signature: parsed.data.signature,
  });

  if (!auth.ok) {
    res.status(401).json({ error: auth.error });
    return null;
  }

  return parsed.data;
}

// ─── List favorites ─────────────────────────────────────────────
router.get(
  '/:address/favorites',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { address } = req.params;
      const auth = await authorizeFavoriteRead(req, res);
      if (!auth) return;
      const favorites = await prisma.favorite.findMany({
        where: { walletAddress: address },
        orderBy: { createdAt: 'asc' },
      });
      res.json({ favorites: favorites.map((f) => f.pairSymbol) });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Add favorite ───────────────────────────────────────────────
router.post(
  '/:address/favorites',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { address } = req.params;
      const parsed = AddFavoriteSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }

      const auth = await verifyWalletActionSignature({
        action: 'favorites.add',
        address,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
        signature: parsed.data.signature,
        fields: { pairSymbol: parsed.data.pairSymbol },
      });
      if (!auth.ok) {
        return res.status(401).json({ error: auth.error });
      }

      await prisma.favorite.upsert({
        where: {
          walletAddress_pairSymbol: {
            walletAddress: address,
            pairSymbol: parsed.data.pairSymbol,
          },
        },
        update: {},
        create: {
          walletAddress: address,
          pairSymbol: parsed.data.pairSymbol,
        },
      });

      res.status(201).json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Remove favorite ────────────────────────────────────────────
router.delete(
  '/:address/favorites/:symbol',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { address, symbol } = req.params;
      let decoded: string;
      try {
        decoded = decodeURIComponent(symbol);
      } catch {
        return res
          .status(400)
          .json({ error: 'Invalid pair symbol', code: 'VALIDATION_ERROR' });
      }
      const parsed = SignedActionSchema.safeParse({
        ...(req.body as Record<string, unknown>),
        ...getSignedAuthInput(req, 'body'),
      });
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }
      // Removal is a write: write verifier (ban check + write nonce space).
      const auth = await verifyWalletActionSignature({
        action: 'favorites.remove',
        address,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
        signature: parsed.data.signature,
        fields: { pairSymbol: decoded },
      });
      if (!auth.ok) {
        return res.status(401).json({ error: auth.error });
      }

      await prisma.favorite.deleteMany({
        where: { walletAddress: address, pairSymbol: decoded },
      });

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
