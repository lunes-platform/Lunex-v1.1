/**
 * Emergency pause/unpause must not answer 2xx unless the contract state was
 * confirmed. Clients keyed on HTTP status (curl -f, fetch res.ok, axios
 * defaults) used to record a failed pause as done.
 */
jest.mock('../../db', () => ({ __esModule: true, default: {} }));

jest.mock('../../utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../config', () => ({
  config: { adminSecret: 'test-admin-secret-local-only-000000000002' },
}));

jest.mock('../../services/emergencyService', () => ({
  emergencyService: {
    getStatus: jest.fn(),
    pauseSpot: jest.fn(),
    unpauseSpot: jest.fn(),
  },
}));

import express from 'express';
import request from 'supertest';
import adminRouter from '../../routes/admin';
import { emergencyService } from '../../services/emergencyService';

const ADMIN = 'Bearer test-admin-secret-local-only-000000000002';
const BODY = { reason: 'incident drill', performedBy: 'admin-1' };

const app = express();
app.use(express.json());
app.use('/api/v1/admin', adminRouter);

const pauseMock = emergencyService.pauseSpot as jest.Mock;
const unpauseMock = emergencyService.unpauseSpot as jest.Mock;

// Plain objects: the route must key on the fields, not on the TS type.
function spot(overrides: Record<string, unknown>) {
  return {
    component: 'spot_settlement',
    available: true,
    paused: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

type Case = {
  action: 'pause' | 'unpause';
  mock: jest.Mock;
  expected: boolean;
};

const CASES: Case[] = [
  { action: 'pause', mock: pauseMock, expected: true },
  { action: 'unpause', mock: unpauseMock, expected: false },
];

describe.each(CASES)(
  'POST /emergency/spot/$action',
  ({ action, mock, expected }) => {
    const url = `/api/v1/admin/emergency/spot/${action}`;

    it('answers 200 with ok:true only when the state is confirmed', async () => {
      const result = spot({ paused: expected, txHash: '0xok' });
      mock.mockResolvedValue(result);
      const res = await request(app)
        .post(url)
        .set('Authorization', ADMIN)
        .send(BODY);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, ...result });
    });

    it('answers 503 when the contract/method is not available', async () => {
      const result = spot({
        available: false,
        error: `spot_settlement.${action} not available`,
      });
      mock.mockResolvedValue(result);
      const res = await request(app)
        .post(url)
        .set('Authorization', ADMIN)
        .send(BODY);
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ ok: false, ...result });
    });

    it('answers 502 when the tx failed on-chain', async () => {
      const result = spot({
        error: `spot_settlement.${action} rejected on-chain: contracts.ContractReverted`,
      });
      mock.mockResolvedValue(result);
      const res = await request(app)
        .post(url)
        .set('Authorization', ADMIN)
        .send(BODY);
      expect(res.status).toBe(502);
      expect(res.body).toEqual({ ok: false, ...result });
    });

    it('answers 502 when finalized but the state did not change', async () => {
      const result = spot({
        paused: !expected,
        txHash: '0xnochange',
        error: `spot_settlement.${action} not confirmed on-chain`,
      });
      mock.mockResolvedValue(result);
      const res = await request(app)
        .post(url)
        .set('Authorization', ADMIN)
        .send(BODY);
      expect(res.status).toBe(502);
      expect(res.body).toEqual({ ok: false, ...result });
    });

    it('answers 502 when paused is not the expected value even without error', async () => {
      const result = spot({ paused: !expected });
      mock.mockResolvedValue(result);
      const res = await request(app)
        .post(url)
        .set('Authorization', ADMIN)
        .send(BODY);
      expect(res.status).toBe(502);
      expect(res.body.ok).toBe(false);
    });

    it('answers 502 when paused is unknown (null) without error', async () => {
      mock.mockResolvedValue(spot({ paused: null }));
      const res = await request(app)
        .post(url)
        .set('Authorization', ADMIN)
        .send(BODY);
      expect(res.status).toBe(502);
      expect(res.body.ok).toBe(false);
    });

    it('answers 202 with ok:false, pending:true when the outcome is ambiguous', async () => {
      const result = spot({
        paused: expected,
        pending: true,
        txHash: '0xpending',
        error: `spot_settlement.${action} broadcast but not finalized`,
      });
      mock.mockResolvedValue(result);
      const res = await request(app)
        .post(url)
        .set('Authorization', ADMIN)
        .send(BODY);
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ ok: false, ...result });
      expect(res.body.pending).toBe(true);
    });

    it('still rejects an unauthenticated call before touching the chain', async () => {
      const res = await request(app).post(url).send(BODY);
      expect(res.status).toBe(401);
      expect(mock).not.toHaveBeenCalled();
    });

    it('still validates the audit fields', async () => {
      const res = await request(app)
        .post(url)
        .set('Authorization', ADMIN)
        .send({ reason: '' });
      expect(res.status).toBe(400);
      expect(mock).not.toHaveBeenCalled();
    });
  },
);
