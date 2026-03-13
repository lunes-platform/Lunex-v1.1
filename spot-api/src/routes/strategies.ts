import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { strategyService } from '../services/strategyService'
import { agentAuth, optionalAgentAuth } from '../middleware/agentAuth'

const router = Router()

// ─── Validation Schemas ──────────────────────────────────────────

const StrategyTypeValues = ['COPYTRADE', 'MARKET_MAKER', 'ARBITRAGE', 'MOMENTUM', 'HEDGE', 'CUSTOM'] as const
const RiskLevelValues    = ['LOW', 'MEDIUM', 'HIGH', 'AGGRESSIVE'] as const
const StatusValues       = ['ACTIVE', 'PAUSED', 'ARCHIVED'] as const

const CreateStrategySchema = z.object({
    name:         z.string().min(3).max(128),
    description:  z.string().max(2000).optional(),
    strategyType: z.enum(StrategyTypeValues).optional(),
    riskLevel:    z.enum(RiskLevelValues).optional(),
    leaderId:     z.string().uuid().optional(),
    vaultAddress: z.string().max(128).optional(),
    isPublic:     z.boolean().optional(),
})

const UpdateStrategySchema = z.object({
    name:         z.string().min(3).max(128).optional(),
    description:  z.string().max(2000).optional(),
    strategyType: z.enum(StrategyTypeValues).optional(),
    riskLevel:    z.enum(RiskLevelValues).optional(),
    status:       z.enum(StatusValues).optional(),
    isPublic:     z.boolean().optional(),
    vaultAddress: z.string().max(128).optional(),
})

const ListStrategiesSchema = z.object({
    strategyType: z.enum(StrategyTypeValues).optional(),
    riskLevel:    z.enum(RiskLevelValues).optional(),
    status:       z.enum(StatusValues).optional(),
    isPublic:     z.coerce.boolean().optional(),
    agentId:      z.string().uuid().optional(),
    search:       z.string().max(200).optional(),
    sortBy:       z.enum(['roi30d', 'followersCount', 'totalVolume', 'sharpeRatio', 'createdAt']).optional(),
    sortDir:      z.enum(['asc', 'desc']).optional(),
    limit:        z.coerce.number().int().min(1).max(100).optional(),
    offset:       z.coerce.number().int().min(0).optional(),
})

const MarketplaceSchema = z.object({
    strategyType: z.enum(StrategyTypeValues).optional(),
    riskLevel:    z.enum(RiskLevelValues).optional(),
    search:       z.string().max(200).optional(),
    sortBy:       z.enum(['roi30d', 'followersCount', 'totalVolume', 'sharpeRatio']).optional(),
    limit:        z.coerce.number().int().min(1).max(100).optional(),
    offset:       z.coerce.number().int().min(0).optional(),
})

const FollowSchema = z.object({
    followerAddress:  z.string().min(8).max(128),
    allocatedCapital: z.coerce.number().nonnegative().optional(),
})

const UnfollowSchema = z.object({
    followerAddress: z.string().min(8).max(128),
})

// ─── Public Routes ───────────────────────────────────────────────

// GET /strategies/marketplace — top strategies ranked by ROI + followers
router.get('/marketplace', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const parsed = MarketplaceSchema.safeParse(req.query)
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues })
        }
        const result = await strategyService.getMarketplace(parsed.data)
        res.json(result)
    } catch (err) { next(err) }
})

// GET /strategies — list strategies (public discovery or agent's own with auth)
router.get('/', optionalAgentAuth(), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const parsed = ListStrategiesSchema.safeParse(req.query)
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues })
        }

        const input = { ...parsed.data }

        // If agentId filter is set but the requester is NOT that agent, restrict to public+active
        if (input.agentId && req.agent?.id !== input.agentId) {
            input.isPublic = true
            input.status   = 'ACTIVE' as const
        }

        const result = await strategyService.listStrategies(input)
        res.json(result)
    } catch (err) { next(err) }
})

