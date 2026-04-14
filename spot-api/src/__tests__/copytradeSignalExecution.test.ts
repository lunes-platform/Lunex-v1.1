jest.mock('../db', () => ({
  __esModule: true,
  default: {
    $transaction: jest.fn(),
    copyVault: {
      findUnique: jest.fn(),
    },
    pair: {
      findUnique: jest.fn(),
    },
    leaderTrade: {
      findFirst: jest.fn(),
    },
    trade: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    copyTradeWalletContinuation: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
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

jest.mock('../services/routerService', () => ({
  routerService: {
    executeViaRouter: jest.fn(),
  },
}));

import prisma from '../db';
import { copytradeService } from '../services/copytradeService';
import { routerService } from '../services/routerService';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockRouterService = routerService as jest.Mocked<typeof routerService>;

function decimalLike(value: number | string) {
  return {
    toString: () => value.toString(),
  };
}

function createVault(overrides?: Partial<any>) {
  return {
    id: 'vault-1',
    leaderId: 'leader-1',
    status: 'ACTIVE',
    totalEquity: decimalLike(1000),
    contractAddress: '5Fvault',
    twapThreshold: decimalLike(50000),
    maxSlippageBps: 150,
    leader: {
      address: 'leader-wallet-1',
      pnlHistory: [],
    },
    ...overrides,
  };
}

function createPair(overrides?: Partial<any>) {
  return {
    id: 'pair-1',
    symbol: 'LUNES/USDT',
    ...overrides,
  };
}

function createSignalTxMocks() {
  return {
    copyTradeSignal: {
      create: jest.fn().mockImplementation(async ({ data }: any) => ({
        id: 'signal-1',
        ...data,
      })),
    },
    copyTradeExecution: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation(async ({ data }: any) => ({
        id: `exec-${data.sliceIndex}`,
        ...data,
      })),
    },
    copyTradeWalletContinuation: {
      create: jest.fn().mockImplementation(async ({ data }: any) => ({
        id: 'continuation-1',
        signalId: data.signalId,
        positionEffect: data.positionEffect,
        status: data.status,
        txHash: null,
      })),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    leaderTrade: {
      create: jest.fn().mockResolvedValue({ id: 'leader-trade-1' }),
      update: jest.fn().mockResolvedValue({ id: 'leader-trade-1' }),
    },
    copyVault: {
      update: jest.fn().mockResolvedValue({ totalEquity: decimalLike(1000) }),
    },
    leader: {
      update: jest.fn().mockResolvedValue({}),
    },
  };
}

describe('copytradeService.createSignal Option B', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockPrisma.copyVault.findUnique as jest.Mock).mockResolvedValue(
      createVault(),
    );
    (mockPrisma.pair.findUnique as jest.Mock).mockResolvedValue(createPair());
    (mockPrisma.leaderTrade.findFirst as jest.Mock).mockResolvedValue(null);
    (mockPrisma.trade.findFirst as jest.Mock).mockResolvedValue({
      price: decimalLike(4),
    });
    (mockPrisma.trade.findMany as jest.Mock).mockResolvedValue([]);
  });

  it('executes a live vault order when AUTO resolves to ORDERBOOK on a contract-backed vault', async () => {
    const tx = createSignalTxMocks();
    (mockPrisma.$transaction as jest.Mock).mockImplementation(
      async (callback: any) => callback(tx),
    );

    mockRouterService.executeViaRouter.mockResolvedValue({
      executedVia: 'ORDERBOOK',
      success: true,
      order: {
        id: 'order-1',
        status: 'FILLED',
      },
    } as any);
    (mockPrisma.trade.findMany as jest.Mock).mockResolvedValue([
      {
        amount: decimalLike(100),
        quoteAmount: decimalLike(400),
        price: decimalLike(4),
      },
    ]);

    const result = await copytradeService.createSignal('leader-1', {
      pairSymbol: 'LUNES/USDT',
      side: 'SELL',
      positionEffect: 'OPEN',
      signalMode: 'AUTO',
      source: 'API',
      amountIn: '100',
      amountOutMin: '380',
      maxSlippageBps: 100,
    });

    expect(mockRouterService.executeViaRouter).toHaveBeenCalledWith(
      expect.objectContaining({
        pairSymbol: 'LUNES/USDT',
        side: 'SELL',
        amountIn: 100,
        maxSlippageBps: 100,
        makerAddress: '5Fvault',
        agentId: 'leader-1',
        nonce: expect.any(String),
      }),
    );

    expect(result).toMatchObject({
      signalId: 'signal-1',
      signalModeResolved: 'EXECUTE_VAULT',
      executedVia: 'ORDERBOOK',
      orderId: 'order-1',
      amountIn: 100,
      totalAmountOut: 400,
      executionPrice: 4,
      positionEffect: 'OPEN',
    });

    const executionCreate = (tx.copyTradeExecution.create as jest.Mock).mock
      .calls[0][0];
    expect(Number(executionCreate.data.amountIn.toString())).toBeCloseTo(
      100,
      10,
    );
    expect(Number(executionCreate.data.amountOut.toString())).toBeCloseTo(
      400,
      10,
    );
  });

  it('executes a live vault order when AUTO resolves to AMM_V1 on a contract-backed vault', async () => {
    const tx = createSignalTxMocks();
    (mockPrisma.$transaction as jest.Mock).mockImplementation(
      async (callback: any) => callback(tx),
    );

    mockRouterService.executeViaRouter.mockResolvedValue({
      executedVia: 'AMM_V1',
      success: true,
      order: {
        id: 'order-amm-1',
        status: 'FILLED',
      },
    } as any);
    (mockPrisma.trade.findMany as jest.Mock).mockResolvedValue([
      {
        amount: decimalLike(100),
        quoteAmount: decimalLike(405),
        price: decimalLike(4.05),
      },
    ]);

    const result = await copytradeService.createSignal('leader-1', {
      pairSymbol: 'LUNES/USDT',
      side: 'SELL',
      positionEffect: 'OPEN',
      signalMode: 'AUTO',
      source: 'API',
      amountIn: '100',
      amountOutMin: '380',
      maxSlippageBps: 100,
    });

    expect(mockRouterService.executeViaRouter).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      signalId: 'signal-1',
      signalModeResolved: 'EXECUTE_VAULT',
      executedVia: 'AMM_V1',
      orderId: 'order-amm-1',
      amountIn: 100,
      totalAmountOut: 405,
      executionPrice: 4.05,
      positionEffect: 'OPEN',
    });
  });

  it('falls back to journaling when AUTO cannot live-execute because ASYMMETRIC requires wallet signature', async () => {
    const tx = createSignalTxMocks();
    (mockPrisma.$transaction as jest.Mock).mockImplementation(
      async (callback: any) => callback(tx),
    );

    mockRouterService.executeViaRouter.mockResolvedValue({
      executedVia: 'ASYMMETRIC',
      success: true,
      requiresWalletSignature: true,
      contractCallIntent: {
        contractAddress: '5Fasym',
        method: 'swap',
        side: 'SELL',
        amountIn: 100,
        minAmountOut: 420,
        makerAddress: '5Fvault',
        nonce: 'copytrade_vault_vault-1_1700000000000',
        agentId: 'leader-1',
      },
      message: 'needs wallet signature',
    } as any);

    const result = await copytradeService.createSignal('leader-1', {
      pairSymbol: 'LUNES/USDT',
      side: 'SELL',
      positionEffect: 'OPEN',
      signalMode: 'AUTO',
      source: 'API',
      amountIn: '100',
      amountOutMin: '380',
      maxSlippageBps: 100,
    });

    expect(mockRouterService.executeViaRouter).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      signalId: 'signal-1',
      signalModeResolved: 'JOURNAL',
      executedVia: null,
      orderId: null,
      isPendingWalletSignature: true,
      amountIn: 100,
      totalAmountOut: 400,
      executionPrice: 4,
      positionEffect: 'OPEN',
      walletAssistedContinuation: {
        executedVia: 'ASYMMETRIC',
        requiresWalletSignature: true,
        contractCallIntent: {
          contractAddress: '5Fasym',
          method: 'swap',
          side: 'SELL',
          amountIn: 100,
          minAmountOut: 420,
          makerAddress: '5Fvault',
          agentId: 'leader-1',
        },
        message: 'needs wallet signature',
      },
    });
    expect(result.slices).toHaveLength(0);
    expect(tx.copyTradeExecution.create).not.toHaveBeenCalled();
    expect(tx.copyTradeWalletContinuation.create).toHaveBeenCalledTimes(1);
  });

  it('falls back to journaling when AUTO live execution errors at runtime', async () => {
    const tx = createSignalTxMocks();
    (mockPrisma.$transaction as jest.Mock).mockImplementation(
      async (callback: any) => callback(tx),
    );

    mockRouterService.executeViaRouter.mockRejectedValue(
      new Error('route execution unavailable'),
    );

    const result = await copytradeService.createSignal('leader-1', {
      pairSymbol: 'LUNES/USDT',
      side: 'SELL',
      positionEffect: 'OPEN',
      signalMode: 'AUTO',
      source: 'API',
      amountIn: '100',
      amountOutMin: '380',
      maxSlippageBps: 100,
    });

    expect(mockRouterService.executeViaRouter).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      signalId: 'signal-1',
      signalModeResolved: 'JOURNAL',
      executedVia: null,
      orderId: null,
      amountIn: 100,
      totalAmountOut: 400,
      executionPrice: 4,
      positionEffect: 'OPEN',
    });
  });

  it('keeps EXECUTE_VAULT strict and fails when live execution errors', async () => {
    const tx = createSignalTxMocks();
    (mockPrisma.$transaction as jest.Mock).mockImplementation(
      async (callback: any) => callback(tx),
    );

    mockRouterService.executeViaRouter.mockRejectedValue(
      new Error('route execution unavailable'),
    );

    await expect(
      copytradeService.createSignal('leader-1', {
        pairSymbol: 'LUNES/USDT',
        side: 'SELL',
        positionEffect: 'OPEN',
        signalMode: 'EXECUTE_VAULT',
        source: 'API',
        amountIn: '100',
        amountOutMin: '380',
        maxSlippageBps: 100,
      }),
    ).rejects.toThrow('route execution unavailable');
  });

  it('keeps EXECUTE_VAULT strict when best route requires wallet signature', async () => {
    const tx = createSignalTxMocks();
    (mockPrisma.$transaction as jest.Mock).mockImplementation(
      async (callback: any) => callback(tx),
    );

    mockRouterService.executeViaRouter.mockResolvedValue({
      executedVia: 'ASYMMETRIC',
      success: true,
      requiresWalletSignature: true,
      message: 'needs wallet signature',
    } as any);

    await expect(
      copytradeService.createSignal('leader-1', {
        pairSymbol: 'LUNES/USDT',
        side: 'SELL',
        positionEffect: 'OPEN',
        signalMode: 'EXECUTE_VAULT',
        source: 'API',
        amountIn: '100',
        amountOutMin: '380',
        maxSlippageBps: 100,
      }),
    ).rejects.toThrow(
      'Live vault execution requires a server-executable route; ASYMMETRIC needs wallet signature',
    );
  });

  it('rejects OPEN signals when requested notional exceeds vault equity', async () => {
    (mockPrisma.copyVault.findUnique as jest.Mock).mockResolvedValue(
      createVault({ totalEquity: decimalLike(50) }),
    );

    await expect(
      copytradeService.createSignal('leader-1', {
        pairSymbol: 'LUNES/USDT',
        side: 'BUY',
        positionEffect: 'OPEN',
        signalMode: 'AUTO',
        source: 'API',
        amountIn: '120',
        amountOutMin: '20',
        maxSlippageBps: 100,
      }),
    ).rejects.toThrow('exceeds vault equity');

    expect(mockRouterService.executeViaRouter).not.toHaveBeenCalled();
  });

  it('confirms a pending wallet-assisted signal and records execution', async () => {
    const tx = {
      copyTradeSignal: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'signal-1',
          leaderId: 'leader-1',
          vaultId: 'vault-1',
          pairId: 'pair-1',
          pairSymbol: 'LUNES/USDT',
          side: 'SELL',
          amountIn: decimalLike(100),
          amountOutMin: decimalLike(380),
          executionPrice: decimalLike(4),
          maxSlippageBps: 100,
          status: 'PENDING_WALLET_SIGNATURE',
        }),
        update: jest.fn().mockImplementation(async ({ data }: any) => ({
          id: 'signal-1',
          ...data,
          status: 'EXECUTED',
        })),
      },
      copyTradeExecution: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 'exec-1' }),
      },
      copyTradeWalletContinuation: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'continuation-1',
          signalId: 'signal-1',
          positionEffect: 'OPEN',
          status: 'PENDING',
          txHash: null,
        }),
        update: jest.fn().mockResolvedValue({
          id: 'continuation-1',
          status: 'CONFIRMED',
          txHash: '0xtxhash',
        }),
        create: jest.fn(),
      },
      leaderTrade: {
        findFirst: jest.fn(),
        update: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'leader-trade-open-1' }),
      },
      copyVault: {
        update: jest.fn(),
      },
      leader: {
        update: jest.fn(),
      },
    };
    (mockPrisma.$transaction as jest.Mock).mockImplementation(
      async (callback: any) => callback(tx),
    );

    const result = await copytradeService.confirmWalletSignalContinuation(
      'leader-1',
      'signal-1',
      {
        leaderAddress: 'leader-wallet-1',
        txHash: '0xtxhash',
        nonce: 'nonce-12345678',
        timestamp: Date.now(),
        signature: 'signature-12345678',
      },
    );

    expect(result).toMatchObject({
      signalId: 'signal-1',
      continuationStatus: 'CONFIRMED',
      txHash: '0xtxhash',
      executedVia: 'ASYMMETRIC',
      alreadyConfirmed: false,
    });
    expect(tx.copyTradeExecution.create).toHaveBeenCalledTimes(1);
    expect(tx.leaderTrade.create).toHaveBeenCalledTimes(1);
    expect(tx.copyTradeSignal.update).toHaveBeenCalledTimes(1);
  });

  it('returns idempotent response when wallet-assisted continuation is already confirmed', async () => {
    const tx = {
      copyTradeSignal: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'signal-1',
          leaderId: 'leader-1',
          vaultId: 'vault-1',
          pairId: 'pair-1',
          pairSymbol: 'LUNES/USDT',
          side: 'SELL',
          amountIn: decimalLike(100),
          amountOutMin: decimalLike(380),
          executionPrice: decimalLike(4),
          maxSlippageBps: 100,
          status: 'PENDING_WALLET_SIGNATURE',
        }),
        update: jest.fn(),
      },
      copyTradeExecution: {
        count: jest.fn(),
        create: jest.fn(),
      },
      copyTradeWalletContinuation: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'continuation-1',
          signalId: 'signal-1',
          positionEffect: 'OPEN',
          status: 'CONFIRMED',
          txHash: '0xconfirmed',
        }),
        update: jest.fn(),
        create: jest.fn(),
      },
      leaderTrade: {
        findFirst: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      copyVault: {
        update: jest.fn(),
      },
      leader: {
        update: jest.fn(),
      },
    };
    (mockPrisma.$transaction as jest.Mock).mockImplementation(
      async (callback: any) => callback(tx),
    );

    const result = await copytradeService.confirmWalletSignalContinuation(
      'leader-1',
      'signal-1',
      {
        leaderAddress: 'leader-wallet-1',
        txHash: '0xconfirmed',
        nonce: 'nonce-87654321',
        timestamp: Date.now(),
        signature: 'signature-87654321',
      },
    );

    expect(result).toMatchObject({
      signalId: 'signal-1',
      continuationStatus: 'CONFIRMED',
      txHash: '0xconfirmed',
      executedVia: 'ASYMMETRIC',
      alreadyConfirmed: true,
    });
    expect(tx.copyTradeSignal.update).not.toHaveBeenCalled();
    expect(tx.copyTradeExecution.create).not.toHaveBeenCalled();
    expect(tx.copyTradeWalletContinuation.update).not.toHaveBeenCalled();
  });

  it('rejects wallet confirmation when amountOut is below signal amountOutMin', async () => {
    const tx = {
      copyTradeSignal: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'signal-1',
          leaderId: 'leader-1',
          vaultId: 'vault-1',
          pairId: 'pair-1',
          pairSymbol: 'LUNES/USDT',
          side: 'SELL',
          amountIn: decimalLike(100),
          amountOutMin: decimalLike(380),
          executionPrice: decimalLike(4),
          maxSlippageBps: 100,
          status: 'PENDING_WALLET_SIGNATURE',
        }),
        update: jest.fn(),
      },
      copyTradeExecution: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
      },
      copyTradeWalletContinuation: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'continuation-1',
          signalId: 'signal-1',
          positionEffect: 'OPEN',
          status: 'PENDING',
          txHash: null,
        }),
        update: jest.fn(),
        create: jest.fn(),
      },
      leaderTrade: {
        findFirst: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      copyVault: {
        update: jest.fn(),
      },
      leader: {
        update: jest.fn(),
      },
    };
    (mockPrisma.$transaction as jest.Mock).mockImplementation(
      async (callback: any) => callback(tx),
    );

    await expect(
      copytradeService.confirmWalletSignalContinuation('leader-1', 'signal-1', {
        leaderAddress: 'leader-wallet-1',
        txHash: '0xtxhash',
        amountOut: '300',
        nonce: 'nonce-12345678',
        timestamp: Date.now(),
        signature: 'signature-12345678',
      }),
    ).rejects.toThrow('below signal amountOutMin');
  });
});
