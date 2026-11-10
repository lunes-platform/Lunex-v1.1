/**
 * M-09 (second pass) — bans are keyed by account, not by the SS58 string the
 * admin happened to paste. The explorer shows prefix 57; requests arrive in
 * the canonical prefix 42. Rows written before the fix must keep blocking.
 */
type BanRow = { address: string; reason: string; bannedBy: string };
type AgentRow = {
  id?: string;
  walletAddress: string;
  isBanned: boolean;
  banReason: string | null;
};
type StringFilter = string | { in: string[] } | undefined;

const bans: BanRow[] = [];
const agents: AgentRow[] = [];

function matches(value: string | undefined, filter: StringFilter) {
  if (filter === undefined) return true;
  if (value === undefined) return false;
  if (typeof filter === 'string') return value === filter;
  return filter.in.includes(value);
}

// Rows pushed without an id get a stable one (updates go by id).
function withId(row: AgentRow, index: number) {
  if (!row.id) row.id = `agent-${index}`;
  return row;
}

const mockPrisma = {
  $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  bannedWallet: {
    findUnique: jest.fn(
      async ({ where }: { where: { address: string } }) =>
        bans.find((row) => row.address === where.address) ?? null,
    ),
    findFirst: jest.fn(
      async ({ where }: { where: { address?: StringFilter } }) =>
        bans.find((row) => matches(row.address, where.address)) ?? null,
    ),
    findMany: jest.fn(async (args?: { where?: { address?: StringFilter } }) =>
      bans
        .filter((row) => matches(row.address, args?.where?.address))
        .map((row) => ({ ...row })),
    ),
    upsert: jest.fn(
      async ({
        where,
        create,
        update,
      }: {
        where: { address: string };
        create: BanRow;
        update: Partial<BanRow>;
      }) => {
        const existing = bans.find((row) => row.address === where.address);
        if (existing) return Object.assign(existing, update);
        bans.push({ ...create });
        return create;
      },
    ),
    deleteMany: jest.fn(
      async ({ where }: { where: { address?: StringFilter } }) => {
        let count = 0;
        for (let i = bans.length - 1; i >= 0; i--) {
          if (matches(bans[i].address, where.address)) {
            bans.splice(i, 1);
            count++;
          }
        }
        return { count };
      },
    ),
  },
  agent: {
    findUnique: jest.fn(
      async ({ where }: { where: { walletAddress: string } }) =>
        agents.find((row) => row.walletAddress === where.walletAddress) ?? null,
    ),
    findFirst: jest.fn(
      async ({
        where,
      }: {
        where: { walletAddress?: StringFilter; isBanned?: boolean };
      }) =>
        agents.find(
          (row) =>
            matches(row.walletAddress, where.walletAddress) &&
            (where.isBanned === undefined || row.isBanned === where.isBanned),
        ) ?? null,
    ),
    findMany: jest.fn(
      async (args?: {
        where?: { walletAddress?: StringFilter; isBanned?: boolean };
      }) =>
        agents
          .map(withId)
          .filter(
            (row) =>
              matches(row.walletAddress, args?.where?.walletAddress) &&
              (args?.where?.isBanned === undefined ||
                row.isBanned === args.where.isBanned),
          )
          .map((row) => ({ ...row })),
    ),
    updateMany: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { walletAddress?: StringFilter; id?: StringFilter };
        data: Partial<AgentRow>;
      }) => {
        const hit = agents
          .map(withId)
          .filter(
            (row) =>
              matches(row.walletAddress, where.walletAddress) &&
              matches(row.id, where.id),
          );
        hit.forEach((row) => Object.assign(row, data));
        return { count: hit.length };
      },
    ),
  },
};

jest.mock('../../db', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../config', () => ({
  config: { adminSecret: 'test-admin-secret-local-only-000000000001' },
}));

import express from 'express';
import request from 'supertest';
import { u8aToHex } from '@polkadot/util';
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';
import adminRouter from '../../routes/admin';
import { walletRiskService } from '../../services/walletRiskService';

// Same key (Alice) in the canonical prefix 42 and the Lunes prefix 57.
const GENERIC = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const LUNES = '6mfqoTMHrMeVMyKwjqomUjVomPMJ4AjdCm1VReFtk7Be8wqr';
const OTHER = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';
const ADMIN = 'Bearer test-admin-secret-local-only-000000000001';

