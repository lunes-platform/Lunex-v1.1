/**
 * BE-10: PATCH /execution/:logId/status must only let the owning agent update
 * its own execution log, and the body must be schema-validated.
 */
import express from 'express';
import request from 'supertest';

const logs = new Map<string, Record<string, unknown>>();

const mockPrisma = {
  executionLog: {
    update: jest.fn(),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const row = logs.get(where.id);
      if (!row || (where.agentId && row.agentId !== where.agentId)) {
        return { count: 0 };
      }
      Object.assign(row, data);
      return { count: 1 };
    }),
    findFirst: jest.fn(async ({ where }: any) => {
      const row = logs.get(where.id);
      if (!row || (where.agentId && row.agentId !== where.agentId)) return null;
      return { ...row };
    }),
  },
};

jest.mock('../db', () => ({ __esModule: true, default: mockPrisma }));

let currentAgentId = 'agent-B';
jest.mock('../middleware/agentAuth', () => ({
  agentAuth: () => (req: any, _res: any, next: any) => {
    req.agent = { id: currentAgentId, permissions: ['TRADE_SPOT'] };
    next();
  },
}));

jest.mock('../utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import executionRouter from '../routes/execution';
import { errorHandler } from '../middleware/errors';

const app = express();
app.use(express.json());
app.use('/api/v1/execution', executionRouter);
app.use(errorHandler());

const LOG_ID = '11111111-1111-4111-8111-111111111111';

describe('PATCH /execution/:logId/status (BE-10)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    logs.clear();
    logs.set(LOG_ID, {
      id: LOG_ID,
      agentId: 'agent-A',
      status: 'PENDING',
      executedAmount: null,
      price: null,
    });
  });

  it('returns 404 and leaves the log untouched when another agent patches it', async () => {
    currentAgentId = 'agent-B';

    const res = await request(app)
      .patch(`/api/v1/execution/${LOG_ID}/status`)
      .send({ status: 'EXECUTED', executedAmount: '999', executionPrice: '1' });

    expect(res.status).toBe(404);
    expect(logs.get(LOG_ID)).toEqual(
      expect.objectContaining({ status: 'PENDING', executedAmount: null }),
    );
    expect(mockPrisma.executionLog.update).not.toHaveBeenCalled();
  });

  it('lets the owning agent update its own log', async () => {
    currentAgentId = 'agent-A';

    const res = await request(app)
      .patch(`/api/v1/execution/${LOG_ID}/status`)
      .send({ status: 'EXECUTED', executedAmount: '5', executionPrice: '0.2' });

    expect(res.status).toBe(200);
    expect(res.body.entry).toEqual(
      expect.objectContaining({ id: LOG_ID, status: 'EXECUTED' }),
    );
    expect(mockPrisma.executionLog.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: LOG_ID, agentId: 'agent-A' },
      }),
    );
  });

  it.each([
    [{ status: 'EXECUTED', executedAmount: 'abc' }],
    [{ status: 'EXECUTED', executionPrice: '-1' }],
    [{ status: 'EXECUTED', slippageBps: 1.5 }],
    [{ status: 'EXECUTED', orderId: 'not-a-uuid' }],
    [{ status: 'NOPE' }],
    [{ status: 'EXECUTED', extra: { $ne: null } }],
  ])('rejects an invalid body with 400: %j', async (payload) => {
    currentAgentId = 'agent-A';

    const res = await request(app)
      .patch(`/api/v1/execution/${LOG_ID}/status`)
      .send(payload);

    expect(res.status).toBe(400);
    expect(mockPrisma.executionLog.updateMany).not.toHaveBeenCalled();
  });
});
