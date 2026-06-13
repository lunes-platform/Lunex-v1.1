// Mock prisma client shared across all affiliateService suites.
// Shaped to cover Task 1 (idempotency), Task 2 (post-settlement credit) and
// Task 3 (payout batch reconciliation + advisory lock).
const mockPrisma = {
  referral: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    count: jest.fn(),
    findMany: jest.fn(),
    groupBy: jest.fn(),
  },
  affiliateCommission: {
    create: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
    groupBy: jest.fn(),
    aggregate: jest.fn(),
  },
  affiliatePayoutBatch: {
    create: jest.fn(),
    update: jest.fn(),
  },
  trade: {
    findMany: jest.fn(),
  },
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
  $executeRaw: jest.fn(),
};

jest.mock('../db', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../utils/logger', () => ({
  log: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import { affiliateService } from '../services/affiliateService';
import { Decimal } from '@prisma/client/runtime/library';

// Build a P2002 unique-violation error the same way Prisma surfaces it at runtime.
function makeP2002(): Error & { code: string } {
  const err = new Error('Unique constraint failed') as Error & { code: string };
  err.name = 'PrismaClientKnownRequestError';
  err.code = 'P2002';
  return err;
}

describe('affiliateService.distributeCommissions — idempotency (Task 1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // 3-level chain: beneficiaries at levels 1..3.
    const chain = [
      { refereeAddress: 'src', referrerAddress: 'anc-1' },
      { refereeAddress: 'anc-1', referrerAddress: 'anc-2' },
      { refereeAddress: 'anc-2', referrerAddress: 'anc-3' },
    ];
    mockPrisma.referral.findUnique.mockImplementation(({ where }) => {
      const node = chain.find((c) => c.refereeAddress === where.refereeAddress);
      if (!node) return Promise.resolve(null);
      // Old enough to pass the 7-day cooldown.
      return Promise.resolve({
        ...node,
        createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      });
    });
  });

  it('skips a duplicate (P2002) commission without throwing and continues the chain', async () => {
    let call = 0;
    mockPrisma.affiliateCommission.create.mockImplementation(({ data }) => {
      call += 1;
      // First level collides on the unique constraint.
      if (call === 1) return Promise.reject(makeP2002());
      return Promise.resolve({ id: `c-${call}`, ...data });
    });

    const result = await affiliateService.distributeCommissions(
      'src',
      'USDT',
      '100',
      'SPOT',
      'trade-1',
    );

    // Duplicate level skipped, remaining levels still processed.
    expect(mockPrisma.affiliateCommission.create).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.level)).toEqual([2, 3]);
  });

  it('returns created commissions on the happy path', async () => {
    mockPrisma.affiliateCommission.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'c', ...data }),
    );

    const result = await affiliateService.distributeCommissions(
      'src',
      'USDT',
      '100',
      'SPOT',
      'trade-1',
    );

    expect(result).toHaveLength(3);
    // 400/300/150 bps of 100 = 4 / 3 / 1.5
    expect(result[0].commissionRate).toBe(400);
    expect(result[0].commissionAmount.toString()).toBe('4');
  });

  it('returns [] when fee is <= 0 without querying the chain', async () => {
    const result = await affiliateService.distributeCommissions(
      'src',
      'USDT',
      '0',
      'SPOT',
      'trade-1',
    );
    expect(result).toEqual([]);
    expect(mockPrisma.affiliateCommission.create).not.toHaveBeenCalled();
  });

  it('re-throws non-P2002 create errors (does not swallow real DB failures)', async () => {
    mockPrisma.affiliateCommission.create.mockRejectedValue(
      new Error('connection reset'),
    );

    await expect(
      affiliateService.distributeCommissions(
        'src',
        'USDT',
        '100',
        'SPOT',
        'trade-1',
      ),
    ).rejects.toThrow('connection reset');
  });
});

describe('affiliateService.distributeSpotTradeCommissions (Task 2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns early without querying when tradeIds is empty', async () => {
    await affiliateService.distributeSpotTradeCommissions([]);
    expect(mockPrisma.trade.findMany).not.toHaveBeenCalled();
  });

  it('only loads SETTLED trades and credits both fee legs when positive', async () => {
    mockPrisma.trade.findMany.mockResolvedValue([
      {
        id: 'trade-1',
        takerAddress: 'taker',
        makerAddress: 'maker',
        takerFee: new Decimal('2'),
        makerFee: new Decimal('1'),
        pair: { quoteName: 'USDT' },
      },
    ]);
    const spy = jest
      .spyOn(affiliateService, 'distributeCommissions')
      .mockResolvedValue([]);

    await affiliateService.distributeSpotTradeCommissions(['trade-1']);

    expect(mockPrisma.trade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['trade-1'] }, settlementStatus: 'SETTLED' },
        include: { pair: true },
      }),
    );
    expect(spy).toHaveBeenCalledWith(
      'taker',
      'USDT',
      '2',
      'SPOT',
      'trade-1',
    );
    expect(spy).toHaveBeenCalledWith(
      'maker',
      'USDT',
      '1',
      'SPOT',
      'trade-1',
    );
    spy.mockRestore();
  });

  it('skips a fee leg whose fee is zero', async () => {
    mockPrisma.trade.findMany.mockResolvedValue([
      {
        id: 'trade-1',
        takerAddress: 'taker',
        makerAddress: 'maker',
        takerFee: new Decimal('2'),
        makerFee: new Decimal('0'),
        pair: { quoteName: 'USDT' },
      },
    ]);
    const spy = jest
      .spyOn(affiliateService, 'distributeCommissions')
      .mockResolvedValue([]);

    await affiliateService.distributeSpotTradeCommissions(['trade-1']);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('taker', 'USDT', '2', 'SPOT', 'trade-1');
    spy.mockRestore();
  });
});

