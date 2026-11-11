/**
 * M-09 (third pass) — an agent is one account whatever encoding it was
 * registered or is presented in. New rows are stored canonical; legacy rows
 * (prefix 57, hex, prefix 0) keep working, and a wallet ban reaches the
 * agent's API key even when the Agent row itself was never flagged.
 */
type StringFilter = string | { in: string[] } | undefined;
type AgentRow = {
  id: string;
  walletAddress: string;
  agentType: string;
  framework: string | null;
  strategyDescription: string | null;
  leaderId: string | null;
  isActive: boolean;
  isBanned: boolean;
  banReason: string | null;
  stakedAmount: string;
  totalTrades: number;
  totalVolume: string;
  lastActiveAt: Date | null;
  createdAt: Date;
  leader?: unknown;
};
type BanRow = { address: string; reason: string | null };
type KeyRow = {
  id: string;
  agentId: string;
  keyHash: string;
  revokedAt: Date | null;
  expiresAt: Date;
  permissions: string[];
};

const agents: AgentRow[] = [];
const bans: BanRow[] = [];
const keys: KeyRow[] = [];
const leaders: Array<{ id: string; address: string }> = [];

function matches(value: string, filter: StringFilter) {
  if (filter === undefined) return true;
  if (typeof filter === 'string') return value === filter;
  return filter.in.includes(value);
}

function agentRow(overrides: Partial<AgentRow>): AgentRow {
  return {
    id: `agent-${agents.length + 1}`,
    walletAddress: '',
    agentType: 'AI_AGENT',
    framework: null,
    strategyDescription: null,
    leaderId: null,
    isActive: true,
    isBanned: false,
    banReason: null,
    stakedAmount: '0',
    totalTrades: 0,
    totalVolume: '0',
    lastActiveAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    leader: null,
    ...overrides,
  };
}

type AgentWhere = {
  id?: string;
  walletAddress?: StringFilter;
  isBanned?: boolean;
};
function agentMatches(row: AgentRow, where: AgentWhere = {}) {
  return (
    (where.id === undefined || row.id === where.id) &&
    matches(row.walletAddress, where.walletAddress) &&
    (where.isBanned === undefined || row.isBanned === where.isBanned)
  );
}

const mockPrisma = {
  agent: {
    findUnique: jest.fn(
      async ({ where }: { where: { id?: string; walletAddress?: string } }) =>
        agents.find(
          (row) =>
            (where.id === undefined || row.id === where.id) &&
            (where.walletAddress === undefined ||
              row.walletAddress === where.walletAddress),
        ) ?? null,
    ),
    findFirst: jest.fn(
      async ({ where }: { where?: AgentWhere }) =>
        agents.find((row) => agentMatches(row, where)) ?? null,
    ),
    findMany: jest.fn(async (args?: { where?: AgentWhere }) =>
      agents.filter((row) => agentMatches(row, args?.where)),
    ),
    create: jest.fn(async ({ data }: { data: Partial<AgentRow> }) => {
      const row = agentRow(data);
      agents.push(row);
      return row;
    }),
  },
  leader: {
    findUnique: jest.fn(
      async ({ where }: { where: { id: string } }) =>
        leaders.find((row) => row.id === where.id) ?? null,
    ),
  },
  bannedWallet: {
    findFirst: jest.fn(
      async ({ where }: { where: { address?: StringFilter } }) =>
        bans.find((row) => matches(row.address, where.address)) ?? null,
    ),
    findMany: jest.fn(async () => bans.map((row) => ({ ...row }))),
  },
  agentApiKey: {
    findUnique: jest.fn(async ({ where }: { where: { keyHash: string } }) => {
      const key = keys.find((row) => row.keyHash === where.keyHash);
      if (!key) return null;
      return { ...key, agent: agents.find((row) => row.id === key.agentId) };
    }),
    count: jest.fn(async () => 0),
    create: jest.fn(async ({ data }: { data: Omit<KeyRow, 'id'> }) => ({
      ...data,
      id: 'key-new',
    })),
    update: jest.fn(async () => ({})),
  },
};

