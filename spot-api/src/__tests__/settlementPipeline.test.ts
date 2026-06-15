/**
 * Settlement throughput pipeline (Batching especialista).
 *
 * The spot_settlement contract has NO batch message — only single
 * `settle_trade(maker, taker, fill_amount, fill_price)`. To raise settlement
 * throughput above the ~1-trade-per-finalized-block ceiling, settleTrades()
 * pipelines submissions: up to MAX_SETTLE_CONCURRENCY extrinsics in flight at
 * once, each with a distinct relayer nonce, instead of awaiting isFinalized
 * one trade at a time.
 *
 * These tests prove the custody-grade invariants of that pipeline:
 *  - every trade maps to exactly ONE settle_trade extrinsic (no double-settle);
 *  - each in-flight extrinsic gets a DISTINCT, monotonically increasing nonce
 *    (so the node never silently drops a colliding submission);
 *  - results come back in input order;
 *  - one failing trade does NOT block or fail its siblings;
 *  - a failure invalidates the cached nonce so the pipeline re-seeds from chain
 *    (no permanent nonce gap);
 *  - concurrency is bounded by MAX_SETTLE_CONCURRENCY.
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

jest.mock('../utils/txWithTimeout', () => ({
  withTxTimeout: (_label: string, p: Promise<unknown>) => p,
}));

import {
  settlementService,
  TradeSettlementInput,
} from '../services/settlementService';

function makeWeightLike(refTime: bigint, proofSize: bigint) {
  return {
    refTime: { toBigInt: () => refTime },
    proofSize: { toBigInt: () => proofSize },
  };
}

function buildInput(id: string, makerNonce: string): TradeSettlementInput {
  return {
    tradeId: id,
    pair: {
      symbol: 'LUNES/USDT',
      baseToken: 'base-token',
      quoteToken: 'quote-token',
      isNativeBase: true,
      isNativeQuote: false,
      baseDecimals: 8,
    },
    makerOrder: {
      makerAddress: `maker-${id}`,
      side: 'SELL',
      type: 'LIMIT',
      price: '100',
      stopPrice: null,
      amount: '1',
      filledAmount: '0',
      nonce: makerNonce,
      signature: '0x' + 'ab'.repeat(64),
      signatureTimestamp: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: new Date('2026-02-01T00:00:00.000Z'),
    },
    takerOrder: {
      makerAddress: `taker-${id}`,
      side: 'BUY',
      type: 'MARKET',
      price: '100',
      stopPrice: null,
      amount: '1',
      filledAmount: '0',
      nonce: makerNonce + '1',
      signature: '0x' + 'cd'.repeat(64),
      signatureTimestamp: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: null,
    },
    fillAmount: '1',
    fillPrice: '100',
  };
}

type Submission = {
  tradeId: string;
  nonce: bigint;
};

describe('settlementService.settleTrades pipeline (Batching)', () => {
  const svc = settlementService as any;
  const gasRequired = makeWeightLike(123_000_000_000n, 2_000_000n);

  // Mutable knobs per test.
  let accountNextIndexCalls: number;
  let seedNonce: bigint;
  let submissions: Submission[];
  let inFlight: number;
  let maxInFlight: number;
  // tradeIds (by maker address suffix) that should fail at submit time.
  let failTradeIds: Set<string>;

  function installMocks() {
    const createTypeSpy = jest.fn((type: string, value: any) => {
      if (type === 'WeightV2') return makeWeightLike(value.refTime, value.proofSize);
      return { __type: type, value };
    });

    const api = {
      registry: { createType: createTypeSpy },
      createType: createTypeSpy,
      rpc: {
        system: {
          accountNextIndex: jest.fn(async (_addr: string) => {
            accountNextIndexCalls += 1;
            return { toString: () => seedNonce.toString() };
          }),
        },
      },
    };

    const settleQuery = jest.fn(() => ({
      gasRequired,
      result: { isErr: false, toString: () => 'ok' },
    }));

    // The settle tx mock derives which trade it is from the maker order arg
    // (4th positional after the gas object). It records the nonce it was given
    // and asserts concurrency by tracking in-flight count across an async tick.
    const settleTx = jest.fn(
      (_gas: unknown, makerOrder: any, _taker: unknown, _fa: unknown, _fp: unknown) => {
        const tradeId: string = makerOrder.__tradeId;
        return {
          signAndSend: (
            _signer: unknown,
            opts: { nonce: bigint },
            cb: (r: any) => void,
          ) => {
            submissions.push({ tradeId, nonce: opts.nonce });
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);

            // Resolve asynchronously so concurrent submissions actually
            // overlap (synchronous cb would serialize and hide concurrency).
            setTimeout(() => {
              inFlight -= 1;
              if (failTradeIds.has(tradeId)) {
                cb({
                  dispatchError: { toString: () => 'Module(NonceAlreadyUsed)' },
                  txHash: { toHex: () => '0xdead' },
                });
                return;
              }
              cb({
                status: { isInBlock: true, isFinalized: true },
                txHash: { toHex: () => `0x${tradeId}` },
              });
            }, 5);

            return Promise.resolve(() => undefined);
          },
        };
      },
    );

    const contract = {
      query: { settle_trade: settleQuery },
      tx: { settle_trade: settleTx },
    };

    svc.api = api;
    svc.contract = contract;
    svc.relayer = { address: 'relayer-address' };
    svc.settleMethodKey = 'settle_trade';
    svc.nextRelayerNonce = null;
    svc.nonceLock = Promise.resolve();

    jest.spyOn(svc, 'ensureReady').mockResolvedValue(true);
    jest.spyOn(svc, 'assertSettlementInputTrusted').mockResolvedValue(undefined);
    // toSignedOrder is signature-shaped; stub it to a marker carrying the
    // trade id so the tx mock can attribute submissions to a trade.
    jest
      .spyOn(svc, 'toSignedOrder')
      .mockImplementation((_pair: unknown, order: any) => ({
        __tradeId: order.makerAddress.replace(/^(maker|taker)-/, ''),
      }));
  }

  beforeEach(() => {
    accountNextIndexCalls = 0;
    seedNonce = 100n;
    submissions = [];
    inFlight = 0;
    maxInFlight = 0;
    failTradeIds = new Set();
    delete process.env.MAX_SETTLE_CONCURRENCY;
    installMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    svc.api = null;
    svc.contract = null;
    svc.relayer = null;
    svc.nextRelayerNonce = null;
    svc.nonceLock = Promise.resolve();
    delete process.env.MAX_SETTLE_CONCURRENCY;
  });

  it('settles every trade exactly once with a distinct, monotonic nonce', async () => {
    const inputs = Array.from({ length: 5 }, (_, i) =>
      buildInput(`t${i}`, `170000000000${i}`),
    );

    const results = await settlementService.settleTrades(inputs);

    expect(results).toHaveLength(5);
    expect(results.every((r) => r.status === 'SETTLED')).toBe(true);
    // Results preserve input order.
    expect(results.map((r) => r.tradeId)).toEqual(inputs.map((i) => i.tradeId));

    // Exactly one extrinsic per trade — no double-settle.
    expect(submissions).toHaveLength(5);
    const settledIds = submissions.map((s) => s.tradeId).sort();
    expect(settledIds).toEqual(['t0', 't1', 't2', 't3', 't4']);

    // Distinct, monotonically increasing nonces seeded from chain (100..104).
    const nonces = submissions.map((s) => s.nonce).sort((a, b) => Number(a - b));
    expect(nonces).toEqual([100n, 101n, 102n, 103n, 104n]);
    // No nonce reused.
    expect(new Set(nonces).size).toBe(5);
    // Seeded from chain exactly once for the whole successful batch.
    expect(accountNextIndexCalls).toBe(1);
  });

  it('isolates a single failure without blocking or failing siblings', async () => {
    failTradeIds = new Set(['t2']);
    const inputs = Array.from({ length: 4 }, (_, i) =>
      buildInput(`t${i}`, `170000000000${i}`),
    );

    const results = await settlementService.settleTrades(inputs);

    const byId = Object.fromEntries(results.map((r) => [r.tradeId, r]));
    expect(byId['t0'].status).toBe('SETTLED');
    expect(byId['t1'].status).toBe('SETTLED');
    expect(byId['t3'].status).toBe('SETTLED');
    expect(byId['t2'].status).toBe('FAILED');
    expect(byId['t2'].error).toContain('NonceAlreadyUsed');

    // All four were still attempted exactly once.
    expect(submissions).toHaveLength(4);
  });

  it('invalidates the cached nonce after a failure so the pipeline re-seeds', async () => {
    // First batch: one trade fails -> nonce cache invalidated.
    failTradeIds = new Set(['t0']);
    await settlementService.settleTrades([buildInput('t0', '1700000000000')]);
    expect(accountNextIndexCalls).toBe(1);

    // Second batch: success. Because the cache was invalidated, it must
    // re-seed from chain rather than reuse a stale (gapped) counter.
    failTradeIds = new Set();
    seedNonce = 200n;
    const results = await settlementService.settleTrades([
      buildInput('t1', '1700000000001'),
    ]);

    expect(results[0].status).toBe('SETTLED');
    expect(accountNextIndexCalls).toBe(2);
    expect(submissions[submissions.length - 1].nonce).toBe(200n);
  });

  it('bounds concurrency by MAX_SETTLE_CONCURRENCY', async () => {
    process.env.MAX_SETTLE_CONCURRENCY = '3';
    const inputs = Array.from({ length: 10 }, (_, i) =>
      buildInput(`t${i}`, `17000000000${i}0`),
    );

    await settlementService.settleTrades(inputs);

    expect(submissions).toHaveLength(10);
    // Never more than 3 extrinsics in flight at once.
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1);
  });
});
