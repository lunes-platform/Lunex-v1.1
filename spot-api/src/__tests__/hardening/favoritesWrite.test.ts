/**
 * BE-20 — removing a favorite is a write: it must go through the action
 * verifier (walletRiskService ban check), not the read verifier.
 */
const deleteMany = jest.fn(async () => ({ count: 1 }));
jest.mock('@prisma/client', () => ({
  ...jest.requireActual('@prisma/client'),
  PrismaClient: jest.fn(() => ({
    favorite: { deleteMany, findMany: jest.fn(async () => []), upsert: jest.fn() },
  })),
}));

jest.mock('@polkadot/util-crypto', () => ({
  // Real SS58 codec: auth canonicalizes addresses (M-09).
  ...jest.requireActual('@polkadot/util-crypto'),
  cryptoWaitReady: jest.fn().mockResolvedValue(undefined),
  signatureVerify: jest.fn(() => ({ isValid: true })),
}));

jest.mock('../../utils/redis', () => {
  const store = new Map<string, string>();
  return {
    getRedis: jest.fn(() => ({
      get: jest.fn(async (k: string) => store.get(k) ?? null),
      set: jest.fn(async (k: string, v: string) => {
        if (store.has(k)) return null;
        store.set(k, v);
        return 'OK';
      }),
    })),
    disconnectRedis: jest.fn(),
  };
});

jest.mock('../../services/walletRiskService', () => ({
  walletRiskService: {
    assertWalletCanAct: jest.fn(async () => {
      throw new Error('Wallet is banned');
    }),
  },
}));

import express from 'express';
import request from 'supertest';
import favoritesRouter from '../../routes/favorites';
import { walletRiskService } from '../../services/walletRiskService';

const app = express();
app.use(express.json());
app.use('/api/v1/user', favoritesRouter);

const ADDRESS = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';

describe('BE-20 favorite removal', () => {
  it('a banned wallet cannot remove favorites', async () => {
    const res = await request(app)
      .delete(`/api/v1/user/${ADDRESS}/favorites/LUNES%2FUSDT`)
      .send({
        nonce: 'fav-remove-nonce-1',
        timestamp: Date.now(),
        signature: '0xsigned-payload',
      });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Wallet is banned');
    expect(walletRiskService.assertWalletCanAct).toHaveBeenCalledWith(ADDRESS);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('a malformed percent-encoding is a 400, not a 500', async () => {
    const res = await request(app)
      .delete(`/api/v1/user/${ADDRESS}/favorites/%25E0%25A4%25A`)
      .send({
        nonce: 'fav-remove-nonce-2',
        timestamp: Date.now(),
        signature: '0xsigned-payload',
      });
    expect(res.status).toBe(400);
  });
});
