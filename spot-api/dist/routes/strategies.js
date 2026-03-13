"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const strategyService_1 = require("../services/strategyService");
const agentAuth_1 = require("../middleware/agentAuth");
const router = (0, express_1.Router)();
// ─── Validation Schemas ──────────────────────────────────────────
const StrategyTypeValues = ['COPYTRADE', 'MARKET_MAKER', 'ARBITRAGE', 'MOMENTUM', 'HEDGE', 'CUSTOM'];
const RiskLevelValues = ['LOW', 'MEDIUM', 'HIGH', 'AGGRESSIVE'];
const StatusValues = ['ACTIVE', 'PAUSED', 'ARCHIVED'];
const CreateStrategySchema = zod_1.z.object({
    name: zod_1.z.string().min(3).max(128),
    description: zod_1.z.string().max(2000).optional(),
    strategyType: zod_1.z.enum(StrategyTypeValues).optional(),
    riskLevel: zod_1.z.enum(RiskLevelValues).optional(),
    leaderId: zod_1.z.string().uuid().optional(),
    vaultAddress: zod_1.z.string().max(128).optional(),
    isPublic: zod_1.z.boolean().optional(),
});
const UpdateStrategySchema = zod_1.z.object({
    name: zod_1.z.string().min(3).max(128).optional(),
    description: zod_1.z.string().max(2000).optional(),
    strategyType: zod_1.z.enum(StrategyTypeValues).optional(),
    riskLevel: zod_1.z.enum(RiskLevelValues).optional(),
    status: zod_1.z.enum(StatusValues).optional(),
    isPublic: zod_1.z.boolean().optional(),
    vaultAddress: zod_1.z.string().max(128).optional(),
});
const ListStrategiesSchema = zod_1.z.object({
    strategyType: zod_1.z.enum(StrategyTypeValues).optional(),
    riskLevel: zod_1.z.enum(RiskLevelValues).optional(),
    status: zod_1.z.enum(StatusValues).optional(),
    isPublic: zod_1.z.coerce.boolean().optional(),
    agentId: zod_1.z.string().uuid().optional(),
    search: zod_1.z.string().max(200).optional(),
    sortBy: zod_1.z.enum(['roi30d', 'followersCount', 'totalVolume', 'sharpeRatio', 'createdAt']).optional(),
    sortDir: zod_1.z.enum(['asc', 'desc']).optional(),
    limit: zod_1.z.coerce.number().int().min(1).max(100).optional(),
    offset: zod_1.z.coerce.number().int().min(0).optional(),
});
const MarketplaceSchema = zod_1.z.object({
    strategyType: zod_1.z.enum(StrategyTypeValues).optional(),
    riskLevel: zod_1.z.enum(RiskLevelValues).optional(),
    search: zod_1.z.string().max(200).optional(),
    sortBy: zod_1.z.enum(['roi30d', 'followersCount', 'totalVolume', 'sharpeRatio']).optional(),
    limit: zod_1.z.coerce.number().int().min(1).max(100).optional(),
    offset: zod_1.z.coerce.number().int().min(0).optional(),
});
const FollowSchema = zod_1.z.object({
    followerAddress: zod_1.z.string().min(8).max(128),
    allocatedCapital: zod_1.z.coerce.number().nonnegative().optional(),
});
const UnfollowSchema = zod_1.z.object({
    followerAddress: zod_1.z.string().min(8).max(128),
});
// ─── Public Routes ───────────────────────────────────────────────
// GET /strategies/marketplace — top strategies ranked by ROI + followers
router.get('/marketplace', async (req, res, next) => {
    try {
        const parsed = MarketplaceSchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const result = await strategyService_1.strategyService.getMarketplace(parsed.data);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
// GET /strategies — list strategies (public discovery or agent's own with auth)
router.get('/', (0, agentAuth_1.optionalAgentAuth)(), async (req, res, next) => {
    try {
        const parsed = ListStrategiesSchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const input = { ...parsed.data };
        // If agentId filter is set but the requester is NOT that agent, restrict to public+active
        if (input.agentId && req.agent?.id !== input.agentId) {
            input.isPublic = true;
            input.status = 'ACTIVE';
        }
        const result = await strategyService_1.strategyService.listStrategies(input);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
// GET /strategies/:id — strategy detail
router.get('/:id', async (req, res, next) => {
    try {
        const strategy = await strategyService_1.strategyService.getStrategy(req.params.id);
        res.json({ strategy });
    }
    catch (err) {
        if (err.message === 'Strategy not found')
            return res.status(404).json({ error: err.message });
        next(err);
    }
});
// GET /strategies/:id/performance — historical daily snapshots
router.get('/:id/performance', async (req, res, next) => {
    try {
        const days = Math.min(Number(req.query.days ?? 30), 365);
        const history = await strategyService_1.strategyService.getPerformanceHistory(req.params.id, days);
        res.json({ history, days });
    }
    catch (err) {
        next(err);
    }
});
// GET /strategies/:id/followers — list active followers
router.get('/:id/followers', async (req, res, next) => {
    try {
        const limit = Math.min(Number(req.query.limit ?? 50), 200);
        const offset = Number(req.query.offset ?? 0);
        const result = await strategyService_1.strategyService.getFollowers(req.params.id, limit, offset);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
// GET /strategies/followed/:address — strategies followed by a wallet
router.get('/followed/:address', async (req, res, next) => {
    try {
        const followed = await strategyService_1.strategyService.getFollowedStrategies(req.params.address);
        res.json({ followed });
    }
    catch (err) {
        next(err);
    }
});
// ─── Authenticated Routes (agent API key required) ────────────────
// POST /strategies — create a new strategy (agent must be authenticated)
router.post('/', (0, agentAuth_1.agentAuth)(), async (req, res, next) => {
    try {
        const parsed = CreateStrategySchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const strategy = await strategyService_1.strategyService.createStrategy({
            agentId: req.agent.id,
            ...parsed.data,
        });
        res.status(201).json({ strategy });
    }
    catch (err) {
        if (err.message?.includes('not found') || err.message?.includes('not active')) {
            return res.status(400).json({ error: err.message });
        }
        next(err);
    }
});
// PATCH /strategies/:id — update strategy (owner only)
router.patch('/:id', (0, agentAuth_1.agentAuth)(), async (req, res, next) => {
    try {
        const parsed = UpdateStrategySchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const strategy = await strategyService_1.strategyService.updateStrategy(req.params.id, req.agent.id, parsed.data);
        res.json({ strategy });
    }
    catch (err) {
        if (err.message === 'Strategy not found')
            return res.status(404).json({ error: err.message });
        if (err.message?.includes('Unauthorized'))
            return res.status(403).json({ error: err.message });
        next(err);
    }
});
// POST /strategies/:id/follow — follow a strategy
router.post('/:id/follow', async (req, res, next) => {
    try {
        const parsed = FollowSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const result = await strategyService_1.strategyService.followStrategy(req.params.id, parsed.data.followerAddress, parsed.data.allocatedCapital);
        res.status(201).json(result);
    }
    catch (err) {
        if (err.message?.includes('not found'))
            return res.status(404).json({ error: err.message });
        if (err.message?.includes('Already following'))
            return res.status(409).json({ error: err.message });
        if (err.message?.includes('Cannot follow') || err.message?.includes('private')) {
            return res.status(400).json({ error: err.message });
        }
        next(err);
    }
});
// DELETE /strategies/:id/follow — unfollow a strategy
router.delete('/:id/follow', async (req, res, next) => {
    try {
        const parsed = UnfollowSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const result = await strategyService_1.strategyService.unfollowStrategy(req.params.id, parsed.data.followerAddress);
        res.json(result);
    }
    catch (err) {
        if (err.message?.includes('Not following'))
            return res.status(404).json({ error: err.message });
        next(err);
    }
});
// POST /strategies/:id/sync-performance — trigger reputation sync (agent owner only)
router.post('/:id/sync-performance', (0, agentAuth_1.agentAuth)(), async (req, res, next) => {
    try {
        const strategy = await strategyService_1.strategyService.getStrategy(req.params.id);
        if (strategy.agentId !== req.agent.id) {
            return res.status(403).json({ error: 'Unauthorized: not the strategy owner' });
        }
        const result = await strategyService_1.strategyService.syncPerformanceFromLeader(req.params.id);
        if (!result)
            return res.status(404).json({ error: 'No analytics snapshot found for linked leader' });
        res.json(result);
    }
    catch (err) {
        if (err.message === 'Strategy not found')
            return res.status(404).json({ error: err.message });
        if (err.message?.includes('no linked leader'))
            return res.status(400).json({ error: err.message });
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=strategies.js.map