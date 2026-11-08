/**
 * BE-06: margin collateral ledger integrity.
 *
 *  1. Proof of funds: there is no on-chain margin custody (no contract, no
 *     custody address) and the spot vault is user-controlled on-chain, so the
 *     backend cannot prove nor lock collateral. Unproven journal collateral is
 *     therefore only allowed in a non-production environment with on-chain
 *     settlement disabled; otherwise deposit/withdraw fail closed with 409.
 *  2. Lost update: every balance write is an atomic increment/decrement taken
 *     under a row lock (SELECT ... FOR UPDATE), and debits are conditional
 *     (`collateralAvailable >= amount`), so concurrent withdrawals cannot both
 *     pass the stale balance check.
 */
import { Decimal } from '@prisma/client/runtime/library';

const mockConfig = {
  isProd: false,
  margin: {
    markPriceMaxAgeMs: 120_000,
    maxBookSpreadBps: 1000,
    maxTradeToBookDeviationBps: 500,
    operationalBlockAfterFailures: 3,
  },
};
jest.mock('../config', () => ({ config: mockConfig }));

const mockSettlementEnabled = jest.fn(() => false);
jest.mock('../services/settlementService', () => ({
  settlementService: { isEnabled: () => mockSettlementEnabled() },
}));

jest.mock('../utils/orderbook', () => ({
  orderbookManager: { get: jest.fn() },
}));
jest.mock('../utils/logger', () => ({
  log: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

// ── Tiny in-memory "database" honouring the atomic operators we rely on ──
type Account = {
  id: string;
  address: string;
  collateralToken: string;
  collateralAvailable: Decimal;
  collateralLocked: Decimal;
  totalRealizedPnl: Decimal;
  createdAt: Date;
  updatedAt: Date;
};

const ADDRESS = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
let account: Account;
const transfers: Array<Record<string, unknown>> = [];
let positions: Array<Record<string, any>> = [];
const lockCalls: string[] = [];

function applyNumericOps(target: any, data: any) {
  for (const [key, value] of Object.entries(data ?? {})) {
    if (value && typeof value === 'object' && 'increment' in (value as any)) {
      target[key] = new Decimal(target[key]).plus((value as any).increment);
    } else if (
      value &&
      typeof value === 'object' &&
      'decrement' in (value as any)
    ) {
      target[key] = new Decimal(target[key]).minus((value as any).decrement);
    } else if (value instanceof Decimal) {
      // Absolute write from a stale read — the bug under test.
      target[key] = value;
    } else {
      target[key] = value;
    }
  }
}

function matchesAccountWhere(where: any): boolean {
  if (where.id && where.id !== account.id) return false;
  const guard = where.collateralAvailable;
  if (guard?.gte !== undefined && account.collateralAvailable.lt(guard.gte))
    return false;
  return true;
}

const tx: any = {
  $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
    lockCalls.push(strings.join('?'));
    return [{ id: account.id }];
  }),
  marginAccount: {
    findUnique: jest.fn(async () => ({ ...account })),
    create: jest.fn(),
    update: jest.fn(async ({ where, data }: any) => {
      if (!matchesAccountWhere(where)) throw new Error('not found');
      applyNumericOps(account, data);
      return { ...account };
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      if (!matchesAccountWhere(where)) return { count: 0 };
      applyNumericOps(account, data);
      return { count: 1 };
    }),
  },
  marginPosition: {
    findMany: jest.fn(async () => []),
    findUnique: jest.fn(async ({ where }: any) => {
      const p = positions.find((x) => x.id === where.id);
      return p ? { ...p, account: { ...account } } : null;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const p = positions.find((x) => x.id === where.id)!;
      Object.assign(p, data);
      return { ...p };
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const p = positions.find(
        (x) =>
          x.id === where.id && (!where.status || x.status === where.status),
      );
      if (!p) return { count: 0 };
      Object.assign(p, data);
      return { count: 1 };
    }),
    create: jest.fn(),
  },
  marginCollateralTransfer: {
    create: jest.fn(async ({ data }: any) => {
      transfers.push(data);
      return data;
    }),
  },
  marginLiquidation: { create: jest.fn(async () => ({})) },
  trade: {
    findFirst: jest.fn(async () => ({
      price: new Decimal('0.1'),
      createdAt: new Date(),
    })),
  },
  pair: { findUnique: jest.fn() },
};

const mockPrisma: any = {
  ...tx,
  $transaction: jest.fn(async (cb: (t: any) => unknown) => cb(tx)),
};

jest.mock('../db', () => ({ __esModule: true, default: mockPrisma }));

import { marginService } from '../services/marginService';

function resetAccount(available: string, locked = '0') {
  const now = new Date('2026-01-01T00:00:00Z');
  account = {
    id: 'acc-1',
    address: ADDRESS,
    collateralToken: 'USDT',
    collateralAvailable: new Decimal(available),
    collateralLocked: new Decimal(locked),
    totalRealizedPnl: new Decimal('0'),
    createdAt: now,
    updatedAt: now,
  };
}

describe('BE-06 margin collateral integrity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.isProd = false;
    mockSettlementEnabled.mockReturnValue(false);
    transfers.length = 0;
    lockCalls.length = 0;
    positions = [];
    resetAccount('100');
  });

  describe('proof of funds (fail closed)', () => {
    it('rejects deposits in production with 409 and writes nothing', async () => {
      mockConfig.isProd = true;

      await expect(
        marginService.depositCollateral({
          address: ADDRESS,
          amount: '1000000000',
          token: 'USDT',
          signature: 'sig',
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'MARGIN_COLLATERAL_PROOF_REQUIRED',
      });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(account.collateralAvailable.toString()).toBe('100');
    });

    it('rejects deposits when on-chain settlement (real funds) is enabled', async () => {
      mockSettlementEnabled.mockReturnValue(true);

      await expect(
        marginService.depositCollateral({
          address: ADDRESS,
          amount: '10',
          signature: 'sig',
        }),
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(transfers).toHaveLength(0);
    });

    it('rejects withdrawals in production (no custody → no CONFIRMED transfer)', async () => {
      mockConfig.isProd = true;

      await expect(
        marginService.withdrawCollateral({
          address: ADDRESS,
          amount: '10',
          signature: 'sig',
        }),
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(transfers).toHaveLength(0);
    });

    it('allows journal deposits in dev with an atomic increment under row lock', async () => {
      await marginService.depositCollateral({
        address: ADDRESS,
        amount: '25',
        signature: 'sig',
      });

      expect(account.collateralAvailable.toString()).toBe('125');
      expect(lockCalls.some((sql) => /FOR UPDATE/.test(sql))).toBe(true);
      const call =
        tx.marginAccount.update.mock.calls[0]?.[0] ??
        tx.marginAccount.updateMany.mock.calls[0]?.[0];
      expect(call.data.collateralAvailable).toEqual({
        increment: new Decimal('25'),
      });
    });
  });

  describe('lost update', () => {
    it('two concurrent withdrawals of 100 on a 100 balance: exactly one succeeds', async () => {
      const results = await Promise.allSettled([
        marginService.withdrawCollateral({
          address: ADDRESS,
          amount: '100',
          signature: 'sig-1',
        }),
        marginService.withdrawCollateral({
          address: ADDRESS,
          amount: '100',
          signature: 'sig-2',
        }),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
      expect(transfers.filter((t) => t.direction === 'WITHDRAW')).toHaveLength(
        1,
      );
      expect(account.collateralAvailable.toString()).toBe('0');
    });

    it('withdraw debits with a conditional decrement guarded by gte', async () => {
      await marginService.withdrawCollateral({
        address: ADDRESS,
        amount: '40',
        signature: 'sig',
      });

      expect(tx.marginAccount.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'acc-1',
          collateralAvailable: { gte: new Decimal('40') },
        },
        data: { collateralAvailable: { decrement: new Decimal('40') } },
      });
      expect(account.collateralAvailable.toString()).toBe('60');
    });

    it('closePosition is a CAS on status OPEN: a concurrent second close credits nothing', async () => {
      resetAccount('0', '50');
      positions = [
        {
          id: 'pos-1',
          accountId: 'acc-1',
          pairId: 'pair-1',
          pairSymbol: 'LUNES/USDT',
          side: 'BUY',
          status: 'OPEN',
          collateralAmount: new Decimal('50'),
          leverage: new Decimal('2'),
          notional: new Decimal('100'),
          quantity: new Decimal('1000'),
          entryPrice: new Decimal('0.1'),
          markPrice: new Decimal('0.1'),
          borrowedAmount: new Decimal('50'),
          maintenanceMargin: new Decimal('5'),
          liquidationPrice: new Decimal('0.05'),
          unrealizedPnl: new Decimal('0'),
          realizedPnl: new Decimal('0'),
          openedAt: new Date(),
          closedAt: null,
          updatedAt: new Date(),
        },
      ];
      // Both callers read the position while it is still OPEN (stale read).
      const staleOpen = { ...positions[0], account: { ...account } };
      tx.marginPosition.findUnique.mockResolvedValue(staleOpen);
      mockPrisma.marginAccount.findUnique = jest.fn(async () => ({
        ...account,
      }));
      mockPrisma.marginPosition.findMany = jest.fn(async () => []);

      const results = await Promise.allSettled([
        marginService.closePosition('pos-1', ADDRESS),
        marginService.closePosition('pos-1', ADDRESS),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      // Released exactly once: 50 collateral back, locked back to 0.
      expect(account.collateralAvailable.toString()).toBe('50');
      expect(account.collateralLocked.toString()).toBe('0');
    });
  });
});
