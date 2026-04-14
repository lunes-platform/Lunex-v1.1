import prisma from '../db';
import type {
  StrategyType,
  StrategyRiskLevel,
  StrategyStatus,
  Prisma,
} from '@prisma/client';

// ─── Types ───────────────────────────────────────────────────────

export interface CreateStrategyInput {
  agentId: string;
  name: string;
  description?: string;
  strategyType?: StrategyType;
  riskLevel?: StrategyRiskLevel;
  leaderId?: string;
  vaultAddress?: string;
  isPublic?: boolean;
}

export interface UpdateStrategyInput {
  name?: string;
  description?: string;
  strategyType?: StrategyType;
  riskLevel?: StrategyRiskLevel;
  status?: StrategyStatus;
  isPublic?: boolean;
  vaultAddress?: string;
}

export interface ListStrategiesInput {
  strategyType?: StrategyType;
  riskLevel?: StrategyRiskLevel;
  status?: StrategyStatus;
  isPublic?: boolean;
  agentId?: string;
  search?: string;
  sortBy?:
    | 'roi30d'
    | 'followersCount'
    | 'totalVolume'
    | 'sharpeRatio'
    | 'createdAt';
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

// ─── Reputation score weights ────────────────────────────────────

const REPUTATION_WEIGHTS = {
  roi30d: 0.35,
  sharpeRatio: 0.25,
  winRate: 0.2,
  maxDrawdownInverse: 0.1, // lower drawdown = higher score
  followersNorm: 0.1,
};
const MAX_FOLLOWERS_NORM = 10_000;

function computeReputationScore(params: {
  roi30d: number;
  sharpeRatio: number;
  winRate: number; // 0-1
  maxDrawdown: number; // 0-1
  followersCount: number;
}): number {
  const roi = Math.min(Math.max(params.roi30d, -1), 5); // clamp -100%..+500%
  const roiNorm = (roi + 1) / 6; // → 0..1

  const sharpeNorm = Math.min(params.sharpeRatio / 3, 1); // 3 = excellent

  const winRateNorm = Math.min(Math.max(params.winRate, 0), 1);

  const ddInverse = 1 - Math.min(Math.max(params.maxDrawdown, 0), 1);

  const followersNorm = Math.min(params.followersCount / MAX_FOLLOWERS_NORM, 1);

  const score =
    roiNorm * REPUTATION_WEIGHTS.roi30d +
    sharpeNorm * REPUTATION_WEIGHTS.sharpeRatio +
    winRateNorm * REPUTATION_WEIGHTS.winRate +
    ddInverse * REPUTATION_WEIGHTS.maxDrawdownInverse +
    followersNorm * REPUTATION_WEIGHTS.followersNorm;

  return Math.round(score * 100 * 100) / 100; // 0-100, 2 decimals
}

// ─── Service ─────────────────────────────────────────────────────

export const strategyService = {
  // ── CRUD ──────────────────────────────────────────────────────

  async createStrategy(input: CreateStrategyInput) {
    const agent = await prisma.agent.findUnique({
      where: { id: input.agentId },
    });
    if (!agent) throw new Error('Agent not found');
    if (!agent.isActive) throw new Error('Agent is not active');

    if (input.leaderId) {
      const leader = await prisma.leader.findUnique({
        where: { id: input.leaderId },
      });
      if (!leader) throw new Error('Leader not found');
    }

    const strategy = await prisma.strategy.create({
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
      include: {
        agent: {
          select: { walletAddress: true, agentType: true, framework: true },
        },
        leader: true,
      },
    });

    return strategy;
  },

  async getStrategy(id: string) {
    const strategy = await prisma.strategy.findUnique({
      where: { id },
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
          },
        },
      },
    });
    if (!strategy) throw new Error('Strategy not found');
    return strategy;
  },

  async updateStrategy(
    id: string,
    agentId: string,
    input: UpdateStrategyInput,
  ) {
    const strategy = await prisma.strategy.findUnique({ where: { id } });
    if (!strategy) throw new Error('Strategy not found');
    if (strategy.agentId !== agentId)
      throw new Error('Unauthorized: not the strategy owner');

    return prisma.strategy.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && {
          description: input.description,
        }),
        ...(input.strategyType !== undefined && {
          strategyType: input.strategyType,
        }),
        ...(input.riskLevel !== undefined && { riskLevel: input.riskLevel }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.isPublic !== undefined && { isPublic: input.isPublic }),
        ...(input.vaultAddress !== undefined && {
          vaultAddress: input.vaultAddress,
        }),
      },
    });
  },

  async listStrategies(input: ListStrategiesInput = {}) {
    const {
      strategyType,
      riskLevel,
      status,
      isPublic,
      agentId,
      search,
      sortBy = 'roi30d',
      sortDir = 'desc',
      limit = 20,
      offset = 0,
    } = input;

    // When querying by agentId (agent's own strategies), show all statuses/visibility unless explicitly filtered.
    // For public discovery (no agentId), default to ACTIVE + PUBLIC.
    const effectiveStatus = status ?? (agentId ? undefined : 'ACTIVE');
    const effectiveIsPublic = isPublic ?? (agentId ? undefined : true);

    const where: Prisma.StrategyWhereInput = {
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
      prisma.strategy.findMany({
        where,
        orderBy: { [sortBy]: sortDir },
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
            },
          },
        },
      }),
      prisma.strategy.count({ where }),
    ]);

    return { strategies, total, limit, offset };
  },

  // ── Follow / Unfollow ─────────────────────────────────────────

  async followStrategy(
    strategyId: string,
    followerAddress: string,
    allocatedCapital?: number,
  ) {
    const strategy = await prisma.strategy.findUnique({
      where: { id: strategyId },
    });
    if (!strategy) throw new Error('Strategy not found');
    if (strategy.status !== 'ACTIVE')
      throw new Error('Cannot follow a non-active strategy');
    if (!strategy.isPublic) throw new Error('Strategy is private');

    const existing = await prisma.strategyFollow.findUnique({
      where: { strategyId_followerAddress: { strategyId, followerAddress } },
    });

    if (existing) {
      if (existing.isActive) throw new Error('Already following this strategy');
      // Re-activate
      await prisma.strategyFollow.update({
        where: { id: existing.id },
        data: {
          isActive: true,
          followedAt: new Date(),
          unfollowedAt: null,
          allocatedCapital: allocatedCapital ?? existing.allocatedCapital,
        },
      });
    } else {
      await prisma.strategyFollow.create({
        data: {
          strategyId,
          followerAddress,
          allocatedCapital: allocatedCapital ?? 0,
        },
      });
    }

    // Increment followersCount
    const updated = await prisma.strategy.update({
      where: { id: strategyId },
      data: { followersCount: { increment: 1 } },
    });

    return { following: true, followersCount: updated.followersCount };
  },

  async unfollowStrategy(strategyId: string, followerAddress: string) {
    const follow = await prisma.strategyFollow.findUnique({
      where: { strategyId_followerAddress: { strategyId, followerAddress } },
    });
    if (!follow || !follow.isActive)
      throw new Error('Not following this strategy');

    await prisma.strategyFollow.update({
      where: { id: follow.id },
      data: { isActive: false, unfollowedAt: new Date() },
    });

    const updated = await prisma.strategy.update({
      where: { id: strategyId },
      data: { followersCount: { decrement: 1 } },
    });

    return { following: false, followersCount: updated.followersCount };
  },

  async getFollowers(strategyId: string, limit = 50, offset = 0) {
    const [followers, total] = await Promise.all([
      prisma.strategyFollow.findMany({
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
      prisma.strategyFollow.count({ where: { strategyId, isActive: true } }),
    ]);
    return { followers, total };
  },

  async getFollowedStrategies(followerAddress: string) {
    return prisma.strategyFollow.findMany({
      where: { followerAddress, isActive: true },
      include: {
        strategy: {
          include: {
            agent: {
              select: {
                walletAddress: true,
                agentType: true,
                reputationScore: true,
              },
            },
            leader: { select: { name: true, username: true, avatar: true } },
          },
        },
      },
      orderBy: { followedAt: 'desc' },
    });
  },

  // ── Performance: daily snapshot ───────────────────────────────

  async getPerformanceHistory(strategyId: string, days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    return prisma.strategyPerformance.findMany({
      where: { strategyId, date: { gte: since } },
      orderBy: { date: 'asc' },
    });
  },

  // ── Reputation Engine: sync from LeaderAnalyticsSnapshot ──────

  async syncPerformanceFromLeader(strategyId: string) {
    const strategy = await prisma.strategy.findUnique({
      where: { id: strategyId },
    });
    if (!strategy) throw new Error('Strategy not found');
    if (!strategy.leaderId)
      throw new Error(
        'Strategy has no linked leader; cannot sync from leader analytics',
      );

    const snapshot = await prisma.leaderAnalyticsSnapshot.findUnique({
      where: {
        leaderId_sourceChain: {
          leaderId: strategy.leaderId,
          sourceChain: 'lunes',
        },
      },
    });
    if (!snapshot) return null;

    // Daily snapshot for today
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    await prisma.strategyPerformance.upsert({
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
      prisma.strategy.update({
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
      prisma.agent.update({
        where: { id: strategy.agentId },
        data: { reputationScore },
      }),
    ]);

    return { strategy: updated, reputationScore };
  },

  // ── Marketplace: top strategies ranked by composite score ─────

  async getMarketplace(
    input: {
      strategyType?: StrategyType;
      riskLevel?: StrategyRiskLevel;
      search?: string;
      sortBy?: 'roi30d' | 'followersCount' | 'totalVolume' | 'sharpeRatio';
      limit?: number;
      offset?: number;
    } = {},
  ) {
    const {
      strategyType,
      riskLevel,
      search,
      sortBy = 'roi30d',
      limit = 20,
      offset = 0,
    } = input;

    const where: Prisma.StrategyWhereInput = {
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
      prisma.strategy.findMany({
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
      prisma.strategy.count({ where }),
    ]);

    return { strategies, total, limit, offset };
  },

  // ── Bulk sync all strategies that have a linked leader ─────────

  async syncAllLeaderStrategies() {
    const strategies = await prisma.strategy.findMany({
      where: { leaderId: { not: null }, status: 'ACTIVE' },
      select: { id: true },
    });

    const results = await Promise.allSettled(
      strategies.map((s) => strategyService.syncPerformanceFromLeader(s.id)),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;
    return { total: strategies.length, succeeded, failed };
  },
};
