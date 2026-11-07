/**
 * The UI must be able to tell whether spot trades settle on-chain, so it can
 * warn testers ("orders are not settled on chain") and refuse vault deposits
 * into a contract the backend does not settle against.
 */
import express from 'express';
import request from 'supertest';

const mockSettlement = { isEnabled: jest.fn() };
const mockBalances = { getBalances: jest.fn() };
jest.mock('../services/settlementService', () => ({
  settlementService: mockSettlement,
}));
jest.mock('../services/balanceService', () => ({
  balanceService: mockBalances,
}));
jest.mock('../config', () => ({
  config: {
    blockchain: {
      spotContractAddress: '5SpotVault1111111111111111111111111111111',
    },
  },
}));
jest.mock('../middleware/readSession', () => ({
  readAuthSchema: (_req: unknown, schema: unknown) => schema,
  verifyWalletReadAccess: jest.fn().mockResolvedValue({ ok: true }),
}));

import balancesRouter from '../routes/balances';

const app = express();
app.use('/api/v1/balances', balancesRouter);

const signedQuery = {
  address: '5Wallet11111111111111111111111111111111111',
  nonce: 'nonce-123456',
  timestamp: String(Date.now()),
  signature: '0xsignature',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockBalances.getBalances.mockResolvedValue([]);
});

describe('GET /api/v1/balances/settlement', () => {
  it('reports on-chain settlement and the vault contract when enabled', async () => {
    mockSettlement.isEnabled.mockReturnValue(true);
    const res = await request(app).get('/api/v1/balances/settlement');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      settlementEnabled: true,
      contractAddress: '5SpotVault1111111111111111111111111111111',
    });
    expect(mockBalances.getBalances).not.toHaveBeenCalled();
  });

  it('is explicit when trades are NOT settled on-chain (no contract exposed)', async () => {
    mockSettlement.isEnabled.mockReturnValue(false);
    const res = await request(app).get('/api/v1/balances/settlement');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      settlementEnabled: false,
      contractAddress: null,
    });
  });
});

describe('GET /api/v1/balances', () => {
  it('tags the balance list with the settlement mode', async () => {
    mockSettlement.isEnabled.mockReturnValue(false);
    const res = await request(app).get('/api/v1/balances').query(signedQuery);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ balances: [], settlementEnabled: false });
  });
});
