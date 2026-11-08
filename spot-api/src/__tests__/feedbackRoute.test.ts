/**
 * Beta feedback + client error telemetry (P0-10).
 *
 * POST /api/v1/feedback                  anonymous bug report / feedback
 * POST /api/v1/telemetry/client-errors   frontend error reports (deduplicated)
 * GET  /api/v1/feedback                  admin only
 * GET  /api/v1/telemetry/client-errors   admin only
 */
import express from 'express';
import request from 'supertest';

const mockPrisma = {
  clientFeedback: { create: jest.fn(), findMany: jest.fn() },
  clientError: { upsert: jest.fn(), findMany: jest.fn() },
};
jest.mock('../db', () => ({ __esModule: true, default: mockPrisma, prisma: mockPrisma }));

const mockRateLimit = jest.fn();
jest.mock('../utils/redisRateLimit', () => ({
  checkRedisRateLimit: (...args: unknown[]) => mockRateLimit(...args),
}));

jest.mock('../middleware/adminGuard', () => ({
  requireAdmin: (req: any, res: any, next: any) =>
    req.headers.authorization === 'Bearer admin-test'
      ? next()
      : res.status(401).json({ error: 'Unauthorized' }),
}));

jest.mock('../utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import feedbackRouter from '../routes/feedback';
import { errorHandler } from '../middleware/errors';

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use('/api/v1', feedbackRouter);
app.use(errorHandler());

const WALLET = '5HYVGHPrMmG6TKeczuTjhaGcRTkW8sMhWfppaFrTCAvKFfBb';

beforeEach(() => {
  jest.clearAllMocks();
  mockRateLimit.mockResolvedValue({ allowed: true, remaining: 5, retryAfterMs: 0 });
  mockPrisma.clientFeedback.create.mockImplementation(async ({ data }: any) => ({ id: 'fb-1', ...data }));
  mockPrisma.clientError.upsert.mockResolvedValue({ id: 'err-1' });
  mockPrisma.clientFeedback.findMany.mockResolvedValue([]);
  mockPrisma.clientError.findMany.mockResolvedValue([]);
});

describe('POST /api/v1/feedback', () => {
  const valid = {
    category: 'BUG',
    message: 'Swap button stays disabled after approving LUSDT',
    page: '/swap',
    appVersion: '0.1.0+abc123',
    network: 'testnet',
  };

  it('stores a valid anonymous report and returns 201 with the id', async () => {
    const res = await request(app).post('/api/v1/feedback').set('User-Agent', 'jest-agent').send(valid);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'fb-1' });
    const data = mockPrisma.clientFeedback.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ category: 'BUG', page: '/swap', network: 'testnet', walletAddress: null });
    expect(data).not.toHaveProperty('ip');
  });

  it('accepts an optional wallet address and txHash', async () => {
    const txHash = '0x' + 'ab'.repeat(32);
    const res = await request(app)
      .post('/api/v1/feedback')
      .send({ ...valid, walletAddress: WALLET, txHash });
    expect(res.status).toBe(201);
    const data = mockPrisma.clientFeedback.create.mock.calls[0][0].data;
    expect(data.walletAddress).toBe(WALLET);
    expect(data.txHash).toBe(txHash);
  });

  it.each([
    ['unknown category', { category: 'HACK' }],
    ['message too short', { message: 'hi' }],
    ['message too long', { message: 'x'.repeat(4001) }],
    ['invalid wallet', { walletAddress: 'not-a-wallet' }],
    ['invalid txHash', { txHash: '0x123' }],
    ['unknown field', { email: 'a@b.c' }],
    ['page too long', { page: '/' + 'p'.repeat(400) }],
  ])('rejects %s with 400', async (_name, patch) => {
    const res = await request(app).post('/api/v1/feedback').send({ ...valid, ...patch });
    expect(res.status).toBe(400);
    expect(mockPrisma.clientFeedback.create).not.toHaveBeenCalled();
  });

  it('truncates a long user agent instead of rejecting', async () => {
    const res = await request(app).post('/api/v1/feedback').send({ ...valid, userAgent: 'U'.repeat(2000) });
    expect(res.status).toBe(201);
    const data = mockPrisma.clientFeedback.create.mock.calls[0][0].data;
    expect(data.userAgent.length).toBeLessThanOrEqual(300);
  });

  it('is rate-limited per IP (429 + Retry-After)', async () => {
    mockRateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfterMs: 30_000 });
    const res = await request(app).post('/api/v1/feedback').send(valid);
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('30');
    expect(mockPrisma.clientFeedback.create).not.toHaveBeenCalled();
    expect(mockRateLimit.mock.calls[0][0].key).toMatch(/^rl:feedback:/);
  });
});