jest.mock('../../db', () => ({ __esModule: true, default: mockPrisma }));
jest.mock('../../utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { createHash } from 'crypto';
import { u8aToHex } from '@polkadot/util';
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';
import { agentService } from '../../services/agentService';

const GENERIC = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const PUBLIC_KEY = decodeAddress(GENERIC);
const LUNES = encodeAddress(PUBLIC_KEY, 57);
const PREFIX_0 = encodeAddress(PUBLIC_KEY, 0);
const HEX = u8aToHex(PUBLIC_KEY);
const HEX_UPPER = `0x${HEX.slice(2).toUpperCase()}`;
const OTHER = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';

const ENCODINGS: Array<[string, string]> = [
  ['prefix 57', LUNES],
  ['prefix 0', PREFIX_0],
  ['lower-case hex', HEX],
  ['upper-case hex', HEX_UPPER],
];

beforeEach(() => {
  agents.length = 0;
  bans.length = 0;
  keys.length = 0;
  leaders.length = 0;
  jest.clearAllMocks();
});

describe('registerAgent stores the canonical address', () => {
  it.each(ENCODINGS)(
    'registered as %s → stored as prefix 42',
    async (_l, raw) => {
      const agent = await agentService.registerAgent({
        walletAddress: raw,
        agentType: 'AI_AGENT',
      });
      expect(agent.walletAddress).toBe(GENERIC);
      expect(agents.map((row) => row.walletAddress)).toEqual([GENERIC]);
    },
  );

  it('refuses a second agent for a key already registered in prefix 57', async () => {
    agents.push(agentRow({ walletAddress: LUNES }));
    await expect(
      agentService.registerAgent({ walletAddress: HEX, agentType: 'AI_AGENT' }),
    ).rejects.toThrow('Agent already registered');
    expect(mockPrisma.agent.create).not.toHaveBeenCalled();
  });

  it.each([
    ['prefix 0', PREFIX_0, GENERIC],
    ['lower-case hex', HEX, LUNES],
    ['upper-case hex', HEX_UPPER, GENERIC],
  ])(
    'refuses a second agent when the legacy row is stored as %s',
    async (_label, stored, presented) => {
      agents.push(agentRow({ walletAddress: stored }));
      await expect(
        agentService.registerAgent({
          walletAddress: presented,
          agentType: 'AI_AGENT',
        }),
      ).rejects.toThrow('Agent already registered');
      expect(mockPrisma.agent.create).not.toHaveBeenCalled();
    },
  );

  it('a legacy row of another account does not block registration', async () => {
    agents.push(agentRow({ walletAddress: u8aToHex(decodeAddress(OTHER)) }));
    await expect(
      agentService.registerAgent({
        walletAddress: GENERIC,
        agentType: 'AI_AGENT',
      }),
    ).resolves.toMatchObject({ walletAddress: GENERIC });
  });

  it('links a leader whose address is stored in another encoding', async () => {
    leaders.push({ id: 'leader-own', address: LUNES });
    await agentService.registerAgent({
      walletAddress: HEX,
      agentType: 'AI_AGENT',
      linkLeaderId: 'leader-own',
    });
    expect(agents[0]).toMatchObject({
      walletAddress: GENERIC,
      leaderId: 'leader-own',
    });
  });

  it("still refuses another account's leader", async () => {
    leaders.push({ id: 'leader-victim', address: OTHER });
    await expect(
      agentService.registerAgent({
        walletAddress: HEX,
        agentType: 'AI_AGENT',
        linkLeaderId: 'leader-victim',
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('getAgentByWallet finds the agent in any encoding', () => {
  it.each([['prefix 42', GENERIC], ...ENCODINGS])(
    'canonical row looked up as %s',
    async (_label, lookup) => {
      agents.push(agentRow({ id: 'agent-c', walletAddress: GENERIC }));
      const agent = await agentService.getAgentByWallet(lookup);
      expect(agent?.id).toBe('agent-c');
    },
  );

  it('a legacy prefix-57 row is found from the canonical form', async () => {
    agents.push(agentRow({ id: 'agent-l', walletAddress: LUNES }));
    expect((await agentService.getAgentByWallet(GENERIC))?.id).toBe('agent-l');
  });

  it('another account is not found', async () => {
    agents.push(agentRow({ walletAddress: GENERIC }));
    expect(await agentService.getAgentByWallet(OTHER)).toBeNull();
  });
});

describe('a wallet ban reaches API keys of an unflagged agent', () => {
  function addKey(agentId: string) {
    const raw = `lnx_${agentId}`;
    keys.push({
      id: `key-${agentId}`,
      agentId,
      keyHash: createHash('sha256').update(raw).digest('hex'),
      revokedAt: null,
      expiresAt: new Date(Date.now() + 86_400_000),
      permissions: ['TRADE_SPOT'],
    });
    return raw;
  }

  it.each([['prefix 42', GENERIC], ...ENCODINGS])(
    'verifyApiKey rejects an agent stored as %s when the wallet is banned',
    async (_label, stored) => {
      agents.push(agentRow({ id: 'agent-b', walletAddress: stored }));
      const raw = addKey('agent-b');
      expect(await agentService.verifyApiKey(raw)).not.toBeNull();

      bans.push({ address: GENERIC, reason: 'market abuse' });
      expect(await agentService.verifyApiKey(raw)).toBeNull();
    },
  );

  it.each(ENCODINGS)(
    'verifyApiKey rejects when the BannedWallet row is a legacy %s string',
    async (_label, bannedAs) => {
      agents.push(agentRow({ id: 'agent-b', walletAddress: GENERIC }));
      const raw = addKey('agent-b');
      bans.push({ address: bannedAs, reason: 'legacy' });
      expect(await agentService.verifyApiKey(raw)).toBeNull();
    },
  );

  it.each([['prefix 42', GENERIC], ...ENCODINGS])(
    'createApiKey refuses an agent stored as %s when the wallet is banned',
    async (_label, stored) => {
      agents.push(agentRow({ id: 'agent-b', walletAddress: stored }));
      bans.push({ address: GENERIC, reason: 'market abuse' });
      await expect(
        agentService.createApiKey('agent-b', { permissions: ['READ_ONLY'] }),
      ).rejects.toThrow('Wallet is banned');
      expect(mockPrisma.agentApiKey.create).not.toHaveBeenCalled();
    },
  );

  it('an unrelated ban does not affect the agent', async () => {
    agents.push(agentRow({ id: 'agent-b', walletAddress: HEX }));
    const raw = addKey('agent-b');
    bans.push({ address: OTHER, reason: 'other' });
    expect(await agentService.verifyApiKey(raw)).not.toBeNull();
  });
});
