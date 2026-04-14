import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import request from 'supertest';

jest.mock('../../services/rewardDistributionService', () => ({
  rewardDistributionService: {
    getRewardPool: jest.fn(),
    getPublicRankings: jest.fn(),
    getPendingRewards: jest.fn(),
    getRewardHistory: jest.fn(),
    getDistributedWeeks: jest.fn(),
    claimRewards: jest.fn(),
  },
}));

import rewardsRouter from '../../routes/rewards';
import { rewardDistributionService } from '../../services/rewardDistributionService';

const rewardDistributionServiceMock = rewardDistributionService as jest.Mocked<
  typeof rewardDistributionService
>;

function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use('/api/v1/rewards', rewardsRouter);

  return app;
}

const app = createApp();

describe('Rewards API E2E', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/v1/rewards/weeks', () => {
    it('should return distributed weeks with observability payload', async () => {
      rewardDistributionServiceMock.getDistributedWeeks.mockResolvedValueOnce([
        {
          id: 'week-1',
          weekStart: new Date('2026-04-06T00:00:00.000Z'),
          weekEnd: new Date('2026-04-13T00:00:00.000Z'),
          totalFeesCollected: 500,
          rewardPoolAmount: 100,
          leaderPoolAmount: 40,
          traderPoolAmount: 30,
          stakerPoolAmount: 30,
          status: 'DISTRIBUTED',
          distributedAt: new Date('2026-04-13T00:10:00.000Z'),
          createdAt: new Date('2026-04-06T00:00:00.000Z'),
          _count: { rewards: 3 },
          split: {
            rewardPoolPct: 20,
            leaderPoolPct: 40,
            traderPoolPct: 30,
            stakerPoolPct: 30,
            splitTotalPct: 100,
            splitValid: true,
          },
          observability: {
            dbBackedRewardEntries: 3,
            leader: { entries: 2 },
            trader: { entries: 1 },
            staker: { amount: 30, claimMode: 'on-chain' },
          },
        },
      ] as any);

      const res = await request(app)
        .get('/api/v1/rewards/weeks')
        .query({ limit: '5' });

      expect(res.status).toBe(200);
      expect(res.body.weeks).toMatchObject([
        {
          id: 'week-1',
          traderPoolAmount: 30,
          split: {
            splitValid: true,
          },
          observability: {
            dbBackedRewardEntries: 3,
            staker: {
              claimMode: 'on-chain',
            },
          },
        },
      ]);
      expect(
        rewardDistributionServiceMock.getDistributedWeeks,
      ).toHaveBeenCalledWith(5);
    });
  });

  describe('GET /api/v1/rewards/rankings', () => {
    it('should return 400 on invalid query', async () => {
      const res = await request(app)
        .get('/api/v1/rewards/rankings')
        .query({ limit: '0', segment: 'invalid' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'Validation failed');
      expect(
        rewardDistributionServiceMock.getPublicRankings,
      ).not.toHaveBeenCalled();
    });

    it('should return public reward-engine rankings', async () => {
      rewardDistributionServiceMock.getPublicRankings.mockResolvedValueOnce({
        window: {
          mode: 'current',
          weekStart: new Date('2026-04-13T00:00:00.000Z'),
          weekEnd: new Date('2026-04-20T00:00:00.000Z'),
        },
        leaders: [
          {
            id: 'leader-1',
            address: 'addr-1',
            name: 'Alpha',
            username: 'alpha',
            isAI: false,
            avatar: '',
            roi30d: 12.5,
            winRate: 61,
            sharpe: 2.4,
            followers: 8,
            aum: '1.2K',
            aumRaw: 1200,
            score: 0.92,
            tags: ['swing'],
            rank: 1,
          },
        ],
        traders: [
          {
            address: 'trader-1',
            volume: 25000,
            tradeCount: 12,
            rank: 1,
          },
        ],
      });

      const res = await request(app)
        .get('/api/v1/rewards/rankings')
        .query({ limit: '5', segment: 'traders', week: 'previous' });

      expect(res.status).toBe(200);
      expect(res.body.rankings).toMatchObject({
        window: {
          mode: 'current',
        },
        leaders: [
          {
            id: 'leader-1',
            address: 'addr-1',
            rank: 1,
          },
        ],
        traders: [
          {
            address: 'trader-1',
            rank: 1,
          },
        ],
      });
      expect(
        rewardDistributionServiceMock.getPublicRankings,
      ).toHaveBeenCalledWith({
        limit: 5,
        segment: 'traders',
        week: 'previous',
      });
    });
  });
});
