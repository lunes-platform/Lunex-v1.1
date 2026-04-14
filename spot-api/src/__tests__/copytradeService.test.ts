jest.mock('../db', () => ({
  __esModule: true,
  default: {
    $transaction: jest.fn(),
    copyVault: {
      findUnique: jest.fn(),
    },
    copyVaultPosition: {
      findUnique: jest.fn(),
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

jest.mock('../services/affiliateService', () => ({
  affiliateService: {
    distributeCommissions: jest.fn(),
  },
}));

jest.mock('../services/copyVaultService', () => ({
  copyVaultService: {
    isEnabled: jest.fn(),
    deposit: jest.fn(),
    withdraw: jest.fn(),
  },
}));

import prisma from '../db';
import { copytradeService } from '../services/copytradeService';
import { affiliateService } from '../services/affiliateService';
import { copyVaultService } from '../services/copyVaultService';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockAffiliateService = affiliateService as jest.Mocked<
  typeof affiliateService
>;
const mockCopyVaultService = copyVaultService as jest.Mocked<
  typeof copyVaultService
>;

function createVaultRecord(overrides?: Partial<any>) {
  return {
    id: 'vault-1',
    leaderId: 'leader-1',
    collateralToken: 'USDT',
    status: 'ACTIVE',
    contractAddress: null,
    minDeposit: { toString: () => '10' },
    totalShares: { toString: () => '100' },
    totalEquity: { toString: () => '2000' },
    leader: {
      performanceFeeBps: 1500,
    },
    ...overrides,
  };
}

function createPositionRecord(overrides?: Partial<any>) {
  return {
    id: 'position-1',
    vaultId: 'vault-1',
    followerAddress: 'follower-1',
    shareBalance: { toString: () => '100' },
    highWaterMarkValue: { toString: () => '800' },
    ...overrides,
  };
}

function createWithdrawTxMocks(overrides?: {
  vault?: Partial<any>;
  position?: Partial<any>;
  updatedPosition?: Partial<any>;
  withdrawalId?: string;
}) {
  const vault = createVaultRecord(overrides?.vault);
  const position = createPositionRecord(overrides?.position);

  const updatedPosition = {
    shareBalance: { toString: () => '50' },
    ...overrides?.updatedPosition,
  };

  return {
    copyVault: {
      findUnique: jest.fn().mockResolvedValue(vault),
      update: jest.fn().mockResolvedValue({}),
    },
    copyVaultPosition: {
      findUnique: jest.fn().mockResolvedValue(position),
      update: jest.fn().mockResolvedValue(updatedPosition),
    },
    copyVaultWithdrawal: {
      create: jest
        .fn()
        .mockResolvedValue({ id: overrides?.withdrawalId || 'withdrawal-1' }),
    },
    leader: {
      update: jest.fn().mockResolvedValue({}),
    },
  };
}

function createDepositTxMocks(overrides?: {
  vault?: Partial<any>;
  existingPosition?: Partial<any> | null;
  createdPosition?: Partial<any>;
  depositId?: string;
}) {
  const vault = createVaultRecord(overrides?.vault);
  const existingPosition =
    overrides?.existingPosition === null
      ? null
      : createPositionRecord(overrides?.existingPosition);
  const createdPosition = {
    id: 'position-1',
    ...overrides?.createdPosition,
  };

  return {
    copyVault: {
      findUnique: jest.fn().mockResolvedValue(vault),
      update: jest.fn().mockResolvedValue({}),
    },
    copyVaultPosition: {
      findUnique: jest.fn().mockResolvedValue(existingPosition),
      update: jest.fn().mockResolvedValue(createdPosition),
      create: jest.fn().mockResolvedValue(createdPosition),
    },
    copyVaultDeposit: {
      create: jest
        .fn()
        .mockResolvedValue({ id: overrides?.depositId || 'deposit-1' }),
    },
    leaderFollow: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    leader: {
      update: jest.fn().mockResolvedValue({}),
    },
  };
}

describe('copytradeService.depositToVault', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCopyVaultService.isEnabled.mockReturnValue(false);
  });

  it('persists db-journal deposits when on-chain confirmation is unavailable', async () => {
    const tx = createDepositTxMocks({ existingPosition: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockPrisma.$transaction as jest.Mock).mockImplementation(
      async (callback: any) => callback(tx),
    );

    const result = await copytradeService.depositToVault('leader-1', {
      followerAddress: 'follower-1',
      token: 'USDT',
      amount: '100',
      nonce: 'test-nonce',
      timestamp: Date.now(),
      signature: 'signed',
    });

    expect(mockCopyVaultService.deposit).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      depositId: 'deposit-1',
      sharesMinted: 5,
      amount: 100,
      positionId: 'position-1',
      txHash: null,
      executionMode: 'db-journal',
    });

    const depositCreate = (tx.copyVaultDeposit.create as jest.Mock).mock
      .calls[0][0];
    expect(depositCreate.data.txHash).toBeNull();
  });

  it('records txHash when deposit is confirmed on-chain before db journaling', async () => {
    const tx = createDepositTxMocks({
      existingPosition: null,
      vault: { contractAddress: '5Fvault' },
    });
    mockCopyVaultService.isEnabled.mockReturnValue(true);
    mockCopyVaultService.deposit.mockResolvedValue({
      txHash: '0xdeposit',
      blockHash: '0xblock',
      shares: '0',
      success: true,
    });
    (mockPrisma.copyVault.findUnique as jest.Mock).mockResolvedValue(
      createVaultRecord({ contractAddress: '5Fvault' }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockPrisma.$transaction as jest.Mock).mockImplementation(
      async (callback: any) => callback(tx),
    );

    const result = await copytradeService.depositToVault('leader-1', {
      followerAddress: 'follower-1',
      token: 'USDT',
      amount: '100',
      nonce: 'test-nonce',
      timestamp: Date.now(),
      signature: 'signed',
    });

    expect(mockCopyVaultService.deposit).toHaveBeenCalledWith(
      '5Fvault',
      'follower-1',
      '100',
    );
    expect(result).toMatchObject({
      depositId: 'deposit-1',
      txHash: '0xdeposit',
      executionMode: 'on-chain-confirmed',
    });

    const depositCreate = (tx.copyVaultDeposit.create as jest.Mock).mock
      .calls[0][0];
    expect(depositCreate.data.txHash).toBe('0xdeposit');
  });
});

describe('copytradeService.withdrawFromVault', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCopyVaultService.isEnabled.mockReturnValue(false);
  });

  it('applies HWM performance fee, preserves gross/net accounting and accrues leader fees', async () => {
    const tx = createWithdrawTxMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockPrisma.$transaction as jest.Mock).mockImplementation(
      async (callback: any) => callback(tx),
    );
    mockAffiliateService.distributeCommissions.mockResolvedValue([]);

    const result = await copytradeService.withdrawFromVault('leader-1', {
      followerAddress: 'follower-1',
      shares: '50',
      nonce: 'test-nonce',
      timestamp: Date.now(),
      signature: 'signed',
    });

    expect(result).toMatchObject({
      withdrawalId: 'withdrawal-1',
      grossAmount: 1000,
      feeAmount: 90,
      netAmount: 910,
      profitAmount: 600,
      remainingShares: 50,
      collateralToken: 'USDT',
      followerAddress: 'follower-1',
      txHash: null,
      executionMode: 'db-journal',
    });

    const positionUpdate = (tx.copyVaultPosition.update as jest.Mock).mock
      .calls[0][0];
    expect(
      Number(positionUpdate.data.totalWithdrawn.increment.toString()),
    ).toBeCloseTo(910, 10);
    expect(
      Number(positionUpdate.data.feePaid.increment.toString()),
    ).toBeCloseTo(90, 10);
    expect(
      Number(positionUpdate.data.realizedPnl.increment.toString()),
    ).toBeCloseTo(510, 10);
    expect(
      Number(positionUpdate.data.highWaterMarkValue.toString()),
    ).toBeCloseTo(400, 10);

    const vaultUpdate = (tx.copyVault.update as jest.Mock).mock.calls[0][0];
    expect(
      Number(vaultUpdate.data.totalShares.decrement.toString()),
    ).toBeCloseTo(50, 10);
    expect(
      Number(vaultUpdate.data.totalEquity.decrement.toString()),
    ).toBeCloseTo(1000, 10);
    expect(
      Number(vaultUpdate.data.totalWithdrawals.increment.toString()),
    ).toBeCloseTo(910, 10);

    const leaderUpdate = (tx.leader.update as jest.Mock).mock.calls[0][0];
    expect(Number(leaderUpdate.data.totalAum.decrement.toString())).toBeCloseTo(
      1000,
      10,
    );
    expect(
      Number(leaderUpdate.data.totalPerformanceFeesEarned.increment.toString()),
    ).toBeCloseTo(90, 10);

    expect(mockAffiliateService.distributeCommissions).toHaveBeenCalledWith(
      'follower-1',
      'USDT',
      90,
      'COPYTRADE',
      'withdrawal-1',
    );
  });

  it('does not accrue affiliate commissions when there is no profit above HWM', async () => {
    const tx = createWithdrawTxMocks({
      position: {
        highWaterMarkValue: { toString: () => '2400' },
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockPrisma.$transaction as jest.Mock).mockImplementation(
      async (callback: any) => callback(tx),
    );
    mockAffiliateService.distributeCommissions.mockResolvedValue([]);

    const result = await copytradeService.withdrawFromVault('leader-1', {
      followerAddress: 'follower-1',
      shares: '50',
      nonce: 'test-nonce',
      timestamp: Date.now(),
      signature: 'signed',
    });

    expect(result.feeAmount).toBe(0);
    expect(result.netAmount).toBe(1000);
    expect(result.profitAmount).toBe(0);
    expect(result.executionMode).toBe('db-journal');

    const leaderUpdate = (tx.leader.update as jest.Mock).mock.calls[0][0];
    expect(
      Number(leaderUpdate.data.totalPerformanceFeesEarned.increment.toString()),
    ).toBeCloseTo(0, 10);
    expect(mockAffiliateService.distributeCommissions).not.toHaveBeenCalled();
  });

  it('records txHash when withdrawal is confirmed on-chain before db journaling', async () => {
    const tx = createWithdrawTxMocks({
      vault: { contractAddress: '5Fvault' },
    });
    mockCopyVaultService.isEnabled.mockReturnValue(true);
    mockCopyVaultService.withdraw.mockResolvedValue({
      txHash: '0xwithdraw',
      blockHash: '0xblock',
      amount: '0',
      success: true,
    });
    (mockPrisma.copyVault.findUnique as jest.Mock).mockResolvedValue(
      createVaultRecord({ contractAddress: '5Fvault' }),
    );
    (mockPrisma.copyVaultPosition.findUnique as jest.Mock).mockResolvedValue(
      createPositionRecord(),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockPrisma.$transaction as jest.Mock).mockImplementation(
      async (callback: any) => callback(tx),
    );
    mockAffiliateService.distributeCommissions.mockResolvedValue([]);

    const result = await copytradeService.withdrawFromVault('leader-1', {
      followerAddress: 'follower-1',
      shares: '50',
      nonce: 'test-nonce',
      timestamp: Date.now(),
      signature: 'signed',
    });

    expect(mockCopyVaultService.withdraw).toHaveBeenCalledWith(
      '5Fvault',
      'follower-1',
      '50',
    );
    expect(result).toMatchObject({
      withdrawalId: 'withdrawal-1',
      txHash: '0xwithdraw',
      executionMode: 'on-chain-confirmed',
    });

    const withdrawalCreate = (tx.copyVaultWithdrawal.create as jest.Mock).mock
      .calls[0][0];
    expect(withdrawalCreate.data.txHash).toBe('0xwithdraw');
  });
});
