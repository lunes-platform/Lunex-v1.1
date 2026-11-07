/**
 * Reward payouts must never be auto-re-paid when the outcome of a broadcast
 * transfer is unknown (timeout / dropped / RPC error after broadcast).
 *
 *  - transferNative signs with a mortal era, hands the hash to the caller
 *    BEFORE broadcasting, and reports UNKNOWN for ambiguous outcomes.
 *  - rewardDistributionService records SUBMITTED + hash before broadcast,
 *    UNKNOWN afterwards, and only FAILED (proven unpaid) rows are retried.
 *  - UNKNOWN / stale SUBMITTED rows are reconciled by hash from finalized
 *    blocks: success -> CONFIRMED, absent past the era / ExtrinsicFailed ->
 *    FAILED (retryable), era still open / chain unavailable -> untouched.
 */

jest.mock('../db', () => ({
  __esModule: true,
  default: {
    userReward: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

jest.mock('../config', () => ({
  config: {
    rewards: {
      enabled: true,
      rewardPoolPct: 20,
      leaderPoolPct: 40,
      traderPoolPct: 30,
      stakerPoolPct: 30,
      stakingContractAddress: 'staking-addr',
      stakingContractMetadataPath: './abis/Staking.json',
    },
    blockchain: { wsUrl: 'ws://127.0.0.1:9944', relayerSeed: '//Test' },
    socialAnalytics: { chainName: 'lunes' },
  },
}));

jest.mock('../utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import prisma from '../db';
import { rewardPayoutService } from '../services/rewardPayoutService';
import { rewardDistributionService } from '../services/rewardDistributionService';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPrisma = prisma as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const svc = rewardPayoutService as any;

const TX_HASH = '0xabc123';

type SendBehaviour = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cb: (result: any) => void,
) => Promise<() => void>;

function buildMockApi(opts: {
  send: SendBehaviour;
  finalizedNumber?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  blocks?: Record<number, { hashes: string[]; events?: any[] }>;
}) {
  const order: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extrinsic: any = {
    hash: { toHex: () => TX_HASH },
    signAsync: jest.fn(async (..._args: unknown[]) => {
      order.push('sign');
      return extrinsic;
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    send: jest.fn((cb: any) => {
      order.push('send');
      return opts.send(cb);
    }),
  };
  const finalizedNumber = opts.finalizedNumber ?? 100;
  const blocks = opts.blocks ?? {};
  const api = {
    registry: { createType: jest.fn(() => ({ isMortalEra: true })) },
    rpc: {
      chain: {
        getFinalizedHead: jest.fn(async () => ({ toHex: () => '0xfinal' })),
        getHeader: jest.fn(async () => ({
          number: { toNumber: () => finalizedNumber },
        })),
        getBlockHash: jest.fn(async (n: number) => ({
          toHex: () => `0xblock${n}`,
          n,
        })),
        getBlock: jest.fn(async (h: { n: number }) => ({
          block: {
            extrinsics: (blocks[h.n]?.hashes ?? []).map((x) => ({
              hash: { toHex: () => x },
            })),
          },
        })),
      },
    },
    at: jest.fn(async (h: { n: number }) => ({
      query: { system: { events: async () => blocks[h.n]?.events ?? [] } },
    })),
    tx: { balances: { transferKeepAlive: jest.fn(() => extrinsic) } },
  };
  return { api, extrinsic, order };
}

function eventRecord(index: number, method: string) {
  return {
    phase: {
      isApplyExtrinsic: true,
      asApplyExtrinsic: { toNumber: () => index },
    },
    event: { section: 'system', method, data: [] },
  };
}

function installApi(api: unknown) {
  svc.api = api;
  svc.relayer = { address: 'relayer' };
  svc.initPromise = Promise.resolve(true);
  jest
    .spyOn(rewardPayoutService, 'getRelayerBalance')
    .mockResolvedValue(BigInt(10) ** BigInt(20));
}

describe('rewardPayoutService.transferNative — ambiguous outcomes', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reports UNKNOWN with the hash when the tx times out after broadcast', async () => {
    const { api, extrinsic, order } = buildMockApi({
      send: async () => () => undefined, // never finalizes
    });
    installApi(api);
    const onBeforeBroadcast = jest.fn(async () => {
      order.push('persist');
    });

    const result = await rewardPayoutService.transferNative('dest', 5, {
      onBeforeBroadcast,
      timeoutMs: 20,
    });

    expect(result.outcome).toBe('UNKNOWN');
    expect(result.success).toBe(false);
    expect(result.txHash).toBe(TX_HASH);
    expect(result.submission).toEqual({
      txHash: TX_HASH,
      birthBlock: 100,
      mortality: 64,
    });
    expect(onBeforeBroadcast).toHaveBeenCalledWith(result.submission);
    // The hash is persisted strictly before the broadcast.
    expect(order).toEqual(['sign', 'persist', 'send']);
    // Signed with a mortal era anchored on the finalized head.
    const signOpts = (extrinsic.signAsync.mock.calls[0] as unknown[])[1] as {
      era: unknown;
      blockHash: unknown;
    };
    expect(signOpts.era).toEqual({ isMortalEra: true });
    expect(api.registry.createType).toHaveBeenCalledWith('ExtrinsicEra', {
      current: 100,
      period: 64,
    });
  });

  it('reports UNKNOWN when the RPC send itself errors after the hash was persisted', async () => {
    const { api } = buildMockApi({
      send: async () => {
        throw new Error('ws disconnected');
      },
    });
    installApi(api);

    const result = await rewardPayoutService.transferNative('dest', 5, {
      onBeforeBroadcast: async () => undefined,
      timeoutMs: 50,
    });

    expect(result.outcome).toBe('UNKNOWN');
    expect(result.txHash).toBe(TX_HASH);
  });

  it('reports UNKNOWN when the pool drops the tx', async () => {
    const { api } = buildMockApi({
      send: async (cb) => {
        setImmediate(() => cb({ status: { isDropped: true } }));
        return () => undefined;
      },
    });
    installApi(api);

    const result = await rewardPayoutService.transferNative('dest', 5, {
      timeoutMs: 200,
    });
    expect(result.outcome).toBe('UNKNOWN');
  });

  it('reports FAILED (definitive) for a finalized dispatch error', async () => {
    const { api } = buildMockApi({
      send: async (cb) => {
        setImmediate(() =>
          cb({
            status: { isFinalized: true },
            dispatchError: { toString: () => 'balances.InsufficientBalance' },
          }),
        );
        return () => undefined;
      },
    });
    installApi(api);

    const result = await rewardPayoutService.transferNative('dest', 5, {
      timeoutMs: 200,
    });
    expect(result.outcome).toBe('FAILED');
    expect(result.txHash).toBe(TX_HASH);
    expect(result.error).toContain('InsufficientBalance');
  });

  it('reports CONFIRMED only once finalized without a dispatch error', async () => {
    const { api } = buildMockApi({
      send: async (cb) => {
        setImmediate(() => cb({ status: { isInBlock: true } }));
        setImmediate(() => cb({ status: { isFinalized: true } }));
        return () => undefined;
      },
    });
    installApi(api);

    const result = await rewardPayoutService.transferNative('dest', 5, {
      timeoutMs: 200,
    });
    expect(result.outcome).toBe('CONFIRMED');
    expect(result.success).toBe(true);
    expect(result.txHash).toBe(TX_HASH);
  });

  it('never broadcasts when persisting the hash fails', async () => {
    const { api, extrinsic } = buildMockApi({
      send: async () => () => undefined,
    });
    installApi(api);

    const result = await rewardPayoutService.transferNative('dest', 5, {
      onBeforeBroadcast: async () => {
        throw new Error('claim lost');
      },
      timeoutMs: 20,
    });

    expect(extrinsic.send).not.toHaveBeenCalled();
    expect(result.outcome).toBe('FAILED');
    expect(result.txHash).toBeNull();
  });
});

describe('rewardPayoutService.reconcileTransfer — finalized blocks only', () => {
  afterEach(() => jest.restoreAllMocks());

  const submission = { txHash: TX_HASH, birthBlock: 100, mortality: 64 };

  it('INCLUDED_SUCCESS when the hash is in a finalized block with ExtrinsicSuccess', async () => {
    const { api } = buildMockApi({
      send: async () => () => undefined,
      finalizedNumber: 110,
      blocks: {
        103: {
          hashes: ['0xother', TX_HASH],
          events: [
            eventRecord(0, 'ExtrinsicSuccess'),
            eventRecord(1, 'ExtrinsicSuccess'),
          ],
        },
      },
    });
    installApi(api);

    const r = await rewardPayoutService.reconcileTransfer(submission);
    expect(r).toEqual({
      outcome: 'INCLUDED_SUCCESS',
      txHash: TX_HASH,
      blockHash: '0xblock103',
    });
  });

  it('INCLUDED_FAILED when the extrinsic applied with ExtrinsicFailed', async () => {
    const { api } = buildMockApi({
      send: async () => () => undefined,
      finalizedNumber: 110,
      blocks: {
        101: { hashes: [TX_HASH], events: [eventRecord(0, 'ExtrinsicFailed')] },
      },
    });
    installApi(api);

    const r = await rewardPayoutService.reconcileTransfer(submission);
    expect(r.outcome).toBe('INCLUDED_FAILED');
  });

  it('NOT_INCLUDED once the finalized head passed the era without the hash', async () => {
    const { api } = buildMockApi({
      send: async () => () => undefined,
      finalizedNumber: 165,
    });
    installApi(api);

    const r = await rewardPayoutService.reconcileTransfer(submission);
    expect(r).toEqual({ outcome: 'NOT_INCLUDED' });
  });

  it('PENDING while the era is still open', async () => {
    const { api } = buildMockApi({
      send: async () => () => undefined,
      finalizedNumber: 130,
    });
    installApi(api);

    const r = await rewardPayoutService.reconcileTransfer(submission);
    expect(r).toEqual({ outcome: 'PENDING' });
  });

  it('UNAVAILABLE when the chain cannot be read', async () => {
    const { api } = buildMockApi({ send: async () => () => undefined });
    api.rpc.chain.getFinalizedHead.mockRejectedValue(new Error('rpc down'));
    installApi(api);

    const r = await rewardPayoutService.reconcileTransfer(submission);
    expect(r.outcome).toBe('UNAVAILABLE');
  });
});

describe('rewardDistributionService — UNKNOWN payouts are never auto-re-paid', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    jest.spyOn(rewardPayoutService, 'isEnabled').mockReturnValue(true);
    mockPrisma.userReward.create.mockResolvedValue({ id: 'ur-1' });
    mockPrisma.userReward.update.mockResolvedValue({});
    mockPrisma.userReward.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.userReward.findFirst.mockResolvedValue(null);
    mockPrisma.userReward.findMany.mockResolvedValue([]);
    jest.spyOn(rewardDistributionService, 'rankLeaders').mockResolvedValue([
      {
        address: 'leader-a',
        score: 10,
        roi30d: 1,
        aum: 1,
        followers: 1,
        name: 'A',
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);
  });

  const submission = { txHash: TX_HASH, birthBlock: 100, mortality: 64 };

  it('persists SUBMITTED + hash before broadcast and records UNKNOWN on an ambiguous outcome', async () => {
    jest
      .spyOn(rewardPayoutService, 'transferNative')
      .mockImplementation(async (_to, _amt, options) => {
        await options?.onBeforeBroadcast?.(submission);
        return {
          success: false,
          outcome: 'UNKNOWN',
          txHash: TX_HASH,
          error: 'timeout',
          submission,
        };
      });

    await rewardDistributionService.distributeLeaderRewards(100, 'week-1');

    const calls = mockPrisma.userReward.updateMany.mock.calls.map(
      (c: unknown[]) => c[0],
    );
    // 1) claim + hash, guarded on the freshly created PENDING record
    expect(calls[0]).toEqual({
      where: { id: 'ur-1', payoutStatus: 'PENDING' },
      data: expect.objectContaining({
        payoutStatus: 'SUBMITTED',
        txHash: TX_HASH,
        payoutBirthBlock: 100,
        payoutMortality: 64,
        payoutSubmittedAt: expect.any(Date),
      }),
    });
    // 2) ambiguous outcome -> UNKNOWN, guarded on our own submission
    expect(calls[1]).toEqual({
      where: { id: 'ur-1', payoutStatus: 'SUBMITTED', txHash: TX_HASH },
      data: expect.objectContaining({
        payoutStatus: 'UNKNOWN',
        txHash: TX_HASH,
      }),
    });
  });

  it('records FAILED (retryable) when nothing was broadcast', async () => {
    jest.spyOn(rewardPayoutService, 'transferNative').mockResolvedValue({
      success: false,
      outcome: 'FAILED',
      txHash: null,
      error: 'Insufficient relayer balance',
    });

    await rewardDistributionService.distributeLeaderRewards(100, 'week-1');

    expect(mockPrisma.userReward.updateMany).toHaveBeenCalledWith({
      where: { id: 'ur-1', payoutStatus: 'PENDING' },
      data: expect.objectContaining({
        payoutStatus: 'FAILED',
        payoutError: 'Insufficient relayer balance',
      }),
    });
  });

  it('retryFailedPayouts only re-pays FAILED rows and claims them atomically', async () => {
    mockPrisma.userReward.findMany.mockImplementation(
      async (args: { where: { payoutStatus: unknown } }) => {
        if (args.where.payoutStatus === 'FAILED') {
          return [
            {
              id: 'ur-failed',
              walletAddress: 'w1',
              amount: '5',
              payoutStatus: 'FAILED',
            },
          ];
        }
        return [];
      },
    );
    const transfer = jest
      .spyOn(rewardPayoutService, 'transferNative')
      .mockImplementation(async (_to, _amt, options) => {
        await options?.onBeforeBroadcast?.(submission);
        return {
          success: true,
          outcome: 'CONFIRMED',
          txHash: TX_HASH,
          error: null,
          submission,
        };
      });

    const res = await rewardDistributionService.retryFailedPayouts(10);

    // The retry query never selects UNKNOWN / SUBMITTED rows.
    const retryQuery = mockPrisma.userReward.findMany.mock.calls.find(
      (c: Array<{ where: { payoutStatus: unknown } }>) =>
        c[0].where.payoutStatus === 'FAILED',
    );
    expect(retryQuery).toBeDefined();
    expect(transfer).toHaveBeenCalledTimes(1);
    expect(transfer.mock.calls[0][0]).toBe('w1');
    // CAS claim on FAILED at broadcast time (concurrent retries cannot both pay)
    expect(mockPrisma.userReward.updateMany).toHaveBeenCalledWith({
      where: { id: 'ur-failed', payoutStatus: 'FAILED' },
      data: expect.objectContaining({
        payoutStatus: 'SUBMITTED',
        txHash: TX_HASH,
      }),
    });
    expect(mockPrisma.userReward.updateMany).toHaveBeenCalledWith({
      where: { id: 'ur-failed', payoutStatus: 'SUBMITTED', txHash: TX_HASH },
      data: expect.objectContaining({ payoutStatus: 'CONFIRMED' }),
    });
    expect(res.retried).toBe(1);
  });

  it('reconciles UNKNOWN rows by hash and never re-pays them', async () => {
    const unknownRows = [
      {
        id: 'ur-ok',
        walletAddress: 'w-ok',
        amount: '5',
        payoutStatus: 'UNKNOWN',
        txHash: '0xok',
        payoutBirthBlock: 100,
        payoutMortality: 64,
      },
      {
        id: 'ur-gone',
        walletAddress: 'w-gone',
        amount: '5',
        payoutStatus: 'UNKNOWN',
        txHash: '0xgone',
        payoutBirthBlock: 100,
        payoutMortality: 64,
      },
      {
        id: 'ur-wait',
        walletAddress: 'w-wait',
        amount: '5',
        payoutStatus: 'UNKNOWN',
        txHash: '0xwait',
        payoutBirthBlock: 100,
        payoutMortality: 64,
      },
    ];
    mockPrisma.userReward.findMany.mockImplementation(
      async (args: { where: { payoutStatus?: unknown; OR?: unknown } }) =>
        args.where.payoutStatus === 'FAILED' ? [] : unknownRows,
    );
    const transfer = jest.spyOn(rewardPayoutService, 'transferNative');
    jest
      .spyOn(rewardPayoutService, 'reconcileTransfer')
      .mockImplementation(async (sub) => {
        if (sub.txHash === '0xok') {
          return {
            outcome: 'INCLUDED_SUCCESS',
            txHash: '0xok',
            blockHash: '0xb',
          };
        }
        if (sub.txHash === '0xgone') return { outcome: 'NOT_INCLUDED' };
        return { outcome: 'PENDING' };
      });

    const res = await rewardDistributionService.reconcileUnknownPayouts(10);

    expect(transfer).not.toHaveBeenCalled();
    expect(mockPrisma.userReward.updateMany).toHaveBeenCalledWith({
      where: { id: 'ur-ok', payoutStatus: 'UNKNOWN', txHash: '0xok' },
      data: expect.objectContaining({
        payoutStatus: 'CONFIRMED',
        payoutError: null,
      }),
    });
    expect(mockPrisma.userReward.updateMany).toHaveBeenCalledWith({
      where: { id: 'ur-gone', payoutStatus: 'UNKNOWN', txHash: '0xgone' },
      data: expect.objectContaining({ payoutStatus: 'FAILED' }),
    });
    const touchedWait = mockPrisma.userReward.updateMany.mock.calls.some(
      (c: Array<{ where: { id: string } }>) => c[0].where.id === 'ur-wait',
    );
    expect(touchedWait).toBe(false);
    expect(res).toEqual({ checked: 3, confirmed: 1, failed: 1, pending: 1 });
  });

  it('retryFailedPayouts reconciles first, so a NOT_INCLUDED row is retried only on a later run', async () => {
    const reconcile = jest
      .spyOn(rewardDistributionService, 'reconcileUnknownPayouts')
      .mockResolvedValue({ checked: 0, confirmed: 0, failed: 0, pending: 0 });

    await rewardDistributionService.retryFailedPayouts(10);

    expect(reconcile).toHaveBeenCalled();
  });
});
