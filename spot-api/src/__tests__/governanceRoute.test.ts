/**
 * Governance vote mirror (UX history only — the staking contract is the
 * source of truth and allows ONE vote per (proposal, wallet)).
 *
 * POST /api/v1/governance/vote/record   signed `governance.vote.record`
 * POST /api/v1/governance/vote/check    signed read
 */
import express from 'express';
import request from 'supertest';

const mockPrisma = {
  governanceVote: {
    findFirst: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
  },
};
jest.mock('../db', () => ({ __esModule: true, default: mockPrisma, prisma: mockPrisma }));

const mockVerifyAction = jest.fn();
jest.mock('../middleware/auth', () => ({
  ...jest.requireActual('../middleware/auth'),
  verifyWalletActionSignature: (...args: unknown[]) => mockVerifyAction(...args),
}));

jest.mock('../middleware/readSession', () => ({
  readAuthSchema: (_req: unknown, schema: unknown) => schema,
  verifyWalletReadAccess: jest.fn().mockResolvedValue({ ok: true }),
}));

jest.mock('../utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import governanceRouter from '../routes/governance';
import { errorHandler } from '../middleware/errors';

const app = express();
app.use(express.json());
app.use('/api/v1/governance', governanceRouter);
app.use(errorHandler());

const WALLET = '5HYVGHPrMmG6TKeczuTjhaGcRTkW8sMhWfppaFrTCAvKFfBb';
const TX = '0x' + 'ab'.repeat(32);
const auth = { nonce: 'nonce-12345678', timestamp: Date.now(), signature: '0xsig-signature' };
const body = (extra: Record<string, unknown> = {}) => ({
  walletAddress: WALLET,
  proposalId: 3,
  voteType: 'YES',
  ...auth,
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockVerifyAction.mockResolvedValue({ ok: true });
  mockPrisma.governanceVote.findFirst.mockResolvedValue(null);
  mockPrisma.governanceVote.create.mockImplementation(async ({ data }: any) => ({
    id: 'v1',
    votedAt: new Date(),
    ...data,
  }));
});

describe('POST /vote/record', () => {
  it('records the first vote with its txHash (signed field)', async () => {
    const res = await request(app).post('/api/v1/governance/vote/record').send(body({ txHash: TX }));
    expect(res.status).toBe(201);
    expect(mockPrisma.governanceVote.create).toHaveBeenCalledWith({
      data: { walletAddress: WALLET, proposalId: 3, voteType: 'YES', txHash: TX },
    });
    expect(mockVerifyAction.mock.calls[0][0]).toMatchObject({
      action: 'governance.vote.record',
      fields: { proposalId: 3, voteType: 'YES', txHash: TX },
    });
  });

  it('records without txHash (optional)', async () => {
    const res = await request(app).post('/api/v1/governance/vote/record').send(body());
    expect(res.status).toBe(201);
    expect(mockPrisma.governanceVote.create.mock.calls[0][0].data.txHash).toBeNull();
  });

  it('treats ANY existing record for (proposal, wallet) as already voted — no cooldown', async () => {
    mockPrisma.governanceVote.findFirst.mockResolvedValue({
      id: 'old',
      voteType: 'NO',
      votedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
    });
    const res = await request(app).post('/api/v1/governance/vote/record').send(body());
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_VOTED');
    expect(mockPrisma.governanceVote.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { walletAddress: WALLET, proposalId: 3 } }),
    );
    expect(mockPrisma.governanceVote.create).not.toHaveBeenCalled();
  });

  it('maps a concurrent unique-constraint race to ALREADY_VOTED', async () => {
    mockPrisma.governanceVote.create.mockRejectedValue({ code: 'P2002' });
    const res = await request(app).post('/api/v1/governance/vote/record').send(body());
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_VOTED');
  });

  it.each(['0xabc123', 'ab'.repeat(32), '0x' + 'zz'.repeat(32), '0x' + 'ab'.repeat(33)])(
    'rejects malformed txHash %s',
    async (txHash) => {
      const res = await request(app).post('/api/v1/governance/vote/record').send(body({ txHash }));
      expect(res.status).toBe(400);
      expect(mockPrisma.governanceVote.create).not.toHaveBeenCalled();
    },
  );

  it('rejects an invalid signature', async () => {
    mockVerifyAction.mockResolvedValue({ ok: false, error: 'Invalid signature' });
    const res = await request(app).post('/api/v1/governance/vote/record').send(body());
    expect(res.status).toBe(401);
    expect(mockPrisma.governanceVote.create).not.toHaveBeenCalled();
  });
});

describe('POST /vote/check', () => {
  it('canVote=true when there is no record', async () => {
    const res = await request(app)
      .post('/api/v1/governance/vote/check')
      .send({ walletAddress: WALLET, proposalId: 3, ...auth });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ canVote: true, alreadyVoted: false });
  });

  it('canVote=false forever once a vote exists (one vote per proposal)', async () => {
    mockPrisma.governanceVote.findFirst.mockResolvedValue({
      id: 'old',
      voteType: 'YES',
      txHash: TX,
      votedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });
    const res = await request(app)
      .post('/api/v1/governance/vote/check')
      .send({ walletAddress: WALLET, proposalId: 3, ...auth });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      canVote: false,
      alreadyVoted: true,
      lastVoteType: 'YES',
      txHash: TX,
    });
  });
});
