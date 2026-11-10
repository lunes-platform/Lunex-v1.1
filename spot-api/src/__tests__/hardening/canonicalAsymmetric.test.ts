/**
 * M-09 (third pass) — asymmetric strategy ownership is per account, not per
 * string. Agents are now registered canonical (prefix 42) while the signed
 * wallet routes store `userAddress` as the client sent it (57, hex, 0...), so
 * the ownership checks and the listing must match any encoding of the same
 * account.
 */
import { u8aToHex } from '@polkadot/util';
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';

type StringFilter = string | { in: string[] } | undefined;
type StrategyRow = ReturnType<typeof strategyRow>;

const strategies: StrategyRow[] = [];

function matches(value: string, filter: StringFilter) {
  if (filter === undefined) return true;
  if (typeof filter === 'string') return value === filter;
  return filter.in.includes(value);
}

const mockPrisma = {
  asymmetricStrategy: {
    findUnique: jest.fn(
      async ({ where }: { where: { id: string } }) =>
        strategies.find((row) => row.id === where.id) ?? null,
    ),
    findFirst: jest.fn(
      async ({
        where,
      }: {
        where: {
          userAddress: StringFilter;
          pairAddress: string;
          status: { not: string };
        };
      }) =>
        strategies.find(
          (row) =>
            matches(row.userAddress, where.userAddress) &&
            row.pairAddress === where.pairAddress &&
            row.status !== where.status.not,
        ) ?? null,
    ),
    findMany: jest.fn(
      async ({
        where,
      }: {
        where: {
          userAddress?: StringFilter;
          pairAddress?: string;
          status?: { not: string };
        };
      }) =>
        strategies.filter(
          (row) =>
            matches(row.userAddress, where.userAddress) &&
            (where.pairAddress === undefined ||
              row.pairAddress === where.pairAddress) &&
            (where.status === undefined || row.status !== where.status.not),
        ),
    ),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = strategyRow({
        id: `strategy-${strategies.length + 1}`,
        userAddress: data.userAddress as string,
        pairAddress: data.pairAddress as string,
        agentId: (data.agentId as string | null) ?? null,
      });
      strategies.push(row);
      return row;
    }),
    update: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const row = strategies.find((item) => item.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return row;
      },
    ),
  },
  asymmetricRebalanceLog: {
    create: jest.fn(async () => ({})),
    findMany: jest.fn(async () => []),
  },
};

