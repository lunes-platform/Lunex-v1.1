/**
 * BE-07: a settle_trade extrinsic that was broadcast must never be blindly
 * re-submitted, because the contract only guards cumulative fills per maker
 * nonce (a partial fill can be applied twice).
 *
 * settlementService guarantees:
 *  - the signed extrinsic hash + relayer nonce + mortal era (birth block,
 *    period) are handed to `onBeforeBroadcast` BEFORE the extrinsic is sent;
 *    if persisting fails, nothing is broadcast;
 *  - after broadcast, any non-definitive outcome (timeout, dropped, RPC error)
 *    is reported as UNKNOWN (ambiguous), never FAILED;
 *  - only definitive outcomes are FAILED: finalized dispatch error, Invalid,
 *    Usurped. A dispatch error in a non-finalized block is not final;
 *  - reconcileSubmission() resolves an ambiguous submission from finalized
 *    chain data only.
 */

jest.mock('../config', () => ({
  config: {
    blockchain: {
      wsUrl: 'ws://127.0.0.1:9944',
      spotContractAddress: '5G5nDqhgpwobxRK1Fhj4wcXA1Cpa9DxYreUCJsCTNV3MMBjt',
      spotContractMetadataPath: '/tmp/spot.json',
      relayerSeed: '//SpotRelayer',
      nativeTokenAddress: null,
    },
  },
}));

jest.mock('../utils/logger', () => ({
  log: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

// Short, deterministic timeout so "never finalizes" resolves quickly.
jest.mock('../utils/txWithTimeout', () => {
  class TxTimeoutError extends Error {}
  return {
    TxTimeoutError,
    DEFAULT_TX_TIMEOUT_MS: 60_000,
    withTxTimeout: (label: string, p: Promise<unknown>) =>
      Promise.race([
        p,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new TxTimeoutError(`${label} timed out`)),
            30,
          ),
        ),
      ]),
  };
});

import {
  settlementService,
  SETTLEMENT_TX_MORTALITY_BLOCKS,
} from '../services/settlementService';

type Status = Record<string, boolean>;
type Emission = { status: Status; dispatchError?: { toString(): string } };

const FINALIZED_NUMBER = 1000;

function buildInput(tradeId: string) {
  const order = (addr: string, side: string) => ({
    makerAddress: addr,
    side,
    type: 'LIMIT',
    price: '1',
    amount: '1',
    filledAmount: '0',
    nonce: '1700000000001',
    signature: '0x' + 'ab'.repeat(64),
    signatureTimestamp: new Date(),
    expiresAt: null,
  });
  return {
    tradeId,
    pair: {
      symbol: 'LUNES/USDT',
      baseToken: 'base',
      quoteToken: 'quote',
      isNativeBase: false,
      isNativeQuote: false,
      baseDecimals: 8,
      quoteDecimals: 6,
    },
    makerOrder: order('maker', 'SELL'),
    takerOrder: order('taker', 'BUY'),
    fillAmount: '1',
    fillPrice: '1',
  };
}

