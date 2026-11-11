/**
 * M-09 (third pass) — new agents are stored canonical (prefix 42), so the
 * owner-wallet key routes compare the presented wallet as an account, not as
 * a string: an owner who registered and keeps signing in 57/hex is not 403.
 */
import express from 'express';
import request from 'supertest';
import { u8aToHex } from '@polkadot/util';
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';

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
jest.mock('../../services/agentService', () => ({
  agentService: mockAgentService,
}));

const mockVerifyWalletActionSignature = jest.fn();
jest.mock('../../middleware/auth', () => ({
  getSignedAuthInput: jest.fn(() => ({})),
  verifyWalletActionSignature: (...args: unknown[]) =>
    mockVerifyWalletActionSignature(...args),
  verifyWalletReadSignature: jest.fn(),
}));

jest.mock('../../middleware/readSession', () => ({
  readAuthSchema: jest.fn(),
  verifyWalletReadAccess: jest.fn(),
}));

jest.mock('../../middleware/agentAuth', () => ({
  agentAuth: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  optionalAgentAuth: () => (_req: unknown, _res: unknown, next: () => void) =>
    next(),
}));

jest.mock('../../utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import agentsRouter from '../../routes/agents';
import { errorHandler } from '../../middleware/errors';

const app = express();
app.use(express.json());
app.use('/api/v1/agents', agentsRouter);
app.use(errorHandler());

const GENERIC = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const PUBLIC_KEY = decodeAddress(GENERIC);
const HEX = u8aToHex(PUBLIC_KEY);
const PRESENTED: Array<[string, string]> = [
  ['prefix 57', encodeAddress(PUBLIC_KEY, 57)],
  ['prefix 0', encodeAddress(PUBLIC_KEY, 0)],
  ['lower-case hex', HEX],
  ['upper-case hex', `0x${HEX.slice(2).toUpperCase()}`],
];
const OTHER = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';
const signed = {
  nonce: 'nonce-12345678',
  timestamp: Date.now(),
  signature: 'sig-12345678',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAgentService.getAgentProfile.mockResolvedValue({
    id: 'agent-1',
    walletAddress: GENERIC,
  });
  mockAgentService.getApiKeys.mockResolvedValue([]);
  mockAgentService.revokeAllApiKeys.mockResolvedValue({ revoked: 1 });
  mockAgentService.rotateApiKey.mockResolvedValue({ revoked: 1, key: {} });
  mockAgentService.createApiKey.mockResolvedValue({ id: 'key-1' });
  mockVerifyWalletActionSignature.mockResolvedValue({ ok: true });
});

describe.each(PRESENTED)(
  'owner presents the wallet as %s',
  (_label, wallet) => {
    it('revoke-all is allowed and signs over the presented string', async () => {
      const res = await request(app)
        .post('/api/v1/agents/agent-1/api-keys/revoke-all')
        .send({ walletAddress: wallet, ...signed });
      expect(res.status).toBe(200);
      expect(mockVerifyWalletActionSignature).toHaveBeenCalledWith(
        expect.objectContaining({ address: wallet }),
      );
    });

    it('rotate is allowed', async () => {
      const res = await request(app)
        .post('/api/v1/agents/agent-1/api-keys/rotate')
        .send({ walletAddress: wallet, permissions: ['READ_ONLY'], ...signed });
      expect(res.status).toBe(201);
    });

    it('bootstrap key creation is allowed', async () => {
      const res = await request(app)
        .post('/api/v1/agents/agent-1/api-keys')
        .send({ walletAddress: wallet, permissions: ['READ_ONLY'], ...signed });
      expect(res.status).toBe(201);
    });
  },
);

it('another account is still 403 on every owner route', async () => {
  for (const path of ['revoke-all', 'rotate']) {
    const res = await request(app)
      .post(`/api/v1/agents/agent-1/api-keys/${path}`)
      .send({ walletAddress: OTHER, permissions: ['READ_ONLY'], ...signed });
    expect(res.status).toBe(403);
  }
  const res = await request(app)
    .post('/api/v1/agents/agent-1/api-keys')
    .send({ walletAddress: OTHER, permissions: ['READ_ONLY'], ...signed });
  expect(res.status).toBe(403);
  expect(mockVerifyWalletActionSignature).not.toHaveBeenCalled();
});
