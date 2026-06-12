jest.mock('../db', () => ({
  __esModule: true,
  default: {
    userReward: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
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
    blockchain: { wsUrl: '', relayerSeed: '' },
    socialAnalytics: { chainName: 'lunes' },
  },
}));

jest.mock('../utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../services/rewardPayoutService', () => ({
  rewardPayoutService: {
    isEnabled: jest.fn(() => true),
    transferNative: jest.fn(),
  },
}));

import prisma from '../db';
import { rewardDistributionService } from '../services/rewardDistributionService';
import { rewardPayoutService } from '../services/rewardPayoutService';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPrisma = prisma as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPayout = rewardPayoutService as any;

describe('rewardDistributionService — no double-pay across reprocessing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.userReward.create.mockResolvedValue({ id: 'ur-1' });
    mockPrisma.userReward.update.mockResolvedValue({});
    mockPayout.transferNative.mockResolvedValue({
      success: true,
      txHash: '0xpaid',
      error: null,
    });
    jest
      .spyOn(rewardDistributionService, 'rankLeaders')
      .mockResolvedValue([
        { address: 'leader-a', score: 10, roi30d: 1, aum: 1, followers: 1, name: 'A' },
      ]);
  });

  it('pays once on the first run', async () => {
    // No prior reward record exists.
    mockPrisma.userReward.findFirst.mockResolvedValue(null);

    await rewardDistributionService.distributeLeaderRewards(100, 'week-1');

    expect(mockPayout.transferNative).toHaveBeenCalledTimes(1);
  });

  it('does NOT pay again when the reward was already recorded (crash-and-retry)', async () => {
    // Simulate a prior run that already created the idempotency record.
    mockPrisma.userReward.findFirst.mockResolvedValue({
      id: 'ur-existing',
      walletAddress: 'leader-a',
      txHash: '0xpaid',
      payoutStatus: 'CONFIRMED',
    });

    await rewardDistributionService.distributeLeaderRewards(100, 'week-1');

    // Critical: the on-chain transfer must NOT fire a second time.
    expect(mockPayout.transferNative).not.toHaveBeenCalled();
  });

  it('claims the idempotency record BEFORE transferring (create precedes transfer)', async () => {
    mockPrisma.userReward.findFirst.mockResolvedValue(null);

    const order: string[] = [];
    mockPrisma.userReward.create.mockImplementation(async () => {
      order.push('create');
      return { id: 'ur-1' };
    });
    mockPayout.transferNative.mockImplementation(async () => {
      order.push('transfer');
      return { success: true, txHash: '0xpaid', error: null };
    });

    await rewardDistributionService.distributeLeaderRewards(100, 'week-1');

    // The DB idempotency claim must be persisted before money moves, so a crash
    // mid-transfer leaves a record that blocks a re-pay on the next run.
    expect(order[0]).toBe('create');
    expect(order).toContain('transfer');
    expect(order.indexOf('create')).toBeLessThan(order.indexOf('transfer'));
  });

  it('treats a unique-constraint violation on create as already-paid (no transfer)', async () => {
    mockPrisma.userReward.findFirst.mockResolvedValue(null);
    // Concurrent run already inserted the row — Prisma P2002 unique violation.
    const p2002 = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
    });
    mockPrisma.userReward.create.mockRejectedValue(p2002);

    await expect(
      rewardDistributionService.distributeLeaderRewards(100, 'week-1'),
    ).resolves.toBeDefined();

    expect(mockPayout.transferNative).not.toHaveBeenCalled();
  });
});