describe('settlementService submission safety (BE-07)', () => {
  const svc = settlementService as any;
  let events: string[];
  let emissions: Emission[] | 'never' | 'reject';
  let signOptions: any;

  beforeEach(() => {
    events = [];
    emissions = [{ status: { isInBlock: true, isFinalized: true } }];
    signOptions = null;

    const createType = jest.fn((type: string, value: any) => ({
      __type: type,
      value,
    }));
    svc.api = {
      registry: { createType },
      createType,
      rpc: {
        system: {
          accountNextIndex: jest.fn(async () => ({ toString: () => '7' })),
        },
        chain: {
          getFinalizedHead: jest.fn(async () => ({ toHex: () => '0xfinal' })),
          getHeader: jest.fn(async () => ({
            number: { toNumber: () => FINALIZED_NUMBER },
          })),
        },
      },
    };
    const extrinsic: any = {
      hash: { toHex: () => '0xsignedhash' },
      signAsync: jest.fn(async (_signer: unknown, opts: unknown) => {
        events.push('sign');
        signOptions = opts;
        return extrinsic;
      }),
      send: jest.fn((cb: (r: any) => void) => {
        events.push('send');
        if (emissions === 'reject') {
          return Promise.reject(new Error('ws disconnected'));
        }
        if (emissions !== 'never') {
          const list = emissions;
          setTimeout(() => {
            for (const e of list) {
              cb({ ...e, txHash: { toHex: () => '0xsignedhash' } });
            }
          }, 1);
        }
        return Promise.resolve(() => undefined);
      }),
    };
    svc.contract = {
      query: {
        settle_trade: jest.fn(async () => ({
          gasRequired: {
            refTime: { toBigInt: () => 1n },
            proofSize: { toBigInt: () => 1n },
          },
          result: { isErr: false },
        })),
      },
      tx: { settle_trade: jest.fn(() => extrinsic) },
    };
    svc.relayer = { address: 'relayer' };
    svc.settleMethodKey = 'settle_trade';
    svc.nextRelayerNonce = null;
    svc.nonceLock = Promise.resolve();
    jest.spyOn(svc, 'ensureReady').mockResolvedValue(true);
    jest
      .spyOn(svc, 'assertSettlementInputTrusted')
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    svc.api = null;
    svc.contract = null;
    svc.relayer = null;
  });

  it('persists the signed hash/nonce/era via onBeforeBroadcast before sending', async () => {
    const onBeforeBroadcast = jest.fn(async () => {
      events.push('persist');
    });

    const [result] = await settlementService.settleTrades([buildInput('t1')], {
      onBeforeBroadcast,
    });

    expect(result).toEqual(
      expect.objectContaining({ status: 'SETTLED', txHash: '0xsignedhash' }),
    );
    expect(events).toEqual(['sign', 'persist', 'send']);
    expect(onBeforeBroadcast).toHaveBeenCalledWith('t1', {
      txHash: '0xsignedhash',
      relayerNonce: 7,
      birthBlock: FINALIZED_NUMBER,
      mortality: SETTLEMENT_TX_MORTALITY_BLOCKS,
    });
    // Mortal era anchored on the finalized head we recorded.
    expect(signOptions).toEqual(
      expect.objectContaining({
        nonce: 7n,
        blockHash: expect.objectContaining({}),
        era: expect.objectContaining({
          __type: 'ExtrinsicEra',
          value: {
            current: FINALIZED_NUMBER,
            period: SETTLEMENT_TX_MORTALITY_BLOCKS,
          },
        }),
      }),
    );
  });

  it('does not broadcast when persisting the submission fails', async () => {
    const [result] = await settlementService.settleTrades([buildInput('t1')], {
      onBeforeBroadcast: async () => {
        throw new Error('superseded');
      },
    });

    expect(result.status).toBe('FAILED');
    expect(events).not.toContain('send');
  });

  it('reports a timeout after broadcast as UNKNOWN (never FAILED) with the submission', async () => {
    emissions = 'never';

    const [result] = await settlementService.settleTrades([buildInput('t1')], {
      onBeforeBroadcast: async () => undefined,
    });

    expect(result.status).toBe('UNKNOWN');
    expect(result.submission).toEqual(
      expect.objectContaining({ txHash: '0xsignedhash', relayerNonce: 7 }),
    );
  });

  it('reports a broadcast RPC error as UNKNOWN (it may have reached the pool)', async () => {
    emissions = 'reject';

    const [result] = await settlementService.settleTrades([buildInput('t1')]);

    expect(result.status).toBe('UNKNOWN');
  });

  it('a dispatch error in a non-finalized block is not final; finalized error is FAILED', async () => {
    emissions = [
      {
        status: { isInBlock: true, isFinalized: false },
        dispatchError: { toString: () => 'Module(FillExceedsRemaining)' },
      },
      {
        status: { isInBlock: false, isFinalized: true },
        dispatchError: { toString: () => 'Module(FillExceedsRemaining)' },
      },
    ];

    const [result] = await settlementService.settleTrades([buildInput('t1')]);

    expect(result.status).toBe('FAILED');
    expect(result.error).toContain('FillExceedsRemaining');
  });

  it('Invalid / Usurped are definitive FAILED (extrinsic can never land)', async () => {
    emissions = [{ status: { isInvalid: true } }];
    const [invalid] = await settlementService.settleTrades([buildInput('t1')]);
    expect(invalid.status).toBe('FAILED');

    emissions = [{ status: { isUsurped: true } }];
    const [usurped] = await settlementService.settleTrades([buildInput('t2')]);
    expect(usurped.status).toBe('FAILED');
  });

  it('Dropped is ambiguous → UNKNOWN', async () => {
    emissions = [{ status: { isDropped: true } }];
    const [result] = await settlementService.settleTrades([buildInput('t1')]);
    expect(result.status).toBe('UNKNOWN');
  });
});

