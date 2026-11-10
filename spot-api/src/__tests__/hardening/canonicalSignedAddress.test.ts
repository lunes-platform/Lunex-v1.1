/**
 * M-09 (third pass) — request schemas canonicalize the wallet field, but the
 * client signed the `address:` line in its OWN encoding (hex, prefix 0, ...).
 * Routes must hand auth the string as sent so that line can be rebuilt,
 * while identity, nonce key and ban check stay on the canonical address.
 */
jest.mock('../../utils/redis', () => {
  const store = new Map<string, string>();
  const mockRedis = {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(
      async (
        key: string,
        value: string,
        _ex?: string,
        _ttl?: number,
        nx?: string,
      ) => {
        if (nx === 'NX' && store.has(key)) return null;
        store.set(key, value);
        return 'OK';
      },
    ),
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
    createOrder: jest.fn(),
    cancelOrder: jest.fn(async (id: string) => ({ id })),
    getUserOrders: jest.fn(async () => []),
  },
}));

jest.mock('../../services/marginService', () => ({
  marginService: {
    getOverview: jest.fn(async () => ({ ok: true })),
    depositCollateral: jest.fn(async () => ({ ok: true })),
    withdrawCollateral: jest.fn(async () => ({ ok: true })),
    openPosition: jest.fn(async () => ({ ok: true })),
    closePosition: jest.fn(async () => ({ ok: true })),
    liquidatePosition: jest.fn(async () => ({ ok: true })),
    getPriceHealth: jest.fn(),
    resetPriceHealthMonitor: jest.fn(),
  },
}));

jest.mock('../../services/tradeService', () => ({
  tradeService: {
    getUserTrades: jest.fn(async () => []),
    getRecentTrades: jest.fn(async () => []),
  },
}));

jest.mock('../../services/balanceService', () => ({
  balanceService: {
    getBalances: jest.fn(async () => []),
  },
}));

jest.mock('../../utils/redisRateLimit', () => ({
  checkRedisRateLimit: jest.fn(async () => ({ allowed: true })),
}));

import express from 'express';
import request from 'supertest';
import { Keyring } from '@polkadot/keyring';
import { u8aToHex } from '@polkadot/util';
import { cryptoWaitReady, encodeAddress } from '@polkadot/util-crypto';
import { config } from '../../config';
import {
  buildWalletActionMessage,
  verifyWalletActionSignature,
  verifyWalletReadSignature,
} from '../../middleware/auth';
import ordersRouter from '../../routes/orders';
import marginRouter from '../../routes/margin';
import tradesRouter from '../../routes/trades';
import balancesRouter from '../../routes/balances';
import { orderService } from '../../services/orderService';
import { marginService } from '../../services/marginService';
import { tradeService } from '../../services/tradeService';
import { balanceService } from '../../services/balanceService';
import { isSameAccount } from '../../utils/validation';
import { walletRiskService } from '../../services/walletRiskService';
import * as redisModule from '../../utils/redis';

const mockRedis = (
  redisModule as unknown as { __mockRedis: { _clear(): void } }
).__mockRedis;
const assertWalletCanAct = walletRiskService.assertWalletCanAct as jest.Mock;

const app = express();
app.use(express.json());
app.use('/api/v1/orders', ordersRouter);
app.use('/api/v1/margin', marginRouter);
app.use('/api/v1/trades', tradesRouter);
app.use('/api/v1/balances', balancesRouter);

type Pair = ReturnType<Keyring['addFromUri']>;
let pair: Pair;
let otherPair: Pair;
let generic: string;
const encodings: Record<string, string> = {};
const originalSigning = { ...config.signing };
let nonceSeq = 0;

beforeAll(async () => {
  await cryptoWaitReady();
  const keyring = new Keyring({ type: 'sr25519' });
  pair = keyring.addFromUri('//CanonicalSignedAddress');
  otherPair = keyring.addFromUri('//CanonicalSignedAddressOther');
  generic = encodeAddress(pair.publicKey, 42);
  const hexLower = u8aToHex(pair.publicKey);
  encodings['lower-case hex'] = hexLower;
  encodings['upper-case hex'] = `0x${hexLower.slice(2).toUpperCase()}`;
  encodings['prefix 0'] = encodeAddress(pair.publicKey, 0);
  encodings['prefix 2'] = encodeAddress(pair.publicKey, 2);
});

beforeEach(() => {
  mockRedis._clear();
  jest.clearAllMocks();
  config.signing.domain = 'lunex.lunes.io';
  config.signing.genesisHash = `0x${'ab'.repeat(32)}`;
  config.signing.acceptLegacy = false;
});

afterAll(() => {
  Object.assign(config.signing, originalSigning);
});

const LABELS = ['lower-case hex', 'upper-case hex', 'prefix 0', 'prefix 2'];

