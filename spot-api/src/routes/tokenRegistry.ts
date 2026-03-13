import { NextFunction, Router, Request, Response } from 'express'
import {
  getAllTokens,
  getToken,
  searchTokens,
  registerToken,
} from '../services/tokenRegistryService'
import { requireAdmin } from '../middleware/adminGuard'
import { z } from 'zod'

const router = Router()


// ── GET /api/v1/tokens ───────────────────────────────────────────
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const verified = req.query.verified === 'true' ? true : req.query.verified === 'false' ? false : undefined
    const trusted  = req.query.trusted  === 'true' ? true : req.query.trusted  === 'false' ? false : undefined
    const tokens = await getAllTokens({ verified, trusted })
    res.json({ tokens })
  } catch (err) { next(err) }
})

// ── GET /api/v1/tokens/search?q= ────────────────────────────────
router.get('/search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = String(req.query.q ?? '')
    const tokens = await searchTokens(q)
    res.json({ tokens })
  } catch (err) { next(err) }
})

// ── GET /api/v1/tokens/:address ──────────────────────────────────
router.get('/:address', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = await getToken(req.params.address)
    if (!token) return res.status(404).json({ error: 'Token not found in registry' })
    res.json(token)
  } catch (err) { next(err) }
})

// ── POST /api/v1/tokens (admin) ──────────────────────────────────
const RegisterSchema = z.object({
  address:    z.string().min(1),
  symbol:     z.string().min(1),
  name:       z.string().min(1),
  decimals:   z.number().optional(),
  logoURI:    z.string().optional(),
  isVerified: z.boolean().optional(),
  isTrusted:  z.boolean().optional(),
  source:     z.string().optional(),
})

router.post('/', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = RegisterSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues })
    }
    const token = await registerToken(parsed.data)
    res.status(201).json({ message: 'Token registered', token })
  } catch (err) { next(err) }
})

export default router