describe('settlementService.reconcileSubmission (BE-07)', () => {
  const svc = settlementService as any;
  const submission = {
    txHash: '0xours',
    relayerNonce: 7,
    birthBlock: 100,
    mortality: 64,
  };
  let finalizedNumber: number;
  let blocks: Record<number, string[]>;
  let eventsByBlock: Record<number, any[]>;

  beforeEach(() => {
    finalizedNumber = 200;
    blocks = {};
    eventsByBlock = {};
    svc.api = {
      rpc: {
        chain: {
          getFinalizedHead: jest.fn(async () => ({ toHex: () => '0xfin' })),
          getHeader: jest.fn(async () => ({
            number: { toNumber: () => finalizedNumber },
          })),
          getBlockHash: jest.fn(async (n: number) => ({
            toHex: () => `0xblock${n}`,
            __n: n,
          })),
          getBlock: jest.fn(async (hash: { __n: number }) => ({
            block: {
              extrinsics: (blocks[hash.__n] ?? []).map((h) => ({
                hash: { toHex: () => h },
              })),
            },
          })),
        },
      },
      at: jest.fn(async (hash: { __n: number }) => ({
        query: {
          system: {
            events: jest.fn(async () => eventsByBlock[hash.__n] ?? []),
          },
        },
      })),
    };
    svc.relayer = { address: 'relayer' };
    jest.spyOn(svc, 'ensureReady').mockResolvedValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    svc.api = null;
    svc.relayer = null;
  });

  const applyEvent = (index: number, method: string) => ({
    phase: {
      isApplyExtrinsic: true,
      asApplyExtrinsic: { toNumber: () => index },
    },
    event: { section: 'system', method, data: [] },
  });

  it('INCLUDED_SUCCESS when the hash is in a finalized block with ExtrinsicSuccess', async () => {
    blocks[130] = ['0xother', '0xours'];
    eventsByBlock[130] = [
      applyEvent(0, 'ExtrinsicSuccess'),
      applyEvent(1, 'ExtrinsicSuccess'),
    ];

    await expect(svc.reconcileSubmission(submission)).resolves.toEqual({
      outcome: 'INCLUDED_SUCCESS',
      txHash: '0xours',
      blockHash: '0xblock130',
    });
  });

  it('INCLUDED_FAILED when the extrinsic was included but failed', async () => {
    blocks[101] = ['0xours'];
    eventsByBlock[101] = [applyEvent(0, 'ExtrinsicFailed')];

    await expect(svc.reconcileSubmission(submission)).resolves.toEqual(
      expect.objectContaining({ outcome: 'INCLUDED_FAILED' }),
    );
  });

  it('NOT_INCLUDED only once the finalized head is past birth + mortality', async () => {
    finalizedNumber = 100 + 64 + 1;
    await expect(svc.reconcileSubmission(submission)).resolves.toEqual({
      outcome: 'NOT_INCLUDED',
    });
  });

  it('PENDING while the mortal era is still open (may still land)', async () => {
    finalizedNumber = 150;
    await expect(svc.reconcileSubmission(submission)).resolves.toEqual({
      outcome: 'PENDING',
    });
  });
});