const app = express();
app.use(express.json());
app.use('/api/v1/admin', adminRouter);

beforeEach(() => {
  bans.length = 0;
  agents.length = 0;
  jest.clearAllMocks();
});

describe('ban entered in one prefix blocks every prefix', () => {
  it.each([
    ['57', LUNES, GENERIC],
    ['42', GENERIC, LUNES],
  ])('ban in %s blocks the same key', async (_label, bannedAs, actingAs) => {
    await walletRiskService.banWallet(bannedAs, 'market abuse', 'admin-1');
    await expect(
      walletRiskService.assertWalletCanAct(actingAs),
    ).rejects.toThrow('Wallet is banned: market abuse');
    await expect(
      walletRiskService.assertWalletCanAct(OTHER),
    ).resolves.toBeUndefined();
  });

  it('stores the ban under the canonical address', async () => {
    const res = await request(app)
      .post(`/api/v1/admin/wallets/${LUNES}/ban`)
      .set('Authorization', ADMIN)
      .send({ reason: 'market abuse', bannedBy: 'admin-1' });
    expect(res.status).toBe(200);
    expect(res.body.wallet.address).toBe(GENERIC);
    expect(bans.map((row) => row.address)).toEqual([GENERIC]);
  });

  it('flags agents registered under any encoding of the key', async () => {
    agents.push({ walletAddress: LUNES, isBanned: false, banReason: null });
    await walletRiskService.banWallet(GENERIC, 'sybil', 'admin-1');
    expect(agents[0]).toMatchObject({ isBanned: true, banReason: 'sybil' });
  });
});

describe('legacy rows written before canonicalization', () => {
  it('a BannedWallet row stored in prefix 57 still blocks the 42 form', async () => {
    bans.push({ address: LUNES, reason: 'legacy', bannedBy: 'admin-0' });
    await expect(walletRiskService.assertWalletCanAct(GENERIC)).rejects.toThrow(
      'Wallet is banned: legacy',
    );
  });

  it('a banned Agent row stored in prefix 57 still blocks the 42 form', async () => {
    agents.push({ walletAddress: LUNES, isBanned: true, banReason: 'bot' });
    await expect(walletRiskService.assertWalletCanAct(GENERIC)).rejects.toThrow(
      'Wallet is banned: bot',
    );
  });

  it('an undecodable input is looked up as a raw string, without throwing', async () => {
    bans.push({ address: 'legacy-raw', reason: 'raw', bannedBy: 'admin-0' });
    await expect(
      walletRiskService.assertWalletCanAct('legacy-raw'),
    ).rejects.toThrow('Wallet is banned: raw');
    await expect(
      walletRiskService.assertWalletCanAct('wallet-1'),
    ).resolves.toBeUndefined();
  });
});

describe('unban removes the ban however it was stored', () => {
  it.each([
    ['42', GENERIC],
    ['57', LUNES],
  ])('unban entered in %s', async (_label, unbanAs) => {
    bans.push({ address: LUNES, reason: 'legacy', bannedBy: 'admin-0' });
    bans.push({ address: GENERIC, reason: 'new', bannedBy: 'admin-1' });
    agents.push({ walletAddress: LUNES, isBanned: true, banReason: 'legacy' });
    bans.push({ address: OTHER, reason: 'keep', bannedBy: 'admin-1' });

    const res = await request(app)
      .delete(`/api/v1/admin/wallets/${unbanAs}/ban`)
      .set('Authorization', ADMIN);
    expect(res.status).toBe(200);

    expect(bans.map((row) => row.address)).toEqual([OTHER]);
    expect(agents[0]).toMatchObject({ isBanned: false, banReason: null });
    await expect(
      walletRiskService.assertWalletCanAct(GENERIC),
    ).resolves.toBeUndefined();
  });
});

describe('undecodable admin input', () => {
  it('ban with an undecodable address is 400 and writes nothing', async () => {
    const res = await request(app)
      .post('/api/v1/admin/wallets/not-an-address/ban')
      .set('Authorization', ADMIN)
      .send({ reason: 'market abuse', bannedBy: 'admin-1' });
    expect(res.status).toBe(400);
    expect(mockPrisma.bannedWallet.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.agent.updateMany).not.toHaveBeenCalled();
    expect(bans).toEqual([]);
  });

  it('unban with an undecodable address is 400', async () => {
    const res = await request(app)
      .delete('/api/v1/admin/wallets/not-an-address/ban')
      .set('Authorization', ADMIN);
    expect(res.status).toBe(400);
    expect(mockPrisma.bannedWallet.deleteMany).not.toHaveBeenCalled();
  });
});

