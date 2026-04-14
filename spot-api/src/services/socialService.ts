import prisma from '../db';
import { config } from '../config';
import {
  SocialLeadersQuery,
  UpsertLeaderProfileInput,
} from '../utils/validation';
import { abbreviateAum, formatMemberSince } from '../utils/copytrade';

function toFloat(
  value: { toString(): string } | number | null | undefined,
): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  return parseFloat(value.toString());
}

function shortenAddress(address: string) {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function toInitials(value: string) {
  const clean = value.replace(/[^a-zA-Z0-9 ]/g, ' ').trim();
  if (!clean) return 'NA';

  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function formatTrade(trade: any) {
  const entry = toFloat(trade.entryPrice);
  const exit = trade.exitPrice ? toFloat(trade.exitPrice) : entry;

  return {
    date: trade.openedAt.toISOString().slice(0, 10),
    pair: trade.pairSymbol,
    side: trade.side === 'BUY' ? 'Buy' : 'Sell',
    entry,
    exit,
    pnl: toFloat(trade.pnlPct),
    status: trade.status === 'CLOSED' ? 'Closed' : 'Open',
  };
}

function formatIdea(idea: any) {
  return {
    id: idea.id,
    title: idea.title,
    description: idea.description,
    pair: idea.pairSymbol,
    direction: idea.direction,
    likes: idea.likesCount,
    comments: idea.commentsCount,
    date: idea.createdAt.toISOString().slice(0, 10),
    tags: idea.tags,
    leader: idea.leader
      ? {
          id: idea.leader.id,
          name: idea.leader.name,
          username: idea.leader.username,
          isAI: idea.leader.isAi,
        }
      : undefined,
  };
}

function normalizeOptionalString(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function getAnalyticsDb() {
  const db = prisma as any;
  if (typeof db.leaderAnalyticsSnapshot?.findMany !== 'function') {
    return null;
  }

  return db;
}

async function getAnalyticsSnapshotMap(leaderIds: string[]) {
  const db = getAnalyticsDb();
  if (!db || leaderIds.length === 0) {
    return new Map<string, any>();
  }

  const snapshots = await db.leaderAnalyticsSnapshot.findMany({
    where: {
      leaderId: { in: leaderIds },
      sourceChain: config.socialAnalytics.chainName,
    },
  });

  return new Map(
    snapshots.map((snapshot: any) => [snapshot.leaderId, snapshot]),
  );
}

function formatComment(comment: any, leaderProfile?: any) {
  const author = leaderProfile?.name || shortenAddress(comment.address);

  return {
    id: comment.id,
    author,
    initials: toInitials(author),
    avatar: leaderProfile?.avatar || '',
    createdAt: comment.createdAt.toISOString(),
    content: comment.content,
  };
}

function formatFollower(follow: any, leaderProfile?: any) {
  const name = leaderProfile?.name || shortenAddress(follow.followerAddress);

  return {
    id: follow.id,
    name,
    username: leaderProfile?.username || '',
    initials: toInitials(name),
    avatar: leaderProfile?.avatar || '',
    followedAt: follow.createdAt.toISOString(),
  };
}

function sortFormattedLeaders(
  leaders: any[],
  sortBy: SocialLeadersQuery['sortBy'] | 'sharpe' = 'roi30d',
) {
  const sorted = [...leaders];

  sorted.sort((left, right) => {
    if (sortBy === 'followers') {
      return right.followers - left.followers || right.roi30d - left.roi30d;
    }

    if (sortBy === 'winRate') {
      return right.winRate - left.winRate || right.roi30d - left.roi30d;
    }

    if (sortBy === 'sharpe') {
      return right.sharpe - left.sharpe || right.roi30d - left.roi30d;
    }

    return right.roi30d - left.roi30d || right.sharpe - left.sharpe;
  });

  return sorted.map((leader, index) => ({
    ...leader,
    rank: index + 1,
  }));
}

function formatLeader(
  leader: any,
  options?: {
    includeRelations?: boolean;
    isFollowing?: boolean;
    analyticsSnapshot?: any;
  },
) {
  const includeRelations = options?.includeRelations ?? false;
  const analyticsSnapshot = options?.analyticsSnapshot;
  const aumRaw = analyticsSnapshot
    ? toFloat(analyticsSnapshot.currentEquity)
    : toFloat(leader.totalAum);
  const roi30d = analyticsSnapshot
    ? toFloat(analyticsSnapshot.roi30d)
    : toFloat(leader.roi30d);
  const roi90d = analyticsSnapshot
    ? toFloat(analyticsSnapshot.roi90d)
    : toFloat(leader.roi90d);
  const drawdown = analyticsSnapshot
    ? toFloat(analyticsSnapshot.maxDrawdown)
    : toFloat(leader.drawdown);
  const winRate = analyticsSnapshot
    ? toFloat(analyticsSnapshot.winRate)
    : toFloat(leader.winRate);
  const avgProfit = analyticsSnapshot
    ? toFloat(analyticsSnapshot.avgProfit)
    : toFloat(leader.avgProfit);
  const sharpe = analyticsSnapshot
    ? toFloat(analyticsSnapshot.sharpe)
    : toFloat(leader.sharpe);
  const pnlHistory = analyticsSnapshot?.pnlHistory?.length
    ? analyticsSnapshot.pnlHistory
    : (leader.pnlHistory ?? []);

  return {
    id: leader.id,
    name: leader.name,
    username: leader.username,
    address: leader.address,
    avatar: leader.avatar,
    isAI: leader.isAi,
    isVerified: leader.isVerified,
    bio: leader.bio,
    memberSince: formatMemberSince(leader.memberSince),
    roi30d,
    roi90d,
    aum: abbreviateAum(aumRaw),
    aumRaw,
    drawdown,
    followers: leader.followersCount,
    winRate,
    avgProfit,
    sharpe,
    fee: leader.performanceFeeBps / 100,
    socialLinks: {
      twitterUrl: leader.twitterUrl ?? '',
      telegramUrl: leader.telegramUrl ?? '',
      discordUrl: leader.discordUrl ?? '',
    },
    pnlHistory,
    tags: leader.tags ?? [],
    isFollowing: options?.isFollowing ?? false,
    vault: leader.vault
      ? {
          id: leader.vault.id,
          name: leader.vault.name,
          collateralToken: leader.vault.collateralToken,
          status: leader.vault.status,
          totalEquity: toFloat(leader.vault.totalEquity),
          totalShares: toFloat(leader.vault.totalShares),
          totalDeposits: toFloat(leader.vault.totalDeposits),
          totalWithdrawals: toFloat(leader.vault.totalWithdrawals),
          minDeposit: toFloat(leader.vault.minDeposit),
          twapThreshold: toFloat(leader.vault.twapThreshold),
          maxSlippageBps: leader.vault.maxSlippageBps,
        }
      : null,
    trades: includeRelations ? (leader.trades ?? []).map(formatTrade) : [],
    ideas: includeRelations ? (leader.ideas ?? []).map(formatIdea) : [],
  };
}

export const socialService = {
  async getStats() {
    const [leaders, ideasCount, vaults, totalFollowers] = await Promise.all([
      prisma.leader.findMany({
        select: {
          id: true,
          totalAum: true,
          isAi: true,
        },
      }),
      prisma.socialIdea.count(),
      prisma.copyVault.findMany({
        select: { totalEquity: true },
      }),
      prisma.leaderFollow.count(),
    ]);

    const analyticsSnapshotMap = await getAnalyticsSnapshotMap(
      leaders.map((leader) => leader.id),
    );

    return {
      totalAum: leaders.reduce((sum, leader) => {
        const snapshot = analyticsSnapshotMap.get(leader.id);
        return (
          sum +
          (snapshot
            ? toFloat(snapshot.currentEquity)
            : toFloat(leader.totalAum))
        );
      }, 0),
      activeTraaders: leaders.filter((leader) => !leader.isAi).length,
      aiAgents: leaders.filter((leader) => leader.isAi).length,
      totalFollowers,
      totalIdeas: ideasCount,
      totalVaultEquity: vaults.reduce(
        (sum, vault) => sum + toFloat(vault.totalEquity),
        0,
      ),
    };
  },

  async listLeaders(query: SocialLeadersQuery) {
    const where: Record<string, unknown> = {};

    if (query.tab === 'traders') where.isAi = false;
    if (query.tab === 'bots') where.isAi = true;

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { username: { contains: query.search, mode: 'insensitive' } },
        { bio: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const leaders = await prisma.leader.findMany({
      where,
      include: { vault: true },
    });

    const leaderIds = leaders.map((l) => l.id);
    const [analyticsSnapshotMap, realFollowerCounts] = await Promise.all([
      getAnalyticsSnapshotMap(leaderIds),
      prisma.leaderFollow.groupBy({
        by: ['leaderId'],
        where: { leaderId: { in: leaderIds } },
        _count: { id: true },
      }),
    ]);

    const followerCountMap = new Map(
      realFollowerCounts.map((r) => [r.leaderId, r._count.id]),
    );

    const formattedLeaders = leaders.map((leader) =>
      formatLeader(
        { ...leader, followersCount: followerCountMap.get(leader.id) ?? 0 },
        { analyticsSnapshot: analyticsSnapshotMap.get(leader.id) },
      ),
    );

    return sortFormattedLeaders(formattedLeaders, query.sortBy).slice(
      0,
      query.limit,
    );
  },

  async getLeaderboard(limit = 10) {
    const leaders = await prisma.leader.findMany({
      include: { vault: true },
    });

    const leaderIds = leaders.map((l) => l.id);
    const [analyticsSnapshotMap, realFollowerCounts] = await Promise.all([
      getAnalyticsSnapshotMap(leaderIds),
      prisma.leaderFollow.groupBy({
        by: ['leaderId'],
        where: { leaderId: { in: leaderIds } },
        _count: { id: true },
      }),
    ]);

    const followerCountMap = new Map(
      realFollowerCounts.map((r) => [r.leaderId, r._count.id]),
    );

    const formattedLeaders = leaders.map((leader) =>
      formatLeader(
        { ...leader, followersCount: followerCountMap.get(leader.id) ?? 0 },
        { analyticsSnapshot: analyticsSnapshotMap.get(leader.id) },
      ),
    );

    return sortFormattedLeaders(formattedLeaders, 'sharpe').slice(0, limit);
  },

  async getLeaderProfile(leaderId: string, viewerAddress?: string) {
    const leader = await prisma.leader.findUnique({
      where: { id: leaderId },
      include: {
        vault: true,
        trades: {
          orderBy: { openedAt: 'desc' },
          take: 50,
        },
        ideas: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
        follows: viewerAddress
          ? {
              where: { followerAddress: viewerAddress },
              take: 1,
            }
          : false,
      },
    });

    if (!leader) throw new Error('Leader not found');

    const isFollowing = Array.isArray(leader.follows)
      ? leader.follows.length > 0
      : false;
    const analyticsSnapshotMap = await getAnalyticsSnapshotMap([leader.id]);
    return formatLeader(leader, {
      includeRelations: true,
      isFollowing,
      analyticsSnapshot: analyticsSnapshotMap.get(leader.id),
    });
  },

  async getLeaderProfileByAddress(address: string, viewerAddress?: string) {
    const leader = await prisma.leader.findUnique({
      where: { address },
      include: {
        vault: true,
        trades: {
          orderBy: { openedAt: 'desc' },
          take: 50,
        },
        ideas: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
        follows: viewerAddress
          ? {
              where: { followerAddress: viewerAddress },
              take: 1,
            }
          : false,
      },
    });

    if (!leader) throw new Error('Leader not found');

    const isFollowing = Array.isArray(leader.follows)
      ? leader.follows.length > 0
      : false;
    const analyticsSnapshotMap = await getAnalyticsSnapshotMap([leader.id]);
    return formatLeader(leader, {
      includeRelations: true,
      isFollowing,
      analyticsSnapshot: analyticsSnapshotMap.get(leader.id),
    });
  },

  async upsertLeaderProfile(input: UpsertLeaderProfileInput) {
    const performanceFeeBps = Math.round(input.fee * 100);

    const leader = await prisma.leader.upsert({
      where: { address: input.address },
      update: {
        name: input.name,
        username: input.username,
        avatar: input.avatar || '',
        bio: input.bio,
        performanceFeeBps,
        twitterUrl: normalizeOptionalString(input.twitterUrl),
        telegramUrl: normalizeOptionalString(input.telegramUrl),
        discordUrl: normalizeOptionalString(input.discordUrl),
      },
      create: {
        name: input.name,
        username: input.username,
        address: input.address,
        avatar: input.avatar || '',
        bio: input.bio,
        performanceFeeBps,
        isAi: false,
        isVerified: false,
        twitterUrl: normalizeOptionalString(input.twitterUrl),
        telegramUrl: normalizeOptionalString(input.telegramUrl),
        discordUrl: normalizeOptionalString(input.discordUrl),
        tags: ['New Leader'],
      },
      include: {
        vault: true,
        trades: {
          orderBy: { openedAt: 'desc' },
          take: 50,
        },
        ideas: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });

    const vault = leader.vault
      ? leader.vault
      : await prisma.copyVault.create({
          data: {
            leaderId: leader.id,
            name: `${input.name} Vault`,
          },
        });

    return formatLeader(
      {
        ...leader,
        vault,
      },
      { includeRelations: true, isFollowing: false },
    );
  },

  async followLeader(leaderId: string, address: string) {
    const leader = await prisma.leader.findUnique({ where: { id: leaderId } });
    if (!leader) throw new Error('Leader not found');

    return prisma.$transaction(async (tx) => {
      const existing = await tx.leaderFollow.findUnique({
        where: {
          leaderId_followerAddress: {
            leaderId,
            followerAddress: address,
          },
        },
      });

      if (existing) {
        return { followed: true, alreadyFollowing: true };
      }

      await tx.leaderFollow.create({
        data: {
          leaderId,
          followerAddress: address,
        },
      });

      await tx.leader.update({
        where: { id: leaderId },
        data: { followersCount: { increment: 1 } },
      });

      return { followed: true, alreadyFollowing: false };
    });
  },

  async unfollowLeader(leaderId: string, address: string) {
    const leader = await prisma.leader.findUnique({ where: { id: leaderId } });
    if (!leader) throw new Error('Leader not found');

    return prisma.$transaction(async (tx) => {
      const existing = await tx.leaderFollow.findUnique({
        where: {
          leaderId_followerAddress: {
            leaderId,
            followerAddress: address,
          },
        },
      });

      if (!existing) {
        return { followed: false, alreadyFollowing: false };
      }

      await tx.leaderFollow.delete({
        where: {
          leaderId_followerAddress: {
            leaderId,
            followerAddress: address,
          },
        },
      });

      await tx.leader.update({
        where: { id: leaderId },
        data: { followersCount: { decrement: 1 } },
      });

      return { followed: false, alreadyFollowing: true };
    });
  },

  async getFollowedLeaders(address: string) {
    const follows = await prisma.leaderFollow.findMany({
      where: { followerAddress: address },
      include: {
        leader: {
          include: {
            vault: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const analyticsSnapshotMap = await getAnalyticsSnapshotMap(
      follows.map((follow) => follow.leader.id),
    );

    return follows.map((follow) =>
      formatLeader(follow.leader, {
        isFollowing: true,
        analyticsSnapshot: analyticsSnapshotMap.get(follow.leader.id),
      }),
    );
  },

  async getLeaderFollowers(leaderId: string, limit = 20) {
    const follows = await prisma.leaderFollow.findMany({
      where: { leaderId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const followerAddresses = Array.from(
      new Set(follows.map((follow) => follow.followerAddress)),
    );
    const followerProfiles =
      followerAddresses.length > 0
        ? await prisma.leader.findMany({
            where: { address: { in: followerAddresses } },
            select: {
              address: true,
              name: true,
              username: true,
              avatar: true,
            },
          })
        : [];

    const followerProfileMap = new Map(
      followerProfiles.map((profile) => [profile.address, profile]),
    );

    return follows.map((follow) =>
      formatFollower(follow, followerProfileMap.get(follow.followerAddress)),
    );
  },

  async listIdeas(limit = 50) {
    const ideas = await prisma.socialIdea.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        leader: true,
      },
    });

    return ideas.map(formatIdea);
  },

  async getIdeaComments(ideaId: string, limit = 50) {
    const comments = await prisma.socialIdeaComment.findMany({
      where: { ideaId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const addresses = Array.from(
      new Set(comments.map((comment) => comment.address)),
    );
    const commenterProfiles =
      addresses.length > 0
        ? await prisma.leader.findMany({
            where: { address: { in: addresses } },
            select: {
              address: true,
              name: true,
              username: true,
              avatar: true,
            },
          })
        : [];

    const commenterProfileMap = new Map(
      commenterProfiles.map((profile) => [profile.address, profile]),
    );

    return comments.map((comment) =>
      formatComment(comment, commenterProfileMap.get(comment.address)),
    );
  },

  async likeIdea(ideaId: string, address: string) {
    return prisma.$transaction(async (tx) => {
      const idea = await tx.socialIdea.findUnique({ where: { id: ideaId } });
      if (!idea) throw new Error('Idea not found');

      const existing = await tx.socialIdeaLike.findUnique({
        where: {
          ideaId_address: {
            ideaId,
            address,
          },
        },
      });

      if (existing) {
        return { liked: true, alreadyLiked: true };
      }

      await tx.socialIdeaLike.create({
        data: {
          ideaId,
          address,
        },
      });

      const updated = await tx.socialIdea.update({
        where: { id: ideaId },
        data: { likesCount: { increment: 1 } },
      });

      return { liked: true, alreadyLiked: false, likes: updated.likesCount };
    });
  },

  async unlikeIdea(ideaId: string, address: string) {
    return prisma.$transaction(async (tx) => {
      const idea = await tx.socialIdea.findUnique({ where: { id: ideaId } });
      if (!idea) throw new Error('Idea not found');

      const existing = await tx.socialIdeaLike.findUnique({
        where: {
          ideaId_address: {
            ideaId,
            address,
          },
        },
      });

      if (!existing) {
        return { liked: false, alreadyLiked: false, likes: idea.likesCount };
      }

      await tx.socialIdeaLike.delete({
        where: {
          ideaId_address: {
            ideaId,
            address,
          },
        },
      });

      await tx.socialIdea.update({
        where: { id: ideaId },
        data: { likesCount: { decrement: 1 } },
      });

      return { liked: false, alreadyLiked: true, likes: idea.likesCount - 1 };
    });
  },

  async commentOnIdea(ideaId: string, address: string, content: string) {
    return prisma.$transaction(async (tx) => {
      const idea = await tx.socialIdea.findUnique({ where: { id: ideaId } });
      if (!idea) throw new Error('Idea not found');

      const comment = await tx.socialIdeaComment.create({
        data: {
          ideaId,
          address,
          content,
        },
      });

      await tx.socialIdea.update({
        where: { id: ideaId },
        data: { commentsCount: { increment: 1 } },
      });

      return {
        id: comment.id,
        author: shortenAddress(comment.address),
        initials: toInitials(shortenAddress(comment.address)),
        avatar: '',
        content: comment.content,
        createdAt: comment.createdAt.toISOString(),
      };
    });
  },
};