function sign(
  signer: Pair,
  action: string,
  address: string,
  fields: Record<string, string | number | undefined> = {},
) {
  const nonce = `ss58-nonce-${++nonceSeq}`;
  const timestamp = Date.now();
  const signature = u8aToHex(
    signer.sign(
      buildWalletActionMessage({ action, address, nonce, timestamp, fields }),
    ),
  );
  return { nonce, timestamp, signature };
}

describe('wallet actions signed over a non-42/57 address line', () => {
  it.each(LABELS)('DELETE /orders/:id accepts %s', async (label) => {
    const raw = encodings[label];
    const res = await request(app)
      .delete('/api/v1/orders/order-1')
      .send({
        makerAddress: raw,
        ...sign(pair, 'orders.cancel', raw, { orderId: 'order-1' }),
      });
    expect(res.status).toBe(200);
    expect(orderService.cancelOrder).toHaveBeenCalledWith('order-1', generic);
    expect(assertWalletCanAct).toHaveBeenCalledWith(generic);
  });

  it.each(LABELS)(
    'margin collateral deposit/withdraw accept %s',
    async (label) => {
      const raw = encodings[label];
      for (const [path, action] of [
        ['deposit', 'margin.collateral.deposit'],
        ['withdraw', 'margin.collateral.withdraw'],
      ]) {
        const res = await request(app)
          .post(`/api/v1/margin/collateral/${path}`)
          .send({
            address: raw,
            token: 'USDT',
            amount: '10',
            ...sign(pair, action, raw, { token: 'USDT', amount: '10' }),
          });
        expect(res.status).toBe(201);
      }
      expect(marginService.depositCollateral).toHaveBeenCalledWith(
        expect.objectContaining({ address: generic }),
      );
      expect(marginService.withdrawCollateral).toHaveBeenCalledWith(
        expect.objectContaining({ address: generic }),
      );
    },
  );

  it.each(LABELS)('margin open/close/liquidate accept %s', async (label) => {
    const raw = encodings[label];
    const open = await request(app)
      .post('/api/v1/margin/positions')
      .send({
        address: raw,
        pairSymbol: 'LUNES/USDT',
        side: 'BUY',
        collateralAmount: '10',
        leverage: '2',
        ...sign(pair, 'margin.position.open', raw, {
          pairSymbol: 'LUNES/USDT',
          side: 'BUY',
          collateralAmount: '10',
          leverage: '2',
        }),
      });
    expect(open.status).toBe(201);

    const close = await request(app)
      .post('/api/v1/margin/positions/pos-1/close')
      .send({
        address: raw,
        ...sign(pair, 'margin.position.close', raw, { positionId: 'pos-1' }),
      });
    expect(close.status).toBe(200);
    expect(marginService.closePosition).toHaveBeenCalledWith('pos-1', generic);

    const liquidate = await request(app)
      .post('/api/v1/margin/positions/pos-2/liquidate')
      .send({
        liquidatorAddress: raw,
        ...sign(pair, 'margin.position.liquidate', raw, {
          positionId: 'pos-2',
        }),
      });
    expect(liquidate.status).toBe(200);
    expect(marginService.liquidatePosition).toHaveBeenCalledWith(
      'pos-2',
      generic,
    );
  });

  it('another key signing over the victim address is still 401', async () => {
    const raw = encodings['lower-case hex'];
    const res = await request(app)
      .delete('/api/v1/orders/order-1')
      .send({
        makerAddress: raw,
        ...sign(otherPair, 'orders.cancel', raw, { orderId: 'order-1' }),
      });
    expect(res.status).toBe(401);
    expect(orderService.cancelOrder).not.toHaveBeenCalled();
  });
});

describe('signed reads over a non-42/57 address line', () => {
  it.each(LABELS)('GET /orders accepts %s', async (label) => {
    const raw = encodings[label];
    const signed = sign(pair, 'orders.list', raw, { limit: 50, offset: 0 });
    const res = await request(app)
      .get('/api/v1/orders')
      .query({ makerAddress: raw })
      .set('X-Lunex-Nonce', signed.nonce)
      .set('X-Lunex-Timestamp', String(signed.timestamp))
      .set('X-Lunex-Signature', signed.signature);
    expect(res.status).toBe(200);
    expect(orderService.getUserOrders).toHaveBeenCalledWith(
      generic,
      undefined,
      50,
      0,
    );
  });

  it.each(LABELS)('GET /margin accepts %s', async (label) => {
    const raw = encodings[label];
    const signed = sign(pair, 'margin.overview', raw);
    const res = await request(app)
      .get('/api/v1/margin')
      .query({ address: raw })
      .set('X-Lunex-Nonce', signed.nonce)
      .set('X-Lunex-Timestamp', String(signed.timestamp))
      .set('X-Lunex-Signature', signed.signature);
    expect(res.status).toBe(200);
    expect(marginService.getOverview).toHaveBeenCalledWith(generic);
  });
});

