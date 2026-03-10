"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.socialService = void 0;
const db_1 = __importDefault(require("../db"));
const config_1 = require("../config");
const copytrade_1 = require("../utils/copytrade");
function toFloat(value) {
    if (value == null)
        return 0;
    if (typeof value === 'number')
        return value;
    return parseFloat(value.toString());
}
function shortenAddress(address) {
    if (address.length <= 12)
        return address;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
function toInitials(value) {
    const clean = value.replace(/[^a-zA-Z0-9 ]/g, ' ').trim();
    if (!clean)
        return 'NA';
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length === 1)
        return parts[0].slice(0, 2).toUpperCase();
    return parts
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase();
}
function formatTrade(trade) {
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
function formatIdea(idea) {
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
function normalizeOptionalString(value) {
    const normalized = value?.trim();
    return normalized ? normalized : null;
}
function getAnalyticsDb() {
    const db = db_1.default;
    if (typeof db.leaderAnalyticsSnapshot?.findMany !== 'function') {
        return null;
    }
    return db;
}
async function getAnalyticsSnapshotMap(leaderIds) {
    const db = getAnalyticsDb();
    if (!db || leaderIds.length === 0) {
        return new Map();
    }
    const snapshots = await db.leaderAnalyticsSnapshot.findMany({
        where: {
            leaderId: { in: leaderIds },
            sourceChain: config_1.config.socialAnalytics.chainName,
        },
    });
    return new Map(snapshots.map((snapshot) => [snapshot.leaderId, snapshot]));
}
function formatComment(comment, leaderProfile) {
    const author = leaderProfile?.name || shortenAddress(comment.address);
    return {
        id: comment.id,
        address: comment.address,
        author,
        initials: toInitials(author),
        avatar: leaderProfile?.avatar || '',
        createdAt: comment.createdAt.toISOString(),
        content: comment.content,
    };
}
function formatFollower(follow, leaderProfile) {
    const name = leaderProfile?.name || shortenAddress(follow.followerAddress);
    return {
        id: follow.id,
        address: follow.followerAddress,
        name,
        username: leaderProfile?.username || '',
        initials: toInitials(name),
        avatar: leaderProfile?.avatar || '',
        followedAt: follow.createdAt.toISOString(),
    };
}
function sortFormattedLeaders(leaders, sortBy = 'roi30d') {
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
function formatLeader(leader, options) {
    const includeRelations = options?.includeRelations ?? false;
    const analyticsSnapshot = options?.analyticsSnapshot;
    const aumRaw = analyticsSnapshot ? toFloat(analyticsSnapshot.currentEquity) : toFloat(leader.totalAum);
    const roi30d = analyticsSnapshot ? toFloat(analyticsSnapshot.roi30d) : toFloat(leader.roi30d);
    const roi90d = analyticsSnapshot ? toFloat(analyticsSnapshot.roi90d) : toFloat(leader.roi90d);
    const drawdown = analyticsSnapshot ? toFloat(analyticsSnapshot.maxDrawdown) : toFloat(leader.drawdown);
    const winRate = analyticsSnapshot ? toFloat(analyticsSnapshot.winRate) : toFloat(leader.winRate);
    const avgProfit = analyticsSnapshot ? toFloat(analyticsSnapshot.avgProfit) : toFloat(leader.avgProfit);
    const sharpe = analyticsSnapshot ? toFloat(analyticsSnapshot.sharpe) : toFloat(leader.sharpe);
    const pnlHistory = analyticsSnapshot?.pnlHistory?.length ? analyticsSnapshot.pnlHistory : (leader.pnlHistory ?? []);
    return {
        id: leader.id,
        name: leader.name,
        username: leader.username,
        address: leader.address,
        avatar: leader.avatar,
        isAI: leader.isAi,
        isVerified: leader.isVerified,
        bio: leader.bio,
        memberSince: (0, copytrade_1.formatMemberSince)(leader.memberSince),
        roi30d,
        roi90d,
        aum: (0, copytrade_1.abbreviateAum)(aumRaw),
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
exports.socialService = {
    async getStats() {
        const [leaders, ideasCount, vaults] = await Promise.all([
            db_1.default.leader.findMany({
                select: {
                    id: true,
                    followersCount: true,
                    totalAum: true,
                    isAi: true,
                },
            }),
            db_1.default.socialIdea.count(),
            db_1.default.copyVault.findMany({
                select: { totalEquity: true },
            }),
        ]);
        const analyticsSnapshotMap = await getAnalyticsSnapshotMap(leaders.map((leader) => leader.id));
        return {
            totalAum: leaders.reduce((sum, leader) => {
                const snapshot = analyticsSnapshotMap.get(leader.id);
                return sum + (snapshot ? toFloat(snapshot.currentEquity) : toFloat(leader.totalAum));
            }, 0),
            activeTraders: leaders.filter((leader) => !leader.isAi).length,
            aiAgents: leaders.filter((leader) => leader.isAi).length,
            totalFollowers: leaders.reduce((sum, leader) => sum + leader.followersCount, 0),
            totalIdeas: ideasCount,
            totalVaultEquity: vaults.reduce((sum, vault) => sum + toFloat(vault.totalEquity), 0),
        };
    },
    async listLeaders(query) {
        const where = {};
        if (query.tab === 'traders')
            where.isAi = false;
        if (query.tab === 'bots')
            where.isAi = true;
        if (query.search) {
            where.OR = [
                { name: { contains: query.search, mode: 'insensitive' } },
                { username: { contains: query.search, mode: 'insensitive' } },
                { bio: { contains: query.search, mode: 'insensitive' } },
            ];
        }
        const leaders = await db_1.default.leader.findMany({
            where,
            include: {
                vault: true,
            },
        });
        const analyticsSnapshotMap = await getAnalyticsSnapshotMap(leaders.map((leader) => leader.id));
        const formattedLeaders = leaders.map((leader) => formatLeader(leader, {
            analyticsSnapshot: analyticsSnapshotMap.get(leader.id),
        }));
        return sortFormattedLeaders(formattedLeaders, query.sortBy).slice(0, query.limit);
    },
    async getLeaderboard(limit = 10) {
        const leaders = await db_1.default.leader.findMany({
            include: { vault: true },
        });
        const analyticsSnapshotMap = await getAnalyticsSnapshotMap(leaders.map((leader) => leader.id));
        const formattedLeaders = leaders.map((leader) => formatLeader(leader, {
            analyticsSnapshot: analyticsSnapshotMap.get(leader.id),
        }));
        return sortFormattedLeaders(formattedLeaders, 'sharpe').slice(0, limit);
    },
    async getLeaderProfile(leaderId, viewerAddress) {
        const leader = await db_1.default.leader.findUnique({
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
        if (!leader)
            throw new Error('Leader not found');
        const isFollowing = Array.isArray(leader.follows) ? leader.follows.length > 0 : false;
        const analyticsSnapshotMap = await getAnalyticsSnapshotMap([leader.id]);
        return formatLeader(leader, { includeRelations: true, isFollowing, analyticsSnapshot: analyticsSnapshotMap.get(leader.id) });
    },
    async getLeaderProfileByAddress(address, viewerAddress) {
        const leader = await db_1.default.leader.findUnique({
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
        if (!leader)
            throw new Error('Leader not found');
        const isFollowing = Array.isArray(leader.follows) ? leader.follows.length > 0 : false;
        const analyticsSnapshotMap = await getAnalyticsSnapshotMap([leader.id]);
        return formatLeader(leader, {
            includeRelations: true,
            isFollowing,
            analyticsSnapshot: analyticsSnapshotMap.get(leader.id),
        });
    },
    async upsertLeaderProfile(input) {
        const performanceFeeBps = Math.round(input.fee * 100);
        const leader = await db_1.default.leader.upsert({
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
            : await db_1.default.copyVault.create({
                data: {
                    leaderId: leader.id,
                    name: `${input.name} Vault`,
                },
            });
        return formatLeader({
            ...leader,
            vault,
        }, { includeRelations: true, isFollowing: false });
    },
    async followLeader(leaderId, address) {
        const leader = await db_1.default.leader.findUnique({ where: { id: leaderId } });
        if (!leader)
            throw new Error('Leader not found');
        return db_1.default.$transaction(async (tx) => {
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
    async unfollowLeader(leaderId, address) {
        const leader = await db_1.default.leader.findUnique({ where: { id: leaderId } });
        if (!leader)
            throw new Error('Leader not found');
        return db_1.default.$transaction(async (tx) => {
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
    async getFollowedLeaders(address) {
        const follows = await db_1.default.leaderFollow.findMany({
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
        const analyticsSnapshotMap = await getAnalyticsSnapshotMap(follows.map((follow) => follow.leader.id));
        return follows.map((follow) => formatLeader(follow.leader, {
            isFollowing: true,
            analyticsSnapshot: analyticsSnapshotMap.get(follow.leader.id),
        }));
    },
    async getLeaderFollowers(leaderId, limit = 20) {
        const follows = await db_1.default.leaderFollow.findMany({
            where: { leaderId },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
        const followerAddresses = Array.from(new Set(follows.map((follow) => follow.followerAddress)));
        const followerProfiles = followerAddresses.length > 0
            ? await db_1.default.leader.findMany({
                where: { address: { in: followerAddresses } },
                select: {
                    address: true,
                    name: true,
                    username: true,
                    avatar: true,
                },
            })
            : [];
        const followerProfileMap = new Map(followerProfiles.map((profile) => [profile.address, profile]));
        return follows.map((follow) => formatFollower(follow, followerProfileMap.get(follow.followerAddress)));
    },
    async listIdeas(limit = 50) {
        const ideas = await db_1.default.socialIdea.findMany({
            orderBy: { createdAt: 'desc' },
            take: limit,
            include: {
                leader: true,
            },
        });
        return ideas.map(formatIdea);
    },
    async getIdeaComments(ideaId, limit = 50) {
        const comments = await db_1.default.socialIdeaComment.findMany({
            where: { ideaId },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
        const addresses = Array.from(new Set(comments.map((comment) => comment.address)));
        const commenterProfiles = addresses.length > 0
            ? await db_1.default.leader.findMany({
                where: { address: { in: addresses } },
                select: {
                    address: true,
                    name: true,
                    username: true,
                    avatar: true,
                },
            })
            : [];
        const commenterProfileMap = new Map(commenterProfiles.map((profile) => [profile.address, profile]));
        return comments.map((comment) => formatComment(comment, commenterProfileMap.get(comment.address)));
    },
    async likeIdea(ideaId, address) {
        return db_1.default.$transaction(async (tx) => {
            const idea = await tx.socialIdea.findUnique({ where: { id: ideaId } });
            if (!idea)
                throw new Error('Idea not found');
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
    async unlikeIdea(ideaId, address) {
        return db_1.default.$transaction(async (tx) => {
            const idea = await tx.socialIdea.findUnique({ where: { id: ideaId } });
            if (!idea)
                throw new Error('Idea not found');
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
            const updated = await tx.socialIdea.update({
                where: { id: ideaId },
                data: { likesCount: { decrement: 1 } },
            });
            return { liked: false, alreadyLiked: true, likes: idea.likesCount - 1 };
        });
    },
    async depositToVault(leaderId, input) {
        const leader = await db_1.default.leader.findUnique({
            where: { id: leaderId },
            include: { vault: true },
        });
        if (!leader || !leader.vault) {
            throw new Error('Leader or Vault not found');
        }
        const { vault } = leader;
        const depositAmount = parseFloat(input.amount);
        if (depositAmount <= 0) {
            throw new Error('Amount must be greater than zero');
        }
        if (depositAmount < toFloat(vault.minDeposit)) {
            throw new Error(`Minimum deposit is ${vault.minDeposit} ${vault.collateralToken}`);
        }
        // Since we are mocking the blockchain transaction for now, we just update the DB
        return db_1.default.$transaction(async (_tx) => {
            const tx = _tx;
            // 1. Find or create the follower's position
            let position = await tx.copyVaultPosition.findUnique({
                where: {
                    vaultId_followerAddress: {
                        vaultId: vault.id,
                        followerAddress: input.followerAddress,
                    },
                },
            });
            let sharePrice = 1.0;
            if (toFloat(vault.totalShares) > 0) {
                sharePrice = toFloat(vault.totalEquity) / toFloat(vault.totalShares);
            }
            const sharesToMint = depositAmount / sharePrice;
            if (!position) {
                position = await tx.copyVaultPosition.create({
                    data: {
                        vaultId: vault.id,
                        followerAddress: input.followerAddress,
                        shareBalance: sharesToMint,
                        currentValue: depositAmount,
                        netDeposited: depositAmount,
                        highWaterMarkValue: depositAmount,
                    },
                });
            }
            else {
                position = await tx.copyVaultPosition.update({
                    where: { id: position.id },
                    data: {
                        shareBalance: { increment: sharesToMint },
                        netDeposited: { increment: depositAmount },
                        currentValue: { increment: depositAmount },
                        highWaterMarkValue: Math.max(toFloat(position.highWaterMarkValue), toFloat(position.currentValue) + depositAmount),
                    },
                });
            }
            // 2. Update the Vault
            await tx.copyVault.update({
                where: { id: vault.id },
                data: {
                    totalEquity: { increment: depositAmount },
                    totalShares: { increment: sharesToMint },
                    totalDeposits: { increment: depositAmount },
                },
            });
            // 3. Record Activity
            await tx.copyVaultActivity.create({
                data: {
                    vaultId: vault.id,
                    type: 'DEPOSIT',
                    followerAddress: input.followerAddress,
                    amount: depositAmount,
                    token: input.token,
                    netAmount: depositAmount,
                },
            });
            return position;
        });
    },
    async withdrawFromVault(leaderId, input) {
        const leader = await db_1.default.leader.findUnique({
            where: { id: leaderId },
            include: { vault: true },
        });
        if (!leader || !leader.vault) {
            throw new Error('Leader or Vault not found');
        }
        const { vault } = leader;
        const sharesToWithdraw = parseFloat(input.shares);
        if (sharesToWithdraw <= 0) {
            throw new Error('Shares to withdraw must be greater than zero');
        }
        return db_1.default.$transaction(async (_tx) => {
            const tx = _tx;
            const position = await tx.copyVaultPosition.findUnique({
                where: {
                    vaultId_followerAddress: {
                        vaultId: vault.id,
                        followerAddress: input.followerAddress,
                    },
                },
            });
            if (!position || toFloat(position.shareBalance) < sharesToWithdraw) {
                throw new Error('Insufficient shares in position');
            }
            let sharePrice = 1.0;
            if (toFloat(vault.totalShares) > 0) {
                sharePrice = toFloat(vault.totalEquity) / toFloat(vault.totalShares);
            }
            const withdrawAmount = sharesToWithdraw * sharePrice;
            // Basic Performance Fee calculation (High Water Mark)
            let feeAmount = 0;
            const currentPosValue = toFloat(position.shareBalance) * sharePrice;
            if (currentPosValue > toFloat(position.highWaterMarkValue)) {
                const profit = currentPosValue - toFloat(position.highWaterMarkValue);
                // Only charge fee on the withdrawn portion's profit
                const withdrawnProfitRatio = sharesToWithdraw / toFloat(position.shareBalance);
                feeAmount = (profit * withdrawnProfitRatio) * (leader.performanceFeeBps / 10000);
            }
            const netAmount = withdrawAmount - feeAmount;
            const updatedPosition = await tx.copyVaultPosition.update({
                where: { id: position.id },
                data: {
                    shareBalance: { decrement: sharesToWithdraw },
                    totalWithdrawn: { increment: withdrawAmount },
                    currentValue: { decrement: withdrawAmount },
                    feePaid: { increment: feeAmount },
                },
            });
            await tx.copyVault.update({
                where: { id: vault.id },
                data: {
                    totalEquity: { decrement: withdrawAmount },
                    totalShares: { decrement: sharesToWithdraw },
                    totalWithdrawals: { increment: withdrawAmount },
                },
            });
            await tx.copyVaultActivity.create({
                data: {
                    vaultId: vault.id,
                    type: 'WITHDRAWAL',
                    followerAddress: input.followerAddress,
                    amount: withdrawAmount,
                    feeAmount,
                    netAmount,
                },
            });
            return {
                ...updatedPosition,
                withdrawnAmount: withdrawAmount,
                feeAmount,
                netAmount,
            };
        });
    },
    async commentOnIdea(ideaId, address, content) {
        return db_1.default.$transaction(async (tx) => {
            const idea = await tx.socialIdea.findUnique({ where: { id: ideaId } });
            if (!idea)
                throw new Error('Idea not found');
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
                address: comment.address,
                author: shortenAddress(comment.address),
                initials: toInitials(shortenAddress(comment.address)),
                avatar: '',
                content: comment.content,
                createdAt: comment.createdAt.toISOString(),
            };
        });
    },
};
//# sourceMappingURL=socialService.js.map