jest.mock('../../db', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { asymmetricService } from '../../services/asymmetricService';

// Alice in every encoding the API accepts.
const GENERIC = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const PUBLIC_KEY = decodeAddress(GENERIC);
const LUNES = encodeAddress(PUBLIC_KEY, 57);
const POLKADOT = encodeAddress(PUBLIC_KEY, 0);
const HEX_LOWER = u8aToHex(PUBLIC_KEY);
const HEX_UPPER = `0x${HEX_LOWER.slice(2).toUpperCase()}`;
const OTHER = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';
const PAIR = '5Fpair';

const NON_CANONICAL: Array<[string, string]> = [
  ['prefix 57', LUNES],
  ['prefix 0', POLKADOT],
  ['lower-case hex', HEX_LOWER],
  ['upper-case hex', HEX_UPPER],
];

function decimalLike(value: string | number) {
  return { toString: () => String(value) };
}

function strategyRow(overrides: {
  id: string;
  userAddress: string;
  pairAddress?: string;
  agentId?: string | null;
}) {
  return {
    pairAddress: PAIR,
    agentId: null as string | null,
    status: 'ACTIVE',
    isAutoRebalance: true,
    pendingAmount: decimalLike('0'),
    lastRebalancedAt: null,
    buyK: decimalLike('1000'),
    buyGamma: 3,
    buyMaxCapacity: decimalLike('10000'),
    buyFeeTargetBps: 30,
    sellGamma: 2,
    sellMaxCapacity: decimalLike('8000'),
    sellFeeTargetBps: 35,
    sellProfitTargetBps: 500,
    leverageL: decimalLike('0'),
    allocationC: decimalLike('0.5'),
    retryCount: 0,
    lastError: null,
    createdAt: new Date('2026-04-14T10:00:00Z'),
    updatedAt: new Date('2026-04-14T10:00:00Z'),
    ...overrides,
  };
}

function seed(userAddress: string, agentId: string | null = null) {
  const row = strategyRow({ id: 'strategy-1', userAddress, agentId });
  strategies.push(row);
  return row;
}

beforeEach(() => {
  strategies.length = 0;
  jest.clearAllMocks();
});

describe('agent registered canonical, strategy stored as the wallet sent it', () => {
  it.each(NON_CANONICAL)(
    'link-strategy accepts a %s strategy of the same account',
    async (_label, stored) => {
      seed(stored);
      const linked = await asymmetricService.linkStrategyToAgent(
        'strategy-1',
        'agent-1',
        GENERIC,
        PAIR,
      );
      expect(linked.agentId).toBe('agent-1');
    },
  );

  it.each(NON_CANONICAL)(
    'update-curve / strategy-status accept a %s strategy',
    async (_label, stored) => {
      seed(stored, 'agent-1');
      await expect(
        asymmetricService.getStrategyForAgent('strategy-1', 'agent-1', GENERIC),
      ).resolves.toMatchObject({ id: 'strategy-1' });
    },
  );

  it('another account is still Unauthorized', async () => {
    seed(LUNES, 'agent-1');
    await expect(
      asymmetricService.linkStrategyToAgent('strategy-1', 'agent-1', OTHER),
    ).rejects.toThrow('Unauthorized');
    await expect(
      asymmetricService.getStrategyForAgent('strategy-1', 'agent-1', OTHER),
    ).rejects.toThrow('Unauthorized');
  });
});

describe('strategy created by the agent (canonical), wallet presents another encoding', () => {
  it.each(NON_CANONICAL)(
    'the wallet in %s owns it (toggle / update / list)',
    async (_label, presented) => {
      seed(GENERIC, 'agent-1');
      await expect(
        asymmetricService.getStrategyForUser('strategy-1', presented),
      ).resolves.toMatchObject({ id: 'strategy-1' });
      await expect(
        asymmetricService.toggleAutoRebalance('strategy-1', presented, false),
      ).resolves.toMatchObject({ isAutoRebalance: false });
      const listed = await asymmetricService.listUserStrategies(presented);
      expect(listed.map((item) => item.id)).toEqual(['strategy-1']);
    },
  );

  it('another account is still Unauthorized and lists nothing', async () => {
    seed(GENERIC, 'agent-1');
    await expect(
      asymmetricService.getStrategyForUser('strategy-1', OTHER),
    ).rejects.toThrow('Unauthorized');
    expect(await asymmetricService.listUserStrategies(OTHER)).toEqual([]);
  });

  it('an undecodable legacy address still matches only itself', async () => {
    seed('5Fuser');
    await expect(
      asymmetricService.getStrategyForUser('strategy-1', '5Fuser'),
    ).resolves.toMatchObject({ id: 'strategy-1' });
    await expect(
      asymmetricService.getStrategyForUser('strategy-1', '5Fother'),
    ).rejects.toThrow('Unauthorized');
  });
});

describe('createStrategy duplicate check is per account', () => {
  it.each(NON_CANONICAL)(
    'an active %s strategy blocks a canonical one for the same pair',
    async (_label, stored) => {
      seed(stored);
      await expect(
        asymmetricService.createStrategy({
          userAddress: GENERIC,
          pairAddress: PAIR,
          buyK: '1000',
          buyGamma: 3,
          buyMaxCapacity: '10000',
          sellGamma: 2,
          sellMaxCapacity: '8000',
        }),
      ).rejects.toThrow('Active strategy already exists for this pair');
    },
  );
});