describe('POST /api/v1/telemetry/client-errors', () => {
  const valid = {
    source: 'boundary',
    message: `TypeError: cannot read balance of ${WALLET}`,
    stack: `TypeError: x\n    at Swap (${WALLET})\n    at render`,
    page: '/swap',
    appVersion: '0.1.0',
    network: 'testnet',
    count: 3,
  };

  it('upserts by server-side fingerprint, scrubbing wallet addresses', async () => {
    const res = await request(app).post('/api/v1/telemetry/client-errors').send(valid);
    expect(res.status).toBe(202);
    const arg = mockPrisma.clientError.upsert.mock.calls[0][0];
    expect(arg.where.fingerprint_appVersion.appVersion).toBe('0.1.0');
    expect(arg.where.fingerprint_appVersion.fingerprint).toMatch(/^[0-9a-f]{32}$/);
    expect(arg.create.message).not.toContain(WALLET);
    expect(arg.create.stack).not.toContain(WALLET);
    expect(arg.create.count).toBe(3);
    expect(arg.update.count).toEqual({ increment: 3 });
  });

  it('same error twice => same fingerprint', async () => {
    await request(app).post('/api/v1/telemetry/client-errors').send(valid);
    await request(app).post('/api/v1/telemetry/client-errors').send({ ...valid, count: 1 });
    const [a, b] = mockPrisma.clientError.upsert.mock.calls.map((c: any) => c[0].where.fingerprint_appVersion.fingerprint);
    expect(a).toBe(b);
  });

  it('truncates oversized stacks and rejects bad source', async () => {
    const ok = await request(app)
      .post('/api/v1/telemetry/client-errors')
      .send({ ...valid, stack: 's'.repeat(20_000) });
    expect(ok.status).toBe(202);
    expect(mockPrisma.clientError.upsert.mock.calls[0][0].create.stack.length).toBeLessThanOrEqual(4000);
    const bad = await request(app).post('/api/v1/telemetry/client-errors').send({ ...valid, source: 'evil' });
    expect(bad.status).toBe(400);
  });

  it('is rate-limited per IP', async () => {
    mockRateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfterMs: 1000 });
    const res = await request(app).post('/api/v1/telemetry/client-errors').send(valid);
    expect(res.status).toBe(429);
    expect(mockRateLimit.mock.calls[0][0].key).toMatch(/^rl:client-errors:/);
  });
});

describe('admin reads', () => {
  it('GET /feedback requires admin', async () => {
    expect((await request(app).get('/api/v1/feedback')).status).toBe(401);
    const res = await request(app).get('/api/v1/feedback?limit=10&category=BUG').set('Authorization', 'Bearer admin-test');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
    const arg = mockPrisma.clientFeedback.findMany.mock.calls[0][0];
    expect(arg.take).toBe(10);
    expect(arg.where).toEqual({ category: 'BUG' });
  });

  it('GET /telemetry/client-errors requires admin and caps limit', async () => {
    expect((await request(app).get('/api/v1/telemetry/client-errors')).status).toBe(401);
    const res = await request(app).get('/api/v1/telemetry/client-errors?limit=5000').set('Authorization', 'Bearer admin-test');
    expect(res.status).toBe(200);
    expect(mockPrisma.clientError.findMany.mock.calls[0][0].take).toBe(200);
  });
});