// GET /strategies/:id — strategy detail
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const strategy = await strategyService.getStrategy(req.params.id)
        res.json({ strategy })
    } catch (err: any) {
        if (err.message === 'Strategy not found') return res.status(404).json({ error: err.message })
        next(err)
    }
})

// GET /strategies/:id/performance — historical daily snapshots
router.get('/:id/performance', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const days = Math.min(Number(req.query.days ?? 30), 365)
        const history = await strategyService.getPerformanceHistory(req.params.id, days)
        res.json({ history, days })
    } catch (err) { next(err) }
})

// GET /strategies/:id/followers — list active followers
router.get('/:id/followers', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const limit  = Math.min(Number(req.query.limit  ?? 50), 200)
        const offset = Number(req.query.offset ?? 0)
        const result = await strategyService.getFollowers(req.params.id, limit, offset)
        res.json(result)
    } catch (err) { next(err) }
})

// GET /strategies/followed/:address — strategies followed by a wallet
router.get('/followed/:address', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const followed = await strategyService.getFollowedStrategies(req.params.address)
        res.json({ followed })
    } catch (err) { next(err) }
})

// ─── Authenticated Routes (agent API key required) ────────────────

// POST /strategies — create a new strategy (agent must be authenticated)
router.post('/', agentAuth(), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const parsed = CreateStrategySchema.safeParse(req.body)
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues })
        }
        const strategy = await strategyService.createStrategy({
            agentId: req.agent!.id,
            ...parsed.data,
        })
        res.status(201).json({ strategy })
    } catch (err: any) {
        if (err.message?.includes('not found') || err.message?.includes('not active')) {
            return res.status(400).json({ error: err.message })
        }
        next(err)
    }
})

// PATCH /strategies/:id — update strategy (owner only)
router.patch('/:id', agentAuth(), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const parsed = UpdateStrategySchema.safeParse(req.body)
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues })
        }
        const strategy = await strategyService.updateStrategy(req.params.id, req.agent!.id, parsed.data)
        res.json({ strategy })
    } catch (err: any) {
        if (err.message === 'Strategy not found') return res.status(404).json({ error: err.message })
        if (err.message?.includes('Unauthorized'))  return res.status(403).json({ error: err.message })
        next(err)
    }
})

// POST /strategies/:id/follow — follow a strategy
router.post('/:id/follow', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const parsed = FollowSchema.safeParse(req.body)
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues })
        }
        const result = await strategyService.followStrategy(
            req.params.id,
            parsed.data.followerAddress,
            parsed.data.allocatedCapital,
        )
        res.status(201).json(result)
    } catch (err: any) {
        if (err.message?.includes('not found'))        return res.status(404).json({ error: err.message })
        if (err.message?.includes('Already following')) return res.status(409).json({ error: err.message })
        if (err.message?.includes('Cannot follow') || err.message?.includes('private')) {
            return res.status(400).json({ error: err.message })
        }
        next(err)
    }
})

// DELETE /strategies/:id/follow — unfollow a strategy
router.delete('/:id/follow', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const parsed = UnfollowSchema.safeParse(req.body)
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues })
        }
        const result = await strategyService.unfollowStrategy(req.params.id, parsed.data.followerAddress)
        res.json(result)
    } catch (err: any) {
        if (err.message?.includes('Not following')) return res.status(404).json({ error: err.message })
        next(err)
    }
})

// POST /strategies/:id/sync-performance — trigger reputation sync (agent owner only)
router.post('/:id/sync-performance', agentAuth(), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const strategy = await strategyService.getStrategy(req.params.id)
        if (strategy.agentId !== req.agent!.id) {
            return res.status(403).json({ error: 'Unauthorized: not the strategy owner' })
        }
        const result = await strategyService.syncPerformanceFromLeader(req.params.id)
        if (!result) return res.status(404).json({ error: 'No analytics snapshot found for linked leader' })
        res.json(result)
    } catch (err: any) {
        if (err.message === 'Strategy not found') return res.status(404).json({ error: err.message })
        if (err.message?.includes('no linked leader')) return res.status(400).json({ error: err.message })
        next(err)
    }
})

export default router
