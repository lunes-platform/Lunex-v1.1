import express from 'express';
import request from 'supertest';

const mockPrisma = {
  $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  agent: {
    updateMany: jest.fn(),
  },
  bannedWallet: {
    upsert: jest.fn(),
    deleteMany: jest.fn(),
  },
};

jest.mock('../../db', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../utils/logger', () => ({
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../config', () => ({
  config: {
    adminSecret: 'test-admin-secret-local-only-000000000001',
  },
}));

import adminRouter from '../../routes/admin';

// Valid SS58 (M-09: undecodable admin input is 400) and its prefix-57 form.
const WALLET = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const WALLET_57 = '6mfqoTMHrMeVMyKwjqomUjVomPMJ4AjdCm1VReFtk7Be8wqr';

const app = express();
app.use(express.json());
app.use('/api/v1/admin', adminRouter);

describe('Admin wallet risk API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.agent.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.bannedWallet.upsert.mockResolvedValue({
      id: 'ban-1',
      address: WALLET,
      reason: 'market abuse',
      bannedBy: 'admin-1',
    });
    mockPrisma.bannedWallet.deleteMany.mockResolvedValue({ count: 1 });
  });

  it('bans a wallet through a protected backend endpoint', async () => {
    const res = await request(app)
      .post(`/api/v1/admin/wallets/${WALLET}/ban`)
      .set('Authorization', 'Bearer test-admin-secret-local-only-000000000001')
      .send({ reason: 'market abuse', bannedBy: 'admin-1' });

    expect(res.status).toBe(200);
    expect(res.body.wallet).toEqual({
      address: WALLET,
      isBanned: true,
      reason: 'market abuse',
    });
    expect(mockPrisma.bannedWallet.upsert).toHaveBeenCalledWith({
      where: { address: WALLET },
      create: {
        address: WALLET,
        reason: 'market abuse',
        bannedBy: 'admin-1',
      },
      update: {
        reason: 'market abuse',
        bannedBy: 'admin-1',
      },
    });
    expect(mockPrisma.agent.updateMany).toHaveBeenCalledWith({
      where: { walletAddress: { in: [WALLET, WALLET_57] } },
      data: { isBanned: true, banReason: 'market abuse' },
    });
  });

  it('unbans a wallet through a protected backend endpoint', async () => {
    const res = await request(app)
      .delete(`/api/v1/admin/wallets/${WALLET}/ban`)
      .set('Authorization', 'Bearer test-admin-secret-local-only-000000000001');

    expect(res.status).toBe(200);
    expect(res.body.wallet).toEqual({
      address: WALLET,
      isBanned: false,
    });
    expect(mockPrisma.bannedWallet.deleteMany).toHaveBeenCalledWith({
      where: { address: { in: [WALLET, WALLET_57] } },
    });
    expect(mockPrisma.agent.updateMany).toHaveBeenCalledWith({
      where: { walletAddress: { in: [WALLET, WALLET_57] } },
      data: { isBanned: false, banReason: null },
    });
  });

  it('requires admin authentication', async () => {
    const res = await request(app)
      .post(`/api/v1/admin/wallets/${WALLET}/ban`)
      .send({ reason: 'market abuse', bannedBy: 'admin-1' });

    expect(res.status).toBe(401);
    expect(mockPrisma.bannedWallet.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.agent.updateMany).not.toHaveBeenCalled();
  });
});
