/**
 * BE-07 (orchestration): a trade whose settle_trade extrinsic may still land
 * is never re-submitted.
 *
 *  - the submission marker (hash, nonce, era) is persisted before broadcast,
 *    guarded by the claim (status SETTLING + attempt number + no marker), so a
 *    superseded worker cannot broadcast;
 *  - an UNKNOWN outcome parks the trade in RECONCILE_REQUIRED (no retry
 *    schedule) instead of FAILED;
 *  - results are applied with an optimistic guard on settlementAttempts;
 *  - stale SETTLING trades with a marker are reconciled, never re-claimed;
 *  - reconciliation resolves from finalized chain data: SETTLED / retryable
 *    FAILED / still pending;
 *  - STALE_SETTLING_MS strictly exceeds the tx timeout + finality margin.
 */

const mockPrisma: any = {
  trade: {
    update: jest.fn(),
    updateMany: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(mockPrisma)),
};

const mockSettlementService = {
  isEnabled: jest.fn(() => true),
  settleTrades: jest.fn(),
  reconcileSubmission: jest.fn(),
};

const mockAffiliate = { distributeSpotTradeCommissions: jest.fn() };

jest.mock('../db', () => ({ __esModule: true, default: mockPrisma }));
jest.mock('../services/settlementService', () => ({
  settlementService: mockSettlementService,
}));
jest.mock('../services/affiliateService', () => ({
  affiliateService: mockAffiliate,
}));
jest.mock('../utils/logger', () => ({
  log: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

import {
  tradeSettlementService,
  STALE_SETTLING_MS,
  SETTLEMENT_FINALITY_MARGIN_MS,
} from '../services/tradeSettlementService';
import { DEFAULT_TX_TIMEOUT_MS } from '../utils/txWithTimeout';

const input = {
  tradeId: 'trade-1',
  pair: {
    symbol: 'LUNES/USDT',
    baseToken: 'b',
    quoteToken: 'q',
    isNativeBase: false,
    isNativeQuote: false,
    baseDecimals: 8,
    quoteDecimals: 6,
  },
  makerOrder: {
    makerAddress: 'm',
    side: 'SELL',
    type: 'LIMIT',
    price: '1',
    amount: '1',
    filledAmount: '0',
    nonce: '1',
    signature: '0xsig',
    expiresAt: null,
    signatureTimestamp: null,
  },
  takerOrder: {
    makerAddress: 't',
    side: 'BUY',
    type: 'LIMIT',
    price: '1',
    amount: '1',
    filledAmount: '0',
    nonce: '2',
    signature: '0xsig',
    expiresAt: null,
    signatureTimestamp: null,
  },
  fillAmount: '1',
  fillPrice: '1',
};

const submission = {
  txHash: '0xours',
  relayerNonce: 7,
  birthBlock: 100,
  mortality: 64,
};

function updateManyCalls(): any[] {
  return mockPrisma.trade.updateMany.mock.calls.map((c: any[]) => c[0]);
}

describe('tradeSettlementService BE-07', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettlementService.isEnabled.mockReturnValue(true);
    mockPrisma.trade.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.trade.findUnique.mockResolvedValue({
      id: 'trade-1',
      settlementAttempts: 3,
    });
    mockPrisma.trade.findMany.mockResolvedValue([]);
  });

  it('stale-SETTLING window strictly exceeds tx timeout + finality margin', () => {
    expect(SETTLEMENT_FINALITY_MARGIN_MS).toBeGreaterThan(0);
    expect(STALE_SETTLING_MS).toBeGreaterThan(
      DEFAULT_TX_TIMEOUT_MS + SETTLEMENT_FINALITY_MARGIN_MS,
    );
  });

  it('persists the submission marker guarded by the claim before broadcast', async () => {
    mockSettlementService.settleTrades.mockImplementation(
      async (inputs: any[], hooks: any) => {
        await hooks.onBeforeBroadcast(inputs[0].tradeId, submission);
        return [{ tradeId: 'trade-1', status: 'SETTLED', txHash: '0xours' }];
      },
    );

    await tradeSettlementService.processNewTradeSettlements([input]);

    expect(updateManyCalls()).toContainEqual({
      where: {
        id: 'trade-1',
        settlementStatus: 'SETTLING',
        settlementAttempts: 3,
        submittedTxHash: null,
      },
      data: {
        submittedTxHash: '0xours',
        submittedRelayerNonce: 7,
        submittedBirthBlock: 100,
        submittedMortality: 64,
        submittedAt: expect.any(Date),
      },
    });
  });

  it('the hook throws (no broadcast) when the claim was superseded', async () => {
    let hookError: unknown = null;
    mockSettlementService.settleTrades.mockImplementation(
      async (inputs: any[], hooks: any) => {
        mockPrisma.trade.updateMany.mockResolvedValueOnce({ count: 0 });
        try {
          await hooks.onBeforeBroadcast(inputs[0].tradeId, submission);
        } catch (err) {
          hookError = err;
        }
        return [{ tradeId: 'trade-1', status: 'FAILED', error: 'superseded' }];
      },
    );

    await tradeSettlementService.processNewTradeSettlements([input]);

    expect(hookError).toBeInstanceOf(Error);
  });

  it('UNKNOWN outcome → RECONCILE_REQUIRED, no retry schedule, no commission', async () => {
    mockSettlementService.settleTrades.mockResolvedValue([
      {
        tradeId: 'trade-1',
        status: 'UNKNOWN',
        error: 'timed out',
        submission,
      },
    ]);

    await tradeSettlementService.processNewTradeSettlements([input]);

    expect(updateManyCalls()).toContainEqual({
      where: { id: 'trade-1', settlementAttempts: 3 },
      data: expect.objectContaining({
        settlementStatus: 'RECONCILE_REQUIRED',
        nextSettlementRetryAt: null,
      }),
    });
    const statuses = updateManyCalls().map((c) => c.data.settlementStatus);
    expect(statuses).not.toContain('FAILED');
    expect(mockAffiliate.distributeSpotTradeCommissions).not.toHaveBeenCalled();
  });

  it('definitive FAILED clears the submission marker so a retry is safe', async () => {
    mockSettlementService.settleTrades.mockResolvedValue([
      { tradeId: 'trade-1', status: 'FAILED', error: 'Invalid' },
    ]);

    await tradeSettlementService.processNewTradeSettlements([input]);

    expect(updateManyCalls()).toContainEqual({
      where: { id: 'trade-1', settlementAttempts: 3 },
      data: expect.objectContaining({
        settlementStatus: 'FAILED',
        submittedTxHash: null,
        submittedRelayerNonce: null,
        submittedBirthBlock: null,
        submittedMortality: null,
        submittedAt: null,
      }),
    });
  });

  it('never re-claims a stale SETTLING trade that carries a submission marker', async () => {
    mockSettlementService.settleTrades.mockResolvedValue([]);
    mockPrisma.trade.updateMany.mockResolvedValue({ count: 0 });

    await tradeSettlementService.processNewTradeSettlements([input]);

    const claim = updateManyCalls()[0];
    expect(claim.where.OR).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          settlementStatus: 'SETTLING',
          submittedTxHash: null,
        }),
      ]),
    );
    for (const branch of claim.where.OR) {
      expect(branch).toEqual(
        expect.objectContaining({ submittedTxHash: null }),
      );
    }
  });

  describe('retryPendingSettlements reconciliation', () => {
    const parked = {
      id: 'trade-1',
      settlementStatus: 'RECONCILE_REQUIRED',
      settlementAttempts: 3,
      submittedTxHash: '0xours',
      submittedRelayerNonce: 7,
      submittedBirthBlock: 100,
      submittedMortality: 64,
    };

    function arrange(outcome: unknown) {
      // 1st findMany: reconciliation candidates; 2nd: normal retry query.
      mockPrisma.trade.findMany
        .mockResolvedValueOnce([parked])
        .mockResolvedValueOnce([]);
      mockSettlementService.reconcileSubmission.mockResolvedValue(outcome);
    }

    it('selects RECONCILE_REQUIRED and stale-SETTLING-with-marker trades, excludes them from resubmission', async () => {
      arrange({ outcome: 'PENDING' });

      await tradeSettlementService.retryPendingSettlements();

      const [reconcileQuery, retryQuery] =
        mockPrisma.trade.findMany.mock.calls.map((c: any[]) => c[0]);
      expect(reconcileQuery.where.OR).toEqual(
        expect.arrayContaining([
          { settlementStatus: 'RECONCILE_REQUIRED' },
          expect.objectContaining({
            settlementStatus: 'SETTLING',
            submittedTxHash: { not: null },
          }),
        ]),
      );
      for (const branch of retryQuery.where.OR) {
        expect(branch).toEqual(
          expect.objectContaining({ submittedTxHash: null }),
        );
      }
    });

    it('PENDING (era still open): nothing is re-submitted or changed', async () => {
      arrange({ outcome: 'PENDING' });

      const result = await tradeSettlementService.retryPendingSettlements();

      expect(mockSettlementService.settleTrades).not.toHaveBeenCalled();
      expect(mockPrisma.trade.updateMany).not.toHaveBeenCalled();
      expect(result).toEqual(
        expect.objectContaining({ processed: 0, reconciled: 0 }),
      );
    });

    it('INCLUDED_SUCCESS → SETTLED with the on-chain hash + commission credit', async () => {
      arrange({
        outcome: 'INCLUDED_SUCCESS',
        txHash: '0xours',
        blockHash: '0xb',
      });

      const result = await tradeSettlementService.retryPendingSettlements();

      expect(updateManyCalls()).toContainEqual({
        where: {
          id: 'trade-1',
          settlementAttempts: 3,
          submittedTxHash: '0xours',
        },
        data: expect.objectContaining({
          settlementStatus: 'SETTLED',
          txHash: '0xours',
          settledAt: expect.any(Date),
          settlementError: null,
        }),
      });
      expect(mockAffiliate.distributeSpotTradeCommissions).toHaveBeenCalledWith(
        ['trade-1'],
      );
      expect(mockSettlementService.settleTrades).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ reconciled: 1 }));
    });

    it('passes the persisted trade payload so is_fill_settled can be consulted', async () => {
      mockPrisma.trade.findMany
        .mockResolvedValueOnce([
          {
            ...parked,
            settlementPayload: {
              ...input,
              makerOrder: { ...input.makerOrder },
              takerOrder: { ...input.takerOrder },
            },
          },
        ])
        .mockResolvedValueOnce([]);
      mockSettlementService.reconcileSubmission.mockResolvedValue({
        outcome: 'PENDING',
      });

      await tradeSettlementService.retryPendingSettlements();

      const [reconcileQuery] = mockPrisma.trade.findMany.mock.calls.map(
        (c: any[]) => c[0],
      );
      expect(reconcileQuery.select).toEqual(
        expect.objectContaining({ settlementPayload: true }),
      );
      expect(mockSettlementService.reconcileSubmission).toHaveBeenCalledWith(
        submission,
        expect.objectContaining({ tradeId: 'trade-1', fillAmount: '1' }),
      );
    });

    it('ALREADY_SETTLED (fill settled at finalized head) → SETTLED, hash untouched, never re-submitted', async () => {
      arrange({ outcome: 'ALREADY_SETTLED' });

      const result = await tradeSettlementService.retryPendingSettlements();

      const settled = updateManyCalls().find(
        (c) => c.data.settlementStatus === 'SETTLED',
      );
      expect(settled).toEqual({
        where: {
          id: 'trade-1',
          settlementAttempts: 3,
          submittedTxHash: '0xours',
        },
        data: expect.objectContaining({
          settlementStatus: 'SETTLED',
          settledAt: expect.any(Date),
          settlementError: null,
        }),
      });
      // We do not know which extrinsic settled the fill: keep txHash as is.
      expect(settled.data).not.toHaveProperty('txHash');
      expect(mockAffiliate.distributeSpotTradeCommissions).toHaveBeenCalledWith(
        ['trade-1'],
      );
      expect(mockSettlementService.settleTrades).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ reconciled: 1 }));
    });

    it('an alreadySettled SETTLED result does not overwrite txHash', async () => {
      mockSettlementService.settleTrades.mockResolvedValue([
        { tradeId: 'trade-1', status: 'SETTLED', alreadySettled: true },
      ]);

      await tradeSettlementService.processNewTradeSettlements([input]);

      const settled = updateManyCalls().find(
        (c) => c.data.settlementStatus === 'SETTLED',
      );
      expect(settled).toBeDefined();
      expect(settled.data.txHash).toBeUndefined();
    });

    it('NOT_INCLUDED (era expired, finalized) → retryable FAILED with marker cleared', async () => {
      arrange({ outcome: 'NOT_INCLUDED' });

      await tradeSettlementService.retryPendingSettlements();

      expect(updateManyCalls()).toContainEqual({
        where: {
          id: 'trade-1',
          settlementAttempts: 3,
          submittedTxHash: '0xours',
        },
        data: expect.objectContaining({
          settlementStatus: 'FAILED',
          submittedTxHash: null,
          nextSettlementRetryAt: expect.any(Date),
        }),
      });
    });

    it('INCLUDED_FAILED → retryable FAILED (definitive on-chain failure)', async () => {
      arrange({
        outcome: 'INCLUDED_FAILED',
        txHash: '0xours',
        blockHash: '0xb',
        error: 'ExtrinsicFailed',
      });

      await tradeSettlementService.retryPendingSettlements();

      expect(updateManyCalls()).toContainEqual(
        expect.objectContaining({
          data: expect.objectContaining({
            settlementStatus: 'FAILED',
            submittedTxHash: null,
          }),
        }),
      );
      expect(
        mockAffiliate.distributeSpotTradeCommissions,
      ).not.toHaveBeenCalled();
    });

    it('a stale SETTLING trade with a marker is parked as RECONCILE_REQUIRED while unresolved', async () => {
      mockPrisma.trade.findMany
        .mockResolvedValueOnce([{ ...parked, settlementStatus: 'SETTLING' }])
        .mockResolvedValueOnce([]);
      mockSettlementService.reconcileSubmission.mockResolvedValue({
        outcome: 'PENDING',
      });

      await tradeSettlementService.retryPendingSettlements();

      expect(updateManyCalls()).toContainEqual({
        where: {
          id: 'trade-1',
          settlementStatus: 'SETTLING',
          settlementAttempts: 3,
          submittedTxHash: '0xours',
        },
        data: expect.objectContaining({
          settlementStatus: 'RECONCILE_REQUIRED',
        }),
      });
      expect(mockSettlementService.settleTrades).not.toHaveBeenCalled();
    });
  });
});
