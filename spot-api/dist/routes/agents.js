"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const agentService_1 = require("../services/agentService");
const agentAuth_1 = require("../middleware/agentAuth");
const router = (0, express_1.Router)();
// ─── Validation Schemas ──────────────────────────────────────────
const RegisterAgentSchema = zod_1.z.object({
    walletAddress: zod_1.z.string().min(8).max(128),
    agentType: zod_1.z.enum(['HUMAN', 'AI_AGENT', 'OPENCLAW_BOT', 'ALGO_BOT']),
    framework: zod_1.z.string().max(64).optional(),
    strategyDescription: zod_1.z.string().max(2000).optional(),
    linkLeaderId: zod_1.z.string().uuid().optional(),
});
const CreateApiKeySchema = zod_1.z.object({
    label: zod_1.z.string().max(64).optional(),
    permissions: zod_1.z.array(zod_1.z.enum(['TRADE_SPOT', 'TRADE_MARGIN', 'SOCIAL_POST', 'COPYTRADE_SIGNAL', 'READ_ONLY'])).min(1),
    expiresInDays: zod_1.z.coerce.number().int().min(1).max(365).optional(),
});
const RecordStakeSchema = zod_1.z.object({
    amount: zod_1.z.coerce.number().positive(),
    token: zod_1.z.string().max(32).optional(),
    txHash: zod_1.z.string().max(128).optional(),
});
const ListAgentsSchema = zod_1.z.object({
    agentType: zod_1.z.enum(['HUMAN', 'AI_AGENT', 'OPENCLAW_BOT', 'ALGO_BOT']).optional(),
    isActive: zod_1.z.coerce.boolean().optional(),
    sortBy: zod_1.z.enum(['totalTrades', 'totalVolume', 'stakedAmount', 'createdAt']).optional(),
    limit: zod_1.z.coerce.number().int().min(1).max(100).optional(),
    offset: zod_1.z.coerce.number().int().min(0).optional(),
});
// ─── Public Routes ──────────────────────────────────────────────
/** Register a new agent */
router.post('/register', async (req, res) => {
    try {
        const parsed = RegisterAgentSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const agent = await agentService_1.agentService.registerAgent(parsed.data);
        res.status(201).json({ agent });
    }
    catch (err) {
        const status = err.message?.includes('already registered') ? 409 : 500;
        res.status(status).json({ error: err.message });
    }
});
/** List all agents (public leaderboard) */
router.get('/', async (req, res) => {
    try {
        const parsed = ListAgentsSchema.safeParse(req.query);
        const filters = parsed.success ? parsed.data : {};
        const result = await agentService_1.agentService.listAgents(filters);
        res.json(result);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
/** Get agent profile by ID */
router.get('/:id', async (req, res) => {
    try {
        const agent = await agentService_1.agentService.getAgentProfile(req.params.id);
        res.json({ agent });
    }
    catch (err) {
        res.status(404).json({ error: err.message });
    }
});
/** Get agent by wallet address */
router.get('/by-wallet/:address', async (req, res) => {
    try {
        const agent = await agentService_1.agentService.getAgentByWallet(req.params.address);
        if (!agent) {
            return res.status(404).json({ error: 'Agent not found for this wallet' });
        }
        res.json({ agent });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
/** Get staking tiers info */
router.get('/config/staking-tiers', (_req, res) => {
    res.json({ tiers: agentService_1.agentService.STAKING_TIERS });
});
// ─── Authenticated Routes ────────────────────────────────────────
/** Create API key (requires existing API key or first-time setup via wallet) */
router.post('/:id/api-keys', async (req, res) => {
    try {
        const parsed = CreateApiKeySchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const result = await agentService_1.agentService.createApiKey(req.params.id, parsed.data);
        res.status(201).json(result);
    }
    catch (err) {
        const status = err.message?.includes('not found') ? 404
            : err.message?.includes('banned') ? 403
                : err.message?.includes('Maximum') ? 429 : 500;
        res.status(status).json({ error: err.message });
    }
});
/** Revoke API key */
router.delete('/:id/api-keys/:keyId', async (req, res) => {
    try {
        await agentService_1.agentService.revokeApiKey(req.params.id, req.params.keyId);
        res.json({ revoked: true });
    }
    catch (err) {
        res.status(404).json({ error: err.message });
    }
});
/** List API keys for agent */
router.get('/:id/api-keys', async (req, res) => {
    try {
        const keys = await agentService_1.agentService.getApiKeys(req.params.id);
        res.json({ keys });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
/** Record staking transaction */
router.post('/:id/stake', async (req, res) => {
    try {
        const parsed = RecordStakeSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const result = await agentService_1.agentService.recordStake(req.params.id, parsed.data);
        res.status(201).json(result);
    }
    catch (err) {
        res.status(404).json({ error: err.message });
    }
});
/** Check agent permissions (authenticated) */
router.get('/:id/permissions', (0, agentAuth_1.agentAuth)(), async (req, res) => {
    res.json({
        agentId: req.agent.id,
        permissions: req.agent.permissions,
        stakingTier: req.agent.stakingTier,
        tradingLimits: {
            dailyTradeLimit: req.agent.dailyTradeLimit,
            maxPositionSize: req.agent.maxPositionSize,
            maxOpenOrders: req.agent.maxOpenOrders,
        },
    });
});
exports.default = router;
//# sourceMappingURL=agents.js.map