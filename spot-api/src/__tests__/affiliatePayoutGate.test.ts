/**
 * BE-01 (affiliate side): the payout batch must only pay commissions whose
 * source event is proven on-chain. Fail closed per source type:
 *
 *  - SPOT       → sourceTradeId references a Trade with settlementStatus SETTLED
 *  - COPYTRADE  → sourceTradeId references a CopyVaultWithdrawal with a
 *                 finalized txHash on a vault that has an on-chain contract
 *                 (db-journal withdrawals have txHash null → never paid)
 *  - MARGIN     → margin has no on-chain custody → never paid
 *  - null sourceTradeId / unknown type → never paid
 *
 * Ineligible rows stay isPaid:false (they roll to future batches).
 */
import { Decimal } from '@prisma/client/runtime/library';

const mockPrisma = {
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
};

jest.mock('../db', () => ({ __esModule: true, default: mockPrisma }));
jest.mock('../utils/logger', () => ({
  log: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

import { affiliateService } from '../services/affiliateService';

function commission(
  id: string,
  sourceType: string,
  sourceTradeId: string | null,
) {
  return {
    id,
    sourceType,
    sourceTradeId,
    commissionAmount: new Decimal('1'),
  };
}

describe('affiliateService.processPayoutBatch — source-event gate', () => {
  let tx: any;

  beforeEach(() => {
    jest.clearAllMocks();
    tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      affiliateCommission: {
        findMany: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      affiliatePayoutBatch: {
        create: jest.fn().mockResolvedValue({ id: 'batch-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      trade: { findMany: jest.fn().mockResolvedValue([]) },
      copyVaultWithdrawal: { findMany: jest.fn().mockResolvedValue([]) },
    };
    mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(tx));
    mockPrisma.$queryRaw.mockResolvedValue([]);
  });

  it('pays only SETTLED spot trades and on-chain-confirmed copytrade withdrawals', async () => {
    tx.affiliateCommission.findMany
      .mockResolvedValueOnce([
        commission('spot-ok', 'SPOT', 't-settled'),
        commission('spot-bad', 'SPOT', 't-failed'),
        commission('spot-null', 'SPOT', null),
        commission('copy-ok', 'COPYTRADE', 'wd-onchain'),
        commission('copy-journal', 'COPYTRADE', 'wd-journal'),
        commission('copy-null', 'COPYTRADE', null),
        commission('margin', 'MARGIN', 'm-1'),
        commission('weird', 'SOMETHING_NEW', 'x-1'),
      ])
      .mockResolvedValueOnce([]);
    tx.trade.findMany.mockResolvedValue([{ id: 't-settled' }]);
    tx.copyVaultWithdrawal.findMany.mockResolvedValue([{ id: 'wd-onchain' }]);
    tx.affiliateCommission.updateMany.mockResolvedValue({ count: 2 });

    await affiliateService.processPayoutBatch();

    const claimed = tx.affiliateCommission.updateMany.mock.calls[0][0].where.id
      .in as string[];
    expect(claimed.sort()).toEqual(['copy-ok', 'spot-ok']);

    // The copytrade proof query requires a finalized txHash on a vault that
    // has an on-chain contract.
    expect(tx.copyVaultWithdrawal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ['wd-onchain', 'wd-journal'] },
          txHash: { not: null },
          vault: { contractAddress: { not: null } },
        },
      }),
    );
  });

  it('creates an empty COMPLETED batch when nothing is provably eligible', async () => {
    tx.affiliateCommission.findMany.mockResolvedValueOnce([
      commission('copy-journal', 'COPYTRADE', 'wd-journal'),
      commission('margin', 'MARGIN', null),
    ]);

    const result = await affiliateService.processPayoutBatch();

    expect(result).toEqual(
      expect.objectContaining({ processed: 0, totalPaid: 0 }),
    );
    expect(tx.affiliateCommission.updateMany).not.toHaveBeenCalled();
  });
});
