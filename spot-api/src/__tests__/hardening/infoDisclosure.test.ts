/**
 * BE-18 — no internal filesystem paths or key scopes in responses.
 */
process.env.ASYMMETRIC_CONTRACT_BUNDLE_PATH =
  '/nonexistent/hardening/asymmetric_pair.contract';

jest.mock('../../services/asymmetricService', () => ({
  asymmetricService: {},
}));
jest.mock('../../services/rebalancerService', () => ({
  rebalancerService: {},
}));
jest.mock('../../services/asymmetricContractVerifier', () => ({
  verifyAsymmetricContract: jest.fn(),
}));
jest.mock('../../services/agentService', () => ({
  agentService: {
    verifyApiKey: jest.fn(async () => ({
      agent: {
        id: 'agent-1',
        walletAddress: '5Agent',
        agentType: 'AI_AGENT',
        stakingTier: 0,
        dailyTradeLimit: 1,
        maxPositionSize: 1,
        maxOpenOrders: 1,
      },
      permissions: ['READ_ONLY'],
      keyId: 'key-1',
    })),
  },
}));

import express from 'express';
import request from 'supertest';
import asymmetricRouter from '../../routes/asymmetric';
import { agentAuth } from '../../middleware/agentAuth';

describe('BE-18 information disclosure', () => {
  it('missing contract bundle → 503 without the absolute path', async () => {
    const app = express();
    app.use('/api/v1/asymmetric', asymmetricRouter);
    const res = await request(app).get('/api/v1/asymmetric/contract-bundle');
    expect(res.status).toBe(503);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('/nonexistent');
    expect(text).not.toContain('/Users/');
    expect(res.body).not.toHaveProperty('path');
  });

  it('403 for missing permission does not echo the granted scopes', async () => {
    const app = express();
    app.get('/x', agentAuth(['TRADE_SPOT']), (_req, res) => res.json({}));
    const res = await request(app).get('/x').set('X-API-Key', 'lnx_test');
    expect(res.status).toBe(403);
    expect(res.body).not.toHaveProperty('granted');
    expect(res.body.code).toBe('INSUFFICIENT_PERMISSIONS');
  });
});