describe('signed trade and balance reads over a non-42/57 address line', () => {
  it.each(LABELS)('GET /trades accepts %s', async (label) => {
    const raw = encodings[label];
    const signed = sign(pair, 'trades.list', raw, { limit: 50, offset: 0 });
    const res = await request(app)
      .get('/api/v1/trades')
      .query({ address: raw })
      .set('X-Lunex-Nonce', signed.nonce)
      .set('X-Lunex-Timestamp', String(signed.timestamp))
      .set('X-Lunex-Signature', signed.signature);
    expect(res.status).toBe(200);
    expect(tradeService.getUserTrades).toHaveBeenCalledWith(generic, 50, 0);
  });

  it('GET /trades still rejects another key over the victim hex line', async () => {
    const raw = encodings['lower-case hex'];
    const signed = sign(otherPair, 'trades.list', raw, {
      limit: 50,
      offset: 0,
    });
    const res = await request(app)
      .get('/api/v1/trades')
      .query({ address: raw })
      .set('X-Lunex-Nonce', signed.nonce)
      .set('X-Lunex-Timestamp', String(signed.timestamp))
      .set('X-Lunex-Signature', signed.signature);
    expect(res.status).toBe(401);
    expect(tradeService.getUserTrades).not.toHaveBeenCalled();
  });

  it.each(LABELS)('GET /balances accepts %s', async (label) => {
    const raw = encodings[label];
    const signed = sign(pair, 'balances.list', raw);
    const res = await request(app)
      .get('/api/v1/balances')
      .query({ address: raw })
      .set('X-Lunex-Nonce', signed.nonce)
      .set('X-Lunex-Timestamp', String(signed.timestamp))
      .set('X-Lunex-Signature', signed.signature);
    expect(res.status).toBe(200);
    // The service canonicalizes; the route hands it the same account.
    const [address] = (balanceService.getBalances as jest.Mock).mock.calls[0];
    expect(isSameAccount(address, generic)).toBe(true);
  });

  it.each(LABELS)('GET /balances/:token accepts %s', async (label) => {
    const raw = encodings[label];
    const signed = sign(pair, 'balances.get', raw, { token: 'LUNES' });
    const res = await request(app)
      .get('/api/v1/balances/LUNES')
      .query({ address: raw })
      .set('X-Lunex-Nonce', signed.nonce)
      .set('X-Lunex-Timestamp', String(signed.timestamp))
      .set('X-Lunex-Signature', signed.signature);
    expect(res.status).toBe(200);
    const [address, token] = (balanceService.getBalances as jest.Mock).mock
      .calls[0];
    expect(isSameAccount(address, generic)).toBe(true);
    expect(token).toBe('LUNES');
  });
});

describe('auth: signedAddress only rebuilds the message', () => {
  const base = () => ({
    action: 'orders.cancel',
    fields: { orderId: 'o-1' },
  });

  it('verifies a hex-signed message while identity stays canonical', async () => {
    const raw = encodings['lower-case hex'];
    const input = base();
    const signed = sign(pair, input.action, raw, input.fields);
    const result = await verifyWalletActionSignature({
      ...input,
      ...signed,
      address: generic,
      signedAddress: raw,
    });
    expect(result.ok).toBe(true);
    expect(assertWalletCanAct).toHaveBeenCalledWith(generic);

    // Same nonce replayed under another encoding: canonical replay key.
    const replay = await verifyWalletActionSignature({
      ...input,
      ...signed,
      address: encodeAddress(pair.publicKey, 57),
      signedAddress: raw,
    });
    expect(replay).toEqual({
      ok: false,
      error: 'Signature nonce already used',
    });
  });

  it('ignores a signedAddress of another account', async () => {
    const otherHex = u8aToHex(otherPair.publicKey);
    const input = base();
    // The OTHER key signs over its own hex line and claims the victim.
    const signed = sign(otherPair, input.action, otherHex, input.fields);
    const result = await verifyWalletActionSignature({
      ...input,
      ...signed,
      address: generic,
      signedAddress: otherHex,
    });
    expect(result).toEqual({ ok: false, error: 'Invalid signature' });
    expect(assertWalletCanAct).not.toHaveBeenCalled();
  });

  it('read signatures accept signedAddress too', async () => {
    const raw = encodings['prefix 0'];
    const input = { ...base(), action: 'orders.read' };
    const signed = sign(pair, input.action, raw, input.fields);
    expect(
      (
        await verifyWalletReadSignature({
          ...input,
          ...signed,
          address: generic,
          signedAddress: raw,
        })
      ).ok,
    ).toBe(true);
  });
});
