/**
 * Favorite Pairs API
 *
 * GET    /api/v1/user/:address/favorites          — list all favorites
 * POST   /api/v1/user/:address/favorites          — add a favorite
 * DELETE /api/v1/user/:address/favorites/:symbol   — remove a favorite
 */

import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const router = Router({ mergeParams: true })

const AddFavoriteSchema = z.object({
  pairSymbol: z.string().min(1),
})

// ─── List favorites ─────────────────────────────────────────────
router.get('/:address/favorites', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { address } = req.params
    const favorites = await prisma.favorite.findMany({
      where: { walletAddress: address },
      orderBy: { createdAt: 'asc' },
    })
    res.json({ favorites: favorites.map(f => f.pairSymbol) })
  } catch (err) { next(err) }
})

// ─── Add favorite ───────────────────────────────────────────────
router.post('/:address/favorites', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { address } = req.params
    const parsed = AddFavoriteSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues })
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
    })

    res.status(201).json({ ok: true })
  } catch (err) { next(err) }
})

// ─── Remove favorite ────────────────────────────────────────────
router.delete('/:address/favorites/:symbol', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { address, symbol } = req.params
    const decoded = decodeURIComponent(symbol)

    await prisma.favorite.deleteMany({
      where: { walletAddress: address, pairSymbol: decoded },
    })

    res.json({ ok: true })
  } catch (err) { next(err) }
})

export default router
