"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rewardDistributionService = void 0;
const db_1 = __importDefault(require("../db"));
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
const library_1 = require("@prisma/client/runtime/library");
const rewardPayoutService_1 = require("./rewardPayoutService");
// ─── Tier multipliers — must match frontend/contract tiers ───────────────────
const TIER_MULTIPLIERS = {
    Bronze: 1,
    Silver: 1.5,
    Gold: 2,
    Platinum: 3,
};
function getTier(stakedAmount) {
    if (stakedAmount >= 200000)
        return 'Platinum';
    if (stakedAmount >= 50000)
        return 'Gold';
    if (stakedAmount >= 10000)
        return 'Silver';
    return 'Bronze';
}
// Top-N reward distribution percentages (same curve for leaders + traders)
const TOP_SHARE = [0.20, 0.15, 0.10]; // Top 3
const TOP_REMAINING_PCT = 0.55; // Top 4-10 split evenly
function toFloat(value) {
    if (value == null)
        return 0;
    if (typeof value === 'number')
        return value;
    return parseFloat(String(value));
}
// ─── Service ─────────────────────────────────────────────────────────────────
const db = db_1.default;
exports.rewardDistributionService = {
    // ─── Week Helpers ────────────────────────────────────────────────────────
    getCurrentWeekStart() {
        const now = new Date();
        const day = now.getUTCDay();
        const diff = day === 0 ? 6 : day - 1;
        const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff, 0, 0, 0, 0));
        return monday;
    },
    getWeekEnd(weekStart) {
        return new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    },
    // ─── Fee Calculation ─────────────────────────────────────────────────────
    async calculateWeeklyFees(weekStart, weekEnd) {
        const result = await db_1.default.trade.aggregate({
            where: {
                createdAt: { gte: weekStart, lt: weekEnd },
            },
            _sum: {
                makerFee: true,
                takerFee: true,
            },
        });
        const makerTotal = toFloat(result._sum.makerFee);
        const takerTotal = toFloat(result._sum.takerFee);
        return makerTotal + takerTotal;
    },
    // ─── Reward Pool ─────────────────────────────────────────────────────────
    async ensureCurrentWeek() {
        const weekStart = this.getCurrentWeekStart();
        const weekEnd = this.getWeekEnd(weekStart);
        const existing = await db.rewardWeek.findUnique({
            where: { weekStart },
        });
        if (existing)
            return existing;
        return db.rewardWeek.create({
            data: {
                weekStart,
                weekEnd,
                status: 'ACCUMULATING',
            },
        });
    },
    async getRewardPool() {
        const week = await this.ensureCurrentWeek();
        const totalFees = await this.calculateWeeklyFees(week.weekStart, week.weekEnd);
        const { rewardPoolPct, leaderPoolPct, traderPoolPct, stakerPoolPct } = config_1.config.rewards;
        const rewardPool = totalFees * rewardPoolPct / 100;
        const leaderPool = rewardPool * leaderPoolPct / 100;
        const traderPool = rewardPool * traderPoolPct / 100;
        const stakerPool = rewardPool * stakerPoolPct / 100;
        const treasuryPool = totalFees * 40 / 100;
        const lpPool = totalFees * 40 / 100;
        let relayerBalance = null;
        try {
            if (rewardPayoutService_1.rewardPayoutService.isEnabled()) {
                relayerBalance = await rewardPayoutService_1.rewardPayoutService.getRelayerBalanceLunes();
            }
        }
        catch { /* non-critical */ }
        return {
            weekId: week.id,
            weekStart: week.weekStart,
            weekEnd: week.weekEnd,
            status: week.status,
            totalFeesCollected: totalFees,
            rewardPool,
            leaderPool,
            traderPool,
            stakerPool,
            treasuryPool,
            lpPool,
            nextDistribution: new Date(week.weekEnd),
            distributedAt: week.distributedAt,
            relayerBalance,
            payoutEnabled: rewardPayoutService_1.rewardPayoutService.isEnabled(),
        };
    },
    // ─── Leader Ranking ──────────────────────────────────────────────────────
    async rankLeaders() {
        const leaders = await db_1.default.leader.findMany({
            select: {
                id: true,
                name: true,
                address: true,
                roi30d: true,
                totalAum: true,
                followersCount: true,
                sharpe: true,
            },
        });
        if (leaders.length === 0)
            return [];
        const maxRoi = Math.max(...leaders.map(l => Math.abs(toFloat(l.roi30d))), 1);
        const maxAum = Math.max(...leaders.map(l => toFloat(l.totalAum)), 1);
        const maxFollowers = Math.max(...leaders.map(l => l.followersCount), 1);
        const ranked = leaders.map(leader => {
            const roi = toFloat(leader.roi30d);
            const aum = toFloat(leader.totalAum);
            const followers = leader.followersCount;
            const score = (roi / maxRoi) * 0.4 +
                (aum / maxAum) * 0.3 +
                (followers / maxFollowers) * 0.2 +
                (toFloat(leader.sharpe) / 10) * 0.1;
            return {
                address: leader.address,
                score,
                roi30d: roi,
                aum,
                followers,
                name: leader.name,
            };
        });
        ranked.sort((a, b) => b.score - a.score);
        return ranked;
    },
    // ─── Staker Weights ──────────────────────────────────────────────────────
    async getStakerWeights() {
        const positions = await db.copyVaultPosition.findMany({
            where: { shareBalance: { gt: 0 } },
            select: {
                followerAddress: true,
                shareBalance: true,
                netDeposited: true,
            },
        });
        const stakeMap = new Map();
        for (const pos of positions) {
            const current = stakeMap.get(pos.followerAddress) || 0;
            stakeMap.set(pos.followerAddress, current + toFloat(pos.netDeposited));
        }
        const weights = [];
        for (const [address, staked] of stakeMap.entries()) {
            if (staked <= 0)
                continue;
            const tier = getTier(staked);
            const multiplier = TIER_MULTIPLIERS[tier];
            weights.push({ address, staked, multiplier, weight: staked * multiplier });
        }
        return weights;
    },
    // ─── Top Trader Ranking (by weekly volume) ──────────────────────────────
    async rankTopTraders(weekStart, weekEnd) {
        // Aggregate volume per address (both maker and taker roles)
        const trades = await db_1.default.trade.findMany({
            where: { createdAt: { gte: weekStart, lt: weekEnd } },
            select: {
                makerAddress: true,
                takerAddress: true,
                quoteAmount: true,
            },
        });
        const volumeMap = new Map();
        for (const trade of trades) {
            const vol = toFloat(trade.quoteAmount);
            // Credit maker
            const maker = volumeMap.get(trade.makerAddress) || { volume: 0, count: 0 };
            maker.volume += vol;
            maker.count++;
            volumeMap.set(trade.makerAddress, maker);
            // Credit taker
            const taker = volumeMap.get(trade.takerAddress) || { volume: 0, count: 0 };
            taker.volume += vol;
            taker.count++;
            volumeMap.set(trade.takerAddress, taker);
        }
        const ranked = [];
        for (const [address, data] of volumeMap.entries()) {
            if (data.volume > 0) {
                ranked.push({ address, volume: data.volume, tradeCount: data.count });
            }
        }
        ranked.sort((a, b) => b.volume - a.volume);
        return ranked;
    },
    // ─── Distribution Engine (REAL ON-CHAIN) ─────────────────────────────────
    async runWeeklyDistribution() {
        if (!config_1.config.rewards.enabled) {
            logger_1.log.info('[Rewards] Distribution disabled by config');
            return null;
        }
        const now = new Date();
        const currentWeekStart = this.getCurrentWeekStart();
        const prevWeekStart = new Date(currentWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
        const prevWeekEnd = currentWeekStart;
        let week = await db.rewardWeek.findUnique({
            where: { weekStart: prevWeekStart },
        });
        if (!week) {
            week = await db.rewardWeek.create({
                data: {
                    weekStart: prevWeekStart,
                    weekEnd: prevWeekEnd,
                    status: 'ACCUMULATING',
                },
            });
        }
        if (week.status === 'DISTRIBUTED') {
            logger_1.log.info({ weekStart: prevWeekStart }, '[Rewards] Week already distributed');
            return { status: 'ALREADY_DISTRIBUTED', weekId: week.id };
        }
        // 1. Calculate total fees
        const totalFees = await this.calculateWeeklyFees(prevWeekStart, prevWeekEnd);
        if (totalFees <= 0) {
            logger_1.log.info({ weekStart: prevWeekStart }, '[Rewards] No fees collected this week');
            await db.rewardWeek.update({
                where: { id: week.id },
                data: {
                    totalFeesCollected: 0,
                    rewardPoolAmount: 0,
                    leaderPoolAmount: 0,
                    stakerPoolAmount: 0,
                    status: 'DISTRIBUTED',
                    distributedAt: now,
                },
            });
            return { status: 'NO_FEES', weekId: week.id, totalFees: 0 };
        }
        const { rewardPoolPct, leaderPoolPct, traderPoolPct, stakerPoolPct } = config_1.config.rewards;
        const rewardPool = totalFees * rewardPoolPct / 100;
        const leaderPool = rewardPool * leaderPoolPct / 100;
        const traderPool = rewardPool * traderPoolPct / 100;
        const stakerPool = rewardPool * stakerPoolPct / 100;
        logger_1.log.info({
            weekStart: prevWeekStart,
            totalFees,
            rewardPool,
            leaderPool,
            traderPool,
            stakerPool,
        }, '[Rewards] Starting weekly distribution');
        // 2. REAL: Fund staking contract with staker pool
        let fundTxHash = null;
        let distributeTxHash = null;
        if (rewardPayoutService_1.rewardPayoutService.isEnabled() && stakerPool > 0) {
            // Fund the staking contract
            const fundResult = await rewardPayoutService_1.rewardPayoutService.fundStakingRewards(stakerPool);
            if (fundResult.success) {
                fundTxHash = fundResult.txHash;
                logger_1.log.info({ txHash: fundTxHash, amount: stakerPool }, '[Rewards] Staking contract funded');
                // Trigger on-chain distribution to stakers
                const distResult = await rewardPayoutService_1.rewardPayoutService.distributeRewards();
                if (distResult.success) {
                    distributeTxHash = distResult.txHash;
                    logger_1.log.info({ txHash: distributeTxHash }, '[Rewards] On-chain distribution triggered');
                }
                else {
                    logger_1.log.error({ error: distResult.error }, '[Rewards] On-chain distribution failed');
                }
            }
            else {
                logger_1.log.error({ error: fundResult.error }, '[Rewards] Failed to fund staking contract');
            }
        }
        else if (stakerPool > 0) {
            logger_1.log.warn('[Rewards] Payout service not enabled — staker rewards recorded but NOT sent on-chain');
        }
        // 3. Distribute leader rewards (with real native transfers)
        const leaderRewards = await this.distributeLeaderRewards(leaderPool, week.id);
        // 4. Distribute top trader rewards (native transfers by volume)
        const traderRewards = await this.distributeTraderRewards(traderPool, week.id, prevWeekStart, prevWeekEnd);
        // 5. Record staker distribution in DB (on-chain handled by contract)
        const stakerRewards = await this.recordStakerDistribution(stakerPool, week.id, fundTxHash);
        // 6. Update week record
        await db.rewardWeek.update({
            where: { id: week.id },
            data: {
                totalFeesCollected: new library_1.Decimal(totalFees.toString()),
                rewardPoolAmount: new library_1.Decimal(rewardPool.toString()),
                leaderPoolAmount: new library_1.Decimal(leaderPool.toString()),
                stakerPoolAmount: new library_1.Decimal(stakerPool.toString()),
                status: 'DISTRIBUTED',
                distributedAt: now,
            },
        });
        // 7. Ensure next week row exists
        await this.ensureCurrentWeek();
        logger_1.log.info({
            weekId: week.id,
            leaderRewards: leaderRewards.length,
            traderRewards: traderRewards.length,
            stakerRewards: stakerRewards.length,
            totalDistributed: rewardPool,
            fundTxHash,
            distributeTxHash,
        }, '[Rewards] Distribution complete');
        return {
            status: 'DISTRIBUTED',
            weekId: week.id,
            totalFees,
            rewardPool,
            leaderRewards: leaderRewards.length,
            traderRewards: traderRewards.length,
            stakerRewards: stakerRewards.length,
            fundTxHash,
            distributeTxHash,
        };
    },
    // ─── Leader Distribution (REAL Native Transfers) ─────────────────────────
    async distributeLeaderRewards(pool, weekId) {
        const leaders = await this.rankLeaders();
        if (leaders.length === 0 || pool <= 0)
            return [];
        const rewards = [];
        // Top 3 get fixed percentages
        for (let i = 0; i < Math.min(3, leaders.length); i++) {
            const amount = pool * TOP_SHARE[i];
            rewards.push({ address: leaders[i].address, amount, rank: i + 1, txHash: null, status: 'PENDING' });
        }
        // Top 4-10 split remaining evenly
        const remaining = pool * TOP_REMAINING_PCT;
        const remainingLeaders = leaders.slice(3, 10);
        if (remainingLeaders.length > 0) {
            const perLeader = remaining / remainingLeaders.length;
            for (let i = 0; i < remainingLeaders.length; i++) {
                rewards.push({
                    address: remainingLeaders[i].address,
                    amount: perLeader,
                    rank: i + 4,
                    txHash: null,
                    status: 'PENDING',
                });
            }
        }
        // Safety: never distribute more than the pool
        const totalAllocated = rewards.reduce((sum, r) => sum + r.amount, 0);
        if (totalAllocated > pool) {
            const ratio = pool / totalAllocated;
            for (const r of rewards) {
                r.amount *= ratio;
            }
        }
        // REAL: Attempt on-chain transfer for each leader
        const payoutEnabled = rewardPayoutService_1.rewardPayoutService.isEnabled();
        for (const reward of rewards) {
            if (reward.amount <= 0)
                continue;
            if (payoutEnabled) {
                const payoutResult = await rewardPayoutService_1.rewardPayoutService.transferNative(reward.address, reward.amount);
                reward.txHash = payoutResult.txHash;
                reward.status = payoutResult.success ? 'CONFIRMED' : 'FAILED';
                if (!payoutResult.success) {
                    logger_1.log.error({
                        address: reward.address,
                        amount: reward.amount,
                        error: payoutResult.error,
                    }, '[Rewards] Leader payout failed');
                }
            }
            // Persist to DB
            await db.userReward.create({
                data: {
                    rewardWeekId: weekId,
                    walletAddress: reward.address,
                    amount: new library_1.Decimal(reward.amount.toString()),
                    rewardType: 'LEADER',
                    rank: reward.rank,
                    txHash: reward.txHash,
                    payoutStatus: payoutEnabled ? reward.status : 'PENDING',
                    payoutError: reward.status === 'FAILED' ? 'Transfer failed' : null,
                },
            });
        }
        return rewards;
    },
    // ─── Top Trader Distribution (REAL Native Transfers) ────────────────────
    async distributeTraderRewards(pool, weekId, weekStart, weekEnd) {
        const traders = await this.rankTopTraders(weekStart, weekEnd);
        if (traders.length === 0 || pool <= 0)
            return [];
        const rewards = [];
        // Same curve as leaders: top 3 fixed %, top 4-10 split remaining
        for (let i = 0; i < Math.min(3, traders.length); i++) {
            const amount = pool * TOP_SHARE[i];
            rewards.push({ address: traders[i].address, amount, rank: i + 1, txHash: null, status: 'PENDING' });
        }
        const remaining = pool * TOP_REMAINING_PCT;
        const rest = traders.slice(3, 10);
        if (rest.length > 0) {
            const per = remaining / rest.length;
            for (let i = 0; i < rest.length; i++) {
                rewards.push({ address: rest[i].address, amount: per, rank: i + 4, txHash: null, status: 'PENDING' });
            }
        }
        // Safety cap
        const totalAllocated = rewards.reduce((sum, r) => sum + r.amount, 0);
        if (totalAllocated > pool) {
            const ratio = pool / totalAllocated;
            for (const r of rewards) {
                r.amount *= ratio;
            }
        }
        const payoutEnabled = rewardPayoutService_1.rewardPayoutService.isEnabled();
        for (const reward of rewards) {
            if (reward.amount <= 0)
                continue;
            if (payoutEnabled) {
                const result = await rewardPayoutService_1.rewardPayoutService.transferNative(reward.address, reward.amount);
                reward.txHash = result.txHash;
                reward.status = result.success ? 'CONFIRMED' : 'FAILED';
                if (!result.success) {
                    logger_1.log.error({ address: reward.address, amount: reward.amount, error: result.error }, '[Rewards] Trader payout failed');
                }
            }
            await db.userReward.create({
                data: {
                    rewardWeekId: weekId,
                    walletAddress: reward.address,
                    amount: new library_1.Decimal(reward.amount.toString()),
                    rewardType: 'TRADER',
                    rank: reward.rank,
                    txHash: reward.txHash,
                    payoutStatus: payoutEnabled ? reward.status : 'PENDING',
                    payoutError: reward.status === 'FAILED' ? 'Transfer failed' : null,
                },
            });
        }
        return rewards;
    },
    // ─── Staker Distribution Record ──────────────────────────────────────────
    async recordStakerDistribution(pool, weekId, fundTxHash) {
        const stakers = await this.getStakerWeights();
        if (stakers.length === 0 || pool <= 0)
            return [];
        const totalWeight = stakers.reduce((sum, s) => sum + s.weight, 0);
        if (totalWeight <= 0)
            return [];
        const rewards = [];
        for (const staker of stakers) {
            const share = staker.weight / totalWeight;
            const amount = pool * share;
            if (amount <= 0)
                continue;
            rewards.push({ address: staker.address, amount, weight: staker.weight });
            // Record in DB — on-chain distribution handled by staking contract
            await db.userReward.create({
                data: {
                    rewardWeekId: weekId,
                    walletAddress: staker.address,
                    amount: new library_1.Decimal(amount.toString()),
                    rewardType: 'STAKER',
                    weight: new library_1.Decimal(staker.weight.toString()),
                    txHash: fundTxHash, // Reference to the fund tx
                    payoutStatus: fundTxHash ? 'CONFIRMED' : 'PENDING',
                    // Staker claims via on-chain contract claim_rewards()
                    // (already works in frontend)
                },
            });
        }
        return rewards;
    },
    // ─── User Queries ────────────────────────────────────────────────────────
    async getPendingRewards(address) {
        const rewards = await db.userReward.findMany({
            where: {
                walletAddress: address,
                claimed: false,
            },
            include: {
                rewardWeek: {
                    select: { weekStart: true, weekEnd: true },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
        const leaderTotal = rewards
            .filter((r) => r.rewardType === 'LEADER')
            .reduce((sum, r) => sum + toFloat(r.amount), 0);
        const traderTotal = rewards
            .filter((r) => r.rewardType === 'TRADER')
            .reduce((sum, r) => sum + toFloat(r.amount), 0);
        const stakerTotal = rewards
            .filter((r) => r.rewardType === 'STAKER')
            .reduce((sum, r) => sum + toFloat(r.amount), 0);
        return {
            total: leaderTotal + traderTotal + stakerTotal,
            leaderRewards: leaderTotal,
            traderRewards: traderTotal,
            stakerRewards: stakerTotal,
            entries: rewards.map((r) => ({
                id: r.id,
                amount: toFloat(r.amount),
                type: r.rewardType,
                rank: r.rank,
                txHash: r.txHash,
                payoutStatus: r.payoutStatus,
                weekStart: r.rewardWeek.weekStart,
                weekEnd: r.rewardWeek.weekEnd,
                createdAt: r.createdAt,
            })),
        };
    },
    /**
     * Claim rewards — marks DB records as claimed.
     *
     * For LEADER rewards: LUNES was already transferred via transferNative.
     * For STAKER rewards: user claims via on-chain staking contract claim_rewards()
     *   (handled by frontend sdk.claimRewards()).
     */
    async claimRewards(address) {
        const pending = await db.userReward.findMany({
            where: { walletAddress: address, claimed: false },
        });
        if (pending.length === 0) {
            return { claimed: false, message: 'No pending rewards' };
        }
        const totalAmount = pending.reduce((sum, r) => sum + toFloat(r.amount), 0);
        const now = new Date();
        await db.userReward.updateMany({
            where: { walletAddress: address, claimed: false },
            data: { claimed: true, claimedAt: now },
        });
        logger_1.log.info({ address, totalAmount, rewardCount: pending.length }, '[Rewards] Rewards claimed');
        return {
            claimed: true,
            totalAmount,
            rewardsClaimed: pending.length,
            claimedAt: now,
        };
    },
    async getRewardHistory(address, limit = 50) {
        const rewards = await db.userReward.findMany({
            where: { walletAddress: address },
            include: {
                rewardWeek: {
                    select: { weekStart: true, weekEnd: true, totalFeesCollected: true },
                },
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
        return rewards.map((r) => ({
            id: r.id,
            amount: toFloat(r.amount),
            type: r.rewardType,
            rank: r.rank,
            claimed: r.claimed,
            claimedAt: r.claimedAt,
            txHash: r.txHash,
            payoutStatus: r.payoutStatus,
            weekStart: r.rewardWeek.weekStart,
            weekEnd: r.rewardWeek.weekEnd,
            createdAt: r.createdAt,
        }));
    },
    async getDistributedWeeks(limit = 10) {
        return db.rewardWeek.findMany({
            where: { status: 'DISTRIBUTED' },
            orderBy: { weekStart: 'desc' },
            take: limit,
            include: {
                _count: { select: { rewards: true } },
            },
        });
    },
    // ─── Retry Failed Payouts ────────────────────────────────────────────────
    async retryFailedPayouts(limit = 10) {
        if (!rewardPayoutService_1.rewardPayoutService.isEnabled()) {
            return { retried: 0 };
        }
        const failed = await db.userReward.findMany({
            where: {
                payoutStatus: 'FAILED',
                rewardType: { in: ['LEADER', 'TRADER'] },
            },
            take: limit,
            orderBy: { createdAt: 'asc' },
        });
        let retried = 0;
        for (const reward of failed) {
            const amount = toFloat(reward.amount);
            if (amount <= 0)
                continue;
            const result = await rewardPayoutService_1.rewardPayoutService.transferNative(reward.walletAddress, amount);
            await db.userReward.update({
                where: { id: reward.id },
                data: {
                    txHash: result.txHash,
                    payoutStatus: result.success ? 'CONFIRMED' : 'FAILED',
                    payoutError: result.success ? null : result.error,
                },
            });
            if (result.success)
                retried++;
        }
        logger_1.log.info({ retried, total: failed.length }, '[Rewards] Retried failed payouts');
        return { retried, total: failed.length };
    },
};
//# sourceMappingURL=rewardDistributionService.js.map