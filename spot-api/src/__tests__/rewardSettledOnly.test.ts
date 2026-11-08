/**
 * BE-05 / BE-01 (rewards side): reward pools and rankings must only be built
 * from data with on-chain proof.
 *
 *  - The weekly fee pool and the trader ranking count only trades whose
 *    settlementStatus is SETTLED (windowed by settledAt). PENDING / SETTLING /
 *    FAILED / SKIPPED trades never existed on-chain and must not mint rewards.
 *  - The leader ranking AUM only uses vaults with an on-chain contract and
 *    never falls back to the journal-inflatable `leader.totalAum`.
 */

type TradeRow = {
  makerAddress: string;
  takerAddress: string;
  quoteAmount: string;
  makerFee: string;
  takerFee: string;
  settlementStatus: string;
  settledAt: Date | null;
  createdAt: Date;
};

const tradeRows: TradeRow[] = [];

function matchesTradeWhere(row: TradeRow, where: any): boolean {
  if (
    where?.settlementStatus &&
    row.settlementStatus !== where.settlementStatus
  )
    return false;
  const range = where?.settledAt ?? where?.createdAt;
  const value = where?.settledAt ? row.settledAt : row.createdAt;
  if (range) {
    if (!value) return false;
    if (range.gte && value < range.gte) return false;
    if (range.lt && value >= range.lt) return false;
  }
  return true;
}

const mockPrisma = {
  trade: {
    aggregate: jest.fn(async ({ where }: any) => {
      const rows = tradeRows.filter((r) => matchesTradeWhere(r, where));
      return {
        _sum: {
          makerFee: rows.reduce((s, r) => s + Number(r.makerFee), 0),
          takerFee: rows.reduce((s, r) => s + Number(r.takerFee), 0),
        },
      };
    }),
    findMany: jest.fn(async ({ where }: any) =>
      tradeRows.filter((r) => matchesTradeWhere(r, where)),
    ),
  },
  leader: { findMany: jest.fn() },
  leaderFollow: { groupBy: jest.fn(async () => []) },
  copyVault: { findMany: jest.fn() },
  leaderAnalyticsSnapshot: { findMany: jest.fn(async () => []) },
};

jest.mock('../db', () => ({ __esModule: true, default: mockPrisma }));

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
  rewardPayoutService: { isEnabled: jest.fn(() => false) },
}));

import { rewardDistributionService } from '../services/rewardDistributionService';

const weekStart = new Date('2026-04-06T00:00:00Z');
const weekEnd = new Date('2026-04-13T00:00:00Z');
const inWeek = new Date('2026-04-08T00:00:00Z');

function trade(overrides: Partial<TradeRow>): TradeRow {
  return {
    makerAddress: 'maker',
    takerAddress: 'taker',
    quoteAmount: '100',
    makerFee: '0',
    takerFee: '0',
    settlementStatus: 'SETTLED',
    settledAt: inWeek,
    createdAt: inWeek,
    ...overrides,
  };
}

describe('BE-05: rewards count only SETTLED trades', () => {
  beforeEach(() => {
    tradeRows.length = 0;
    jest.clearAllMocks();
  });

  it('calculateWeeklyFees ignores FAILED / PENDING / SKIPPED trades', async () => {
    tradeRows.push(
      trade({ takerFee: '10' }),
      trade({ takerFee: '1000', settlementStatus: 'FAILED', settledAt: null }),
      trade({ takerFee: '500', settlementStatus: 'PENDING', settledAt: null }),
      trade({ makerFee: '700', settlementStatus: 'SKIPPED', settledAt: null }),
    );

    const fees = await rewardDistributionService.calculateWeeklyFees(
      weekStart,
      weekEnd,
    );

    expect(fees).toBe(10);
    expect(mockPrisma.trade.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          settlementStatus: 'SETTLED',
          settledAt: { gte: weekStart, lt: weekEnd },
        },
      }),
    );
  });

  it('rankTopTraders never credits volume from unsettled trades', async () => {
    // 'whale' has 3 counterparties but only via FAILED trades → must not rank.
    for (const cp of ['a', 'b', 'c']) {
      tradeRows.push(
        trade({
          takerAddress: 'whale',
          makerAddress: cp,
          quoteAmount: '1000000',
          settlementStatus: 'FAILED',
          settledAt: null,
        }),
      );
    }
    // 'honest' has 3 counterparties with SETTLED trades.
    for (const cp of ['a', 'b', 'c']) {
      tradeRows.push(
        trade({ takerAddress: 'honest', makerAddress: cp, quoteAmount: '10' }),
      );
    }

    const ranked = await rewardDistributionService.rankTopTraders(
      weekStart,
      weekEnd,
    );

    expect(ranked.map((r) => r.address)).toEqual(['honest']);
    expect(mockPrisma.trade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          settlementStatus: 'SETTLED',
          settledAt: { gte: weekStart, lt: weekEnd },
        },
      }),
    );
  });
});

describe('BE-01 (rewards side): leader AUM requires on-chain vaults', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.leader.findMany.mockResolvedValue([
      {
        id: 'journal-leader',
        name: 'J',
        username: 'j',
        address: 'addr-j',
        avatar: '',
        isAi: false,
        roi30d: '1',
        winRate: '0',
        // Inflated by unproven db-journal deposits.
        totalAum: '1000000000000',
        followersCount: 0,
        sharpe: '0',
        tags: [],
      },
      {
        id: 'onchain-leader',
        name: 'O',
        username: 'o',
        address: 'addr-o',
        avatar: '',
        isAi: false,
        roi30d: '1',
        winRate: '0',
        totalAum: '50',
        followersCount: 0,
        sharpe: '0',
        tags: [],
      },
    ]);
    // Simulates the DB honouring the where filter: only the vault with a
    // contract address is returned.
    mockPrisma.copyVault.findMany.mockImplementation(async ({ where }: any) => {
      const all = [
        {
          leaderId: 'journal-leader',
          totalEquity: '1000000000000',
          contractAddress: null,
        },
        {
          leaderId: 'onchain-leader',
          totalEquity: '50',
          contractAddress: '5Contract',
        },
      ];
      return all.filter(
        (v) => !where?.contractAddress || v.contractAddress !== null,
      );
    });
  });

  it('filters journal-only vaults and does not fall back to leader.totalAum', async () => {
    const ranked = await rewardDistributionService.buildLeaderRankingView();

    expect(mockPrisma.copyVault.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ contractAddress: { not: null } }),
      }),
    );
    const journal = ranked.find((l) => l.id === 'journal-leader');
    const onchain = ranked.find((l) => l.id === 'onchain-leader');
    expect(journal?.aum).toBe(0);
    expect(onchain?.aum).toBe(50);
    expect(ranked[0].id).toBe('onchain-leader');
  });
});