// ─── M-09 third pass: hex and other prefixes, not only 42 <-> 57 ─────
// Alice's key as lower/upper-case hex and Polkadot prefix 0.
const ALICE_HEX = u8aToHex(decodeAddress(GENERIC));
const ALICE_HEX_UPPER = `0x${ALICE_HEX.slice(2).toUpperCase()}`;
const ALICE_PREFIX_0 = encodeAddress(decodeAddress(GENERIC), 0);
const OTHER_HEX = u8aToHex(decodeAddress(OTHER));

const STORED_FORMS: Array<[string, string]> = [
  ['lower-case hex', ALICE_HEX],
  ['upper-case hex', ALICE_HEX_UPPER],
  ['prefix 0', ALICE_PREFIX_0],
];

describe('agents stored in hex or another prefix are flagged by account', () => {
  it.each(STORED_FORMS)(
    'ban via 42 and via 57 flags an agent stored as %s',
    async (_label, stored) => {
      for (const bannedAs of [GENERIC, LUNES]) {
        agents.length = 0;
        bans.length = 0;
        agents.push({
          walletAddress: stored,
          isBanned: false,
          banReason: null,
        });
        agents.push({
          walletAddress: OTHER_HEX,
          isBanned: false,
          banReason: null,
        });
        await walletRiskService.banWallet(bannedAs, 'sybil', 'admin-1');
        expect(agents[0]).toMatchObject({ isBanned: true, banReason: 'sybil' });
        expect(agents[1]).toMatchObject({ isBanned: false, banReason: null });
      }
    },
  );

  it.each(STORED_FORMS)(
    'unban via 42 and via 57 un-flags an agent stored as %s',
    async (_label, stored) => {
      for (const unbanAs of [GENERIC, LUNES]) {
        agents.length = 0;
        agents.push({ walletAddress: stored, isBanned: true, banReason: 'x' });
        agents.push({
          walletAddress: OTHER_HEX,
          isBanned: true,
          banReason: 'y',
        });
        await walletRiskService.unbanWallet(unbanAs);
        expect(agents[0]).toMatchObject({ isBanned: false, banReason: null });
        expect(agents[1]).toMatchObject({ isBanned: true, banReason: 'y' });
      }
    },
  );
});

describe('legacy BannedWallet / Agent rows in hex or another prefix', () => {
  it.each(STORED_FORMS)(
    'a BannedWallet row stored as %s blocks every encoding',
    async (_label, stored) => {
      bans.length = 0;
      bans.push({ address: stored, reason: 'legacy', bannedBy: 'admin-0' });
      for (const actingAs of [GENERIC, LUNES, ALICE_HEX, ALICE_PREFIX_0]) {
        await expect(
          walletRiskService.assertWalletCanAct(actingAs),
        ).rejects.toThrow('Wallet is banned: legacy');
      }
      await expect(
        walletRiskService.assertWalletCanAct(OTHER),
      ).resolves.toBeUndefined();
    },
  );

  it.each(STORED_FORMS)(
    'a banned (slashed) Agent row stored as %s blocks the 42 form',
    async (_label, stored) => {
      agents.length = 0;
      agents.push({
        walletAddress: stored,
        isBanned: true,
        banReason: 'slash',
      });
      await expect(
        walletRiskService.assertWalletCanAct(GENERIC),
      ).rejects.toThrow('Wallet is banned: slash');
    },
  );

  it.each(STORED_FORMS)(
    'unban removes a legacy BannedWallet row stored as %s',
    async (_label, stored) => {
      bans.length = 0;
      bans.push({ address: stored, reason: 'legacy', bannedBy: 'admin-0' });
      bans.push({ address: OTHER_HEX, reason: 'keep', bannedBy: 'admin-0' });
      await walletRiskService.unbanWallet(LUNES);
      expect(bans.map((row) => row.address)).toEqual([OTHER_HEX]);
      await expect(
        walletRiskService.assertWalletCanAct(GENERIC),
      ).resolves.toBeUndefined();
    },
  );
});
