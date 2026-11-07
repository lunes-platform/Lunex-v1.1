// BE-11: public strategy endpoints respect isPublic and never list follower
// wallets (aggregate only); the owner agent can still read its own private
// strategy.

jest.mock('../db', () => ({
  __esModule: true,
  default: {
    strategy: {
      findUnique: jest.fn(),
    },
    strategyFollow: {
      findMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
  },
}));

import prisma from '../db';
import { strategyService } from '../services/strategyService';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPrisma = prisma as any;

beforeEach(() => jest.clearAllMocks());

describe('strategyService.getStrategy (BE-11)', () => {
  it('hides a private strategy from public readers (404)', async () => {
    mockPrisma.strategy.findUnique.mockResolvedValue({
      id: 's-1',
      agentId: 'agent-owner',
      isPublic: false,
    });

    await expect(strategyService.getStrategy('s-1')).rejects.toThrow(
      'Strategy not found',
    );
    await expect(
      strategyService.getStrategy('s-1', { viewerAgentId: 'agent-other' }),
    ).rejects.toThrow('Strategy not found');
  });

  it('lets the owner agent read its own private strategy', async () => {
    mockPrisma.strategy.findUnique.mockResolvedValue({
      id: 's-1',
      agentId: 'agent-owner',
      isPublic: false,
    });

    const strategy = await strategyService.getStrategy('s-1', {
      viewerAgentId: 'agent-owner',
    });
    expect(strategy.id).toBe('s-1');
  });

  it('serves public strategies to anyone', async () => {
    mockPrisma.strategy.findUnique.mockResolvedValue({
      id: 's-2',
      agentId: 'agent-owner',
      isPublic: true,
    });

    expect((await strategyService.getStrategy('s-2')).id).toBe('s-2');
  });
});

describe('strategyService.getFollowers (BE-11)', () => {
  it('returns aggregates only — no follower addresses', async () => {
    mockPrisma.strategy.findUnique.mockResolvedValue({
      id: 's-2',
      isPublic: true,
    });
    mockPrisma.strategyFollow.count.mockResolvedValue(4);
    mockPrisma.strategyFollow.aggregate.mockResolvedValue({
      _sum: { allocatedCapital: { toString: () => '1250.5' } },
    });

    const result = await strategyService.getFollowers('s-2');

    expect(result).toEqual({ total: 4, totalAllocatedCapital: 1250.5 });
    expect(JSON.stringify(result)).not.toMatch(/followerAddress/);
    expect(mockPrisma.strategyFollow.findMany).not.toHaveBeenCalled();
  });

  it('404s for a private strategy', async () => {
    mockPrisma.strategy.findUnique.mockResolvedValue({
      id: 's-1',
      isPublic: false,
    });

    await expect(strategyService.getFollowers('s-1')).rejects.toThrow(
      'Strategy not found',
    );
  });
});
