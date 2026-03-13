"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const agentService_1 = require("../services/agentService");
const agentAuth_1 = require("../middleware/agentAuth");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// ─── Validation Schemas ──────────────────────────────────────────
const RegisterAgentSchema = zod_1.z.object({
    walletAddress: zod_1.z.string().min(8).max(128),
    agentType: zod_1.z.enum(['HUMAN', 'AI_AGENT', 'OPENCLAW_BOT', 'ALGO_BOT']),
    framework: zod_1.z.string().max(64).optional(),
    strategyDescription: zod_1.z.string().max(2000).optional(),
    linkLeaderId: zod_1.z.string().uuid().optional(),
});
const SignedWalletActionSchema = zod_1.z.object({
    nonce: zod_1.z.string().min(8),
    timestamp: zod_1.z.coerce.number().int().positive(),
    signature: zod_1.z.string().min(8),
});
const RegisterAgentSignedSchema = RegisterAgentSchema.merge(SignedWalletActionSchema);
const CreateApiKeySchema = zod_1.z.object({
    label: zod_1.z.string().max(64).optional(),
    permissions: zod_1.z.array(zod_1.z.enum(['TRADE_SPOT', 'TRADE_MARGIN', 'SOCIAL_POST', 'COPYTRADE_SIGNAL', 'READ_ONLY', 'MANAGE_ASYMMETRIC'])).min(1),
    expiresInDays: zod_1.z.coerce.number().int().min(1).max(365).optional(),
});
const CreateApiKeyBootstrapSchema = CreateApiKeySchema.extend({
    walletAddress: zod_1.z.string().min(8).max(128),
}).merge(SignedWalletActionSchema);
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
// ─── Helpers ─────────────────────────────────────────────────────
function ensureAgentScope(req, res) {
    if (!req.agent) {
        res.status(401).json({ error: 'Missing authenticated agent context' });
        return false;
    }
    if (req.agent.id !== req.params.id) {
        res.status(403).json({ error: 'Authenticated agent does not match target agent' });
        return false;
    }
    return true;
}
// ─── Public Routes ───────────────────────────────────────────────
router.post('/register', async (req, res, next) => {
    try {
        const parsed = RegisterAgentSignedSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const auth = await (0, auth_1.verifyWalletActionSignature)({
            action: 'agents.register',
            address: parsed.data.walletAddress,
            nonce: parsed.data.nonce,
            timestamp: parsed.data.timestamp,
            signature: parsed.data.signature,
            fields: {
                agentType: parsed.data.agentType,
                framework: parsed.data.framework,
                strategyDescription: parsed.data.strategyDescription,
                linkLeaderId: parsed.data.linkLeaderId,
            },
        });
        if (!auth.ok)
            return res.status(401).json({ error: auth.error });
        const agent = await agentService_1.agentService.registerAgent(parsed.data);
        res.status(201).json({ agent });
    }
    catch (err) {
        next(err);
    }
});
router.get('/', async (req, res, next) => {
    try {
        const parsed = ListAgentsSchema.safeParse(req.query);
        const filters = parsed.success ? parsed.data : {};
        const result = await agentService_1.agentService.listAgents(filters);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
router.get('/config/staking-tiers', (_req, res) => {
    res.json({ tiers: agentService_1.agentService.STAKING_TIERS });
});
router.get('/by-wallet/:address', async (req, res, next) => {
    try {
        const agent = await agentService_1.agentService.getAgentByWallet(req.params.address);
        if (!agent)
            return res.status(404).json({ error: 'Agent not found for this wallet' });
        res.json({ agent });
    }
    catch (err) {
        next(err);
    }
});
router.get('/me', (0, agentAuth_1.agentAuth)(), async (req, res, next) => {
    try {
        const agent = await agentService_1.agentService.getAgentProfile(req.agent.id);
        res.json({ agent });
    }
    catch (err) {
        next(err);
    }
});
router.get('/:id', async (req, res, next) => {
    try {
        const agent = await agentService_1.agentService.getAgentProfile(req.params.id);
        res.json({ agent });
    }
    catch (err) {
        next(err);
    }
});
// ─── Authenticated Routes ────────────────────────────────────────
router.post('/:id/api-keys', (0, agentAuth_1.optionalAgentAuth)(), async (req, res, next) => {
    try {
        let parsedData;
        if (req.agent) {
            if (!ensureAgentScope(req, res))
                return;
            const parsed = CreateApiKeySchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
            }
            parsedData = parsed.data;
        }
        else {
            const parsed = CreateApiKeyBootstrapSchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(401).json({
                    error: 'Creating the first API key requires either X-API-Key or walletAddress, nonce, timestamp, and signature',
                });
            }
            const agent = await agentService_1.agentService.getAgentProfile(req.params.id);
            if (agent.walletAddress !== parsed.data.walletAddress) {
                return res.status(403).json({ error: 'Wallet signature does not match target agent' });
            }
            const existingKeys = await agentService_1.agentService.getApiKeys(req.params.id);
            if (existingKeys.some((key) => key.isActive)) {
                return res.status(403).json({ error: 'Existing API keys require authenticated agent key management' });
            }
            const auth = await (0, auth_1.verifyWalletActionSignature)({
                action: 'agents.create-api-key',
                address: parsed.data.walletAddress,
                nonce: parsed.data.nonce,
                timestamp: parsed.data.timestamp,
                signature: parsed.data.signature,
                fields: {
                    agentId: req.params.id,
                    label: parsed.data.label,
                    permissions: parsed.data.permissions,
                    expiresInDays: parsed.data.expiresInDays,
                },
            });
            if (!auth.ok)
                return res.status(401).json({ error: auth.error });
            parsedData = parsed.data;
        }
        const result = await agentService_1.agentService.createApiKey(req.params.id, parsedData);
        res.status(201).json(result);
    }
    catch (err) {
        next(err);
    }
});
router.delete('/:id/api-keys/:keyId', (0, agentAuth_1.agentAuth)(), async (req, res, next) => {
    try {
        if (!ensureAgentScope(req, res))
            return;
        await agentService_1.agentService.revokeApiKey(req.params.id, req.params.keyId);
        res.json({ revoked: true });
    }
    catch (err) {
        next(err);
    }
});
router.get('/:id/api-keys', (0, agentAuth_1.agentAuth)(), async (req, res, next) => {
    try {
        if (!ensureAgentScope(req, res))
            return;
        const keys = await agentService_1.agentService.getApiKeys(req.params.id);
        res.json({ keys });
    }
    catch (err) {
        next(err);
    }
});
router.post('/:id/stake', (0, agentAuth_1.agentAuth)(), async (req, res, next) => {
    try {
        if (!ensureAgentScope(req, res))
            return;
        const parsed = RecordStakeSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
        }
        const result = await agentService_1.agentService.recordStake(req.params.id, parsed.data);
        res.status(201).json(result);
    }
    catch (err) {
        next(err);
    }
});
router.get('/:id/permissions', (0, agentAuth_1.agentAuth)(), async (req, res) => {
    if (!ensureAgentScope(req, res))
        return;
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