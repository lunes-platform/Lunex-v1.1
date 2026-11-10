/**
 * M-09 (second pass) — bans are keyed by account, not by the SS58 string the
 * admin happened to paste. The explorer shows prefix 57; requests arrive in
 * the canonical prefix 42. Rows written before the fix must keep blocking.
 */
type BanRow = { address: string; reason: string; bannedBy: string };
type AgentRow = {
  walletAddress: string;
  isBanned: boolean;
  banReason: string | null;
};
type StringFilter = string | { in: string[] } | undefined;

const bans: BanRow[] = [];
const agents: AgentRow[] = [];

function matches(value: string, filter: StringFilter) {
  if (filter === undefined) return true;
  if (typeof filter === 'string') return value === filter;
  return filter.in.includes(value);
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
    updateMany: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { walletAddress?: StringFilter };
        data: Partial<AgentRow>;
      }) => {
        const hit = agents.filter((row) =>
          matches(row.walletAddress, where.walletAddress),
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
