/**
 * BE-13: the agent's OWNER WALLET can revoke/rotate API keys with a wallet
 * signature (dedicated action names), even while a leaked key is active.
 * BE-11: GET /agents/:id serves the public (wallet-less) profile.
 */
import express from 'express';
import request from 'supertest';

const mockAgentService = {
  getAgentProfile: jest.fn(),
  getPublicAgentProfile: jest.fn(),
  revokeAllApiKeys: jest.fn(),
  rotateApiKey: jest.fn(),
  revokeApiKey: jest.fn(),
  getApiKeys: jest.fn(),
  createApiKey: jest.fn(),
  STAKING_TIERS: [],
};
jest.mock('../services/agentService', () => ({
  agentService: mockAgentService,
}));

const mockVerifyWalletActionSignature = jest.fn();
jest.mock('../middleware/auth', () => ({
  getSignedAuthInput: jest.fn(() => ({})),
  verifyWalletActionSignature: (...args: unknown[]) =>
    mockVerifyWalletActionSignature(...args),
  verifyWalletReadSignature: jest.fn(),
}));

jest.mock('../middleware/readSession', () => ({
  readAuthSchema: jest.fn(),
  verifyWalletReadAccess: jest.fn(),
}));

jest.mock('../middleware/agentAuth', () => ({
  agentAuth:
    () =>
    (req: any, res: any, next: any): void => {
      if (!req.headers['x-api-key']) {
        res.status(401).json({ error: 'Missing X-API-Key header' });
        return;
      }
      req.agent = {
        id: 'agent-1',
        keyId: 'key-read',
        permissions: ['READ_ONLY'],
      };
      next();
    },
  optionalAgentAuth: () => (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import agentsRouter from '../routes/agents';
import { errorHandler } from '../middleware/errors';

const app = express();
app.use(express.json());
app.use('/api/v1/agents', agentsRouter);
app.use(errorHandler());

const OWNER = '5Fowner-wallet-address';
const signed = {
  nonce: 'nonce-12345678',
  timestamp: Date.now(),
  signature: 'sig-12345678',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAgentService.getAgentProfile.mockResolvedValue({
    id: 'agent-1',
    walletAddress: OWNER,
  });
  mockVerifyWalletActionSignature.mockResolvedValue({ ok: true });
});

describe('POST /agents/:id/api-keys/revoke-all (BE-13)', () => {
  it('revokes every key when the owner wallet signs agents.revoke-all-api-keys', async () => {
    mockAgentService.revokeAllApiKeys.mockResolvedValue({ revoked: 2 });

    const res = await request(app)
      .post('/api/v1/agents/agent-1/api-keys/revoke-all')
      .send({ walletAddress: OWNER, ...signed });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ revoked: 2 });
    expect(mockVerifyWalletActionSignature).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'agents.revoke-all-api-keys',
        address: OWNER,
        fields: { agentId: 'agent-1' },
      }),
    );
  });

  it('rejects a wallet that does not own the agent', async () => {
    const res = await request(app)
      .post('/api/v1/agents/agent-1/api-keys/revoke-all')
      .send({ walletAddress: '5Fattacker-wallet', ...signed });

    expect(res.status).toBe(403);
    expect(mockAgentService.revokeAllApiKeys).not.toHaveBeenCalled();
  });

  it('rejects an invalid wallet signature', async () => {
    mockVerifyWalletActionSignature.mockResolvedValue({
      ok: false,
      error: 'Invalid signature',
    });

    const res = await request(app)
      .post('/api/v1/agents/agent-1/api-keys/revoke-all')
      .send({ walletAddress: OWNER, ...signed });

    expect(res.status).toBe(401);
    expect(mockAgentService.revokeAllApiKeys).not.toHaveBeenCalled();
  });
});

describe('POST /agents/:id/api-keys/rotate (BE-13)', () => {
  it('rotates keys on a valid owner signature over the new key params', async () => {
    mockAgentService.rotateApiKey.mockResolvedValue({
      revoked: 1,
      key: { id: 'key-new', key: 'lnx_new' },
    });

    const res = await request(app)
      .post('/api/v1/agents/agent-1/api-keys/rotate')
      .send({
        walletAddress: OWNER,
        permissions: ['TRADE_SPOT'],
        expiresInDays: 30,
        ...signed,
      });

    expect(res.status).toBe(201);
    expect(mockVerifyWalletActionSignature).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'agents.rotate-api-key',
        fields: expect.objectContaining({
          agentId: 'agent-1',
          permissions: ['TRADE_SPOT'],
          expiresInDays: 30,
        }),
      }),
    );
    expect(mockAgentService.rotateApiKey).toHaveBeenCalledWith('agent-1', {
      label: undefined,
      permissions: ['TRADE_SPOT'],
      expiresInDays: 30,
    });
  });
});

describe('DELETE /agents/:id/api-keys/:keyId (BE-13)', () => {
  it('passes the authenticated key scope so the service can refuse broader revocations', async () => {
    mockAgentService.revokeApiKey.mockResolvedValue(undefined);

    const res = await request(app)
      .delete('/api/v1/agents/agent-1/api-keys/key-trade')
      .set('X-API-Key', 'lnx_read');

    expect(res.status).toBe(200);
    expect(mockAgentService.revokeApiKey).toHaveBeenCalledWith(
      'agent-1',
      'key-trade',
      { actorKeyId: 'key-read', actorPermissions: ['READ_ONLY'] },
    );
  });
});

describe('GET /agents/:id (BE-11)', () => {
  it('serves the public profile', async () => {
    mockAgentService.getPublicAgentProfile.mockResolvedValue({ id: 'agent-1' });

    const res = await request(app).get('/api/v1/agents/agent-1');

    expect(res.status).toBe(200);
    expect(res.body.agent).not.toHaveProperty('walletAddress');
    expect(mockAgentService.getAgentProfile).not.toHaveBeenCalled();
  });
});
