/**
 * Regression test for Bloqueador A: the Lunes pallet-contracts rejects the
 * polkadot.js sentinel `gasLimit: -1` with `contracts.OutOfGas`, so every
 * settle_trade / cancel_order_for / nonce / balance dry-run failed. The fix
 * passes an explicit generous WeightV2 to the dry-run and submits the real
 * extrinsic with the measured `gasRequired` (+50% margin).
 *
 * These tests prove the gas params on the settle/cancel paths are WeightV2
 * objects produced via `registry.createType('WeightV2', { refTime, proofSize })`
 * and never the `-1` sentinel.
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

// Keep the on-chain extrinsic resolution fast and deterministic.
jest.mock('../utils/txWithTimeout', () => ({
  withTxTimeout: (_label: string, p: Promise<unknown>) => p,
}));

import { settlementService } from '../services/settlementService';

type CapturedGas = {
  gasLimit: unknown;
  storageDepositLimit: unknown;
};

// A fake WeightV2 marker so we can recognise objects built via createType.
class FakeWeightV2 {
  public readonly __weightV2 = true;
  constructor(
    public readonly refTime: { toBigInt(): bigint },
    public readonly proofSize: { toBigInt(): bigint },
  ) {}
}

function makeWeight(refTime: bigint, proofSize: bigint) {
  return new FakeWeightV2(
    { toBigInt: () => refTime },
    { toBigInt: () => proofSize },
  );
}

function isWeightV2(value: unknown): value is FakeWeightV2 {
  return value instanceof FakeWeightV2;
}

describe('settlementService gas params (Bloqueador A regression)', () => {
  const svc = settlementService as any;

  // The dry-run returns a measured gasRequired (as a WeightV2-like object).
  const gasRequired = makeWeight(123_000_000_000n, 2_000_000n);

  let createTypeSpy: jest.Mock;
  let queryCancelGas: CapturedGas | null;
  let txCancelGas: CapturedGas | null;
  let querySettleGas: CapturedGas | null;
  let txSettleGas: CapturedGas | null;

  beforeEach(() => {
    queryCancelGas = null;
    txCancelGas = null;
    querySettleGas = null;
    txSettleGas = null;

    createTypeSpy = jest.fn((type: string, value: any) => {
      if (type === 'WeightV2') {
        return makeWeight(value.refTime, value.proofSize);
      }
      // AccountId etc. — return an opaque marker; identity does not matter.
      return { __type: type, value };
    });

    const api = {
      registry: { createType: createTypeSpy },
      createType: createTypeSpy,
      rpc: {
        system: {
          // Relayer nonce seed for the settle_trade pipeline.
          accountNextIndex: jest.fn(async () => ({ toString: () => '0' })),
        },
      },
    };

    // Build a tx-method mock that records the gas arg and resolves a finalized
    // extrinsic immediately via the signAndSend callback. Supports both the
    // 2-arg form `signAndSend(signer, cb)` (cancel path) and the 3-arg form
    // `signAndSend(signer, { nonce }, cb)` (pipelined settle path).
    const buildTxMethod = (record: (g: CapturedGas) => void) =>
      jest.fn((gas: CapturedGas) => {
        record(gas);
        return {
          signAndSend: (_signer: unknown, ...rest: any[]) => {
            const cb = (
              typeof rest[0] === 'function' ? rest[0] : rest[1]
            ) as (r: any) => void;
            cb({
              status: { isInBlock: true, isFinalized: true },
              txHash: { toHex: () => '0xfeed' },
            });
            return Promise.resolve(() => undefined);
          },
        };
      });

    const cancelQuery = jest.fn((_addr: string, gas: CapturedGas) => {
      queryCancelGas = gas;
      return { gasRequired, result: { isErr: false, toString: () => 'ok' } };
    });
    const settleQuery = jest.fn((_addr: string, gas: CapturedGas) => {
      querySettleGas = gas;
      return { gasRequired, result: { isErr: false, toString: () => 'ok' } };
    });

    const contract = {
      query: {
        settle_trade: settleQuery,
        cancel_order_for: cancelQuery,
        get_balance: jest.fn(),
        is_nonce_used: jest.fn(),
        is_nonce_cancelled: jest.fn(),
      },
      tx: {
        settle_trade: buildTxMethod((g) => (txSettleGas = g)),
        cancel_order_for: buildTxMethod((g) => (txCancelGas = g)),
      },
    };

    // Inject mocked internals onto the singleton, bypassing the real chain
    // connection (ensureReady short-circuits to true).
    svc.api = api;
    svc.contract = contract;
    svc.relayer = { address: 'relayer-address' };
    svc.settleMethodKey = 'settle_trade';
    svc.getBalanceMethodKey = 'get_balance';
    svc.isNonceUsedMethodKey = 'is_nonce_used';
    svc.isNonceCancelledMethodKey = 'is_nonce_cancelled';
    svc.cancelOrderForMethodKey = 'cancel_order_for';
    jest.spyOn(svc, 'ensureReady').mockResolvedValue(true);
    // Trust-source check is signature-specific; bypass for gas-only assertions.
    jest.spyOn(svc, 'assertSettlementInputTrusted').mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    svc.api = null;
    svc.contract = null;
    svc.relayer = null;
  });

  it('cancel_order_for dry-run uses an explicit WeightV2, never gasLimit:-1', async () => {
    await settlementService.cancelOrderFor('maker-address', '1700000000001');

    expect(queryCancelGas).not.toBeNull();
    expect(queryCancelGas!.gasLimit).not.toBe(-1);
    expect(isWeightV2(queryCancelGas!.gasLimit)).toBe(true);
    // Generous ceiling proven on-chain: refTime 600e9, proofSize 8e6.
    expect(createTypeSpy).toHaveBeenCalledWith('WeightV2', {
      refTime: 600_000_000_000n,
      proofSize: 8_000_000n,
    });
  });

  it('cancel_order_for real tx uses measured gasRequired + margin (WeightV2)', async () => {
    await settlementService.cancelOrderFor('maker-address', '1700000000001');

    expect(txCancelGas).not.toBeNull();
    expect(txCancelGas!.gasLimit).not.toBe(-1);
    expect(isWeightV2(txCancelGas!.gasLimit)).toBe(true);
    const w = txCancelGas!.gasLimit as FakeWeightV2;
    // +50% margin over the dry-run gasRequired.
    expect(w.refTime.toBigInt()).toBe((123_000_000_000n * 150n) / 100n);
    expect(w.proofSize.toBigInt()).toBe((2_000_000n * 150n) / 100n);
  });

  it('settle_trade dry-run + real tx use WeightV2, never gasLimit:-1', async () => {
    const input = {
      tradeId: 'trade-1',
      pair: {
        symbol: 'LUNES/USDT',
        baseToken: 'base-token',
        quoteToken: 'quote-token',
        isNativeBase: true,
        isNativeQuote: false,
        baseDecimals: 8,
      },
      makerOrder: {
        makerAddress: 'maker-1',
        side: 'SELL',
        type: 'LIMIT',
        price: '100',
        stopPrice: null,
        amount: '1',
        filledAmount: '0',
        nonce: '1700000000001',
        signature: '0x' + 'ab'.repeat(64),
        signatureTimestamp: new Date('2026-01-01T00:00:00.000Z'),
        expiresAt: new Date('2026-02-01T00:00:00.000Z'),
      },
      takerOrder: {
        makerAddress: 'maker-2',
        side: 'BUY',
        type: 'MARKET',
        price: '100',
        stopPrice: null,
        amount: '1',
        filledAmount: '0',
        nonce: '1700000000002',
        signature: '0x' + 'cd'.repeat(64),
        signatureTimestamp: new Date('2026-01-01T00:00:00.000Z'),
        expiresAt: null,
      },
      fillAmount: '1',
      fillPrice: '100',
    };

    const results = await settlementService.settleTrades([input]);

    expect(results[0].status).toBe('SETTLED');

    expect(querySettleGas).not.toBeNull();
    expect(querySettleGas!.gasLimit).not.toBe(-1);
    expect(isWeightV2(querySettleGas!.gasLimit)).toBe(true);

    expect(txSettleGas).not.toBeNull();
    expect(txSettleGas!.gasLimit).not.toBe(-1);
    expect(isWeightV2(txSettleGas!.gasLimit)).toBe(true);
  });

  it('nonce + balance read dry-runs use WeightV2, never gasLimit:-1', async () => {
    let usedGas: CapturedGas | null = null;
    let cancelledGas: CapturedGas | null = null;
    let balanceGas: CapturedGas | null = null;

    svc.contract.query.is_nonce_used = jest.fn(
      (_addr: string, gas: CapturedGas) => {
        usedGas = gas;
        return { output: { toString: () => 'false' }, result: { isErr: false } };
      },
    );
    svc.contract.query.is_nonce_cancelled = jest.fn(
      (_addr: string, gas: CapturedGas) => {
        cancelledGas = gas;
        return { output: { toString: () => 'false' }, result: { isErr: false } };
      },
    );
    svc.contract.query.get_balance = jest.fn(
      (_addr: string, gas: CapturedGas) => {
        balanceGas = gas;
        return { output: { toString: () => '0' }, result: { isErr: false } };
      },
    );

    await settlementService.isNonceUsed('user-address', '1700000000001');
    await settlementService.isNonceCancelled('user-address', '1700000000001');
    await settlementService.getVaultBalance('user-address', 'token-address', false);

    for (const g of [usedGas, cancelledGas, balanceGas]) {
      expect(g).not.toBeNull();
      expect((g as unknown as CapturedGas).gasLimit).not.toBe(-1);
      expect(isWeightV2((g as unknown as CapturedGas).gasLimit)).toBe(true);
    }
  });
});
