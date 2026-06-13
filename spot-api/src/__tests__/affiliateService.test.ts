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
