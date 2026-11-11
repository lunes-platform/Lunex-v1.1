// BE-03: an agent can only be linked to a leader owned by the same wallet.
// BE-11: public agent views do not expose the owner wallet (unless it is the
//        linked leader's public address).
// BE-13: wallet-owner revoke-all / rotate, revoked keys never authenticate,
//        agent keys cannot revoke broader keys nor mint longer-lived keys.

jest.mock('../db', () => ({
  __esModule: true,
  default: {
    agent: {
      findUnique: jest.fn(),
      // M-09: duplicate check and wallet-ban lookup (no rows → undefined).
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
    },
    leader: {
      findUnique: jest.fn(),
    },
    // M-09: createApiKey/verifyApiKey also run walletRiskService.
    bannedWallet: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    agentApiKey: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

import prisma from '../db';
import { agentService } from '../services/agentService';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPrisma = prisma as any;

const OWNER = '5Fowner-wallet';
const VICTIM = '5Fvictim-wallet';

function agentRow(overrides?: Record<string, unknown>) {
  return {
    id: 'agent-1',
    walletAddress: OWNER,
    agentType: 'AI_AGENT',
    framework: null,
    strategyDescription: null,
    isActive: true,
    isBanned: false,
    stakedAmount: '0',
    totalTrades: 0,
    totalVolume: '0',
    lastActiveAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    leader: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.agent.findUnique.mockResolvedValue(null);
});

describe('agentService.registerAgent (BE-03)', () => {
  it("rejects linking to another wallet's leader and creates nothing", async () => {
    mockPrisma.leader.findUnique.mockResolvedValue({
      id: 'leader-victim',
      address: VICTIM,
    });

    await expect(
      agentService.registerAgent({
        walletAddress: OWNER,
        agentType: 'AI_AGENT',
        linkLeaderId: 'leader-victim',
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockPrisma.agent.create).not.toHaveBeenCalled();
  });

  it('rejects an unknown leader id', async () => {
    mockPrisma.leader.findUnique.mockResolvedValue(null);

    await expect(
      agentService.registerAgent({
        walletAddress: OWNER,
        agentType: 'AI_AGENT',
        linkLeaderId: 'missing',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mockPrisma.agent.create).not.toHaveBeenCalled();
  });

  it('links the agent when the wallet owns the leader', async () => {
    mockPrisma.leader.findUnique.mockResolvedValue({
      id: 'leader-own',
      address: OWNER,
    });
    mockPrisma.agent.create.mockResolvedValue(
      agentRow({ leaderId: 'leader-own' }),
    );

    await agentService.registerAgent({
      walletAddress: OWNER,
      agentType: 'AI_AGENT',
      linkLeaderId: 'leader-own',
    });

    expect(mockPrisma.agent.create.mock.calls[0][0].data.leaderId).toBe(
      'leader-own',
    );
  });
});

describe('agentService public views (BE-11)', () => {
  it('listAgents hides the wallet of agents without a linked leader', async () => {
    mockPrisma.agent.findMany.mockResolvedValue([
      agentRow(),
      agentRow({
        id: 'agent-2',
        walletAddress: VICTIM,
        leader: {
          id: 'leader-v',
          name: 'V',
          username: 'v',
          avatar: '',
          address: VICTIM,
          roi30d: '0',
          followersCount: 0,
        },
      }),
    ]);
    mockPrisma.agent.count.mockResolvedValue(2);

    const { agents } = await agentService.listAgents({});

    expect(agents[0]).not.toHaveProperty('walletAddress');
    // Linked leader's address is public by design (leader profile).
    expect((agents[1] as { walletAddress?: string }).walletAddress).toBe(
      VICTIM,
    );
  });

  it('getPublicAgentProfile hides the wallet; getAgentProfile (owner) keeps it', async () => {
    mockPrisma.agent.findUnique.mockResolvedValue(agentRow());

    const pub = await agentService.getPublicAgentProfile('agent-1');
    const own = await agentService.getAgentProfile('agent-1');

    expect(pub).not.toHaveProperty('walletAddress');
    expect(own.walletAddress).toBe(OWNER);
  });
});

describe('agentService API key lifecycle (BE-13)', () => {
  it('revokeAllApiKeys revokes every active key of the agent', async () => {
    mockPrisma.agentApiKey.updateMany.mockResolvedValue({ count: 3 });

    const result = await agentService.revokeAllApiKeys('agent-1');

    expect(result).toEqual({ revoked: 3 });
    const args = mockPrisma.agentApiKey.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ agentId: 'agent-1', revokedAt: null });
    expect(args.data.revokedAt).toBeInstanceOf(Date);
  });

  it('verifyApiKey rejects a revoked key (agentAuth fails closed)', async () => {
    mockPrisma.agentApiKey.findUnique.mockResolvedValue({
      id: 'key-1',
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
      permissions: ['TRADE_SPOT'],
      agent: { isActive: true, isBanned: false },
    });

    expect(await agentService.verifyApiKey('lnx_leaked')).toBeNull();
    expect(mockPrisma.agentApiKey.update).not.toHaveBeenCalled();
  });

  it('rotateApiKey revokes all keys before issuing the new one', async () => {
    mockPrisma.agentApiKey.updateMany.mockResolvedValue({ count: 2 });
    mockPrisma.agent.findUnique.mockResolvedValue(agentRow());
    mockPrisma.agentApiKey.count.mockResolvedValue(0);
    mockPrisma.agentApiKey.create.mockImplementation(async ({ data }: any) => ({
      id: 'key-new',
      ...data,
    }));

    const result = await agentService.rotateApiKey('agent-1', {
      permissions: ['READ_ONLY'],
    });

    expect(result.revoked).toBe(2);
    expect(result.key.key).toMatch(/^lnx_/);
    const revokeOrder =
      mockPrisma.agentApiKey.updateMany.mock.invocationCallOrder[0];
    const createOrder =
      mockPrisma.agentApiKey.create.mock.invocationCallOrder[0];
    expect(revokeOrder).toBeLessThan(createOrder);
  });

  it('an agent key cannot revoke a key with broader permissions', async () => {
    mockPrisma.agentApiKey.findFirst.mockResolvedValue({
      id: 'key-trade',
      permissions: ['TRADE_SPOT', 'READ_ONLY'],
    });

    await expect(
      agentService.revokeApiKey('agent-1', 'key-trade', {
        actorKeyId: 'key-read',
        actorPermissions: ['READ_ONLY'],
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockPrisma.agentApiKey.update).not.toHaveBeenCalled();
  });

  it('an agent key can revoke itself', async () => {
    mockPrisma.agentApiKey.findFirst.mockResolvedValue({
      id: 'key-read',
      permissions: ['READ_ONLY'],
    });

    await agentService.revokeApiKey('agent-1', 'key-read', {
      actorKeyId: 'key-read',
      actorPermissions: ['READ_ONLY'],
    });
    expect(mockPrisma.agentApiKey.update).toHaveBeenCalled();
  });

  it('a key minted by another key never outlives its parent', async () => {
    const parentExpiry = new Date(Date.now() + 2 * 86_400_000);
    mockPrisma.agent.findUnique.mockResolvedValue(agentRow());
    mockPrisma.agentApiKey.count.mockResolvedValue(1);
    mockPrisma.agentApiKey.create.mockImplementation(async ({ data }: any) => ({
      id: 'key-child',
      ...data,
    }));

    const child = await agentService.createApiKey(
      'agent-1',
      { permissions: ['READ_ONLY'], expiresInDays: 365 },
      { maxExpiresAt: parentExpiry },
    );

    expect(new Date(child.expiresAt).getTime()).toBe(parentExpiry.getTime());
  });
});
