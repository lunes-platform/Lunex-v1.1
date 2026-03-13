import { NextFunction, Request, Response, Router } from 'express'
import { rewardDistributionService } from '../services/rewardDistributionService'
import { rewardScheduler } from '../services/rewardScheduler'
import { verifyWalletActionSignature } from '../middleware/auth'
import { requireAdmin } from '../middleware/adminGuard'

const router = Router()

// ─── Public ──────────────────────────────────────────────────────────────

/** Current week reward pool info + countdown to next distribution. */
router.get('/pool', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const pool = await rewardDistributionService.getRewardPool()
    res.json({ pool })
  } catch (err) { next(err) }
})

/** User's pending (unclaimed) rewards. */
router.get('/pending', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const address = req.query.address
    if (!address || typeof address !== 'string') {
      return res.status(400).json({ error: 'address query parameter required' })
    }
    const pending = await rewardDistributionService.getPendingRewards(address)
    res.json({ pending })
  } catch (err) { next(err) }
})

/** User's reward history (claimed + unclaimed). */
router.get('/history', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const address = req.query.address
    if (!address || typeof address !== 'string') {
      return res.status(400).json({ error: 'address query parameter required' })
    }
    const limit = parseInt(req.query.limit as string || '50', 10)
    const history = await rewardDistributionService.getRewardHistory(address, limit)
    res.json({ history })
  } catch (err) { next(err) }
})

/** Past distributed weeks stats. */
router.get('/weeks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = parseInt(req.query.limit as string || '10', 10)
    const weeks = await rewardDistributionService.getDistributedWeeks(limit)
    res.json({ weeks })
  } catch (err) { next(err) }
})

// ─── Authenticated ──────────────────────────────────────────────────────

/** Claim all pending rewards — requires wallet signature. */
router.post('/claim', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { address, nonce, timestamp, signature } = req.body

    if (!address || !nonce || !timestamp || !signature) {
      return res.status(400).json({ error: 'Missing required fields: address, nonce, timestamp, signature' })
    }

    const auth = await verifyWalletActionSignature({
      action: 'rewards.claim',
      address,
      nonce,
      timestamp,
      signature,
      fields: {},
    })

    if (!auth.ok) {
      return res.status(401).json({ error: auth.error })
    }

    const result = await rewardDistributionService.claimRewards(address)
    res.json({ result })
  } catch (err) { next(err) }
})

// ─── Admin ──────────────────────────────────────────────────────────────


/** Force distribution (admin only — for testing). */
router.post('/distribute', requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await rewardScheduler.forceDistribute()
    res.json({ result })
  } catch (err) { next(err) }
})

export default router
