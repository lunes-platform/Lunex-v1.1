// RISK-BE: copy-engine risk limits — schema validation, persistence, and
// copy-engine application (copyMultiplier scale + maxPerTradeUsdt cap +
// stopLoss/maxDrawdown gate).

jest.mock('../db', () => ({
  __esModule: true,
  default: {
    $transaction: jest.fn(),
    copyVault: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    copyVaultPosition: {
      findUnique: jest.fn(),
    },
    pair: {
      findUnique: jest.fn(),
    },
    trade: {
      findFirst: jest.fn(),
    },
    leaderTrade: {
      findFirst: jest.fn(),
    },
  },
}));

jest.mock('../utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../services/affiliateService', () => ({
  affiliateService: { distributeCommissions: jest.fn() },
}));

jest.mock('../services/copyVaultService', () => ({
  copyVaultService: {
    isEnabled: jest.fn().mockReturnValue(false),
    deposit: jest.fn(),
    withdraw: jest.fn(),
  },
}));

jest.mock('../services/routerService', () => ({
  routerService: { isEnabled: jest.fn().mockReturnValue(false) },
}));

import prisma from '../db';
import { copytradeService } from '../services/copytradeService';
import {
  CopyVaultDepositSchema,
  FollowLeaderSchema,
} from '../utils/validation';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

function vault(overrides?: Partial<any>) {
  return {
    id: 'vault-1',
    leaderId: 'leader-1',
    collateralToken: 'USDT',
    status: 'ACTIVE',
    contractAddress: null,
    minDeposit: { toString: () => '10' },
    totalShares: { toString: () => '100' },
    totalEquity: { toString: () => '100000' },
    totalDeposits: { toString: () => '100000' },
    totalWithdrawals: { toString: () => '0' },
    copyMultiplier: { toString: () => '1' },
    maxPerTradeUsdt: null,
    stopLossPct: null,
    maxDrawdownPct: null,
    twapThreshold: { toString: () => '50000' },
    maxSlippageBps: 100,
    leader: {
      id: 'leader-1',
      address: '5Fleader',
      performanceFeeBps: 1500,
    },
    ...overrides,
  };
}

const baseSigned = {
  nonce: 'test-nonce-xyz',
  timestamp: Date.now(),
  signature: 'signed-payload',
};

function signalInput(overrides?: Partial<any>) {
  return {
    pairSymbol: 'LUNES/USDT',
    side: 'BUY' as const,
    positionEffect: 'OPEN' as const,
    signalMode: 'JOURNAL' as const,
    source: 'API' as const,
    amountIn: '1000',
    amountOutMin: '900',
    maxSlippageBps: 100,
    ...overrides,
  };
}