describe('affiliateService.processPayoutBatch — reconcile + lock + claim (Task 3)', () => {
  let txMock: {
    $executeRaw: jest.Mock;
    affiliateCommission: { findMany: jest.Mock; updateMany: jest.Mock };
    affiliatePayoutBatch: { create: jest.Mock; update: jest.Mock };
    trade: { findMany: jest.Mock };
  };
  let callOrder: string[];

  beforeEach(() => {
    jest.clearAllMocks();
    callOrder = [];
    txMock = {
      $executeRaw: jest.fn(() => {
        callOrder.push('lock');
        return Promise.resolve(0);
      }),
      affiliateCommission: {
        findMany: jest.fn(() => {
          callOrder.push('findMany');
          return Promise.resolve([]);
        }),
        updateMany: jest.fn(() => {
          callOrder.push('updateMany');
          return Promise.resolve({ count: 0 });
        }),
      },
      affiliatePayoutBatch: {
        create: jest.fn(() => {
          callOrder.push('batchCreate');
          return Promise.resolve({ id: 'batch-1' });
        }),
        update: jest.fn(() => Promise.resolve({})),
      },
      trade: {
        findMany: jest.fn(() => Promise.resolve([])),
      },
    };
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn(txMock),
    );
    mockPrisma.$queryRaw.mockResolvedValue([]);
  });

  it('opens the transaction with a pg_advisory_xact_lock before other ops', async () => {
    await affiliateService.processPayoutBatch();
    expect(txMock.$executeRaw).toHaveBeenCalled();
    // lock is the first thing that runs inside the transaction
    expect(callOrder.indexOf('lock')).toBe(0);
    const sql = txMock.$executeRaw.mock.calls[0][0];
    const flat = Array.isArray(sql) ? sql.join(' ') : String(sql);
    expect(flat).toContain('pg_advisory_xact_lock');
  });

  it('claims commissions with updateMany guarded by isPaid:false and totals from claimed rows', async () => {
    txMock.affiliateCommission.findMany
      // 1st call: unpaid selection
      .mockImplementationOnce(() =>
        Promise.resolve([
          { id: 'c1', sourceType: 'COPYTRADE', sourceTradeId: null, commissionAmount: new Decimal('5') },
        ]),
      )
      // 2nd call: rows linked to the batch (for totalPaid)
      .mockImplementationOnce(() =>
        Promise.resolve([{ commissionAmount: new Decimal('5') }]),
      );
    txMock.affiliateCommission.updateMany.mockResolvedValue({ count: 1 });

    const result = await affiliateService.processPayoutBatch();

    const updateCall = txMock.affiliateCommission.updateMany.mock.calls[0][0];
    expect(updateCall.where).toEqual(
      expect.objectContaining({ isPaid: false, id: { in: ['c1'] } }),
    );
    expect(result.processed).toBe(1);
    expect(result.totalPaid).toBe(5);
  });

  it('excludes SPOT commissions whose trade is not SETTLED, keeps COPYTRADE / null / SETTLED-SPOT', async () => {
    txMock.affiliateCommission.findMany
      .mockImplementationOnce(() =>
        Promise.resolve([
          { id: 'spot-unsettled', sourceType: 'SPOT', sourceTradeId: 't-unsettled', commissionAmount: new Decimal('1') },
          { id: 'spot-settled', sourceType: 'SPOT', sourceTradeId: 't-settled', commissionAmount: new Decimal('2') },
          { id: 'copytrade', sourceType: 'COPYTRADE', sourceTradeId: 'wd-1', commissionAmount: new Decimal('3') },
          { id: 'nullsrc', sourceType: 'SPOT', sourceTradeId: null, commissionAmount: new Decimal('4') },
        ]),
      )
      .mockImplementationOnce(() => Promise.resolve([]));
    // Only t-settled is SETTLED.
    txMock.trade.findMany.mockResolvedValue([{ id: 't-settled' }]);
    txMock.affiliateCommission.updateMany.mockResolvedValue({ count: 3 });

    await affiliateService.processPayoutBatch();

    const eligibleIds = txMock.affiliateCommission.updateMany.mock.calls[0][0].where.id.in;
    expect(eligibleIds).toEqual(
      expect.arrayContaining(['spot-settled', 'copytrade', 'nullsrc']),
    );
    expect(eligibleIds).not.toContain('spot-unsettled');
  });

  it('reconciles missed SETTLED trades before opening the transaction', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ id: 'trade-missed' }]);
    const spy = jest
      .spyOn(affiliateService, 'distributeSpotTradeCommissions')
      .mockResolvedValue(undefined);

    await affiliateService.processPayoutBatch();

    expect(spy).toHaveBeenCalledWith(['trade-missed']);
    spy.mockRestore();
  });

  it('does not reconcile when the anti-join returns no missed trades', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);
    const spy = jest
      .spyOn(affiliateService, 'distributeSpotTradeCommissions')
      .mockResolvedValue(undefined);

    await affiliateService.processPayoutBatch();

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('proceeds with the batch even when reconciliation rejects', async () => {
    mockPrisma.$queryRaw.mockRejectedValue(new Error('reconcile boom'));

    const result = await affiliateService.processPayoutBatch();

    expect(result).toEqual(
      expect.objectContaining({ batchId: 'batch-1', processed: 0, totalPaid: 0 }),
    );
  });

  it('returns processed 0 / totalPaid 0 when there are no eligible commissions', async () => {
    const result = await affiliateService.processPayoutBatch();
    expect(result).toEqual(
      expect.objectContaining({ processed: 0, totalPaid: 0 }),
    );
  });
});
