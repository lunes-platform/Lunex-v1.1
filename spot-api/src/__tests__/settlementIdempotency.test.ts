/**
 * spot_settlement is now idempotent per fill (same ABI; settle_trade keeps
 * selector 0xc1b65772): a repeat returns SpotError::TradeAlreadySettled and
 * `is_fill_settled(maker, taker, fill, price)` exposes the settled set.
 *
 *  - dry-run returning TradeAlreadySettled + is_fill_settled (finalized) true
 *    -> SETTLED without broadcasting (no funds move);
 *  - any other contract Err in the dry-run -> FAILED before broadcast;
 *  - a finalized dispatch error whose fill is settled -> SETTLED;
 *  - reconcileSubmission(submission, input): fill settled at the finalized
 *    head -> ALREADY_SETTLED (even if our own tx is absent / reverted /
 *    still in its era, since a late landing would revert);
 *  - is_fill_settled is read at the FINALIZED block via contractsApi.call.
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

import { settlementService } from '../services/settlementService';

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

const FIN_HASH = { toHex: () => '0xfinal' };

function contractOutput(json: unknown) {
  return { toJSON: () => json, toString: () => JSON.stringify(json) };
}

describe('settlementService idempotent settle_trade (TradeAlreadySettled)', () => {
  const svc = settlementService as any;
  let events: string[];
  let emissions: Emission[] | 'never';
  let dryRunOutput: unknown;
  let contractsApiCall: jest.Mock;
  let apiAt: jest.Mock;

  beforeEach(() => {
    events = [];
    emissions = [{ status: { isInBlock: true, isFinalized: true } }];
    dryRunOutput = undefined;

    const createType = jest.fn((type: string, value: any) => ({
      __type: type,
      value,
    }));
    contractsApiCall = jest.fn(async () => ({
      result: {
        isOk: true,
        asOk: {
          flags: { isRevert: false },
          data: { toU8a: () => new Uint8Array([0, 1]) },
        },
      },
    }));
    apiAt = jest.fn(async () => ({
      call: { contractsApi: { call: contractsApiCall } },
    }));
    svc.api = {
      registry: { createType },
      createType,
      at: apiAt,
      rpc: {
        system: {
          accountNextIndex: jest.fn(async () => ({ toString: () => '7' })),
        },
        chain: {
          getFinalizedHead: jest.fn(async () => FIN_HASH),
          getHeader: jest.fn(async () => ({
            number: { toNumber: () => FINALIZED_NUMBER },
          })),
          getBlockHash: jest.fn(async (n: number) => ({
            toHex: () => `0xb${n}`,
          })),
          getBlock: jest.fn(async () => ({ block: { extrinsics: [] } })),
        },
      },
    };
    const extrinsic: any = {
      hash: { toHex: () => '0xsignedhash' },
      signAsync: jest.fn(async () => {
        events.push('sign');
        return extrinsic;
      }),
      send: jest.fn((cb: (r: any) => void) => {
        events.push('send');
        if (emissions !== 'never') {
          const list = emissions;
          setTimeout(() => list.forEach((e) => cb(e)), 1);
        }
        return Promise.resolve(() => undefined);
      }),
    };
    const isFillSettledMessage = {
      identifier: 'is_fill_settled',
      method: 'isFillSettled',
      returnType: { lookupName: 'MessageResultBool', type: 'Result<bool>' },
      toU8a: jest.fn(() => new Uint8Array([0xfb, 0xd0, 0x8f, 0x57])),
    };
    svc.contract = {
      address: { toString: () => 'spot-contract' },
      abi: {
        messages: [isFillSettledMessage],
        registry: {
          createTypeUnsafe: jest.fn(() => contractOutput({ ok: true })),
        },
      },
      query: {
        settle_trade: jest.fn(async () => ({
          gasRequired: {
            refTime: { toBigInt: () => 1n },
            proofSize: { toBigInt: () => 1n },
          },
          result: { isErr: false },
          output: dryRunOutput,
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

  function setDryRun(json: unknown) {
    svc.contract.query.settle_trade = jest.fn(async () => ({
      gasRequired: {
        refTime: { toBigInt: () => 1n },
        proofSize: { toBigInt: () => 1n },
      },
      result: { isErr: false },
      output: contractOutput(json),
    }));
  }

  it('isFillSettled reads is_fill_settled at the FINALIZED head', async () => {
    const settled = await settlementService.isFillSettled(buildInput('t1'));

    expect(settled).toBe(true);
    expect(apiAt).toHaveBeenCalledWith(FIN_HASH);
    expect(contractsApiCall).toHaveBeenCalledTimes(1);
    const args = contractsApiCall.mock.calls[0] as unknown[];
    expect(args[0]).toBe('relayer');
    // encoded is_fill_settled call data
    expect(args[5]).toEqual(new Uint8Array([0xfb, 0xd0, 0x8f, 0x57]));
  });

  it('isFillSettled returns null when the contract has no is_fill_settled (legacy ABI)', async () => {
    svc.contract.abi.messages = [];
    await expect(
      settlementService.isFillSettled(buildInput('t1')),
    ).resolves.toBeNull();
  });

  it('dry-run TradeAlreadySettled + finalized is_fill_settled -> SETTLED, nothing broadcast', async () => {
    setDryRun({ ok: { err: 'TradeAlreadySettled' } });
    const onBeforeBroadcast = jest.fn(async () => undefined);

    const [result] = await settlementService.settleTrades([buildInput('t1')], {
      onBeforeBroadcast,
    });

    expect(result).toEqual(
      expect.objectContaining({
        tradeId: 't1',
        status: 'SETTLED',
        alreadySettled: true,
      }),
    );
    expect(result.txHash).toBeUndefined();
    expect(events).not.toContain('send');
    expect(onBeforeBroadcast).not.toHaveBeenCalled();
  });

  it('dry-run TradeAlreadySettled but not settled at the finalized head -> FAILED (retry later), nothing broadcast', async () => {
    setDryRun({ ok: { err: 'TradeAlreadySettled' } });
    jest.spyOn(settlementService, 'isFillSettled').mockResolvedValue(false);

    const [result] = await settlementService.settleTrades([buildInput('t1')]);

    expect(result.status).toBe('FAILED');
    expect(events).not.toContain('send');
  });

  it('any other contract Err in the dry-run fails BEFORE broadcast', async () => {
    setDryRun({ ok: { err: 'InsufficientBalance' } });

    const [result] = await settlementService.settleTrades([buildInput('t1')]);

    expect(result.status).toBe('FAILED');
    expect(result.error).toContain('InsufficientBalance');
    expect(events).not.toContain('send');
  });

  it('a successful dry-run still broadcasts', async () => {
    setDryRun({ ok: { ok: null } });

    const [result] = await settlementService.settleTrades([buildInput('t1')]);

    expect(result).toEqual(
      expect.objectContaining({ status: 'SETTLED', txHash: '0xsignedhash' }),
    );
    expect(events).toContain('send');
  });

  it('finalized dispatch error but fill settled on-chain -> SETTLED (no retry)', async () => {
    emissions = [
      {
        status: { isFinalized: true },
        dispatchError: { toString: () => 'contracts.ContractReverted' },
      },
    ];

    const [result] = await settlementService.settleTrades([buildInput('t1')]);

    expect(result).toEqual(
      expect.objectContaining({ status: 'SETTLED', alreadySettled: true }),
    );
  });

  it('finalized dispatch error and fill NOT settled -> FAILED', async () => {
    emissions = [
      {
        status: { isFinalized: true },
        dispatchError: { toString: () => 'contracts.ContractReverted' },
      },
    ];
    jest.spyOn(settlementService, 'isFillSettled').mockResolvedValue(false);

    const [result] = await settlementService.settleTrades([buildInput('t1')]);

    expect(result.status).toBe('FAILED');
  });

  describe('reconcileSubmission with is_fill_settled', () => {
    const submission = {
      txHash: '0xsignedhash',
      relayerNonce: 7,
      birthBlock: 990,
      mortality: 64,
    };

    it('ALREADY_SETTLED when the hash is absent but the fill is settled (era still open)', async () => {
      const verdict = await settlementService.reconcileSubmission(
        submission,
        buildInput('t1'),
      );
      expect(verdict).toEqual({ outcome: 'ALREADY_SETTLED' });
    });

    it('keeps PENDING when the fill is not settled and the era is open', async () => {
      jest.spyOn(settlementService, 'isFillSettled').mockResolvedValue(false);
      const verdict = await settlementService.reconcileSubmission(
        submission,
        buildInput('t1'),
      );
      expect(verdict).toEqual({ outcome: 'PENDING' });
    });

    it('without an input the old hash-only behaviour is unchanged', async () => {
      const isFill = jest.spyOn(settlementService, 'isFillSettled');
      const verdict = await settlementService.reconcileSubmission(submission);
      expect(verdict).toEqual({ outcome: 'PENDING' });
      expect(isFill).not.toHaveBeenCalled();
    });

    it('is_fill_settled unavailable (null) does not change the hash verdict', async () => {
      jest.spyOn(settlementService, 'isFillSettled').mockResolvedValue(null);
      svc.api.rpc.chain.getHeader = jest.fn(async () => ({
        number: { toNumber: () => 2000 },
      }));
      const verdict = await settlementService.reconcileSubmission(
        submission,
        buildInput('t1'),
      );
      expect(verdict).toEqual({ outcome: 'NOT_INCLUDED' });
    });
  });
});
