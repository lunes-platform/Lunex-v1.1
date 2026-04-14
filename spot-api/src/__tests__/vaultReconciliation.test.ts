/**
 * Unit tests for VaultReconciliationService.
 *
 * Prisma is mocked so no real database connection is needed.
 */

jest.mock('../db', () => ({
  __esModule: true,
  default: {
    copyVault: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    copyVaultDeposit: {
      aggregate: jest.fn(),
    },
    copyVaultWithdrawal: {
      aggregate: jest.fn(),
    },
    copyTradeSignal: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('../config', () => ({
  config: {
    reconciliation: {
      enabled: true,
      intervalMs: 60_000,
    },
    redis: {
      url: 'redis://127.0.0.1:6379',
      nonceTtlSeconds: 300,
    },
  },
}));

jest.mock('../utils/logger', () => ({
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import prisma from '../db';
import { vaultReconciliationService } from '../services/vaultReconciliationService';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

function makeVault(
  overrides: Partial<{
    id: string;
    name: string;
    totalEquity: string;
    totalShares: string;
  }> = {},
) {
  return {
    id: overrides.id ?? 'vault-1',
    name: overrides.name ?? 'Alpha Vault',
    totalEquity: { toString: () => overrides.totalEquity ?? '1000' },
    totalShares: { toString: () => overrides.totalShares ?? '1000' },
  };
}

function setupPrismaAggregates(deposited: string, withdrawn: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mockPrisma.copyVaultDeposit.aggregate as jest.Mock).mockResolvedValue({
    _sum: { amount: deposited },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mockPrisma.copyVaultWithdrawal.aggregate as jest.Mock).mockResolvedValue({
    _sum: { grossAmount: withdrawn },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mockPrisma.copyTradeSignal.findMany as jest.Mock).mockResolvedValue([]);
}

describe('VaultReconciliationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockPrisma.copyVault.update as jest.Mock).mockResolvedValue({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockPrisma.copyTradeSignal.findMany as jest.Mock).mockResolvedValue([]);
  });

  describe('isEnabled()', () => {
    it('returns true when config.reconciliation.enabled is true', () => {
      expect(vaultReconciliationService.isEnabled()).toBe(true);
    });
  });

  describe('runCycle()', () => {
    it('returns empty array when no vaults exist', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockPrisma.copyVault.findMany as jest.Mock).mockResolvedValue([]);

      const results = await vaultReconciliationService.runCycle();

      expect(results).toEqual([]);
    });

    it('returns a consistent result when equity matches (no drift)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockPrisma.copyVault.findMany as jest.Mock).mockResolvedValue([
        makeVault({ totalEquity: '900' }),
      ]);
      setupPrismaAggregates('1000', '100');

      const results = await vaultReconciliationService.runCycle();

      expect(results).toHaveLength(1);
      expect(results[0].repaired).toBe(false);
      expect(results[0].drift).toBeCloseTo(0, 5);
      expect(mockPrisma.copyVault.update).not.toHaveBeenCalled();
    });

    it('detects drift and repairs vault when actual equity diverges', async () => {
      // DB says totalEquity = 500, but deposits=1000, withdrawals=100 → expected = 900
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockPrisma.copyVault.findMany as jest.Mock).mockResolvedValue([
        makeVault({ totalEquity: '500' }),
      ]);
      setupPrismaAggregates('1000', '100');

      const results = await vaultReconciliationService.runCycle();

      expect(results).toHaveLength(1);
      expect(results[0].repaired).toBe(true);
      expect(results[0].expectedEquity).toBeCloseTo(900, 5);
      expect(results[0].actualEquity).toBeCloseTo(500, 5);
      expect(results[0].drift).toBeCloseTo(400, 5);

      expect(mockPrisma.copyVault.update).toHaveBeenCalledWith({
        where: { id: 'vault-1' },
        data: expect.objectContaining({
          totalEquity: expect.any(String),
        }),
      });
    });

    it('does not repair when drift is within the 0.01 threshold', async () => {
      // Tiny floating point rounding — drift = 0.005
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockPrisma.copyVault.findMany as jest.Mock).mockResolvedValue([
        makeVault({ totalEquity: '899.995' }),
      ]);
      setupPrismaAggregates('1000', '100');

      const results = await vaultReconciliationService.runCycle();

      expect(results[0].repaired).toBe(false);
      expect(mockPrisma.copyVault.update).not.toHaveBeenCalled();
    });

    it('handles null aggregate sums (empty vault with no activity)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockPrisma.copyVault.findMany as jest.Mock).mockResolvedValue([
        makeVault({ totalEquity: '0' }),
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockPrisma.copyVaultDeposit.aggregate as jest.Mock).mockResolvedValue({
        _sum: { amount: null },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockPrisma.copyVaultWithdrawal.aggregate as jest.Mock).mockResolvedValue(
        { _sum: { grossAmount: null } },
      );

      const results = await vaultReconciliationService.runCycle();

      expect(results).toHaveLength(1);
      expect(results[0].expectedEquity).toBe(0);
      expect(results[0].repaired).toBe(false);
    });

    it('clamps expectedEquity to 0 when withdrawals exceed deposits', async () => {
      // Impossible state: more withdrawn than deposited
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockPrisma.copyVault.findMany as jest.Mock).mockResolvedValue([
        makeVault({ totalEquity: '0' }),
      ]);
      setupPrismaAggregates('100', '500');

      const results = await vaultReconciliationService.runCycle();

      expect(results[0].expectedEquity).toBe(0);
    });

    it('includes realized PnL from closed copytrade signals in expected equity', async () => {
      // deposits 1000 - withdrawals 100 + realized pnl 20 = expected 920
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockPrisma.copyVault.findMany as jest.Mock).mockResolvedValue([
        makeVault({ totalEquity: '920' }),
      ]);
      setupPrismaAggregates('1000', '100');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockPrisma.copyTradeSignal.findMany as jest.Mock).mockResolvedValue([
        {
          amountIn: { toString: () => '100' },
          realizedPnlPct: { toString: () => '20' },
        },
      ]);

      const results = await vaultReconciliationService.runCycle();

      expect(results).toHaveLength(1);
      expect(results[0].expectedEquity).toBeCloseTo(920, 5);
      expect(results[0].repaired).toBe(false);
      expect(mockPrisma.copyVault.update).not.toHaveBeenCalled();
    });

    it('reconciles multiple vaults in a single cycle', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockPrisma.copyVault.findMany as jest.Mock).mockResolvedValue([
        makeVault({ id: 'v1', totalEquity: '900' }),
        makeVault({ id: 'v2', totalEquity: '200' }),
      ]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockPrisma.copyVaultDeposit.aggregate as jest.Mock)
        .mockResolvedValueOnce({ _sum: { amount: '1000' } }) // v1
        .mockResolvedValueOnce({ _sum: { amount: '500' } }); // v2
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockPrisma.copyVaultWithdrawal.aggregate as jest.Mock)
        .mockResolvedValueOnce({ _sum: { grossAmount: '100' } }) // v1 → expected 900 ✓
        .mockResolvedValueOnce({ _sum: { grossAmount: '100' } }); // v2 → expected 400, actual 200 ✗

      const results = await vaultReconciliationService.runCycle();

      expect(results).toHaveLength(2);
      expect(results[0].repaired).toBe(false); // v1 consistent
      expect(results[1].repaired).toBe(true); // v2 drifted
    });

    it('continues processing other vaults if one throws', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockPrisma.copyVault.findMany as jest.Mock).mockResolvedValue([
        makeVault({ id: 'bad-vault', totalEquity: '0' }),
        makeVault({ id: 'good-vault', totalEquity: '900' }),
      ]);

      // First vault: aggregate throws
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockPrisma.copyVaultDeposit.aggregate as jest.Mock)
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce({ _sum: { amount: '1000' } });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (
        mockPrisma.copyVaultWithdrawal.aggregate as jest.Mock
      ).mockResolvedValueOnce({ _sum: { grossAmount: '100' } });

      const results = await vaultReconciliationService.runCycle();

      // Only good-vault returned, bad-vault was skipped
      expect(results).toHaveLength(1);
      expect(results[0].vaultId).toBe('good-vault');
    });

    it('skips a cycle if the previous one is still running', async () => {
      // Simulate a long-running cycle by holding the first call
      let resolveFirst!: () => void;
      const firstCallStarted = new Promise<void>((res) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockPrisma.copyVault.findMany as jest.Mock).mockImplementationOnce(
          () =>
            new Promise<typeof resolveFirst>((r) => {
              resolveFirst = () => r([] as never);
              res();
            }),
        );
      });

      const firstCycle = vaultReconciliationService.runCycle();

      // Wait until first cycle is actually inside runCycle
      await firstCallStarted;

      // Second call should be skipped
      const secondCycle = await vaultReconciliationService.runCycle();
      expect(secondCycle).toEqual([]);

      // Resolve first cycle
      resolveFirst();
      await firstCycle;
    });
  });

  describe('start() / stop()', () => {
    it('start() sets an interval and stop() clears it', () => {
      jest.useFakeTimers();

      vaultReconciliationService.start();
      // Interval should be registered — advance timer and check it would run
      const runCycleSpy = jest
        .spyOn(vaultReconciliationService, 'runCycle')
        .mockResolvedValue([]);

      jest.advanceTimersByTime(60_001);
      expect(runCycleSpy).toHaveBeenCalledTimes(1);

      vaultReconciliationService.stop();
      jest.advanceTimersByTime(60_001);
      expect(runCycleSpy).toHaveBeenCalledTimes(1); // still 1 — stopped

      runCycleSpy.mockRestore();
      jest.useRealTimers();
    });
  });
});