// Captures the amountIn recorded on the persisted signal so we can assert on
// the effective (scaled + capped) position size used by the copy-engine.
function wireSignalTx(vaultRecord: any) {
  (mockPrisma.copyVault.findUnique as jest.Mock).mockResolvedValue(vaultRecord);
  (mockPrisma.copyVault.update as jest.Mock).mockResolvedValue({});
  (mockPrisma.pair.findUnique as jest.Mock).mockResolvedValue({
    id: 'pair-1',
    symbol: 'LUNES/USDT',
  });
  (mockPrisma.trade.findFirst as jest.Mock).mockResolvedValue({
    price: { toString: () => '1' },
  });
  (mockPrisma.leaderTrade.findFirst as jest.Mock).mockResolvedValue(null);

  const captured: { signalAmountIn?: number } = {};
  const tx = {
    copyTradeSignal: {
      create: jest.fn().mockImplementation(async (args: any) => {
        captured.signalAmountIn = parseFloat(args.data.amountIn.toString());
        return { id: 'signal-1' };
      }),
    },
    copyTradeExecution: {
      create: jest.fn().mockResolvedValue({ id: 'exec-1' }),
    },
    leaderTrade: {
      create: jest.fn().mockResolvedValue({ id: 'lt-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    copyVault: { update: jest.fn().mockResolvedValue({}) },
  };
  (mockPrisma.$transaction as jest.Mock).mockImplementation(
    async (cb: any) => cb(tx),
  );
  return { captured, tx };
}

describe('RISK-BE: Zod schema validation', () => {
  it('FollowLeaderSchema accepts valid risk params', () => {
    const parsed = FollowLeaderSchema.safeParse({
      address: 'follower-1',
      ...baseSigned,
      copyMultiplier: 2.5,
      maxPerTradeUsdt: 500,
      stopLossPct: 20,
      maxDrawdownPct: 30,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.copyMultiplier).toBe(2.5);
      expect(parsed.data.maxPerTradeUsdt).toBe(500);
      expect(parsed.data.stopLossPct).toBe(20);
      expect(parsed.data.maxDrawdownPct).toBe(30);
    }
  });

  it('FollowLeaderSchema leaves copyMultiplier undefined when omitted (engine treats as 1x)', () => {
    const parsed = FollowLeaderSchema.safeParse({
      address: 'follower-1',
      ...baseSigned,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.copyMultiplier).toBeUndefined();
  });

  it('rejects copyMultiplier out of range (>10)', () => {
    const parsed = FollowLeaderSchema.safeParse({
      address: 'follower-1',
      ...baseSigned,
      copyMultiplier: 11,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects copyMultiplier below 0.1', () => {
    const parsed = FollowLeaderSchema.safeParse({
      address: 'follower-1',
      ...baseSigned,
      copyMultiplier: 0.05,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects stopLossPct above 100 and below 1', () => {
    expect(
      FollowLeaderSchema.safeParse({
        address: 'a',
        ...baseSigned,
        stopLossPct: 101,
      }).success,
    ).toBe(false);
    expect(
      FollowLeaderSchema.safeParse({
        address: 'a',
        ...baseSigned,
        stopLossPct: 0,
      }).success,
    ).toBe(false);
  });

  it('rejects negative maxPerTradeUsdt', () => {
    expect(
      FollowLeaderSchema.safeParse({
        address: 'a',
        ...baseSigned,
        maxPerTradeUsdt: -1,
      }).success,
    ).toBe(false);
  });

  it('CopyVaultDepositSchema accepts risk params and rejects bad maxDrawdownPct', () => {
    const ok = CopyVaultDepositSchema.safeParse({
      followerAddress: 'follower-1',
      token: 'USDT',
      amount: '100',
      ...baseSigned,
      copyMultiplier: 3,
      maxPerTradeUsdt: 250,
      stopLossPct: 15,
      maxDrawdownPct: 40,
    });
    expect(ok.success).toBe(true);

    const bad = CopyVaultDepositSchema.safeParse({
      followerAddress: 'follower-1',
      token: 'USDT',
      amount: '100',
      ...baseSigned,
      maxDrawdownPct: 200,
    });
    expect(bad.success).toBe(false);
  });
});

describe('RISK-BE: persistence on deposit', () => {
  beforeEach(() => jest.clearAllMocks());

  it('persists risk config columns onto the vault during deposit', async () => {
    const v = vault();
    const tx = {
      copyVault: {
        findUnique: jest.fn().mockResolvedValue(v),
        update: jest.fn().mockResolvedValue({}),
      },
      copyVaultPosition: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'position-1' }),
        update: jest.fn().mockResolvedValue({ id: 'position-1' }),
      },
      copyVaultDeposit: {
        create: jest.fn().mockResolvedValue({ id: 'deposit-1' }),
      },
      leader: { update: jest.fn().mockResolvedValue({}) },
    };
    (mockPrisma.$transaction as jest.Mock).mockImplementation(
      async (cb: any) => cb(tx),
    );

    await copytradeService.depositToVault('leader-1', {
      followerAddress: 'follower-1',
      token: 'USDT',
      amount: '100',
      copyMultiplier: 2,
      maxPerTradeUsdt: 500,
      stopLossPct: 25,
      maxDrawdownPct: 35,
      ...baseSigned,
    } as any);

    const updateArgs = (tx.copyVault.update as jest.Mock).mock.calls[0][0];
    expect(updateArgs.data.copyMultiplier.toString()).toBe('2');
    expect(updateArgs.data.maxPerTradeUsdt.toString()).toBe('500');
    expect(updateArgs.data.stopLossPct.toString()).toBe('25');
    expect(updateArgs.data.maxDrawdownPct.toString()).toBe('35');
  });
});

describe('RISK-BE: copy-engine application', () => {
  beforeEach(() => jest.clearAllMocks());

  it('scales the copied position by copyMultiplier', async () => {
    const { captured } = wireSignalTx(
      vault({ copyMultiplier: { toString: () => '2' } }),
    );

    await copytradeService.createSignal('leader-1', signalInput() as any);

    // leader amountIn 1000 * 2x = 2000
    expect(captured.signalAmountIn).toBeCloseTo(2000, 6);
  });

  it('caps the copied position by maxPerTradeUsdt', async () => {
    const { captured } = wireSignalTx(
      vault({
        copyMultiplier: { toString: () => '5' },
        maxPerTradeUsdt: { toString: () => '1500' },
      }),
    );

    await copytradeService.createSignal('leader-1', signalInput() as any);

    // 1000 * 5x = 5000, capped to 1500
    expect(captured.signalAmountIn).toBeCloseTo(1500, 6);
  });

  it('multiplier below cap leaves position unchanged by the cap', async () => {
    const { captured } = wireSignalTx(
      vault({
        copyMultiplier: { toString: () => '1.2' },
        maxPerTradeUsdt: { toString: () => '5000' },
      }),
    );

    await copytradeService.createSignal('leader-1', signalInput() as any);

    expect(captured.signalAmountIn).toBeCloseTo(1200, 6);
  });

  it('halts copy and pauses vault when stopLossPct is breached', async () => {
    wireSignalTx(
      vault({
        stopLossPct: { toString: () => '20' },
        totalDeposits: { toString: () => '100000' },
        totalEquity: { toString: () => '70000' }, // 30% loss >= 20%
      }),
    );

    await expect(
      copytradeService.createSignal('leader-1', signalInput() as any),
    ).rejects.toThrow(/risk limits/i);

    expect(mockPrisma.copyVault.update as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'PAUSED' } }),
    );
  });

  it('halts copy and pauses vault when maxDrawdownPct is breached', async () => {
    wireSignalTx(
      vault({
        maxDrawdownPct: { toString: () => '25' },
        totalDeposits: { toString: () => '100000' },
        totalWithdrawals: { toString: () => '0' },
        totalEquity: { toString: () => '60000' }, // peak 100k, 40% drawdown
      }),
    );

    await expect(
      copytradeService.createSignal('leader-1', signalInput() as any),
    ).rejects.toThrow(/risk limits/i);

    expect(mockPrisma.copyVault.update as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'PAUSED' } }),
    );
  });

  it('does not halt when within stopLoss/drawdown thresholds', async () => {
    const { captured } = wireSignalTx(
      vault({
        stopLossPct: { toString: () => '50' },
        maxDrawdownPct: { toString: () => '50' },
        totalDeposits: { toString: () => '100000' },
        totalEquity: { toString: () => '90000' }, // 10% loss < 50%
      }),
    );

    await copytradeService.createSignal('leader-1', signalInput() as any);
    expect(captured.signalAmountIn).toBeCloseTo(1000, 6);
  });
});
