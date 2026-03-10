"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.agentService = void 0;
const crypto_1 = require("crypto");
const db_1 = __importDefault(require("../db"));
const STAKING_TIERS = [
    { minStake: 0, dailyTradeLimit: 10, maxPositionSize: 100, maxOpenOrders: 5 },
    { minStake: 100, dailyTradeLimit: 100, maxPositionSize: 1000, maxOpenOrders: 20 },
    { minStake: 1000, dailyTradeLimit: 500, maxPositionSize: 10000, maxOpenOrders: 50 },
    { minStake: 10000, dailyTradeLimit: 2000, maxPositionSize: 100000, maxOpenOrders: 200 },
];
function resolveTier(stakedAmount) {
    let tier = 0;
    for (let i = STAKING_TIERS.length - 1; i >= 0; i--) {
        if (stakedAmount >= STAKING_TIERS[i].minStake) {
            tier = i;
            break;
        }
    }
    return { tier, limits: STAKING_TIERS[tier] };
}
// ─── API Key Helpers ────────────────────────────────────────────
function generateApiKey() {
    const raw = `lnx_${(0, crypto_1.randomBytes)(32).toString('hex')}`;
    const prefix = raw.slice(0, 8);
    const hash = (0, crypto_1.createHash)('sha256').update(raw).digest('hex');
    return { raw, prefix, hash };
}
function hashApiKey(raw) {
    return (0, crypto_1.createHash)('sha256').update(raw).digest('hex');
}
// ─── Service ────────────────────────────────────────────────────
exports.agentService = {
    async registerAgent(input) {
        const existing = await db_1.default.agent.findUnique({
            where: { walletAddress: input.walletAddress },
        });
        if (existing) {
            throw new Error('Agent already registered with this wallet address');
        }
        const agent = await db_1.default.agent.create({
            data: {
                walletAddress: input.walletAddress,
                agentType: input.agentType,
                framework: input.framework || null,
                strategyDescription: input.strategyDescription || null,
                leaderId: input.linkLeaderId || null,
            },
            include: { leader: true },
        });
        return formatAgent(agent);
    },
    async createApiKey(agentId, input) {
        const agent = await db_1.default.agent.findUnique({ where: { id: agentId } });
        if (!agent)
            throw new Error('Agent not found');
        if (agent.isBanned)
            throw new Error('Agent is banned');
        const activeKeys = await db_1.default.agentApiKey.count({
            where: { agentId, revokedAt: null, expiresAt: { gt: new Date() } },
        });
        if (activeKeys >= 5) {
            throw new Error('Maximum 5 active API keys per agent');
        }
        const { raw, prefix, hash } = generateApiKey();
        const expiresInDays = input.expiresInDays ?? 90;
        const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
        const apiKey = await db_1.default.agentApiKey.create({
            data: {
                agentId,
                label: input.label ?? 'default',
                keyPrefix: prefix,
                keyHash: hash,
                permissions: input.permissions,
                expiresAt,
            },
        });
        return {
            id: apiKey.id,
            key: raw,
            prefix,
            label: apiKey.label,
            permissions: apiKey.permissions,
            expiresAt: apiKey.expiresAt.toISOString(),
        };
    },
    async revokeApiKey(agentId, keyId) {
        const key = await db_1.default.agentApiKey.findFirst({
            where: { id: keyId, agentId, revokedAt: null },
        });
        if (!key)
            throw new Error('API key not found or already revoked');
        await db_1.default.agentApiKey.update({
            where: { id: keyId },
            data: { revokedAt: new Date() },
        });
    },
    async verifyApiKey(rawKey) {
        const hash = hashApiKey(rawKey);
        const key = await db_1.default.agentApiKey.findUnique({
            where: { keyHash: hash },
            include: { agent: true },
        });
        if (!key)
            return null;
        if (key.revokedAt)
            return null;
        if (key.expiresAt < new Date())
            return null;
        if (!key.agent.isActive || key.agent.isBanned)
            return null;
        await db_1.default.agentApiKey.update({
            where: { id: key.id },
            data: { lastUsedAt: new Date() },
        });
        return {
            agent: key.agent,
            permissions: key.permissions,
            keyId: key.id,
        };
    },
    async getAgentProfile(agentId) {
        const agent = await db_1.default.agent.findUnique({
            where: { id: agentId },
            include: { leader: true, stakes: { where: { status: 'STAKED' } } },
        });
        if (!agent)
            throw new Error('Agent not found');
        return formatAgent(agent);
    },
    async getAgentByWallet(walletAddress) {
        const agent = await db_1.default.agent.findUnique({
            where: { walletAddress },
            include: { leader: true, stakes: { where: { status: 'STAKED' } } },
        });
        if (!agent)
            return null;
        return formatAgent(agent);
    },
    async listAgents(filters) {
        const where = {};
        if (filters.agentType)
            where.agentType = filters.agentType;
        if (filters.isActive !== undefined)
            where.isActive = filters.isActive;
        where.isBanned = false;
        const orderBy = filters.sortBy === 'totalTrades' ? { totalTrades: 'desc' }
            : filters.sortBy === 'totalVolume' ? { totalVolume: 'desc' }
                : filters.sortBy === 'stakedAmount' ? { stakedAmount: 'desc' }
                    : { createdAt: 'desc' };
        const [agents, total] = await Promise.all([
            db_1.default.agent.findMany({
                where,
                orderBy,
                take: filters.limit ?? 20,
                skip: filters.offset ?? 0,
                include: { leader: true },
            }),
            db_1.default.agent.count({ where }),
        ]);
        return {
            agents: agents.map(formatAgent),
            total,
        };
    },
    async recordStake(agentId, input) {
        const agent = await db_1.default.agent.findUnique({ where: { id: agentId } });
        if (!agent)
            throw new Error('Agent not found');
        const stake = await db_1.default.agentStake.create({
            data: {
                agentId,
                amount: input.amount,
                token: input.token ?? 'LUNES',
                txHash: input.txHash ?? null,
                status: 'STAKED',
            },
        });
        const newTotal = parseFloat(agent.stakedAmount.toString()) + input.amount;
        const { tier, limits } = resolveTier(newTotal);
        await db_1.default.agent.update({
            where: { id: agentId },
            data: {
                stakedAmount: newTotal,
                stakingTier: tier,
                dailyTradeLimit: limits.dailyTradeLimit,
                maxPositionSize: limits.maxPositionSize,
                maxOpenOrders: limits.maxOpenOrders,
            },
        });
        return {
            stakeId: stake.id,
            newStakedAmount: newTotal,
            tier,
            limits,
        };
    },
    async slashAgent(agentId, reason) {
        const agent = await db_1.default.agent.findUnique({
            where: { id: agentId },
            include: { stakes: { where: { status: 'STAKED' } } },
        });
        if (!agent)
            throw new Error('Agent not found');
        await db_1.default.$transaction([
            ...agent.stakes.map((stake) => db_1.default.agentStake.update({
                where: { id: stake.id },
                data: { status: 'SLASHED', slashedAt: new Date(), slashReason: reason },
            })),
            db_1.default.agent.update({
                where: { id: agentId },
                data: {
                    stakedAmount: 0,
                    stakingTier: 0,
                    dailyTradeLimit: STAKING_TIERS[0].dailyTradeLimit,
                    maxPositionSize: STAKING_TIERS[0].maxPositionSize,
                    maxOpenOrders: STAKING_TIERS[0].maxOpenOrders,
                    isBanned: true,
                    banReason: reason,
                },
            }),
        ]);
    },
    async getApiKeys(agentId) {
        const keys = await db_1.default.agentApiKey.findMany({
            where: { agentId },
            orderBy: { createdAt: 'desc' },
        });
        return keys.map((k) => ({
            id: k.id,
            label: k.label,
            prefix: k.keyPrefix,
            permissions: k.permissions,
            expiresAt: k.expiresAt.toISOString(),
            revokedAt: k.revokedAt?.toISOString() || null,
            lastUsedAt: k.lastUsedAt?.toISOString() || null,
            createdAt: k.createdAt.toISOString(),
            isActive: !k.revokedAt && k.expiresAt > new Date(),
        }));
    },
    STAKING_TIERS,
};
// ─── Formatters ─────────────────────────────────────────────────
function formatAgent(agent) {
    const { tier, limits } = resolveTier(parseFloat(agent.stakedAmount?.toString() ?? '0'));
    return {
        id: agent.id,
        walletAddress: agent.walletAddress,
        agentType: agent.agentType,
        framework: agent.framework,
        strategyDescription: agent.strategyDescription,
        isActive: agent.isActive,
        isBanned: agent.isBanned,
        stakingTier: tier,
        stakedAmount: parseFloat(agent.stakedAmount?.toString() ?? '0'),
        tradingLimits: {
            dailyTradeLimit: limits.dailyTradeLimit,
            maxPositionSize: limits.maxPositionSize,
            maxOpenOrders: limits.maxOpenOrders,
        },
        totalTrades: agent.totalTrades,
        totalVolume: parseFloat(agent.totalVolume?.toString() ?? '0'),
        lastActiveAt: agent.lastActiveAt?.toISOString() ?? null,
        createdAt: agent.createdAt.toISOString(),
        leader: agent.leader
            ? {
                id: agent.leader.id,
                name: agent.leader.name,
                username: agent.leader.username,
                avatar: agent.leader.avatar,
                roi30d: parseFloat(agent.leader.roi30d?.toString() ?? '0'),
                followers: agent.leader.followersCount,
            }
            : null,
    };
}
//# sourceMappingURL=agentService.js.map