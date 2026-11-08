/**
 * Settlement-time re-verification of order signatures must accept exactly the
 * formats intake accepts (verifySpotOrderSignature):
 *  - v3 (domain + genesis bound) always;
 *  - legacy v2 / v1 ONLY with SIGNING_ACCEPT_LEGACY.
 * Previously settlement tried v3 then fell back to v1 only, so a legitimately
 * accepted v2 order (legacy flag on, or open at deploy time) could never
 * settle. Real sr25519 signatures.
 */
jest.mock('../utils/logger', () => ({
  log: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

import { Keyring } from '@polkadot/keyring';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import { u8aToHex } from '@polkadot/util';
import { config } from '../config';
import {
  buildLegacySpotOrderMessage,
  buildSpotOrderMessage,
  buildSpotOrderMessageV2,
} from '../middleware/auth';
import { settlementService } from '../services/settlementService';

const GENESIS = `0x${'ab'.repeat(32)}`;
const OTHER_GENESIS = `0x${'cd'.repeat(32)}`;
const originalSigning = { ...config.signing };
const svc = settlementService as any;

let keypair: ReturnType<Keyring['addFromUri']>;

const pair = { symbol: 'LUNES/USDT' };
const TIMESTAMP = 1700000000123;

function messageInput() {
  return {
    pairSymbol: 'LUNES/USDT',
    side: 'BUY' as const,
    type: 'LIMIT' as const,
    price: '100',
    stopPrice: undefined,
    amount: '1',
    nonce: '1700000000001',
    timestamp: TIMESTAMP,
    timeInForce: 'GTC',
    expiresAt: null,
  };
}

function storedOrder(signature: string) {
  return {
    makerAddress: keypair.address,
    side: 'BUY',
    type: 'LIMIT',
    price: '100',
    stopPrice: null,
    amount: '1',
    filledAmount: '0',
    nonce: '1700000000001',
    signature,
    signatureTimestamp: new Date(TIMESTAMP),
    expiresAt: null,
    timeInForce: 'GTC',
  };
}

const sign = (message: string) => u8aToHex(keypair.sign(message));

beforeAll(async () => {
  await cryptoWaitReady();
  keypair = new Keyring({ type: 'sr25519' }).addFromUri('//SettlementSigTest');
});

beforeEach(() => {
  config.signing.domain = 'lunex.lunes.io';
  config.signing.genesisHash = GENESIS;
  config.signing.acceptLegacy = false;
});

afterAll(() => {
  Object.assign(config.signing, originalSigning);
});

describe('settlement re-verification of order signatures', () => {
  it('accepts a v3 (domain+genesis bound) order with legacy off', async () => {
    const order = storedOrder(sign(buildSpotOrderMessage(messageInput())));
    await expect(
      svc.assertOrderTrustedSource(pair, order),
    ).resolves.toBeUndefined();
  });

  it('rejects a v3 order signed for another chain', async () => {
    const order = storedOrder(
      sign(
        buildSpotOrderMessage(messageInput(), {
          domain: 'lunex.lunes.io',
          chain: OTHER_GENESIS,
        }),
      ),
    );
    await expect(svc.assertOrderTrustedSource(pair, order)).rejects.toThrow(
      'Invalid order signature',
    );
  });

  it('legacy v2: rejected without the flag, accepted with SIGNING_ACCEPT_LEGACY', async () => {
    const order = storedOrder(sign(buildSpotOrderMessageV2(messageInput())));

    await expect(svc.assertOrderTrustedSource(pair, order)).rejects.toThrow(
      'Invalid order signature',
    );

    config.signing.acceptLegacy = true;
    await expect(
      svc.assertOrderTrustedSource(pair, order),
    ).resolves.toBeUndefined();
  });

  it('legacy v1 (GTC, no expiry): only with SIGNING_ACCEPT_LEGACY', async () => {
    const order = storedOrder(
      sign(buildLegacySpotOrderMessage(messageInput())),
    );

    await expect(svc.assertOrderTrustedSource(pair, order)).rejects.toThrow(
      'Invalid order signature',
    );

    config.signing.acceptLegacy = true;
    await expect(
      svc.assertOrderTrustedSource(pair, order),
    ).resolves.toBeUndefined();
  });

  it('still rejects synthetic agent signatures before any crypto check', async () => {
    await expect(
      svc.assertOrderTrustedSource(pair, storedOrder('agent:agent-1')),
    ).rejects.toThrow('Synthetic agent signatures');
  });
});
