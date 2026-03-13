"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.strategyService = void 0;
const db_1 = __importDefault(require("../db"));
// ─── Reputation score weights ────────────────────────────────────
const REPUTATION_WEIGHTS = {
    roi30d: 0.35,
    sharpeRatio: 0.25,
    winRate: 0.20,
    maxDrawdownInverse: 0.10, // lower drawdown = higher score
    followersNorm: 0.10,
};
const MAX_FOLLOWERS_NORM = 10000;
function computeReputationScore(params) {
    const roi = Math.min(Math.max(params.roi30d, -1), 5); // clamp -100%..+500%
    const roiNorm = (roi + 1) / 6; // → 0..1
    const sharpeNorm = Math.min(params.sharpeRatio / 3, 1); // 3 = excellent
    const winRateNorm = Math.min(Math.max(params.winRate, 0), 1);
    const ddInverse = 1 - Math.min(Math.max(params.maxDrawdown, 0), 1);
    const followersNorm = Math.min(params.followersCount / MAX_FOLLOWERS_NORM, 1);
    const score = roiNorm * REPUTATION_WEIGHTS.roi30d +
        sharpeNorm * REPUTATION_WEIGHTS.sharpeRatio +
        winRateNorm * REPUTATION_WEIGHTS.winRate +
        ddInverse * REPUTATION_WEIGHTS.maxDrawdownInverse +
        followersNorm * REPUTATION_WEIGHTS.followersNorm;
    return Math.round(score * 100 * 100) / 100; // 0-100, 2 decimals
}
// ─── Service ─────────────────────────────────────────────────────
exports.strategyService = {
    // ── CRUD ──────────────────────────────────────────────────────
    async createStrategy(input) {
        const agent = await db_1.default.agent.findUnique({ where: { id: input.agentId } });
        if (!agent)
            throw new Error('Agent not found');
        if (!agent.isActive)
            throw new Error('Agent is not active');
        if (input.leaderId) {
            const leader = await db_1.default.leader.findUnique({ where: { id: input.leaderId } });
            if (!leader)
                throw new Error('Leader not found');
        }
        const strategy = await db_1.default.strategy.create({
            data: {
                agentId: input.agentId,
                name: input.name,
                description: input.description ?? null,
                strategyType: input.strategyType ?? 'CUSTOM',
                riskLevel: input.riskLevel ?? 'MEDIUM',
                leaderId: input.leaderId ?? null,
                vaultAddress: input.vaultAddress ?? null,
                isPublic: input.isPublic ?? true,
            },
            include: { agent: { select: { walletAddress: true, agentType: true, framework: true } }, leader: true },
        });
        return strategy;
    },
    async getStrategy(id) {
        const strategy = await db_1.default.strategy.findUnique({
            where: { id },
            include: {
                agent: { select: { walletAddress: true, agentType: true, framework: true, reputationScore: true } },
                leader: { select: { id: true, name: true, username: true, avatar: true, isAi: true, isVerified: true } },
            },
        });
        if (!strategy)
            throw new Error('Strategy not found');
        return strategy;
    },
    async updateStrategy(id, agentId, input) {
        const strategy = await db_1.default.strategy.findUnique({ where: { id } });
        if (!strategy)
            throw new Error('Strategy not found');
        if (strategy.agentId !== agentId)
            throw new Error('Unauthorized: not the strategy owner');
        return db_1.default.strategy.update({
            where: { id },
            data: {
                ...(input.name !== undefined && { name: input.name }),
                ...(input.description !== undefined && { description: input.description }),
                ...(input.strategyType !== undefined && { strategyType: input.strategyType }),
                ...(input.riskLevel !== undefined && { riskLevel: input.riskLevel }),
                ...(input.status !== undefined && { status: input.status }),
                ...(input.isPublic !== undefined && { isPublic: input.isPublic }),
                ...(input.vaultAddress !== undefined && { vaultAddress: input.vaultAddress }),
            },
        });
    },
    async listStrategies(input = {}) {
        const { strategyType, riskLevel, status, isPublic, agentId, search, sortBy = 'roi30d', sortDir = 'desc', limit = 20, offset = 0, } = input;
        // When querying by agentId (agent's own strategies), show all statuses/visibility unless explicitly filtered.
        // For public discovery (no agentId), default to ACTIVE + PUBLIC.
        const effectiveStatus = status ?? (agentId ? undefined : 'ACTIVE');
        const effectiveIsPublic = isPublic ?? (agentId ? undefined : true);
        const where = {
            ...(strategyType && { strategyType }),
            ...(riskLevel && { riskLevel }),
            ...(agentId && { agentId }),
            ...(effectiveStatus && { status: effectiveStatus }),
            ...(effectiveIsPublic !== undefined && { isPublic: effectiveIsPublic }),
            ...(search?.trim() && {
                OR: [
                    { name: { contains: search.trim(), mode: 'insensitive' } },
                    { description: { contains: search.trim(), mode: 'insensitive' } },
                ],
            }),
        };
        const [strategies, total] = await Promise.all([
            db_1.default.strategy.findMany({
                where,
                orderBy: { [sortBy]: sortDir },
                take: limit,
                skip: offset,
                include: {
                    agent: { select: { walletAddress: true, agentType: true, framework: true, reputationScore: true } },
                    leader: { select: { id: true, name: true, username: true, avatar: true, isAi: true } },
                },
            }),
            db_1.default.strategy.count({ where }),
        ]);
        return { strategies, total, limit, offset };
    },
    // ── Follow / Unfollow ─────────────────────────────────────────
    async followStrategy(strategyId, followerAddress, allocatedCapital) {
        const strategy = await db_1.default.strategy.findUnique({ where: { id: strategyId } });
        if (!strategy)
            throw new Error('Strategy not found');
        if (strategy.status !== 'ACTIVE')
            throw new Error('Cannot follow a non-active strategy');
        if (!strategy.isPublic)
            throw new Error('Strategy is private');
        const existing = await db_1.default.strategyFollow.findUnique({
            where: { strategyId_followerAddress: { strategyId, followerAddress } },
        });
        if (existing) {
            if (existing.isActive)
                throw new Error('Already following this strategy');
            // Re-activate
            await db_1.default.strategyFollow.update({
                where: { id: existing.id },
                data: {
                    isActive: true,
                    followedAt: new Date(),
                    unfollowedAt: null,
                    allocatedCapital: allocatedCapital ?? existing.allocatedCapital,
                },
            });
        }
        else {
            await db_1.default.strategyFollow.create({
                data: {
                    strategyId,
                    followerAddress,
                    allocatedCapital: allocatedCapital ?? 0,
                },
            });
        }
        // Increment followersCount
        const updated = await db_1.default.strategy.update({
            where: { id: strategyId },
            data: { followersCount: { increment: 1 } },
        });
        return { following: true, followersCount: updated.followersCount };
    },
    async unfollowStrategy(strategyId, followerAddress) {
        const follow = await db_1.default.strategyFollow.findUnique({
            where: { strategyId_followerAddress: { strategyId, followerAddress } },
        });
        if (!follow || !follow.isActive)
            throw new Error('Not following this strategy');
        await db_1.default.strategyFollow.update({
            where: { id: follow.id },
            data: { isActive: false, unfollowedAt: new Date() },
        });
        const updated = await db_1.default.strategy.update({
            where: { id: strategyId },
            data: { followersCount: { decrement: 1 } },
        });
        return { following: false, followersCount: updated.followersCount };
    },
    async getFollowers(strategyId, limit = 50, offset = 0) {
        const [followers, total] = await Promise.all([
            db_1.default.strategyFollow.findMany({
                where: { strategyId, isActive: true },
                orderBy: { followedAt: 'desc' },
                take: limit,
                skip: offset,
                select: {
                    id: true,
                    followerAddress: true,
                    allocatedCapital: true,
                    followedAt: true,
                },
            }),
            db_1.default.strategyFollow.count({ where: { strategyId, isActive: true } }),
        ]);
        return { followers, total };
    },
    async getFollowedStrategies(followerAddress) {
        return db_1.default.strategyFollow.findMany({
            where: { followerAddress, isActive: true },
            include: {
                strategy: {
                    include: {
                        agent: { select: { walletAddress: true, agentType: true, reputationScore: true } },
                        leader: { select: { name: true, username: true, avatar: true } },
                    },
                },
            },
            orderBy: { followedAt: 'desc' },
        });
    },
    // ── Performance: daily snapshot ───────────────────────────────
    async getPerformanceHistory(strategyId, days = 30) {
        const since = new Date();
        since.setDate(since.getDate() - days);
        return db_1.default.strategyPerformance.findMany({
            where: { strategyId, date: { gte: since } },
            orderBy: { date: 'asc' },
        });
    },
    // ── Reputation Engine: sync from LeaderAnalyticsSnapshot ──────
    async syncPerformanceFromLeader(strategyId) {
        const strategy = await db_1.default.strategy.findUnique({ where: { id: strategyId } });
        if (!strategy)
            throw new Error('Strategy not found');
        if (!strategy.leaderId)
            throw new Error('Strategy has no linked leader; cannot sync from leader analytics');
        const snapshot = await db_1.default.leaderAnalyticsSnapshot.findUnique({
            where: { leaderId_sourceChain: { leaderId: strategy.leaderId, sourceChain: 'lunes' } },
        });
        if (!snapshot)
            return null;
        // Daily snapshot for today
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        await db_1.default.strategyPerformance.upsert({
            where: { strategyId_date: { strategyId, date: today } },
            create: {
                strategyId,
                date: today,
                roi: snapshot.roi30d,
                pnl: snapshot.realizedPnl,
                volume: snapshot.tradedVolume,
                trades: snapshot.totalTrades,
                equity: snapshot.currentEquity,
                drawdown: snapshot.maxDrawdown,
            },
            update: {
                roi: snapshot.roi30d,
                pnl: snapshot.realizedPnl,
                volume: snapshot.tradedVolume,
                trades: snapshot.totalTrades,
                equity: snapshot.currentEquity,
                drawdown: snapshot.maxDrawdown,
            },
        });
        // Compute reputation score
        const reputationScore = computeReputationScore({
            roi30d: Number(snapshot.roi30d),
            sharpeRatio: Number(snapshot.sharpe),
            winRate: Number(snapshot.winRate),
            maxDrawdown: Number(snapshot.maxDrawdown),
            followersCount: strategy.followersCount,
        });
        // Update strategy performance fields + Agent reputation
        const [updated] = await Promise.all([
            db_1.default.strategy.update({
                where: { id: strategyId },
                data: {
                    roi30d: snapshot.roi30d,
                    sharpeRatio: snapshot.sharpe,
                    maxDrawdown: snapshot.maxDrawdown,
                    winRate: snapshot.winRate,
                    totalTrades: snapshot.totalTrades,
                    totalVolume: snapshot.tradedVolume,
                    vaultEquity: snapshot.currentEquity,
                    performanceSyncedAt: new Date(),
                },
            }),
            db_1.default.agent.update({
                where: { id: strategy.agentId },
                data: { reputationScore },
            }),
        ]);
        return { strategy: updated, reputationScore };
    },
    // ── Marketplace: top strategies ranked by composite score ─────
    async getMarketplace(input = {}) {
        const { strategyType, riskLevel, search, sortBy = 'roi30d', limit = 20, offset = 0 } = input;
        const where = {
            status: 'ACTIVE',
            isPublic: true,
            ...(strategyType && { strategyType }),
            ...(riskLevel && { riskLevel }),
            ...(search?.trim() && {
                OR: [
                    { name: { contains: search.trim(), mode: 'insensitive' } },
                    { description: { contains: search.trim(), mode: 'insensitive' } },
                ],
            }),
        };
        // Rank by selected field, secondary: followersCount DESC
        const [strategies, total] = await Promise.all([
            db_1.default.strategy.findMany({
                where,
                orderBy: [{ [sortBy]: 'desc' }, { followersCount: 'desc' }],
                take: limit,
                skip: offset,
                include: {
                    agent: {
                        select: {
                            walletAddress: true,
                            agentType: true,
                            framework: true,
                            reputationScore: true,
                        },
                    },
                    leader: {
                        select: {
                            id: true,
                            name: true,
                            username: true,
                            avatar: true,
                            isAi: true,
                            isVerified: true,
                            roi30d: true,
                            followersCount: true,
                        },
                    },
                },
            }),
            db_1.default.strategy.count({ where }),
        ]);
        return { strategies, total, limit, offset };
    },
    // ── Bulk sync all strategies that have a linked leader ─────────
    async syncAllLeaderStrategies() {
        const strategies = await db_1.default.strategy.findMany({
            where: { leaderId: { not: null }, status: 'ACTIVE' },
            select: { id: true },
        });
        const results = await Promise.allSettled(strategies.map((s) => exports.strategyService.syncPerformanceFromLeader(s.id)));
        const succeeded = results.filter((r) => r.status === 'fulfilled').length;
        const failed = results.filter((r) => r.status === 'rejected').length;
        return { total: strategies.length, succeeded, failed };
    },
};
//# sourceMappingURL=strategyService.js.map