jest.mock('../db', () => ({
  __esModule: true,
  default: {
    userReward: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    rewardWeek: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    trade: {
      aggregate: jest.fn(),
      findMany: jest.fn(),
    },
    leader: {
      findMany: jest.fn(),
    },
    leaderFollow: {
      groupBy: jest.fn(),
    },
    copyVault: {
      findMany: jest.fn(),
    },
    leaderAnalyticsSnapshot: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('../config', () => ({
  config: {
    rewards: {
      enabled: true,
      rewardPoolPct: 20,
      leaderPoolPct: 40,
      traderPoolPct: 30,
      stakerPoolPct: 30,
    },
    blockchain: {
      wsUrl: '',
      relayerSeed: '',
    },
    socialAnalytics: {
      chainName: 'lunes',
    },
  },
}));

jest.mock('../utils/logger', () => ({
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../services/rewardPayoutService', () => ({
  rewardPayoutService: {
    isEnabled: jest.fn(() => false),
    getRelayerBalanceLunes: jest.fn(),
    fundStakingRewards: jest.fn(),
    distributeRewards: jest.fn(),
    transferNative: jest.fn(),
  },
}));

import prisma from '../db';
import { rewardDistributionService } from '../services/rewardDistributionService';
import { rewardPayoutService } from '../services/rewardPayoutService';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockRewardPayoutService = rewardPayoutService as jest.Mocked<
  typeof rewardPayoutService
>;

describe('rewardDistributionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockPrisma.userReward.updateMany as jest.Mock).mockResolvedValue({
      count: 0,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockPrisma.userReward.create as jest.Mock).mockResolvedValue({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockPrisma.leaderFollow.groupBy as jest.Mock).mockResolvedValue([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockPrisma.copyVault.findMany as jest.Mock).mockResolvedValue([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (
      mockPrisma.leaderAnalyticsSnapshot.findMany as jest.Mock
    ).mockResolvedValue([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockPrisma.trade.findMany as jest.Mock).mockResolvedValue([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockPrisma.trade.aggregate as jest.Mock).mockResolvedValue({
      _sum: { makerFee: '10', takerFee: '15' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockPrisma.rewardWeek.findUnique as jest.Mock).mockResolvedValue({
      id: 'week-current',
      weekStart: new Date('2026-04-13T00:00:00Z'),
      weekEnd: new Date('2026-04-20T00:00:00Z'),
      status: 'ACCUMULATING',
      distributedAt: null,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockPrisma.rewardWeek.findMany as jest.Mock).mockResolvedValue([]);
    mockRewardPayoutService.isEnabled.mockReturnValue(false);
  });

  it('returns reward pool with canonical split metadata', async () => {
    const pool = await rewardDistributionService.getRewardPool();

    expect(pool.totalFeesCollected).toBe(25);
    expect(pool.rewardPool).toBe(5);
    expect(pool.leaderPool).toBe(2);
    expect(pool.traderPool).toBe(1.5);
    expect(pool.stakerPool).toBe(1.5);
    expect(pool.split).toEqual({
      rewardPoolPct: 20,
      leaderPoolPct: 40,
      traderPoolPct: 30,
      stakerPoolPct: 30,
      splitTotalPct: 100,
      splitValid: true,
    });
  });

  it('records staker funding as on-chain only and does not create per-user DB rewards', async () => {
    const result = await rewardDistributionService.recordStakerFunding(
      1250,
      'week-1',
      '0xfund',
      '0xdistribute',
    );

    expect(result).toEqual({
      recordedEntries: 0,
      claimMode: 'on-chain',
    });
    expect(mockPrisma.userReward.create).not.toHaveBeenCalled();
  });

  it('excludes STAKER rows from pending DB-backed rewards', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockPrisma.userReward.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'leader-1',
        rewardType: 'LEADER',
        amount: '10',
        rank: 1,
        txHash: '0xleader',
        payoutStatus: 'CONFIRMED',
        createdAt: new Date('2026-04-01T00:00:00Z'),
        rewardWeek: {
          weekStart: new Date('2026-03-30T00:00:00Z'),
          weekEnd: new Date('2026-04-06T00:00:00Z'),
        },
      },
      {
        id: 'trader-1',
        rewardType: 'TRADER',
        amount: '5',
        rank: 2,
        txHash: '0xtrader',
        payoutStatus: 'CONFIRMED',
        createdAt: new Date('2026-04-02T00:00:00Z'),
        rewardWeek: {
          weekStart: new Date('2026-03-30T00:00:00Z'),
          weekEnd: new Date('2026-04-06T00:00:00Z'),
        },
      },
      {
        id: 'staker-1',
        rewardType: 'STAKER',
        amount: '999',
        rank: null,
        txHash: '0xstaker',
        payoutStatus: 'CONFIRMED',
        createdAt: new Date('2026-04-03T00:00:00Z'),
        rewardWeek: {
          weekStart: new Date('2026-03-30T00:00:00Z'),
          weekEnd: new Date('2026-04-06T00:00:00Z'),
        },
      },
    ]);

    const pending = await rewardDistributionService.getPendingRewards('addr-1');

    expect(mockPrisma.userReward.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          walletAddress: 'addr-1',
          claimed: false,
          rewardType: { in: ['LEADER', 'TRADER'] },
        }),
      }),
    );
    expect(pending.total).toBe(15);
    expect(pending.leaderRewards).toBe(10);
    expect(pending.traderRewards).toBe(5);
    expect(pending.stakerRewards).toBe(0);
    expect(pending.stakerClaimMode).toBe('on-chain');
    expect(pending.entries).toHaveLength(2);
    expect(
      pending.entries.every(
        (entry: { type: string }) => entry.type !== 'STAKER',
      ),
    ).toBe(true);
  });

  it('claims only DB-backed leader and trader rewards', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockPrisma.userReward.findMany as jest.Mock).mockResolvedValue([
      { rewardType: 'LEADER', amount: '10' },
      { rewardType: 'TRADER', amount: '5' },
      { rewardType: 'STAKER', amount: '999' },
    ]);

    const result = await rewardDistributionService.claimRewards('addr-2');

    expect(result.claimed).toBe(true);
    expect(result.totalAmount).toBe(15);
    expect(result.rewardsClaimed).toBe(2);
    expect(mockPrisma.userReward.updateMany).toHaveBeenCalledWith({
      where: {
        walletAddress: 'addr-2',
        claimed: false,
        rewardType: { in: ['LEADER', 'TRADER'] },
      },
      data: {
        claimed: true,
        claimedAt: expect.any(Date),
      },
    });
  });

  it('distributes leader rewards with canonical rank split and DB entries', async () => {
    jest.spyOn(rewardDistributionService, 'rankLeaders').mockResolvedValue([
      {
        address: 'leader-a',
        score: 10,
        roi30d: 1,
        aum: 1,
        followers: 1,
        name: 'A',
      },
      {
        address: 'leader-b',
        score: 9,
        roi30d: 1,
        aum: 1,
        followers: 1,
        name: 'B',
      },
      {
        address: 'leader-c',
        score: 8,
        roi30d: 1,
        aum: 1,
        followers: 1,
        name: 'C',
      },
      {
        address: 'leader-d',
        score: 7,
        roi30d: 1,
        aum: 1,
        followers: 1,
        name: 'D',
      },
    ]);

    const rewards = await rewardDistributionService.distributeLeaderRewards(
      100,
      'week-leader',
    );

    expect(rewards).toHaveLength(4);
    expect(rewards[0].amount).toBeCloseTo(20, 10);
    expect(rewards[1].amount).toBeCloseTo(15, 10);
    expect(rewards[2].amount).toBeCloseTo(10, 10);
    expect(rewards[3].amount).toBeCloseTo(55, 10);
    expect(mockPrisma.userReward.create).toHaveBeenCalledTimes(4);

    const createCalls = (mockPrisma.userReward.create as jest.Mock).mock.calls;
    expect(createCalls[0][0].data.rewardType).toBe('LEADER');
    expect(createCalls[0][0].data.rank).toBe(1);
    expect(createCalls[0][0].data.amount.toString()).toBe('20');
    expect(createCalls[3][0].data.rank).toBe(4);
    expect(Number(createCalls[3][0].data.amount.toString())).toBeCloseTo(
      55,
      10,
    );
    expect(
      createCalls.every((call) => call[0].data.payoutStatus === 'PENDING'),
    ).toBe(true);
  });

  it('distributes trader rewards with canonical rank split and DB entries', async () => {
    jest.spyOn(rewardDistributionService, 'rankTopTraders').mockResolvedValue([
      { address: 'trader-a', volume: 1000, tradeCount: 10 },
      { address: 'trader-b', volume: 900, tradeCount: 9 },
      { address: 'trader-c', volume: 800, tradeCount: 8 },
      { address: 'trader-d', volume: 700, tradeCount: 7 },
    ]);

    const rewards = await rewardDistributionService.distributeTraderRewards(
      200,
      'week-trader',
      new Date('2026-04-06T00:00:00Z'),
      new Date('2026-04-13T00:00:00Z'),
    );

    expect(rewards).toHaveLength(4);
    expect(rewards[0].amount).toBeCloseTo(40, 10);
    expect(rewards[1].amount).toBeCloseTo(30, 10);
    expect(rewards[2].amount).toBeCloseTo(20, 10);
    expect(rewards[3].amount).toBeCloseTo(110, 10);
    expect(mockPrisma.userReward.create).toHaveBeenCalledTimes(4);

    const createCalls = (mockPrisma.userReward.create as jest.Mock).mock.calls;
    expect(createCalls[0][0].data.rewardType).toBe('TRADER');
    expect(createCalls[0][0].data.rank).toBe(1);
    expect(createCalls[0][0].data.amount.toString()).toBe('40');
    expect(createCalls[3][0].data.rank).toBe(4);
    expect(Number(createCalls[3][0].data.amount.toString())).toBeCloseTo(
      110,
      10,
    );
  });

  it('ranks leaders from canonical followers, vault equity and analytics snapshot', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockPrisma.leader.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'leader-1',
        name: 'Alpha',
        username: 'alpha',
        address: 'addr-alpha',
        avatar: '',
        isAi: false,
        roi30d: '1',
        winRate: '40',
        totalAum: '10',
        followersCount: 99,
        sharpe: '0.1',
        tags: ['swing'],
      },
      {
        id: 'leader-2',
        name: 'Beta',
        username: 'beta',
        address: 'addr-beta',
        avatar: '',
        isAi: true,
        roi30d: '2',
        winRate: '41',
        totalAum: '20',
        followersCount: 1,
        sharpe: '0.2',
        tags: ['bot'],
      },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockPrisma.leaderFollow.groupBy as jest.Mock).mockResolvedValue([
      { leaderId: 'leader-1', _count: { id: 2 } },
      { leaderId: 'leader-2', _count: { id: 8 } },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockPrisma.copyVault.findMany as jest.Mock).mockResolvedValue([
      { leaderId: 'leader-1', totalEquity: '1000' },
      { leaderId: 'leader-2', totalEquity: '200' },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (
      mockPrisma.leaderAnalyticsSnapshot.findMany as jest.Mock
    ).mockResolvedValue([
      {
        leaderId: 'leader-1',
        roi30d: '10',
        sharpe: '3',
        winRate: '61',
        currentEquity: '900',
      },
      {
        leaderId: 'leader-2',
        roi30d: '5',
        sharpe: '1',
        winRate: '55',
        currentEquity: '180',
      },
    ]);

    const rankings = await rewardDistributionService.getPublicRankings({
      limit: 10,
      segment: 'all',
      week: 'current',
    });

    expect(rankings.leaders).toHaveLength(2);
    expect(rankings.leaders[0]).toEqual(
      expect.objectContaining({
        id: 'leader-1',
        address: 'addr-alpha',
        roi30d: 10,
        winRate: 61,
        sharpe: 3,
        followers: 2,
        aumRaw: 1000,
        aum: '1.0K',
        rank: 1,
      }),
    );
    expect(rankings.leaders[1]).toEqual(
      expect.objectContaining({
        id: 'leader-2',
        address: 'addr-beta',
        followers: 8,
        aumRaw: 200,
        rank: 2,
      }),
    );
  });

  it('returns distributed weeks with payout observability by type', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockPrisma.rewardWeek.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'week-obs',
        weekStart: new Date('2026-04-06T00:00:00Z'),
        weekEnd: new Date('2026-04-13T00:00:00Z'),
        totalFeesCollected: '500',
        rewardPoolAmount: '100',
        leaderPoolAmount: '40',
        stakerPoolAmount: '30',
        status: 'DISTRIBUTED',
        distributedAt: new Date('2026-04-13T00:10:00Z'),
        createdAt: new Date('2026-04-06T00:00:00Z'),
        rewards: [
          {
            rewardType: 'LEADER',
            amount: '25',
            payoutStatus: 'CONFIRMED',
            claimed: true,
          },
          {
            rewardType: 'LEADER',
            amount: '15',
            payoutStatus: 'PENDING',
            claimed: false,
          },
          {
            rewardType: 'TRADER',
            amount: '30',
            payoutStatus: 'FAILED',
            claimed: false,
          },
        ],
        _count: { rewards: 3 },
      },
    ]);

    const weeks = await rewardDistributionService.getDistributedWeeks(5);

    expect(mockPrisma.rewardWeek.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'DISTRIBUTED' },
        take: 5,
      }),
    );
    expect(weeks).toHaveLength(1);
    expect(weeks[0]).toMatchObject({
      id: 'week-obs',
      rewardPoolAmount: 100,
      leaderPoolAmount: 40,
      traderPoolAmount: 30,
      stakerPoolAmount: 30,
      split: {
        splitTotalPct: 100,
        splitValid: true,
      },
      observability: {
        dbBackedRewardEntries: 3,
        leader: {
          entries: 2,
          distributedAmount: 40,
          expectedPool: 40,
          claimedEntries: 1,
          unclaimedEntries: 1,
          payoutStatusCounts: {
            CONFIRMED: 1,
            PENDING: 1,
          },
        },
        trader: {
          entries: 1,
          distributedAmount: 30,
          expectedPool: 30,
          payoutStatusCounts: {
            FAILED: 1,
          },
        },
        staker: {
          amount: 30,
          claimMode: 'on-chain',
          fundedOnChain: true,
        },
      },
    });
  });
});
