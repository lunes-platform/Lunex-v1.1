import prisma from '../db';
import { config } from '../config';
import { log } from '../utils/logger';
import { Decimal } from '@prisma/client/runtime/library';
import { rewardPayoutService } from './rewardPayoutService';
import { abbreviateAum } from '../utils/copytrade';
import { getRedis } from '../utils/redis';

// ─── Distribution lock ──────────────────────────────────────────────────────
// Acquired by runWeeklyDistribution to prevent two scheduler instances (or a
// scheduler + manual trigger) from running the same week concurrently. TTL is
// long enough to cover a worst-case run (many leaders + traders + on-chain
// transfers) but bounded so a crashed worker eventually releases it.
const DISTRIBUTION_LOCK_TTL_MS = 30 * 60 * 1000; // 30 minutes

async function acquireDistributionLock(weekId: string): Promise<boolean> {
  try {
    const redis = getRedis();
    const result = await redis.set(
      `reward-distribution-lock:${weekId}`,
      Date.now().toString(),
      'PX',
      DISTRIBUTION_LOCK_TTL_MS,
      'NX',
    );
    return result === 'OK';
  } catch (err) {
    log.error({ err, weekId }, '[Rewards] Failed to acquire distribution lock');
    return false;
  }
}

async function releaseDistributionLock(weekId: string): Promise<void> {
  try {
    const redis = getRedis();
    await redis.del(`reward-distribution-lock:${weekId}`);
  } catch (err) {
    log.warn({ err, weekId }, '[Rewards] Failed to release distribution lock');
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface LeaderRanking {
  address: string;
  score: number;
  roi30d: number;
  aum: number;
  followers: number;
  name: string;
}

interface LeaderRankingView extends LeaderRanking {
  id: string;
  username: string;
  isAI: boolean;
  avatar: string;
  winRate: number;
  sharpe: number;
  tags: string[];
}

interface TraderRanking {
  address: string;
  volume: number;
  tradeCount: number;
}

type LeaderRankingSegment = 'all' | 'traders' | 'bots';
type RewardRankingWindow = 'current' | 'previous';
type RewardType = 'LEADER' | 'TRADER';

// Top-N reward distribution percentages (same curve for leaders + traders)
const TOP_SHARE = [0.2, 0.15, 0.1]; // Top 3
const TOP_REMAINING_PCT = 0.55; // Top 4-10 split evenly

function toFloat(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  return parseFloat(String(value));
}

const db = prisma;

// ─── Tracked payouts (never auto-re-pay an UNKNOWN outcome) ─────────────────

/**
 * A SUBMITTED row older than this is treated like UNKNOWN by the reconciler
 * (the process crashed / lost the outcome between broadcast and the final
 * status write). Must exceed the transfer timeout + finality margin.
 */
export const STALE_SUBMITTED_PAYOUT_MS = 15 * 60_000;

type TrackedPayout = {
  status: 'CONFIRMED' | 'FAILED' | 'UNKNOWN' | 'SKIPPED';
  txHash: string | null;
  error: string | null;
};

/**
 * Transfers native LUNES for a claimed UserReward row:
 *  1. hash + era persisted as SUBMITTED BEFORE broadcast, via a CAS on the
 *     row's expected status (concurrent payers cannot both broadcast);
 *  2. final status written only over our own SUBMITTED submission;
 *  3. ambiguous outcomes become UNKNOWN (reconciled by hash, never re-paid).
 */
async function payTrackedReward(
  rewardId: string,
  expectedStatus: 'PENDING' | 'FAILED',
  walletAddress: string,
  amount: number,
): Promise<TrackedPayout> {
  let claimed: string | null = null;

  const result = await rewardPayoutService.transferNative(
    walletAddress,
    amount,
    {
      onBeforeBroadcast: async (submission) => {
        const { count } = await db.userReward.updateMany({
          where: { id: rewardId, payoutStatus: expectedStatus },
          data: {
            payoutStatus: 'SUBMITTED',
            txHash: submission.txHash,
            payoutBirthBlock: submission.birthBlock,
            payoutMortality: submission.mortality,
            payoutSubmittedAt: new Date(),
            payoutError: null,
          },
        });
        if (count !== 1) {
          throw new Error(
            `UserReward ${rewardId} is no longer ${expectedStatus}; not broadcasting`,
          );
        }
        claimed = submission.txHash;
      },
    },
  );

  // Backwards-compatible with results that predate `outcome`.
  const outcome = result.outcome ?? (result.success ? 'CONFIRMED' : 'FAILED');

  if (!claimed && outcome !== 'FAILED') {
    // Should be impossible: a broadcast always goes through the hook.
    log.error(
      { rewardId, txHash: result.txHash, outcome },
      '[Rewards] Payout broadcast without a persisted claim',
    );
  }

  const where = claimed
    ? { id: rewardId, payoutStatus: 'SUBMITTED', txHash: claimed }
    : { id: rewardId, payoutStatus: expectedStatus };

  const { count } = await db.userReward.updateMany({
    where,
    data: {
      txHash: result.txHash ?? claimed,
      payoutStatus: outcome,
      payoutError: outcome === 'CONFIRMED' ? null : result.error,
    },
  });
  if (count !== 1) {
    // Lost the claim before broadcasting (another payer owns the row) —
    // nothing was sent by us, so leave the row to its owner.
    return { status: 'SKIPPED', txHash: null, error: result.error };
  }

  if (outcome !== 'CONFIRMED') {
    log.error(
      { rewardId, walletAddress, amount, outcome, error: result.error },
      outcome === 'UNKNOWN'
        ? '[Rewards] Payout outcome UNKNOWN — awaiting reconciliation, will NOT be re-paid'
        : '[Rewards] Payout failed',
    );
  }

  return {
    status: outcome,
    txHash: result.txHash ?? claimed,
    error: result.error,
  };
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const rewardDistributionService = {
  // ─── Week Helpers ────────────────────────────────────────────────────────

  getCurrentWeekStart(): Date {
    const now = new Date();
    const day = now.getUTCDay();
    const diff = day === 0 ? 6 : day - 1;
    const monday = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - diff,
        0,
        0,
        0,
        0,
      ),
    );
    return monday;
  },

  getWeekEnd(weekStart: Date): Date {
    return new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  },

  getRewardSplitConfig() {
    const { rewardPoolPct, leaderPoolPct, traderPoolPct, stakerPoolPct } =
      config.rewards;
    const splitTotalPct = leaderPoolPct + traderPoolPct + stakerPoolPct;

    return {
      rewardPoolPct,
      leaderPoolPct,
      traderPoolPct,
      stakerPoolPct,
      splitTotalPct,
      splitValid: splitTotalPct === 100,
    };
  },

  calculateRewardBuckets(totalFees: number) {
    const split = this.getRewardSplitConfig();
    const rewardPool = (totalFees * split.rewardPoolPct) / 100;
    const leaderPool = (rewardPool * split.leaderPoolPct) / 100;
    const traderPool = (rewardPool * split.traderPoolPct) / 100;
    const stakerPool = (rewardPool * split.stakerPoolPct) / 100;

    return {
      split,
      rewardPool,
      leaderPool,
      traderPool,
      stakerPool,
      treasuryPool: (totalFees * 40) / 100,
      lpPool: (totalFees * 40) / 100,
    };
  },

  summarizeDbBackedWeekRewards(
    rewards: Array<{
      // Schema persists rewardType as String; comparison below scopes it.
      rewardType: string;
      amount: unknown;
      payoutStatus?: string | null;
      claimed?: boolean | null;
    }>,
    rewardType: RewardType,
    expectedPool: number,
  ) {
    const scopedRewards = rewards.filter(
      (reward) => reward.rewardType === rewardType,
    );
    const payoutStatusCounts = scopedRewards.reduce<Record<string, number>>(
      (accumulator, reward) => {
        const status = reward.payoutStatus || 'PENDING';
        accumulator[status] = (accumulator[status] || 0) + 1;
        return accumulator;
      },
      {},
    );

    const distributedAmount = scopedRewards.reduce(
      (sum, reward) => sum + toFloat(reward.amount),
      0,
    );

    return {
      entries: scopedRewards.length,
      distributedAmount,
      expectedPool,
      allocationGap: expectedPool - distributedAmount,
      claimedEntries: scopedRewards.filter((reward) => reward.claimed).length,
      unclaimedEntries: scopedRewards.filter((reward) => !reward.claimed)
        .length,
      payoutStatusCounts,
    };
  },

  // ─── Fee Calculation ─────────────────────────────────────────────────────

  async calculateWeeklyFees(weekStart: Date, weekEnd: Date): Promise<number> {
    // Only trades proven on-chain feed the reward pool. PENDING / SETTLING /
    // FAILED / SKIPPED trades never moved funds, so counting them would pay
    // real LUNES on fictitious fees (BE-05). Windowed by settledAt so a trade
    // that settles on a later retry counts in the week it actually settled.
    const result = await prisma.trade.aggregate({
      where: {
        settlementStatus: 'SETTLED',
        settledAt: { gte: weekStart, lt: weekEnd },
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

    if (existing) return existing;

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
    const totalFees = await this.calculateWeeklyFees(
      week.weekStart,
      week.weekEnd,
    );
    const {
      split,
      rewardPool,
      leaderPool,
      traderPool,
      stakerPool,
      treasuryPool,
      lpPool,
    } = this.calculateRewardBuckets(totalFees);

    let relayerBalance: number | null = null;
    try {
      if (rewardPayoutService.isEnabled()) {
        relayerBalance = await rewardPayoutService.getRelayerBalanceLunes();
      }
    } catch {
      /* non-critical */
    }

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
      payoutEnabled: rewardPayoutService.isEnabled(),
      stakerClaimMode: 'on-chain',
      split,
    };
  },

  // ─── Leader Ranking ──────────────────────────────────────────────────────

  async buildLeaderRankingView(
    segment: LeaderRankingSegment = 'all',
  ): Promise<LeaderRankingView[]> {
    const where =
      segment === 'traders'
        ? { isAi: false }
        : segment === 'bots'
          ? { isAi: true }
          : {};

    const leaders = await prisma.leader.findMany({
      where,
      select: {
        id: true,
        name: true,
        username: true,
        address: true,
        avatar: true,
        isAi: true,
        roi30d: true,
        winRate: true,
        totalAum: true,
        followersCount: true,
        sharpe: true,
        tags: true,
      },
    });

    if (leaders.length === 0) return [];

    const leaderIds = leaders.map((leader) => leader.id);
    const [realFollowerCounts, vaults, analyticsSnapshots] = await Promise.all([
      prisma.leaderFollow.groupBy({
        by: ['leaderId'],
        where: { leaderId: { in: leaderIds } },
        _count: { id: true },
      }),
      // Only vaults with an on-chain contract carry proven equity. Journal-only
      // vaults (no contractAddress) accept deposits without proof of funds and
      // must not inflate the AUM component of the paid LEADER ranking.
      prisma.copyVault.findMany({
        where: { leaderId: { in: leaderIds }, contractAddress: { not: null } },
        select: { leaderId: true, totalEquity: true },
      }),
      typeof db.leaderAnalyticsSnapshot?.findMany === 'function'
        ? db.leaderAnalyticsSnapshot.findMany({
            where: {
              leaderId: { in: leaderIds },
              sourceChain: config.socialAnalytics.chainName,
            },
          })
        : [],
    ]);

    const followerCountMap = new Map(
      realFollowerCounts.map((entry) => [entry.leaderId, entry._count.id]),
    );
    const vaultEquityMap = new Map(
      vaults.map((vault) => [vault.leaderId, toFloat(vault.totalEquity)]),
    );
    const analyticsSnapshotMap = new Map(
      analyticsSnapshots.map((snapshot) => [snapshot.leaderId, snapshot]),
    );

    const normalizedLeaders = leaders.map((leader) => {
      const snapshot = analyticsSnapshotMap.get(leader.id) as
        | {
            roi30d?: unknown;
            sharpe?: unknown;
            winRate?: unknown;
            currentEquity?: unknown;
          }
        | undefined;
      const roi30d = snapshot
        ? toFloat(snapshot.roi30d)
        : toFloat(leader.roi30d);
      const sharpe = snapshot
        ? toFloat(snapshot.sharpe)
        : toFloat(leader.sharpe);
      const winRate = snapshot
        ? toFloat(snapshot.winRate)
        : toFloat(leader.winRate);
      // Never fall back to leader.totalAum: it is incremented by unproven
      // db-journal deposits. Proven sources only: on-chain vault equity, then
      // the chain-indexed analytics snapshot; otherwise 0.
      const aum =
        vaultEquityMap.get(leader.id) ??
        (snapshot ? toFloat(snapshot.currentEquity) : 0);
      const followers =
        followerCountMap.get(leader.id) ?? leader.followersCount;

      return {
        id: leader.id,
        name: leader.name,
        username: leader.username,
        address: leader.address,
        avatar: leader.avatar,
        isAI: leader.isAi,
        roi30d,
        aum,
        followers,
        sharpe,
        winRate,
        tags: leader.tags ?? [],
      };
    });

    const maxRoi = Math.max(
      ...normalizedLeaders.map((leader) => Math.abs(leader.roi30d)),
      1,
    );
    const maxAum = Math.max(
      ...normalizedLeaders.map((leader) => leader.aum),
      1,
    );
    const maxFollowers = Math.max(
      ...normalizedLeaders.map((leader) => leader.followers),
      1,
    );

    const ranked: LeaderRankingView[] = normalizedLeaders.map((leader) => {
      const score =
        (leader.roi30d / maxRoi) * 0.4 +
        (leader.aum / maxAum) * 0.3 +
        (leader.followers / maxFollowers) * 0.2 +
        (leader.sharpe / 10) * 0.1;

      return {
        id: leader.id,
        address: leader.address,
        score,
        roi30d: leader.roi30d,
        aum: leader.aum,
        followers: leader.followers,
        name: leader.name,
        username: leader.username,
        isAI: leader.isAI,
        avatar: leader.avatar,
        winRate: leader.winRate,
        sharpe: leader.sharpe,
        tags: leader.tags,
      };
    });

    ranked.sort((a, b) => b.score - a.score);
    return ranked;
  },

  async rankLeaders(
    segment: LeaderRankingSegment = 'all',
  ): Promise<LeaderRanking[]> {
    const ranked = await this.buildLeaderRankingView(segment);
    return ranked.map((leader) => ({
      address: leader.address,
      score: leader.score,
      roi30d: leader.roi30d,
      aum: leader.aum,
      followers: leader.followers,
      name: leader.name,
    }));
  },

  // ─── Top Trader Ranking (by weekly volume, with wash-trade / Sybil filters) ─

  async rankTopTraders(
    weekStart: Date,
    weekEnd: Date,
  ): Promise<TraderRanking[]> {
    const MIN_UNIQUE_COUNTERPARTIES = 3; // wallet must trade with ≥3 distinct counterparties
    const BILATERAL_WASH_THRESHOLD = 0.5; // >50% volume with a single counterparty → excluded

    // SETTLED-only (BE-05): unsettled trades (e.g. synthetic agent orders that
    // can never settle) must not earn ranking volume.
    const trades = await prisma.trade.findMany({
      where: {
        settlementStatus: 'SETTLED',
        settledAt: { gte: weekStart, lt: weekEnd },
      },
      select: {
        makerAddress: true,
        takerAddress: true,
        quoteAmount: true,
      },
    });

    // per-address: total taker-side volume, trade count, volume breakdown by counterparty
    const volumeMap = new Map<string, { volume: number; count: number }>();
    const counterMap = new Map<string, Map<string, number>>(); // addr → (counterparty → volume)

    for (const trade of trades) {
      // Self-trade guard (should already be prevented by orderbook, but belt-and-suspenders)
      if (trade.makerAddress === trade.takerAddress) continue;

      const vol = toFloat(trade.quoteAmount);

      // Only credit the TAKER side — crediting both sides enables Sybil wash-trade farming
      const taker = volumeMap.get(trade.takerAddress) || {
        volume: 0,
        count: 0,
      };
      taker.volume += vol;
      taker.count++;
      volumeMap.set(trade.takerAddress, taker);

      // Track per-counterparty volume for bilateral wash detection
      const takerCounters =
        counterMap.get(trade.takerAddress) || new Map<string, number>();
      takerCounters.set(
        trade.makerAddress,
        (takerCounters.get(trade.makerAddress) || 0) + vol,
      );
      counterMap.set(trade.takerAddress, takerCounters);
    }

    const ranked: TraderRanking[] = [];
    for (const [address, data] of volumeMap.entries()) {
      if (data.volume <= 0) continue;

      const counters = counterMap.get(address) ?? new Map<string, number>();
      const uniqueCounterparties = counters.size;

      // Filter 1 — minimum unique counterparties (prevents 2-wallet farming ring)
      if (uniqueCounterparties < MIN_UNIQUE_COUNTERPARTIES) continue;

      // Filter 2 — bilateral wash trade: >50% volume concentrated with one counterparty
      const maxSingleCounterpartyVol = Math.max(...counters.values());
      if (maxSingleCounterpartyVol / data.volume > BILATERAL_WASH_THRESHOLD)
        continue;

      ranked.push({ address, volume: data.volume, tradeCount: data.count });
    }

    ranked.sort((a, b) => b.volume - a.volume);
    return ranked;
  },

  getRankingWindow(mode: RewardRankingWindow = 'current'): {
    mode: RewardRankingWindow;
    weekStart: Date;
    weekEnd: Date;
  } {
    const currentWeekStart = this.getCurrentWeekStart();

    if (mode === 'previous') {
      return {
        mode,
        weekStart: new Date(
          currentWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000,
        ),
        weekEnd: currentWeekStart,
      };
    }

    return {
      mode,
      weekStart: currentWeekStart,
      weekEnd: this.getWeekEnd(currentWeekStart),
    };
  },

  async getPublicRankings(params?: {
    limit?: number;
    segment?: LeaderRankingSegment;
    week?: RewardRankingWindow;
  }) {
    const limit = Math.max(1, Math.min(params?.limit ?? 10, 50));
    const segment = params?.segment ?? 'all';
    const window = this.getRankingWindow(params?.week ?? 'current');

    const [leaders, traders] = await Promise.all([
      this.buildLeaderRankingView(segment),
      this.rankTopTraders(window.weekStart, window.weekEnd),
    ]);

    return {
      window: {
        mode: window.mode,
        weekStart: window.weekStart,
        weekEnd: window.weekEnd,
      },
      leaders: leaders.slice(0, limit).map((leader, index) => ({
        id: leader.id,
        address: leader.address,
        name: leader.name,
        username: leader.username,
        isAI: leader.isAI,
        avatar: leader.avatar,
        roi30d: leader.roi30d,
        winRate: leader.winRate,
        sharpe: leader.sharpe,
        followers: leader.followers,
        aum: abbreviateAum(leader.aum),
        aumRaw: leader.aum,
        score: leader.score,
        tags: leader.tags,
        rank: index + 1,
      })),
      traders: traders.slice(0, limit).map((trader, index) => ({
        address: trader.address,
        volume: trader.volume,
        tradeCount: trader.tradeCount,
        rank: index + 1,
      })),
    };
  },

  // ─── Distribution Engine (REAL ON-CHAIN) ─────────────────────────────────

  async runWeeklyDistribution() {
    if (!config.rewards.enabled) {
      log.info('[Rewards] Distribution disabled by config');
      return null;
    }

    const now = new Date();
    const currentWeekStart = this.getCurrentWeekStart();
    const prevWeekStart = new Date(
      currentWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000,
    );
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
      log.info(
        { weekStart: prevWeekStart },
        '[Rewards] Week already distributed',
      );
      return { status: 'ALREADY_DISTRIBUTED', weekId: week.id };
    }

    // Distributed lock — prevents concurrent runs (scheduler + manual trigger,
    // two replicas, etc). Combined with the per-recipient idempotency below,
    // this guarantees no double payment even if one run crashes mid-flight.
    const lockAcquired = await acquireDistributionLock(week.id);
    if (!lockAcquired) {
      log.warn(
        { weekId: week.id, weekStart: prevWeekStart },
        '[Rewards] Distribution already in progress on another instance — skipping',
      );
      return { status: 'LOCK_HELD', weekId: week.id };
    }

    try {
      return await this._runWeeklyDistributionLocked(
        week,
        now,
        prevWeekStart,
        prevWeekEnd,
      );
    } finally {
      await releaseDistributionLock(week.id);
    }
  },

  async _runWeeklyDistributionLocked(
    week: { id: string; status: string },
    now: Date,
    prevWeekStart: Date,
    prevWeekEnd: Date,
  ) {
    // 1. Calculate total fees
    const totalFees = await this.calculateWeeklyFees(
      prevWeekStart,
      prevWeekEnd,
    );

    if (totalFees <= 0) {
      log.info(
        { weekStart: prevWeekStart },
        '[Rewards] No fees collected this week',
      );
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

    const { split, rewardPool, leaderPool, traderPool, stakerPool } =
      this.calculateRewardBuckets(totalFees);

    if (!split.splitValid) {
      throw new Error(
        `Invalid reward split config: leader/trader/staker pools must sum to 100, received ${split.splitTotalPct}`,
      );
    }

    log.info(
      {
        weekStart: prevWeekStart,
        totalFees,
        rewardPool,
        leaderPool,
        traderPool,
        stakerPool,
        split,
      },
      '[Rewards] Starting weekly distribution',
    );

    // 2. REAL: Fund staking contract with staker pool
    let fundTxHash: string | null = null;
    let distributeTxHash: string | null = null;
    let stakingDistributionOk = true;
    let stakingDistributionError: string | null = null;

    if (rewardPayoutService.isEnabled() && stakerPool > 0) {
      // Fund the staking contract
      const fundResult =
        await rewardPayoutService.fundStakingRewards(stakerPool);
      if (fundResult.success) {
        fundTxHash = fundResult.txHash;
        log.info(
          { txHash: fundTxHash, amount: stakerPool },
          '[Rewards] Staking contract funded',
        );

        // Trigger on-chain distribution to stakers
        const distResult = await rewardPayoutService.distributeRewards();
        if (distResult.success) {
          distributeTxHash = distResult.txHash;
          log.info(
            { txHash: distributeTxHash },
            '[Rewards] On-chain distribution triggered',
          );
        } else {
          stakingDistributionOk = false;
          stakingDistributionError =
            distResult.error || 'Unknown staking distribution error';
          log.error(
            { error: distResult.error },
            '[Rewards] On-chain distribution failed',
          );
        }
      } else {
        stakingDistributionOk = false;
        stakingDistributionError =
          fundResult.error || 'Unknown staking funding error';
        log.error(
          { error: fundResult.error },
          '[Rewards] Failed to fund staking contract',
        );
      }
    } else if (stakerPool > 0) {
      log.warn(
        '[Rewards] Payout service not enabled — staker rewards recorded but NOT sent on-chain',
      );
    }

    if (!stakingDistributionOk) {
      throw new Error(
        `Staker reward funding/distribution failed: ${stakingDistributionError}`,
      );
    }

    // 3. Distribute leader rewards (with real native transfers)
    const leaderRewards = await this.distributeLeaderRewards(
      leaderPool,
      week.id,
    );

    // 4. Distribute top trader rewards (native transfers by volume)
    const traderRewards = await this.distributeTraderRewards(
      traderPool,
      week.id,
      prevWeekStart,
      prevWeekEnd,
    );

    // 5. Record funding metadata only — staker ownership/claim source of truth lives on-chain
    const stakerDistribution = await this.recordStakerFunding(
      stakerPool,
      week.id,
      fundTxHash,
      distributeTxHash,
    );

    // 6. Update week record
    await db.rewardWeek.update({
      where: { id: week.id },
      data: {
        totalFeesCollected: new Decimal(totalFees.toString()),
        rewardPoolAmount: new Decimal(rewardPool.toString()),
        leaderPoolAmount: new Decimal(leaderPool.toString()),
        stakerPoolAmount: new Decimal(stakerPool.toString()),
        status: 'DISTRIBUTED',
        distributedAt: now,
      },
    });

    // 7. Ensure next week row exists
    await this.ensureCurrentWeek();

    log.info(
      {
        weekId: week.id,
        leaderRewards: leaderRewards.length,
        traderRewards: traderRewards.length,
        stakerRewardEntries: stakerDistribution.recordedEntries,
        stakerClaimMode: stakerDistribution.claimMode,
        totalDistributed: rewardPool,
        fundTxHash,
        distributeTxHash,
      },
      '[Rewards] Distribution complete',
    );

    return {
      status: 'DISTRIBUTED',
      weekId: week.id,
      totalFees,
      rewardPool,
      split,
      allocation: {
        leaderPool,
        traderPool,
        stakerPool,
      },
      leaderRewards: leaderRewards.length,
      traderRewards: traderRewards.length,
      stakerRewards: stakerDistribution.recordedEntries,
      stakerClaimMode: stakerDistribution.claimMode,
      fundTxHash,
      distributeTxHash,
    };
  },

  // ─── Leader Distribution (REAL Native Transfers) ─────────────────────────

  async distributeLeaderRewards(pool: number, weekId: string) {
    const leaders = await this.rankLeaders();
    if (leaders.length === 0 || pool <= 0) return [];

    const rewards: Array<{
      address: string;
      amount: number;
      rank: number;
      txHash: string | null;
      status: string;
    }> = [];

    // Top 3 get fixed percentages
    for (let i = 0; i < Math.min(3, leaders.length); i++) {
      const amount = pool * TOP_SHARE[i];
      rewards.push({
        address: leaders[i].address,
        amount,
        rank: i + 1,
        txHash: null,
        status: 'PENDING',
      });
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
    const payoutEnabled = rewardPayoutService.isEnabled();

    for (const reward of rewards) {
      if (reward.amount <= 0) continue;

      // Per-recipient idempotency: if a userReward record already exists for
      // this (week, address, rewardType), a previous run already processed
      // this recipient. Skip the on-chain transfer to prevent double payment.
      const existing = await db.userReward.findFirst({
        where: {
          rewardWeekId: weekId,
          walletAddress: reward.address,
          rewardType: 'LEADER',
        },
      });
      if (existing) {
        log.warn(
          {
            address: reward.address,
            existingTxHash: existing.txHash,
            existingStatus: existing.payoutStatus,
          },
          '[Rewards] Skipping leader — already paid in a prior run',
        );
        reward.txHash = existing.txHash ?? null;
        reward.status = existing.payoutStatus ?? 'PENDING';
        continue;
      }

      // Idempotency claim: persist the reward record BEFORE moving money.
      // The @@unique([rewardWeekId, walletAddress, rewardType]) constraint makes
      // this the durable lock — if a concurrent run already inserted the row,
      // create throws P2002 and we skip the transfer entirely. A crash between
      // this create and the transfer leaves a PENDING record that blocks a
      // re-pay on the next run (findFirst above returns it).
      let rewardRecordId: string;
      try {
        const created = await db.userReward.create({
          data: {
            rewardWeekId: weekId,
            walletAddress: reward.address,
            amount: new Decimal(reward.amount.toString()),
            rewardType: 'LEADER',
            rank: reward.rank,
            txHash: null,
            payoutStatus: 'PENDING',
            payoutError: null,
          },
        });
        rewardRecordId = created.id;
      } catch (err: unknown) {
        if ((err as { code?: string }).code === 'P2002') {
          log.warn(
            { address: reward.address },
            '[Rewards] Leader reward already claimed concurrently — skipping payout',
          );
          continue;
        }
        throw err;
      }

      if (payoutEnabled) {
        const paid = await payTrackedReward(
          rewardRecordId,
          'PENDING',
          reward.address,
          reward.amount,
        );
        reward.txHash = paid.txHash;
        reward.status = paid.status;
      }
    }

    return rewards;
  },

  // ─── Top Trader Distribution (REAL Native Transfers) ────────────────────

  async distributeTraderRewards(
    pool: number,
    weekId: string,
    weekStart: Date,
    weekEnd: Date,
  ) {
    const traders = await this.rankTopTraders(weekStart, weekEnd);
    if (traders.length === 0 || pool <= 0) return [];

    const rewards: Array<{
      address: string;
      amount: number;
      rank: number;
      txHash: string | null;
      status: string;
    }> = [];

    // Same curve as leaders: top 3 fixed %, top 4-10 split remaining
    for (let i = 0; i < Math.min(3, traders.length); i++) {
      const amount = pool * TOP_SHARE[i];
      rewards.push({
        address: traders[i].address,
        amount,
        rank: i + 1,
        txHash: null,
        status: 'PENDING',
      });
    }

    const remaining = pool * TOP_REMAINING_PCT;
    const rest = traders.slice(3, 10);
    if (rest.length > 0) {
      const per = remaining / rest.length;
      for (let i = 0; i < rest.length; i++) {
        rewards.push({
          address: rest[i].address,
          amount: per,
          rank: i + 4,
          txHash: null,
          status: 'PENDING',
        });
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

    const payoutEnabled = rewardPayoutService.isEnabled();

    for (const reward of rewards) {
      if (reward.amount <= 0) continue;

      // Per-recipient idempotency — see distributeLeaderRewards comment.
      const existing = await db.userReward.findFirst({
        where: {
          rewardWeekId: weekId,
          walletAddress: reward.address,
          rewardType: 'TRADER',
        },
      });
      if (existing) {
        log.warn(
          {
            address: reward.address,
            existingTxHash: existing.txHash,
            existingStatus: existing.payoutStatus,
          },
          '[Rewards] Skipping trader — already paid in a prior run',
        );
        reward.txHash = existing.txHash ?? null;
        reward.status = existing.payoutStatus ?? 'PENDING';
        continue;
      }

      // Idempotency claim BEFORE moving money — see distributeLeaderRewards.
      let rewardRecordId: string;
      try {
        const created = await db.userReward.create({
          data: {
            rewardWeekId: weekId,
            walletAddress: reward.address,
            amount: new Decimal(reward.amount.toString()),
            rewardType: 'TRADER',
            rank: reward.rank,
            txHash: null,
            payoutStatus: 'PENDING',
            payoutError: null,
          },
        });
        rewardRecordId = created.id;
      } catch (err: unknown) {
        if ((err as { code?: string }).code === 'P2002') {
          log.warn(
            { address: reward.address },
            '[Rewards] Trader reward already claimed concurrently — skipping payout',
          );
          continue;
        }
        throw err;
      }

      if (payoutEnabled) {
        const paid = await payTrackedReward(
          rewardRecordId,
          'PENDING',
          reward.address,
          reward.amount,
        );
        reward.txHash = paid.txHash;
        reward.status = paid.status;
      }
    }

    return rewards;
  },

  // ─── Staker Distribution Record ──────────────────────────────────────────

  async recordStakerFunding(
    pool: number,
    weekId: string,
    fundTxHash: string | null,
    distributeTxHash: string | null,
  ) {
    if (pool <= 0) {
      return {
        recordedEntries: 0,
        claimMode: 'on-chain' as const,
      };
    }

    log.info(
      {
        weekId,
        stakerPool: pool,
        fundTxHash,
        distributeTxHash,
      },
      '[Rewards] Staker pool funded on-chain; per-user rewards are not materialized in DB',
    );

    return {
      recordedEntries: 0,
      claimMode: 'on-chain' as const,
    };
  },

  // ─── User Queries ────────────────────────────────────────────────────────

  async getPendingRewards(address: string) {
    const rewards = await db.userReward.findMany({
      where: {
        walletAddress: address,
        claimed: false,
        rewardType: { in: ['LEADER', 'TRADER'] },
      },
      include: {
        rewardWeek: {
          select: { weekStart: true, weekEnd: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    const dbBackedRewards = rewards.filter(
      (r) => r.rewardType === 'LEADER' || r.rewardType === 'TRADER',
    );

    const leaderTotal = dbBackedRewards
      .filter((r) => r.rewardType === 'LEADER')
      .reduce((sum, r) => sum + toFloat(r.amount), 0);

    const traderTotal = dbBackedRewards
      .filter((r) => r.rewardType === 'TRADER')
      .reduce((sum, r) => sum + toFloat(r.amount), 0);

    return {
      total: leaderTotal + traderTotal,
      leaderRewards: leaderTotal,
      traderRewards: traderTotal,
      stakerRewards: 0,
      stakerClaimMode: 'on-chain',
      entries: dbBackedRewards.map((r) => ({
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
   * Claim rewards — marks DB-backed trading rewards as claimed.
   *
   * For LEADER rewards: LUNES was already transferred via transferNative.
   * For STAKER rewards: user claims via on-chain staking contract claim_rewards(),
   * so they are intentionally excluded from DB claim flows.
   */
  async claimRewards(address: string) {
    const pending = await db.userReward.findMany({
      where: {
        walletAddress: address,
        claimed: false,
        rewardType: { in: ['LEADER', 'TRADER'] },
      },
    });
    const dbBackedPending = pending.filter(
      (r) => r.rewardType === 'LEADER' || r.rewardType === 'TRADER',
    );

    if (dbBackedPending.length === 0) {
      return { claimed: false, message: 'No pending rewards' };
    }

    const totalAmount = dbBackedPending.reduce(
      (sum, r) => sum + toFloat(r.amount),
      0,
    );

    const now = new Date();
    await db.userReward.updateMany({
      where: {
        walletAddress: address,
        claimed: false,
        rewardType: { in: ['LEADER', 'TRADER'] },
      },
      data: { claimed: true, claimedAt: now },
    });

    log.info(
      { address, totalAmount, rewardCount: dbBackedPending.length },
      '[Rewards] Rewards claimed',
    );

    return {
      claimed: true,
      totalAmount,
      rewardsClaimed: dbBackedPending.length,
      claimedAt: now,
    };
  },

  async getRewardHistory(address: string, limit = 50) {
    const rewards = await db.userReward.findMany({
      where: {
        walletAddress: address,
        rewardType: { in: ['LEADER', 'TRADER'] },
      },
      include: {
        rewardWeek: {
          select: { weekStart: true, weekEnd: true, totalFeesCollected: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    const dbBackedRewards = rewards.filter(
      (r) => r.rewardType === 'LEADER' || r.rewardType === 'TRADER',
    );

    return dbBackedRewards.map((r) => ({
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
    const split = this.getRewardSplitConfig();
    const weeks = await db.rewardWeek.findMany({
      where: { status: 'DISTRIBUTED' },
      orderBy: { weekStart: 'desc' },
      take: limit,
      include: {
        rewards: {
          select: {
            rewardType: true,
            amount: true,
            payoutStatus: true,
            claimed: true,
          },
        },
        _count: { select: { rewards: true } },
      },
    });

    return weeks.map((week) => {
      const rewardPoolAmount = toFloat(week.rewardPoolAmount);
      const leaderPoolAmount = toFloat(week.leaderPoolAmount);
      const stakerPoolAmount = toFloat(week.stakerPoolAmount);
      const traderPoolAmount = Math.max(
        rewardPoolAmount - leaderPoolAmount - stakerPoolAmount,
        0,
      );
      const rewards = Array.isArray(week.rewards) ? week.rewards : [];

      return {
        id: week.id,
        weekStart: week.weekStart,
        weekEnd: week.weekEnd,
        totalFeesCollected: toFloat(week.totalFeesCollected),
        rewardPoolAmount,
        leaderPoolAmount,
        traderPoolAmount,
        stakerPoolAmount,
        status: week.status,
        distributedAt: week.distributedAt,
        createdAt: week.createdAt,
        _count: week._count,
        split,
        observability: {
          dbBackedRewardEntries: week._count?.rewards ?? rewards.length,
          leader: this.summarizeDbBackedWeekRewards(
            rewards,
            'LEADER',
            leaderPoolAmount,
          ),
          trader: this.summarizeDbBackedWeekRewards(
            rewards,
            'TRADER',
            traderPoolAmount,
          ),
          staker: {
            amount: stakerPoolAmount,
            claimMode: 'on-chain' as const,
            fundedOnChain: stakerPoolAmount > 0,
          },
        },
      };
    });
  },

  // ─── Reconcile UNKNOWN Payouts ───────────────────────────────────────────

  /**
   * Resolve UNKNOWN (and stale SUBMITTED) payouts by their persisted hash,
   * from FINALIZED blocks only. Never broadcasts anything.
   *  - INCLUDED_SUCCESS            -> CONFIRMED
   *  - INCLUDED_FAILED / NOT_INCLUDED (era expired) -> FAILED (proven unpaid,
   *    eligible for retryFailedPayouts on a later run)
   *  - PENDING / UNAVAILABLE       -> untouched
   */
  async reconcileUnknownPayouts(limit = 25) {
    const staleBefore = new Date(Date.now() - STALE_SUBMITTED_PAYOUT_MS);
    const rows = await db.userReward.findMany({
      where: {
        rewardType: { in: ['LEADER', 'TRADER'] },
        txHash: { not: null },
        OR: [
          { payoutStatus: 'UNKNOWN' },
          { payoutStatus: 'SUBMITTED', payoutSubmittedAt: { lt: staleBefore } },
        ],
      },
      take: limit,
      orderBy: { createdAt: 'asc' },
    });

    const summary = { checked: 0, confirmed: 0, failed: 0, pending: 0 };
    for (const row of rows) {
      summary.checked++;
      if (
        !row.txHash ||
        row.payoutBirthBlock == null ||
        row.payoutMortality == null
      ) {
        // No era recorded: cannot prove absence. Needs manual review.
        log.error(
          { rewardId: row.id, txHash: row.txHash },
          '[Rewards] UNKNOWN payout without era data — manual reconciliation required',
        );
        summary.pending++;
        continue;
      }

      const r = await rewardPayoutService.reconcileTransfer({
        txHash: row.txHash,
        birthBlock: row.payoutBirthBlock,
        mortality: row.payoutMortality,
      });

      if (r.outcome === 'PENDING' || r.outcome === 'UNAVAILABLE') {
        summary.pending++;
        continue;
      }

      const confirmed = r.outcome === 'INCLUDED_SUCCESS';
      const { count } = await db.userReward.updateMany({
        where: {
          id: row.id,
          payoutStatus: row.payoutStatus,
          txHash: row.txHash,
        },
        data: confirmed
          ? { payoutStatus: 'CONFIRMED', payoutError: null }
          : {
              payoutStatus: 'FAILED',
              payoutError:
                r.outcome === 'INCLUDED_FAILED'
                  ? r.error
                  : 'Not included before mortal era expired',
            },
      });
      if (count !== 1) continue;
      if (confirmed) summary.confirmed++;
      else summary.failed++;
      log.warn(
        { rewardId: row.id, txHash: row.txHash, outcome: r.outcome },
        '[Rewards] Reconciled UNKNOWN payout',
      );
    }
    return summary;
  },

  // ─── Retry Failed Payouts ────────────────────────────────────────────────

  /**
   * Re-pays only FAILED rows (proven unpaid). UNKNOWN / SUBMITTED rows are
   * never re-paid here — they are reconciled by hash first.
   */
  async retryFailedPayouts(limit = 10) {
    if (!rewardPayoutService.isEnabled()) {
      return { retried: 0 };
    }

    const reconciled = await this.reconcileUnknownPayouts(limit);

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
      if (amount <= 0) continue;

      const paid = await payTrackedReward(
        reward.id,
        'FAILED',
        reward.walletAddress,
        amount,
      );
      if (paid.status === 'CONFIRMED') retried++;
    }

    log.info(
      { retried, total: failed.length, reconciled },
      '[Rewards] Retried failed payouts',
    );
    return { retried, total: failed.length, reconciled };
  },
};
