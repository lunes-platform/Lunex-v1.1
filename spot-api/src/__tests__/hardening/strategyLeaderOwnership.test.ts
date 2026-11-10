/**
 * M-10 — an agent may only attach a strategy to a leader it owns.
 * Before the fix, createStrategy only checked that the leaderId existed.
 */
jest.mock('../../db', () => ({
  __esModule: true,
  default: {
    agent: { findUnique: jest.fn() },
    leader: { findUnique: jest.fn() },
    strategy: { create: jest.fn() },
  },
}));

jest.mock('../../middleware/agentAuth', () => ({
  agentAuth:
    () =>
    (
      req: { get(name: string): string | undefined; agent?: { id: string } },
      _res: unknown,
      next: () => void,
    ) => {
      req.agent = { id: req.get('X-Test-Agent') ?? '' };
      next();
    },
  optionalAgentAuth: () => (_req: unknown, _res: unknown, next: () => void) =>
    next(),
}));

import express from 'express';
import request from 'supertest';
import prisma from '../../db';
import strategiesRouter from '../../routes/strategies';
import { errorHandler } from '../../middleware/errors';

const db = prisma as unknown as {
  agent: { findUnique: jest.Mock };
  leader: { findUnique: jest.Mock };
  strategy: { create: jest.Mock };
};

const LEADER_A = '11111111-1111-4111-8111-111111111111';
const LEADER_B = '22222222-2222-4222-8222-222222222222';
const WALLET_A = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
// Same key as WALLET_A, Lunes prefix 57.
const WALLET_A_57 = '6mfqoTMHrMeVMyKwjqomUjVomPMJ4AjdCm1VReFtk7Be8wqr';
const WALLET_B = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';

const agents: Record<string, Record<string, unknown>> = {
  'agent-A': {
    id: 'agent-A',
    isActive: true,
    leaderId: LEADER_A,
    walletAddress: WALLET_A,
  },
  'agent-A-unlinked': {
    id: 'agent-A-unlinked',
    isActive: true,
    leaderId: null,
    walletAddress: WALLET_A,
  },
};
const leaders: Record<string, Record<string, unknown>> = {
  [LEADER_A]: { id: LEADER_A, address: WALLET_A_57 },
  [LEADER_B]: { id: LEADER_B, address: WALLET_B },
};

const app = express();
app.use(express.json());
app.use('/api/v1/strategies', strategiesRouter);
app.use(errorHandler());

function create(agentId: string, leaderId: string) {
  return request(app)
    .post('/api/v1/strategies')
    .set('X-Test-Agent', agentId)
    .send({ name: 'Momentum', leaderId });
}

beforeEach(() => {
  jest.clearAllMocks();
  db.agent.findUnique.mockImplementation(
    async ({ where }: { where: { id: string } }) => agents[where.id] ?? null,
  );
  db.leader.findUnique.mockImplementation(
    async ({ where }: { where: { id: string } }) => leaders[where.id] ?? null,
  );
  db.strategy.create.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'strategy-1',
      ...data,
    }),
  );
});

describe('M-10 strategy leader ownership', () => {
  it("rejects agent A attaching agent B's leader with 403", async () => {
    const res = await create('agent-A', LEADER_B);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(db.strategy.create).not.toHaveBeenCalled();
  });

  it('creates the strategy with the agent’s own linked leader', async () => {
    const res = await create('agent-A', LEADER_A);
    expect(res.status).toBe(201);
    expect(db.strategy.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          agentId: 'agent-A',
          leaderId: LEADER_A,
        }),
      }),
    );
  });

  it('accepts a leader whose wallet is the agent wallet (any SS58 prefix)', async () => {
    const res = await create('agent-A-unlinked', LEADER_A);
    expect(res.status).toBe(201);
  });

  it('rejects an unlinked agent attaching a leader with another wallet', async () => {
    const res = await create('agent-A-unlinked', LEADER_B);
    expect(res.status).toBe(403);
    expect(db.strategy.create).not.toHaveBeenCalled();
  });

  it('keeps 400 for a leader that does not exist', async () => {
    const res = await create('agent-A', '33333333-3333-4333-8333-333333333333');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Leader not found');
  });
});
