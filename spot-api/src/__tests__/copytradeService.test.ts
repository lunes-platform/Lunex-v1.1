// BE-01 / BE-02 / BE-04: CopyVault deposits and withdrawals are journaled ONLY
// from a finalized, follower-signed on-chain tx (no db-journal mode, no
// relayer-signed fund movement), replay-protected by txHash, and a follower
// deposit never rewrites the vault-wide risk config.

jest.mock('../db', () => ({
  __esModule: true,
  default: {
    $transaction: jest.fn(),
    copyVault: {
      findUnique: jest.fn(),
    },
    copyVaultPosition: {
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    copyVaultDeposit: {
      findUnique: jest.fn(),
    },
    copyVaultWithdrawal: {
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
    verifyDeposit: jest.fn(),
    verifyWithdrawal: jest.fn(),
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

const TX = `0x${'ab'.repeat(32)}`;
const BLOCK = `0x${'cd'.repeat(32)}`;

function createVaultRecord(overrides?: Partial<any>) {
  return {
    id: 'vault-1',
    leaderId: 'leader-1',
    collateralToken: 'LUNES',
    status: 'ACTIVE',
    contractAddress: '5Fvault',
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
}) {
  const vault = createVaultRecord(overrides?.vault);
  const position = createPositionRecord(overrides?.position);
  return {
    copyVault: {
      findUnique: jest.fn().mockResolvedValue(vault),
      update: jest.fn().mockResolvedValue({}),
    },
    copyVaultPosition: {
      findUnique: jest.fn().mockResolvedValue(position),
      update: jest
        .fn()
        .mockResolvedValue({ shareBalance: { toString: () => '50' } }),
    },
    copyVaultWithdrawal: {
      create: jest.fn().mockResolvedValue({ id: 'withdrawal-1' }),
    },
    leader: {
      update: jest.fn().mockResolvedValue({}),
    },
  };
}

function createDepositTxMocks(overrides?: {
  existingPosition?: Partial<any> | null;
}) {
  const existingPosition =
    overrides?.existingPosition === null || !overrides?.existingPosition
      ? null
      : createPositionRecord(overrides.existingPosition);
  return {
    copyVault: {
      findUnique: jest.fn().mockResolvedValue(createVaultRecord()),
      update: jest.fn().mockResolvedValue({}),
    },
    copyVaultPosition: {
      findUnique: jest.fn().mockResolvedValue(existingPosition),
      update: jest.fn().mockResolvedValue({ id: 'position-1' }),
      create: jest.fn().mockResolvedValue({ id: 'position-1' }),
    },
    copyVaultDeposit: {
      create: jest.fn().mockResolvedValue({ id: 'deposit-1' }),
    },
    leader: {
      update: jest.fn().mockResolvedValue({}),
    },
  };
}

const depositInput = {
  followerAddress: 'follower-1',
  token: 'LUNES',
  amount: '100',
  stopLossPct: 20,
  copyMultiplier: 10,
  maxPerTradeUsdt: 0,
  txHash: TX,
  blockHash: BLOCK,
  nonce: 'test-nonce',
  timestamp: Date.now(),
  signature: 'signed',
};

const withdrawInput = {
  followerAddress: 'follower-1',
  shares: '50',
  txHash: TX,
  blockHash: BLOCK,
  nonce: 'test-nonce',
  timestamp: Date.now(),
  signature: 'signed',
};

function useTx(tx: unknown) {
  (mockPrisma.$transaction as jest.Mock).mockImplementation(
    async (callback: (client: unknown) => unknown) => callback(tx),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCopyVaultService.isEnabled.mockReturnValue(true);
  (mockPrisma.copyVault.findUnique as jest.Mock).mockResolvedValue(
    createVaultRecord(),
  );
  (mockPrisma.copyVaultDeposit.findUnique as jest.Mock).mockResolvedValue(
    null,
  );
  (mockPrisma.copyVaultWithdrawal.findUnique as jest.Mock).mockResolvedValue(
    null,
  );
  mockCopyVaultService.verifyDeposit.mockResolvedValue({
    kind: 'deposit',
    txHash: TX,
    blockHash: BLOCK,
    blockNumber: 10,
    amount: '100',
    shares: '5',
    performanceFee: '0',
  });
  mockCopyVaultService.verifyWithdrawal.mockResolvedValue({
    kind: 'withdraw',
    txHash: TX,
    blockHash: BLOCK,
    blockNumber: 11,
    amount: '910',
    shares: '50',
    performanceFee: '90',
  });
});

describe('copytradeService.depositToVault (BE-01/BE-02)', () => {
  it('rejects deposits into a vault without an on-chain contract (no db-journal credit)', async () => {
    (mockPrisma.copyVault.findUnique as jest.Mock).mockResolvedValue(
      createVaultRecord({ contractAddress: null }),
    );

    await expect(
      copytradeService.depositToVault('leader-1', depositInput),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mockCopyVaultService.verifyDeposit).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('fails closed (503) when on-chain verification is unavailable', async () => {
    mockCopyVaultService.isEnabled.mockReturnValue(false);

    await expect(
      copytradeService.depositToVault('leader-1', depositInput),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a contract vault whose collateral is not native LUNES', async () => {
    (mockPrisma.copyVault.findUnique as jest.Mock).mockResolvedValue(
      createVaultRecord({ collateralToken: 'USDT' }),
    );

    await expect(
      copytradeService.depositToVault('leader-1', {
        ...depositInput,
        token: 'USDT',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mockCopyVaultService.verifyDeposit).not.toHaveBeenCalled();
  });

  it('rejects a txHash that was already credited (replay)', async () => {
    (mockPrisma.copyVaultDeposit.findUnique as jest.Mock).mockResolvedValue({
      id: 'deposit-0',
    });

    await expect(
      copytradeService.depositToVault('leader-1', depositInput),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mockCopyVaultService.verifyDeposit).not.toHaveBeenCalled();
  });

  it('maps a concurrent unique-constraint race on txHash to 409', async () => {
    const tx = createDepositTxMocks();
    tx.copyVaultDeposit.create.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );
    useTx(tx);

    await expect(
      copytradeService.depositToVault('leader-1', depositInput),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('propagates proof failures and never journals', async () => {
    mockCopyVaultService.verifyDeposit.mockRejectedValue(
      Object.assign(new Error('Transaction signer is not the follower'), {
        statusCode: 422,
      }),
    );

    await expect(
      copytradeService.depositToVault('leader-1', depositInput),
    ).rejects.toThrow(/signer/);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects when the signed amount differs from the on-chain amount', async () => {
    await expect(
      copytradeService.depositToVault('leader-1', {
        ...depositInput,
        amount: '1000000000',
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('credits amount and shares from the verified chain event and stores txHash/blockHash', async () => {
    const tx = createDepositTxMocks();
    useTx(tx);

    const result = await copytradeService.depositToVault(
      'leader-1',
      depositInput,
    );

    expect(mockCopyVaultService.verifyDeposit).toHaveBeenCalledWith({
      vaultAddress: '5Fvault',
      followerAddress: 'follower-1',
      txHash: TX,
      blockHash: BLOCK,
    });
    expect(result).toMatchObject({
      depositId: 'deposit-1',
      sharesMinted: 5,
      amount: 100,
      txHash: TX,
      blockHash: BLOCK,
      executionMode: 'on-chain-confirmed',
    });
    const depositCreate = tx.copyVaultDeposit.create.mock.calls[0][0];
    expect(depositCreate.data).toMatchObject({ txHash: TX, blockHash: BLOCK });
    expect(Number(depositCreate.data.sharesMinted.toString())).toBe(5);
  });

  it('BE-04: never writes follower risk params onto the shared vault; stopLoss goes to the position', async () => {
    const tx = createDepositTxMocks();
    useTx(tx);

    await copytradeService.depositToVault('leader-1', depositInput);

    const vaultUpdate = tx.copyVault.update.mock.calls[0][0];
    expect(vaultUpdate.data).not.toHaveProperty('copyMultiplier');
    expect(vaultUpdate.data).not.toHaveProperty('maxPerTradeUsdt');
    expect(vaultUpdate.data).not.toHaveProperty('stopLossPct');
    expect(vaultUpdate.data).not.toHaveProperty('maxDrawdownPct');

    const positionCreate = tx.copyVaultPosition.create.mock.calls[0][0];
    expect(Number(positionCreate.data.stopLossPct.toString())).toBe(20);
  });
});

describe('copytradeService.withdrawFromVault (BE-01/BE-02)', () => {
  it('rejects withdrawals from a vault without an on-chain contract', async () => {
    (mockPrisma.copyVault.findUnique as jest.Mock).mockResolvedValue(
      createVaultRecord({ contractAddress: null }),
    );

    await expect(
      copytradeService.withdrawFromVault('leader-1', withdrawInput),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockAffiliateService.distributeCommissions).not.toHaveBeenCalled();
  });

  it('rejects a replayed withdrawal txHash', async () => {
    (mockPrisma.copyVaultWithdrawal.findUnique as jest.Mock).mockResolvedValue(
      { id: 'withdrawal-0' },
    );

    await expect(
      copytradeService.withdrawFromVault('leader-1', withdrawInput),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mockCopyVaultService.verifyWithdrawal).not.toHaveBeenCalled();
  });

  it('rejects when the signed shares differ from the on-chain burn', async () => {
    await expect(
      copytradeService.withdrawFromVault('leader-1', {
        ...withdrawInput,
        shares: '99',
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('journals shares, net payout and fee from the Withdrawn event and accrues commissions on the on-chain fee', async () => {
    const tx = createWithdrawTxMocks();
    useTx(tx);
    mockAffiliateService.distributeCommissions.mockResolvedValue([]);

    const result = await copytradeService.withdrawFromVault(
      'leader-1',
      withdrawInput,
    );

    expect(result).toMatchObject({
      withdrawalId: 'withdrawal-1',
      grossAmount: 1000,
      feeAmount: 90,
      netAmount: 910,
      profitAmount: 600,
      remainingShares: 50,
      txHash: TX,
      executionMode: 'on-chain-confirmed',
    });

    const positionUpdate = tx.copyVaultPosition.update.mock.calls[0][0];
    expect(
      Number(positionUpdate.data.shareBalance.decrement.toString()),
    ).toBeCloseTo(50, 10);
    expect(
      Number(positionUpdate.data.feePaid.increment.toString()),
    ).toBeCloseTo(90, 10);
    expect(
      Number(positionUpdate.data.highWaterMarkValue.toString()),
    ).toBeCloseTo(400, 10);

    const vaultUpdate = tx.copyVault.update.mock.calls[0][0];
    expect(
      Number(vaultUpdate.data.totalEquity.decrement.toString()),
    ).toBeCloseTo(1000, 10);

    const withdrawalCreate = tx.copyVaultWithdrawal.create.mock.calls[0][0];
    expect(withdrawalCreate.data).toMatchObject({
      txHash: TX,
      blockHash: BLOCK,
    });

    expect(mockAffiliateService.distributeCommissions).toHaveBeenCalledWith(
      'follower-1',
      'LUNES',
      90,
      'COPYTRADE',
      'withdrawal-1',
    );
  });

  it('does not accrue commissions when the on-chain fee is zero', async () => {
    mockCopyVaultService.verifyWithdrawal.mockResolvedValue({
      kind: 'withdraw',
      txHash: TX,
      blockHash: BLOCK,
      blockNumber: 11,
      amount: '1000',
      shares: '50',
      performanceFee: '0',
    });
    const tx = createWithdrawTxMocks();
    useTx(tx);

    const result = await copytradeService.withdrawFromVault(
      'leader-1',
      withdrawInput,
    );

    expect(result.feeAmount).toBe(0);
    expect(result.netAmount).toBe(1000);
    expect(mockAffiliateService.distributeCommissions).not.toHaveBeenCalled();
  });

  it('refuses to burn more shares than the journaled position holds', async () => {
    const tx = createWithdrawTxMocks({
      position: { shareBalance: { toString: () => '10' } },
    });
    useTx(tx);

    await expect(
      copytradeService.withdrawFromVault('leader-1', withdrawInput),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(tx.copyVaultWithdrawal.create).not.toHaveBeenCalled();
  });
});

describe('copytradeService.getVaultByLeader (BE-11)', () => {
  it('serves aggregates only — no per-follower positions or addresses', async () => {
    (mockPrisma.copyVault.findUnique as jest.Mock).mockResolvedValue({
      ...createVaultRecord(),
      totalDeposits: { toString: () => '2000' },
      totalWithdrawals: { toString: () => '0' },
      twapThreshold: { toString: () => '50000' },
      maxSlippageBps: 100,
      leader: {
        id: 'leader-1',
        name: 'Leader',
        username: 'leader',
        address: '5Fleader',
        isAi: false,
        performanceFeeBps: 1500,
      },
    });
    (mockPrisma.copyVaultPosition.count as jest.Mock).mockResolvedValue(7);

    const result = await copytradeService.getVaultByLeader('leader-1');

    expect(result).not.toHaveProperty('positions');
    expect(JSON.stringify(result)).not.toMatch(/followerAddress/);
    expect(result).toMatchObject({
      activePositions: 7,
      contractAddress: '5Fvault',
    });
  });
});
