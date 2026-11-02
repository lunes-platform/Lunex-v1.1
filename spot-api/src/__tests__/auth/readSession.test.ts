jest.mock('@polkadot/util-crypto', () => ({
  cryptoWaitReady: jest.fn().mockResolvedValue(undefined),
  signatureVerify: jest.fn(),
}));

jest.mock('../../utils/redis', () => {
  const store = new Map<string, string>();

  const mockRedis = {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    }),
    _clear: () => store.clear(),
  };

  return {
    getRedis: jest.fn(() => mockRedis),
    disconnectRedis: jest.fn(async () => undefined),
    __mockRedis: mockRedis,
  };
});

jest.mock('../../services/walletRiskService', () => ({
  walletRiskService: {
    assertWalletCanAct: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../services/orderService', () => ({
  orderService: {
    getUserOrders: jest.fn().mockResolvedValue([]),
    createOrder: jest.fn().mockResolvedValue({ id: 'order-1' }),
    cancelOrder: jest.fn().mockResolvedValue({ id: 'order-1' }),
  },
}));

jest.mock('../../services/marginService', () => ({
  marginService: {
    getOverview: jest.fn().mockResolvedValue({ account: null, positions: [] }),
    getPriceHealthSummary: jest.fn().mockReturnValue({}),
    getPriceHealthMetrics: jest.fn().mockReturnValue(''),
    depositCollateral: jest.fn().mockResolvedValue({ transfer: 'ok' }),
  },
}));

import request from 'supertest';
import { signatureVerify } from '@polkadot/util-crypto';
import app from '../e2e/testApp';
import * as redisModule from '../../utils/redis';
import {
  __resetReadSessionStateForTests,
  issueReadSessionToken,
  verifyReadSessionToken,
} from '../../middleware/readSession';
import { orderService } from '../../services/orderService';
import { marginService } from '../../services/marginService';

const signatureVerifyMock = signatureVerify as jest.MockedFunction<
  typeof signatureVerify
>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockRedis = (redisModule as any).__mockRedis as {
  get: jest.Mock;
  set: jest.Mock;
  _clear: () => void;
};

const ADDRESS = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const OTHER_ADDRESS = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';

function setSignatureValid(isValid: boolean) {
  signatureVerifyMock.mockReturnValue({ isValid } as ReturnType<
    typeof signatureVerify
  >);
}

async function createSession(address = ADDRESS, nonce = `n-${Date.now()}`) {
  setSignatureValid(true);
  return request(app).post('/api/v1/auth/session').send({
    address,
    nonce,
    timestamp: Date.now(),
    signature: '0xsigned-session',
  });
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe('read sessions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis._clear();
    __resetReadSessionStateForTests();
  });

  describe('POST /api/v1/auth/session', () => {
    it('issues an 8h read token after verifying an auth.session signature', async () => {
      const before = Date.now();
      const res = await createSession(ADDRESS, 'session-nonce-1');

      expect(res.status).toBe(201);
      expect(res.body.token).toMatch(/^lxs1\.[\w-]+\.[\w-]+$/);
      expect(res.body.scope).toBe('read');
      expect(res.body.expiresAt).toBeGreaterThanOrEqual(
        before + 8 * 3600 * 1000 - 2000,
      );
      expect(res.body.expiresAt).toBeLessThanOrEqual(
        Date.now() + 8 * 3600 * 1000,
      );

      const [message, , signer] = signatureVerifyMock.mock.calls[0];
      expect(String(message)).toContain('lunex-auth:auth.session');
      expect(String(message)).toContain(`address:${ADDRESS}`);
      expect(String(message)).toContain('nonce:session-nonce-1');
      expect(signer).toBe(ADDRESS);

      const verified = verifyReadSessionToken(res.body.token);
      expect(verified.ok && verified.claims.sub).toBe(ADDRESS);
    });

    it('rejects an invalid wallet signature', async () => {
      setSignatureValid(false);
      const res = await request(app).post('/api/v1/auth/session').send({
        address: ADDRESS,
        nonce: 'session-nonce-bad',
        timestamp: Date.now(),
        signature: '0xbad-signature',
      });
      expect(res.status).toBe(401);
      expect(res.body.token).toBeUndefined();
    });

    it('rejects nonce replay', async () => {
      const first = await createSession(ADDRESS, 'session-nonce-replay');
      expect(first.status).toBe(201);
      const second = await createSession(ADDRESS, 'session-nonce-replay');
      expect(second.status).toBe(401);
      expect(second.body.error).toBe('Signature nonce already used');
    });

    it('rejects a stale timestamp', async () => {
      setSignatureValid(true);
      const res = await request(app)
        .post('/api/v1/auth/session')
        .send({
          address: ADDRESS,
          nonce: 'session-nonce-stale',
          timestamp: Date.now() - 10 * 60 * 1000,
          signature: '0xsigned-session',
        });
      expect(res.status).toBe(401);
    });
  });

  describe('private read routes', () => {
    it('accept a valid bearer session without nonce/signature', async () => {
      const { body } = await createSession();
      signatureVerifyMock.mockClear();

      const res = await request(app)
        .get('/api/v1/orders')
        .query({ makerAddress: ADDRESS })
        .set(bearer(body.token));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ orders: [] });
      expect(signatureVerifyMock).not.toHaveBeenCalled();
      expect(orderService.getUserOrders).toHaveBeenCalledWith(
        ADDRESS,
        undefined,
        50,
        0,
      );
    });

    it('accept the bearer on other read routes (margin overview)', async () => {
      const { body } = await createSession();
      const res = await request(app)
        .get('/api/v1/margin')
        .query({ address: ADDRESS })
        .set(bearer(body.token));
      expect(res.status).toBe(200);
      expect(marginService.getOverview).toHaveBeenCalledWith(ADDRESS);
    });

    it('reject a session bound to a different address', async () => {
      const { body } = await createSession(OTHER_ADDRESS);
      const res = await request(app)
        .get('/api/v1/orders')
        .query({ makerAddress: ADDRESS })
        .set(bearer(body.token));
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Session not valid for this address');
      expect(orderService.getUserOrders).not.toHaveBeenCalled();
    });

    it('reject an expired token', async () => {
      const { token } = issueReadSessionToken(
        ADDRESS,
        Date.now() - 9 * 3600 * 1000,
      );
      expect(verifyReadSessionToken(token)).toEqual({
        ok: false,
        reason: 'expired',
      });
      const res = await request(app)
        .get('/api/v1/orders')
        .query({ makerAddress: ADDRESS })
        .set(bearer(token));
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid or expired session');
      expect(orderService.getUserOrders).not.toHaveBeenCalled();
    });

    it('reject a tampered token (sub swapped, signature kept)', async () => {
      const { body } = await createSession(OTHER_ADDRESS);
      const [prefix, payload, sig] = (body.token as string).split('.');
      const claims = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      );
      claims.sub = ADDRESS;
      const forged = `${prefix}.${Buffer.from(JSON.stringify(claims)).toString(
        'base64url',
      )}.${sig}`;

      expect(verifyReadSessionToken(forged)).toEqual({
        ok: false,
        reason: 'bad_signature',
      });
      const res = await request(app)
        .get('/api/v1/orders')
        .query({ makerAddress: ADDRESS })
        .set(bearer(forged));
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid or expired session');
      expect(orderService.getUserOrders).not.toHaveBeenCalled();
    });

    it('reject a revoked token', async () => {
      const { body } = await createSession();
      const ok = await request(app)
        .get('/api/v1/orders')
        .query({ makerAddress: ADDRESS })
        .set(bearer(body.token));
      expect(ok.status).toBe(200);

      const revoke = await request(app)
        .post('/api/v1/auth/session/revoke')
        .set(bearer(body.token));
      expect(revoke.status).toBe(200);
      expect(revoke.body).toEqual({ revoked: true });

      const after = await request(app)
        .get('/api/v1/orders')
        .query({ makerAddress: ADDRESS })
        .set(bearer(body.token));
      expect(after.status).toBe(401);

      const revokeAgain = await request(app)
        .post('/api/v1/auth/session/revoke')
        .set(bearer(body.token));
      expect(revokeAgain.status).toBe(401);
    });

    it('keep accepting the legacy per-request signature without a bearer', async () => {
      setSignatureValid(true);
      const res = await request(app).get('/api/v1/orders').query({
        makerAddress: ADDRESS,
        nonce: 'legacy-read-nonce-1',
        timestamp: Date.now(),
        signature: '0xsigned-read',
      });
      expect(res.status).toBe(200);
      expect(signatureVerifyMock).toHaveBeenCalledTimes(1);
      expect(String(signatureVerifyMock.mock.calls[0][0])).toContain(
        'lunex-auth:orders.list',
      );
    });

    it('still require nonce/signature when no bearer is presented', async () => {
      const res = await request(app)
        .get('/api/v1/orders')
        .query({ makerAddress: ADDRESS });
      expect(res.status).toBe(400);
      expect(orderService.getUserOrders).not.toHaveBeenCalled();
    });

    it('ignore non-session bearer tokens (e.g. admin secret)', async () => {
      const res = await request(app)
        .get('/api/v1/orders')
        .query({ makerAddress: ADDRESS })
        .set(bearer('some-admin-secret-value'));
      expect(res.status).toBe(400);
    });
  });

  describe('state-changing routes', () => {
    it('reject a bearer-only order placement (no wallet signature)', async () => {
      const { body } = await createSession();
      const res = await request(app)
        .post('/api/v1/orders')
        .set(bearer(body.token))
        .send({
          pairSymbol: 'LUNES/LUSDT',
          side: 'BUY',
          type: 'LIMIT',
          price: '1',
          amount: '1',
          makerAddress: ADDRESS,
        });
      expect(res.status).toBe(400);
      expect(orderService.createOrder).not.toHaveBeenCalled();
    });

    it('reject an order with a bad signature even when a valid bearer is presented', async () => {
      const { body } = await createSession();
      setSignatureValid(false);
      const res = await request(app)
        .post('/api/v1/orders')
        .set(bearer(body.token))
        .send({
          pairSymbol: 'LUNES/LUSDT',
          side: 'BUY',
          type: 'LIMIT',
          price: '1',
          amount: '1',
          makerAddress: ADDRESS,
          nonce: 'order-nonce-1',
          timestamp: Date.now(),
          signature: '0xforged',
        });
      expect(res.status).toBe(401);
      expect(orderService.createOrder).not.toHaveBeenCalled();
    });

    it('reject a bearer-only margin deposit', async () => {
      const { body } = await createSession();
      setSignatureValid(false);
      const res = await request(app)
        .post('/api/v1/margin/collateral/deposit')
        .set(bearer(body.token))
        .send({ address: ADDRESS, token: 'USDT', amount: '10' });
      expect([400, 401]).toContain(res.status);
      expect(marginService.depositCollateral).not.toHaveBeenCalled();
    });
  });
});
