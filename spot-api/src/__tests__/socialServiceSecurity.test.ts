// BE-04: following a leader never rewrites the leader's vault risk config.
// BE-15: a leader cannot raise the performance fee while followers hold vault
//        positions (no retroactive fee increase); decreases are allowed.

jest.mock('../db', () => ({
  __esModule: true,
  default: {
    $transaction: jest.fn(),
    leader: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    copyVault: {
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    copyVaultPosition: {
      count: jest.fn(),
    },
  },
}));

jest.mock('../utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import prisma from '../db';
import { socialService } from '../services/socialService';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

const profileInput = {
  address: '5Fleader',
  name: 'Leader',
  username: 'leader',
  bio: 'bio',
  fee: 50,
  nonce: 'nonce-123456',
  timestamp: Date.now(),
  signature: 'signed',
};

function upsertedLeader(feeBps: number) {
  return {
    id: 'leader-1',
    name: 'Leader',
    username: 'leader',
    address: '5Fleader',
    avatar: '',
    isAi: false,
    isVerified: false,
    bio: 'bio',
    memberSince: new Date(),
    performanceFeeBps: feeBps,
    followersCount: 0,
    vault: { id: 'vault-1', name: 'Leader Vault', contractAddress: null },
    trades: [],
    ideas: [],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('socialService.followLeader (BE-04)', () => {
  it('ignores follower-provided risk params instead of writing them to the vault', async () => {
    (mockPrisma.leader.findUnique as jest.Mock).mockResolvedValue({
      id: 'leader-1',
    });
    const tx = {
      copyVault: { updateMany: jest.fn() },
      leaderFollow: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      leader: { update: jest.fn().mockResolvedValue({}) },
    };
    (mockPrisma.$transaction as jest.Mock).mockImplementation(
      async (cb: (client: unknown) => unknown) => cb(tx),
    );

    const result = await socialService.followLeader('leader-1', '5Ffollower', {
      copyMultiplier: 10,
      maxPerTradeUsdt: 0,
      stopLossPct: 1,
    });

    expect(result).toEqual({ followed: true, alreadyFollowing: false });
    expect(tx.copyVault.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.copyVault.updateMany).not.toHaveBeenCalled();
  });
});

describe('socialService.upsertLeaderProfile (BE-15)', () => {
  it('rejects a fee increase while followers hold open vault positions', async () => {
    (mockPrisma.leader.findUnique as jest.Mock).mockResolvedValue({
      performanceFeeBps: 1000,
      vault: { id: 'vault-1' },
    });
    (mockPrisma.copyVaultPosition.count as jest.Mock).mockResolvedValue(3);

    await expect(
      socialService.upsertLeaderProfile(profileInput),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mockPrisma.leader.upsert).not.toHaveBeenCalled();
  });

  it('allows a fee decrease even with open positions', async () => {
    (mockPrisma.leader.findUnique as jest.Mock).mockResolvedValue({
      performanceFeeBps: 1000,
      vault: { id: 'vault-1' },
    });
    (mockPrisma.copyVaultPosition.count as jest.Mock).mockResolvedValue(3);
    (mockPrisma.leader.upsert as jest.Mock).mockResolvedValue(
      upsertedLeader(500),
    );

    const result = await socialService.upsertLeaderProfile({
      ...profileInput,
      fee: 5,
    });

    expect(mockPrisma.leader.upsert).toHaveBeenCalled();
    expect(result.fee).toBe(5);
  });

  it('allows a fee increase when no follower holds a position', async () => {
    (mockPrisma.leader.findUnique as jest.Mock).mockResolvedValue({
      performanceFeeBps: 1000,
      vault: { id: 'vault-1' },
    });
    (mockPrisma.copyVaultPosition.count as jest.Mock).mockResolvedValue(0);
    (mockPrisma.leader.upsert as jest.Mock).mockResolvedValue(
      upsertedLeader(5000),
    );

    await socialService.upsertLeaderProfile(profileInput);

    expect(mockPrisma.copyVaultPosition.count).toHaveBeenCalledWith({
      where: { vaultId: 'vault-1', shareBalance: { gt: 0 } },
    });
    expect(mockPrisma.leader.upsert).toHaveBeenCalled();
  });

  it('exposes the vault contractAddress (null until deployed) on the profile', async () => {
    (mockPrisma.leader.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.leader.upsert as jest.Mock).mockResolvedValue(
      upsertedLeader(5000),
    );

    const result = await socialService.upsertLeaderProfile(profileInput);

    expect(result.vault).toMatchObject({ contractAddress: null });
  });
});
