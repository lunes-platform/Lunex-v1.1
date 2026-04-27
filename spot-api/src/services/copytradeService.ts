import crypto from 'crypto';
import { cryptoWaitReady, signatureVerify } from '@polkadot/util-crypto';
import { Decimal } from '@prisma/client/runtime/library';
import prisma from '../db';
import { config } from '../config';
import { log } from '../utils/logger';
import { copytradeWalletContinuationsExpiredTotal } from '../utils/metrics';
import { ApiError } from '../middleware/errors';
import { getRedis } from '../utils/redis';
import {
  calculateLeaderTradePnlPct,
  calculateGrossWithdrawal,
  calculatePerformanceFeeOnWithdrawal,
  calculatePositionValue,
  calculateSharesToMint,
  deriveAmountOut,
  hashApiKey,
  planTwapSlices,
  resolveCopytradePositionEffect,
  toNumber,
} from '../utils/copytrade';
import {
  CopyTradeApiKeyChallengeInput,
  CopyTradeApiKeyInput,
  CopyTradeSignalInput,
  CopyTradeSignalWalletConfirmationInput,
  CopyVaultDepositInput,
  CopyVaultWithdrawInput,
} from '../utils/validation';
import { affiliateService } from './affiliateService';
import { copyVaultService } from './copyVaultService';
import { routerService } from './routerService';

function toDecimal(value: number): Decimal {
  return new Decimal(value.toFixed(18));
}

function decimalToNumber(
  value: { toString(): string } | number | null | undefined,
): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  return parseFloat(value.toString());
}

function ensurePairRoute(pairSymbol: string, route?: string[]): string[] {
  if (route && route.length >= 2) return route;
  const [base, quote] = pairSymbol.split('/');
  if (!base || !quote) throw new Error('Invalid pair symbol');
  return [base, quote];
}

const EPSILON = 1e-9;

function estimateSignalQuoteNotional(params: {
  side: 'BUY' | 'SELL';
  amountIn: number;
  amountOutMin: number;
  latestMarketPrice: number;
}) {
  if (params.side === 'BUY') return params.amountIn;

  if (params.latestMarketPrice > 0) {
    return params.amountIn * params.latestMarketPrice;
  }

  // SELL has base amountIn; when no market price is available,
  // use the requested min output as conservative quote notional floor.
  return params.amountOutMin;
}

type ApiKeyChallenge = {
  leaderId: string;
  leaderAddress: string;
  message: string;
  expiresAt: number;
};

type CopyVaultExecutionMode = 'db-journal' | 'on-chain-confirmed';
type CopytradeSignalMode = 'AUTO' | 'JOURNAL' | 'EXECUTE_VAULT';
type CopytradeSignalModeResolved = 'JOURNAL' | 'EXECUTE_VAULT';
type VaultOnChainConfirmation = {
  txHash: string;
  blockHash: string;
};

type LiveSignalExecutionSlice = {
  amountIn: number;
  amountOut: number;
  executionPrice: number;
};

type LiveSignalExecutionResult = {
  orderId: string;
  executedVia: 'ORDERBOOK' | 'AMM_V1';
  totalInputUsed: number;
  totalAmountOut: number;
  executionPrice: number;
  slices: LiveSignalExecutionSlice[];
};

type WalletAssistedSignalContinuation = {
  executedVia: 'ASYMMETRIC';
  requiresWalletSignature: true;
  contractCallIntent: {
    contractAddress: string;
    method: string;
    side: 'BUY' | 'SELL';
    amountIn: number;
    minAmountOut: number;
    makerAddress: string;
    nonce: string;
    agentId: string | null;
  };
  message: string;
};

type SignalExecutionAttemptResult = {
  liveExecution: LiveSignalExecutionResult | null;
  walletAssistedContinuation: WalletAssistedSignalContinuation | null;
};

type WalletContinuationRecord = {
  id: string;
  signalId: string;
  leaderId?: string;
  vaultId?: string;
  positionEffect: 'OPEN' | 'CLOSE';
  status: string;
  executedVia?: string;
  contractAddress?: string;
  method?: string;
  side?: 'BUY' | 'SELL';
  amountIn?: { toString(): string } | number;
  minAmountOut?: { toString(): string } | number;
  makerAddress?: string;
  nonce?: string;
  agentId?: string | null;
  message?: string | null;
  requestedAt?: Date;
  confirmedAt?: Date | null;
  expiresAt?: Date | null;
  txHash: string | null;
};

type WalletContinuationRepo = {
  create: (args: {
    data: Record<string, unknown>;
  }) => Promise<WalletContinuationRecord>;
  findUnique: (args: {
    where: { signalId: string };
  }) => Promise<WalletContinuationRecord | null>;
  findMany?: (
    args: Record<string, unknown>,
  ) => Promise<WalletContinuationRecord[]>;
  count?: (args: Record<string, unknown>) => Promise<number>;
  updateMany?: (args: Record<string, unknown>) => Promise<{ count: number }>;
  update: (args: {
    where: { signalId: string };
    data: Record<string, unknown>;
  }) => Promise<WalletContinuationRecord>;
};

function getWalletContinuationRepo(
  client: unknown,
): WalletContinuationRepo | null {
  const repo = (client as any)?.copyTradeWalletContinuation;
  if (!repo || typeof repo !== 'object') return null;
  if (typeof repo.create !== 'function') return null;
  if (typeof repo.findUnique !== 'function') return null;
  if (typeof repo.update !== 'function') return null;
  return repo as WalletContinuationRepo;
}

const API_KEY_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const API_KEY_CHALLENGE_REDIS_PREFIX = 'copytrade:api-key-challenge';
const apiKeyChallenges = new Map<string, ApiKeyChallenge>();

function getApiKeyChallengeCacheKey(challengeId: string) {
  return `${API_KEY_CHALLENGE_REDIS_PREFIX}:${challengeId}`;
}

function pruneExpiredApiKeyChallenges() {
  const now = Date.now();
  for (const [challengeId, challenge] of apiKeyChallenges.entries()) {
    if (challenge.expiresAt <= now) {
      apiKeyChallenges.delete(challengeId);
    }
  }
}

async function storeApiKeyChallenge(
  challengeId: string,
  challenge: ApiKeyChallenge,
) {
  pruneExpiredApiKeyChallenges();
  try {
    await getRedis().set(
      getApiKeyChallengeCacheKey(challengeId),
      JSON.stringify(challenge),
      'EX',
      Math.ceil(API_KEY_CHALLENGE_TTL_MS / 1000),
    );
  } catch {
    apiKeyChallenges.set(challengeId, challenge);
  }
}

async function loadApiKeyChallenge(
  challengeId: string,
): Promise<ApiKeyChallenge | null> {
  pruneExpiredApiKeyChallenges();

  const fallback = apiKeyChallenges.get(challengeId);
  if (fallback && fallback.expiresAt > Date.now()) {
    return fallback;
  }
  if (fallback && fallback.expiresAt <= Date.now()) {
    apiKeyChallenges.delete(challengeId);
  }

  try {
    const raw = await getRedis().get(getApiKeyChallengeCacheKey(challengeId));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as ApiKeyChallenge;
    if (!parsed || typeof parsed !== 'object') return null;
    if (
      typeof parsed.leaderId !== 'string' ||
      typeof parsed.leaderAddress !== 'string' ||
      typeof parsed.message !== 'string' ||
      typeof parsed.expiresAt !== 'number'
    ) {
      return null;
    }

    if (parsed.expiresAt <= Date.now()) {
      await getRedis().del(getApiKeyChallengeCacheKey(challengeId));
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

async function deleteApiKeyChallenge(challengeId: string) {
  apiKeyChallenges.delete(challengeId);
  try {
    await getRedis().del(getApiKeyChallengeCacheKey(challengeId));
  } catch {
    // best-effort cleanup
  }
}

function buildApiKeyChallengeMessage(
  leaderId: string,
  leaderAddress: string,
  challengeId: string,
  expiresAt: number,
) {
  return [
    'Lunex Copytrade API Key Rotation',
    `leaderId:${leaderId}`,
    `leaderAddress:${leaderAddress}`,
    `challengeId:${challengeId}`,
    `expiresAt:${new Date(expiresAt).toISOString()}`,
  ].join('\n');
}

async function assertValidApiKeyChallenge(
  leaderId: string,
  input: CopyTradeApiKeyInput,
) {
  const challenge = await loadApiKeyChallenge(input.challengeId);
  if (!challenge) throw ApiError.unauthorized('API key challenge not found');
  if (challenge.leaderId !== leaderId)
    throw ApiError.forbidden('API key challenge does not match leader');
  if (challenge.leaderAddress !== input.leaderAddress)
    throw ApiError.forbidden('API key challenge does not match leader address');
  if (challenge.expiresAt <= Date.now()) {
    await deleteApiKeyChallenge(input.challengeId);
    throw ApiError.unauthorized('API key challenge expired');
  }

  await cryptoWaitReady();

  let isValid = false;
  try {
    isValid = signatureVerify(
      challenge.message,
      input.signature,
      input.leaderAddress,
    ).isValid;
  } catch {
    isValid = false;
  }

  if (!isValid) throw ApiError.unauthorized('Invalid API key signature');

  await deleteApiKeyChallenge(input.challengeId);
}

async function confirmDepositOnChainIfConfigured(
  leaderId: string,
  input: CopyVaultDepositInput,
): Promise<VaultOnChainConfirmation | null> {
  if (!copyVaultService.isEnabled()) return null;

  const vault = await prisma.copyVault.findUnique({
    where: { leaderId },
  });
  if (!vault) throw new Error('Vault not found');
  if (vault.status !== 'ACTIVE') throw new Error('Vault is not active');
  if (input.token !== vault.collateralToken) {
    throw new Error(`Vault only accepts ${vault.collateralToken}`);
  }

  const amount = toNumber(input.amount);
  const minDeposit = decimalToNumber(vault.minDeposit);
  if (amount < minDeposit) throw new Error(`Minimum deposit is ${minDeposit}`);
  if (!vault.contractAddress) return null;

  const result = await copyVaultService.deposit(
    vault.contractAddress,
    input.followerAddress,
    input.amount,
  );

  return {
    txHash: result.txHash,
    blockHash: result.blockHash,
  };
}

async function confirmWithdrawalOnChainIfConfigured(
  leaderId: string,
  input: CopyVaultWithdrawInput,
): Promise<VaultOnChainConfirmation | null> {
  if (!copyVaultService.isEnabled()) return null;

  const vault = await prisma.copyVault.findUnique({
    where: { leaderId },
  });
  if (!vault) throw new Error('Vault not found');
  if (!vault.contractAddress) return null;

  const position = await prisma.copyVaultPosition.findUnique({
    where: {
      vaultId_followerAddress: {
        vaultId: vault.id,
        followerAddress: input.followerAddress,
      },
    },
  });
  if (!position) throw new Error('Position not found');

  const shares = toNumber(input.shares);
  if (shares <= 0 || shares > decimalToNumber(position.shareBalance)) {
    throw new Error('Invalid shares to burn');
  }

  const result = await copyVaultService.withdraw(
    vault.contractAddress,
    input.followerAddress,
    input.shares,
  );

  return {
    txHash: result.txHash,
    blockHash: result.blockHash,
  };
}

function resolveSignalMode(
  requested?: CopytradeSignalMode,
): CopytradeSignalMode {
  return requested ?? 'AUTO';
}

function buildLiveExecutionSlice(
  side: 'BUY' | 'SELL',
  trade: {
    amount: { toString(): string };
    quoteAmount: { toString(): string };
    price: { toString(): string };
  },
): LiveSignalExecutionSlice {
  const baseAmount = decimalToNumber(trade.amount);
  const quoteAmount = decimalToNumber(trade.quoteAmount);
  const executionPrice = decimalToNumber(trade.price);

  return side === 'BUY'
    ? {
        amountIn: quoteAmount,
        amountOut: baseAmount,
        executionPrice,
      }
    : {
        amountIn: baseAmount,
        amountOut: quoteAmount,
        executionPrice,
      };
}

async function resolveOpenTradeNotional(
  client: {
    copyTradeSignal: {
      findFirst: (args: Record<string, unknown>) => Promise<{
        amountIn: { toString(): string } | null;
      } | null>;
    };
  },
  input: {
    leaderId: string;
    pairSymbol: string;
    openingSide: 'BUY' | 'SELL';
    openedAt: Date;
    fallbackAmountIn: number;
  },
): Promise<number> {
  const openingSignal = await client.copyTradeSignal.findFirst({
    where: {
      leaderId: input.leaderId,
      pairSymbol: input.pairSymbol,
      side: input.openingSide,
      status: { in: ['EXECUTED', 'TWAP_EXECUTED'] },
      createdAt: { lte: input.openedAt },
    },
    orderBy: { createdAt: 'desc' },
    select: { amountIn: true },
  });

  const notional = decimalToNumber(openingSignal?.amountIn);
  return notional > 0 ? notional : input.fallbackAmountIn;
}

async function maybeExecuteVaultSignal(params: {
  leaderId: string;
  vault: {
    id: string;
    contractAddress: string | null;
    maxSlippageBps: number;
  };
  input: CopyTradeSignalInput;
  amountIn: number;
}): Promise<SignalExecutionAttemptResult> {
  const requestedMode = resolveSignalMode(params.input.signalMode);

  if (requestedMode === 'JOURNAL') {
    return {
      liveExecution: null,
      walletAssistedContinuation: null,
    };
  }

  if (!params.vault.contractAddress) {
    if (requestedMode === 'EXECUTE_VAULT') {
      throw new Error(
        'Live vault execution requires contractAddress on the copy vault',
      );
    }
    return {
      liveExecution: null,
      walletAssistedContinuation: null,
    };
  }

  const effectiveSlippageBps = Math.min(
    params.input.maxSlippageBps,
    params.vault.maxSlippageBps,
  );
  const routedExecution = await routerService.executeViaRouter({
    pairSymbol: params.input.pairSymbol,
    side: params.input.side,
    amountIn: params.amountIn,
    amountOutMin: toNumber(params.input.amountOutMin),
    maxSlippageBps: effectiveSlippageBps,
    makerAddress: params.vault.contractAddress,
    nonce: `copytrade_vault_${params.vault.id}_${Date.now()}`,
    agentId: params.leaderId,
  });

  if (
    routedExecution.executedVia === 'ASYMMETRIC' ||
    ('requiresWalletSignature' in routedExecution &&
      routedExecution.requiresWalletSignature)
  ) {
    const continuation: WalletAssistedSignalContinuation | null =
      'contractCallIntent' in routedExecution &&
      routedExecution.contractCallIntent &&
      typeof routedExecution.contractCallIntent === 'object'
        ? {
            executedVia: 'ASYMMETRIC',
            requiresWalletSignature: true,
            contractCallIntent: {
              contractAddress: String(
                (routedExecution.contractCallIntent as any).contractAddress ??
                  '',
              ),
              method: String(
                (routedExecution.contractCallIntent as any).method ?? 'swap',
              ),
              side: params.input.side,
              amountIn: params.amountIn,
              minAmountOut: Number(
                (routedExecution.contractCallIntent as any).minAmountOut ?? 0,
              ),
              makerAddress: String(
                (routedExecution.contractCallIntent as any).makerAddress ??
                  params.vault.contractAddress,
              ),
              nonce: String(
                (routedExecution.contractCallIntent as any).nonce ?? '',
              ),
              agentId: (routedExecution.contractCallIntent as any).agentId
                ? String((routedExecution.contractCallIntent as any).agentId)
                : null,
            },
            message:
              typeof (routedExecution as any).message === 'string'
                ? String((routedExecution as any).message)
                : 'Route selected: ASYMMETRIC pool. Submit via wallet signature using contractCallIntent.',
          }
        : null;

    if (requestedMode === 'EXECUTE_VAULT') {
      throw new Error(
        'Live vault execution requires a server-executable route; ASYMMETRIC needs wallet signature',
      );
    }
    return {
      liveExecution: null,
      walletAssistedContinuation: continuation,
    };
  }

  const order = 'order' in routedExecution ? routedExecution.order : null;
  if (!order?.id) {
    throw new Error(
      `Live vault execution via ${routedExecution.executedVia} did not return an order`,
    );
  }

  const trades = await prisma.trade.findMany({
    where: {
      OR: [{ makerOrderId: order.id }, { takerOrderId: order.id }],
    },
    orderBy: { createdAt: 'asc' },
  });

  if (trades.length === 0) {
    throw new Error('Live vault execution produced no fills');
  }

  const slices = trades.map((trade) =>
    buildLiveExecutionSlice(params.input.side, trade),
  );
  const totalInputUsed = slices.reduce((sum, slice) => sum + slice.amountIn, 0);
  const totalAmountOut = slices.reduce(
    (sum, slice) => sum + slice.amountOut,
    0,
  );
  const totalBaseAmount =
    params.input.side === 'BUY' ? totalAmountOut : totalInputUsed;
  const totalQuoteAmount =
    params.input.side === 'BUY' ? totalInputUsed : totalAmountOut;
  const executionPrice =
    totalBaseAmount > 0 ? totalQuoteAmount / totalBaseAmount : 0;

  return {
    liveExecution: {
      orderId: order.id,
      executedVia: routedExecution.executedVia,
      totalInputUsed,
      totalAmountOut,
      executionPrice,
      slices,
    },
    walletAssistedContinuation: null,
  };
}

async function persistWalletAssistedContinuation(params: {
  tx: unknown;
  signalId: string;
  leaderId: string;
  vaultId: string;
  positionEffect: 'OPEN' | 'CLOSE';
  continuation: WalletAssistedSignalContinuation;
}) {
  const repo = getWalletContinuationRepo(params.tx);
  if (!repo) {
    log.warn(
      { signalId: params.signalId, leaderId: params.leaderId },
      '[Copytrade] Wallet continuation repository unavailable; persistence skipped',
    );
    return null;
  }

  const payload = params.continuation.contractCallIntent;
  return repo.create({
    data: {
      signalId: params.signalId,
      leaderId: params.leaderId,
      vaultId: params.vaultId,
      positionEffect: params.positionEffect,
      executedVia: params.continuation.executedVia,
      requiresWalletSignature: true,
      contractAddress: payload.contractAddress,
      method: payload.method,
      side: payload.side,
      amountIn: toDecimal(payload.amountIn),
      minAmountOut: toDecimal(payload.minAmountOut),
      makerAddress: payload.makerAddress,
      nonce: payload.nonce,
      agentId: payload.agentId,
      status: 'PENDING',
      message: params.continuation.message,
      requestedAt: new Date(),
    },
  });
}

function toWalletContinuationView(
  row: WalletContinuationRecord,
  pairSymbol?: string,
) {
  return {
    id: row.id,
    signalId: row.signalId,
    leaderId: row.leaderId ?? null,
    vaultId: row.vaultId ?? null,
    pairSymbol: pairSymbol ?? null,
    positionEffect: row.positionEffect,
    status: row.status,
    executedVia: row.executedVia ?? 'ASYMMETRIC',
    txHash: row.txHash,
    contractAddress: row.contractAddress ?? '',
    method: row.method ?? 'swap',
    side: row.side ?? null,
    amountIn: decimalToNumber(row.amountIn),
    minAmountOut: decimalToNumber(row.minAmountOut),
    makerAddress: row.makerAddress ?? '',
    nonce: row.nonce ?? '',
    agentId: row.agentId ?? null,
    message: row.message ?? null,
    requestedAt: row.requestedAt ?? null,
    confirmedAt: row.confirmedAt ?? null,
    expiresAt: row.expiresAt ?? null,
  };
}

export const copytradeService = {
  async createApiKeyChallenge(
    leaderId: string,
    input: CopyTradeApiKeyChallengeInput,
  ) {
    const leader = await prisma.leader.findUnique({ where: { id: leaderId } });
    if (!leader) throw ApiError.notFound('Leader not found');
    if (leader.address !== input.leaderAddress)
      throw ApiError.forbidden('Leader address mismatch');

    pruneExpiredApiKeyChallenges();

    const challengeId = crypto.randomBytes(16).toString('hex');
    const expiresAt = Date.now() + API_KEY_CHALLENGE_TTL_MS;
    const message = buildApiKeyChallengeMessage(
      leaderId,
      input.leaderAddress,
      challengeId,
      expiresAt,
    );

    await storeApiKeyChallenge(challengeId, {
      leaderId,
      leaderAddress: input.leaderAddress,
      message,
      expiresAt,
    });

    return {
      challengeId,
      message,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  },

  async createOrRotateApiKey(leaderId: string, input: CopyTradeApiKeyInput) {
    const leader = await prisma.leader.findUnique({ where: { id: leaderId } });
    if (!leader) throw ApiError.notFound('Leader not found');
    if (leader.address !== input.leaderAddress)
      throw ApiError.forbidden('Leader address mismatch');

    await assertValidApiKeyChallenge(leaderId, input);

    const apiKey = `lunex_${crypto.randomBytes(24).toString('hex')}`;
    const apiKeyHash = hashApiKey(apiKey);

    await prisma.leader.update({
      where: { id: leaderId },
      data: {
        apiKeyHash,
        allowApiTrading: true,
      },
    });

    return {
      apiKey,
      allowApiTrading: true,
    };
  },

  async validateLeaderApiKey(leaderId: string, apiKey: string) {
    const leader = await prisma.leader.findUnique({ where: { id: leaderId } });
    if (!leader) throw ApiError.notFound('Leader not found');
    if (!leader.allowApiTrading)
      throw ApiError.forbidden('API trading disabled for leader');
    if (!leader.apiKeyHash)
      throw ApiError.unauthorized('Leader has no API key configured');
    if (leader.apiKeyHash !== hashApiKey(apiKey))
      throw ApiError.unauthorized('Invalid API key');

    return {
      leaderId: leader.id,
      username: leader.username,
      allowApiTrading: leader.allowApiTrading,
    };
  },

  async listVaults() {
    const vaults = await prisma.copyVault.findMany({
      include: {
        leader: true,
      },
      orderBy: { totalEquity: 'desc' },
    });

    return vaults.map((vault) => ({
      id: vault.id,
      leaderId: vault.leaderId,
      name: vault.name,
      collateralToken: vault.collateralToken,
      status: vault.status,
      totalEquity: decimalToNumber(vault.totalEquity),
      totalShares: decimalToNumber(vault.totalShares),
      totalDeposits: decimalToNumber(vault.totalDeposits),
      totalWithdrawals: decimalToNumber(vault.totalWithdrawals),
      minDeposit: decimalToNumber(vault.minDeposit),
      twapThreshold: decimalToNumber(vault.twapThreshold),
      maxSlippageBps: vault.maxSlippageBps,
      leader: {
        id: vault.leader.id,
        name: vault.leader.name,
        username: vault.leader.username,
        isAI: vault.leader.isAi,
        isVerified: vault.leader.isVerified,
        fee: vault.leader.performanceFeeBps / 100,
        followers: vault.leader.followersCount,
        aum: decimalToNumber(vault.leader.totalAum),
      },
    }));
  },

  async getVaultByLeader(leaderId: string) {
    const vault = await prisma.copyVault.findUnique({
      where: { leaderId },
      include: {
        leader: true,
        positions: {
          orderBy: { updatedAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!vault) throw new Error('Vault not found');

    return {
      id: vault.id,
      leaderId: vault.leaderId,
      name: vault.name,
      collateralToken: vault.collateralToken,
      status: vault.status,
      totalEquity: decimalToNumber(vault.totalEquity),
      totalShares: decimalToNumber(vault.totalShares),
      totalDeposits: decimalToNumber(vault.totalDeposits),
      totalWithdrawals: decimalToNumber(vault.totalWithdrawals),
      minDeposit: decimalToNumber(vault.minDeposit),
      twapThreshold: decimalToNumber(vault.twapThreshold),
      maxSlippageBps: vault.maxSlippageBps,
      leader: {
        id: vault.leader.id,
        name: vault.leader.name,
        username: vault.leader.username,
        address: vault.leader.address,
        isAI: vault.leader.isAi,
        performanceFee: vault.leader.performanceFeeBps / 100,
      },
      positions: vault.positions.map((position) => ({
        id: position.id,
        followerAddress: position.followerAddress,
        shareBalance: decimalToNumber(position.shareBalance),
        estimatedValue: calculatePositionValue(
          position.shareBalance.toString(),
          vault.totalShares.toString(),
          vault.totalEquity.toString(),
        ),
        netDeposited: decimalToNumber(position.netDeposited),
        totalWithdrawn: decimalToNumber(position.totalWithdrawn),
        highWaterMarkValue: decimalToNumber(position.highWaterMarkValue),
        feePaid: decimalToNumber(position.feePaid),
        realizedPnl: decimalToNumber(position.realizedPnl),
      })),
    };
  },

  async getUserPositions(address: string) {
    const positions = await prisma.copyVaultPosition.findMany({
      where: { followerAddress: address },
      include: {
        vault: {
          include: {
            leader: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return positions.map((position) => ({
      id: position.id,
      followerAddress: position.followerAddress,
      shareBalance: decimalToNumber(position.shareBalance),
      currentValue: calculatePositionValue(
        position.shareBalance.toString(),
        position.vault.totalShares.toString(),
        position.vault.totalEquity.toString(),
      ),
      netDeposited: decimalToNumber(position.netDeposited),
      totalWithdrawn: decimalToNumber(position.totalWithdrawn),
      highWaterMarkValue: decimalToNumber(position.highWaterMarkValue),
      feePaid: decimalToNumber(position.feePaid),
      realizedPnl: decimalToNumber(position.realizedPnl),
      vault: {
        id: position.vault.id,
        name: position.vault.name,
        collateralToken: position.vault.collateralToken,
        leaderId: position.vault.leaderId,
        leaderName: position.vault.leader.name,
        leaderUsername: position.vault.leader.username,
      },
    }));
  },

  async depositToVault(leaderId: string, input: CopyVaultDepositInput) {
    const onChainConfirmation = await confirmDepositOnChainIfConfigured(
      leaderId,
      input,
    );
    const executionMode: CopyVaultExecutionMode = onChainConfirmation
      ? 'on-chain-confirmed'
      : 'db-journal';

    try {
      return await prisma.$transaction(async (tx) => {
        const vault = await tx.copyVault.findUnique({
          where: { leaderId },
          include: { leader: true },
        });
        if (!vault) throw new Error('Vault not found');
        if (vault.status !== 'ACTIVE') throw new Error('Vault is not active');
        if (input.token !== vault.collateralToken) {
          throw new Error(`Vault only accepts ${vault.collateralToken}`);
        }

        const amount = toNumber(input.amount);
        const minDeposit = decimalToNumber(vault.minDeposit);
        if (amount < minDeposit)
          throw new Error(`Minimum deposit is ${minDeposit}`);

        const sharesMinted = calculateSharesToMint(
          amount,
          vault.totalShares.toString(),
          vault.totalEquity.toString(),
        );

        const existingPosition = await tx.copyVaultPosition.findUnique({
          where: {
            vaultId_followerAddress: {
              vaultId: vault.id,
              followerAddress: input.followerAddress,
            },
          },
        });

        const position = existingPosition
          ? await tx.copyVaultPosition.update({
              where: {
                vaultId_followerAddress: {
                  vaultId: vault.id,
                  followerAddress: input.followerAddress,
                },
              },
              data: {
                shareBalance: { increment: toDecimal(sharesMinted) },
                netDeposited: { increment: toDecimal(amount) },
                highWaterMarkValue: { increment: toDecimal(amount) },
              },
            })
          : await tx.copyVaultPosition.create({
              data: {
                vaultId: vault.id,
                followerAddress: input.followerAddress,
                shareBalance: toDecimal(sharesMinted),
                netDeposited: toDecimal(amount),
                highWaterMarkValue: toDecimal(amount),
              },
            });

        const deposit = await tx.copyVaultDeposit.create({
          data: {
            vaultId: vault.id,
            followerAddress: input.followerAddress,
            token: input.token,
            amount: toDecimal(amount),
            sharesMinted: toDecimal(sharesMinted),
            txHash: onChainConfirmation?.txHash ?? null,
          },
        });

        await tx.copyVault.update({
          where: { id: vault.id },
          data: {
            totalEquity: { increment: toDecimal(amount) },
            totalShares: { increment: toDecimal(sharesMinted) },
            totalDeposits: { increment: toDecimal(amount) },
          },
        });

        await tx.leader.update({
          where: { id: leaderId },
          data: { totalAum: { increment: toDecimal(amount) } },
        });

        return {
          depositId: deposit.id,
          sharesMinted,
          amount,
          positionId: position.id,
          txHash: onChainConfirmation?.txHash ?? null,
          executionMode,
        };
      });
    } catch (err) {
      if (onChainConfirmation) {
        log.error(
          {
            err,
            leaderId,
            followerAddress: input.followerAddress,
            txHash: onChainConfirmation.txHash,
          },
          '[Copytrade] DB deposit journal failed after on-chain confirmation',
        );
      }
      throw err;
    }
  },

  async withdrawFromVault(leaderId: string, input: CopyVaultWithdrawInput) {
    const onChainConfirmation = await confirmWithdrawalOnChainIfConfigured(
      leaderId,
      input,
    );
    const executionMode: CopyVaultExecutionMode = onChainConfirmation
      ? 'on-chain-confirmed'
      : 'db-journal';

    const result = await prisma
      .$transaction(async (tx) => {
        const vault = await tx.copyVault.findUnique({
          where: { leaderId },
          include: { leader: true },
        });
        if (!vault) throw new Error('Vault not found');

        const position = await tx.copyVaultPosition.findUnique({
          where: {
            vaultId_followerAddress: {
              vaultId: vault.id,
              followerAddress: input.followerAddress,
            },
          },
        });
        if (!position) throw new Error('Position not found');

        const shares = toNumber(input.shares);
        const grossAmount = calculateGrossWithdrawal(
          shares,
          vault.totalShares.toString(),
          vault.totalEquity.toString(),
        );

        const feeInfo = calculatePerformanceFeeOnWithdrawal({
          grossAmount,
          sharesToBurn: shares,
          shareBalanceBefore: position.shareBalance.toString(),
          highWaterMarkValue: position.highWaterMarkValue.toString(),
          performanceFeeBps: vault.leader.performanceFeeBps,
        });

        const netAmount = grossAmount - feeInfo.feeAmount;
        const updatedPosition = await tx.copyVaultPosition.update({
          where: {
            vaultId_followerAddress: {
              vaultId: vault.id,
              followerAddress: input.followerAddress,
            },
          },
          data: {
            shareBalance: { decrement: toDecimal(shares) },
            totalWithdrawn: { increment: toDecimal(netAmount) },
            feePaid: { increment: toDecimal(feeInfo.feeAmount) },
            realizedPnl: {
              increment: toDecimal(feeInfo.profitAmount - feeInfo.feeAmount),
            },
            highWaterMarkValue: toDecimal(feeInfo.remainingHighWaterMark),
          },
        });

        const withdrawal = await tx.copyVaultWithdrawal.create({
          data: {
            vaultId: vault.id,
            followerAddress: input.followerAddress,
            token: vault.collateralToken,
            sharesBurned: toDecimal(shares),
            grossAmount: toDecimal(grossAmount),
            feeAmount: toDecimal(feeInfo.feeAmount),
            netAmount: toDecimal(netAmount),
            profitAmount: toDecimal(feeInfo.profitAmount),
            txHash: onChainConfirmation?.txHash ?? null,
          },
        });

        await tx.copyVault.update({
          where: { id: vault.id },
          data: {
            totalShares: { decrement: toDecimal(shares) },
            totalEquity: { decrement: toDecimal(grossAmount) },
            totalWithdrawals: { increment: toDecimal(netAmount) },
          },
        });

        await tx.leader.update({
          where: { id: leaderId },
          data: {
            totalAum: { decrement: toDecimal(grossAmount) },
            totalPerformanceFeesEarned: {
              increment: toDecimal(feeInfo.feeAmount),
            },
          },
        });

        return {
          withdrawalId: withdrawal.id,
          grossAmount,
          feeAmount: feeInfo.feeAmount,
          netAmount,
          profitAmount: feeInfo.profitAmount,
          remainingShares: decimalToNumber(updatedPosition.shareBalance),
          collateralToken: vault.collateralToken,
          followerAddress: input.followerAddress,
          txHash: onChainConfirmation?.txHash ?? null,
          executionMode,
        };
      })
      .catch((err) => {
        if (onChainConfirmation) {
          log.error(
            {
              err,
              leaderId,
              followerAddress: input.followerAddress,
              txHash: onChainConfirmation.txHash,
            },
            '[Copytrade] DB withdrawal journal failed after on-chain confirmation',
          );
        }
        throw err;
      });

    // Distribute affiliate commissions from the performance fee
    if (result.feeAmount > 0) {
      try {
        await affiliateService.distributeCommissions(
          result.followerAddress,
          result.collateralToken,
          result.feeAmount,
          'COPYTRADE',
          result.withdrawalId,
        );
      } catch (err) {
        log.error(
          { err },
          'Affiliate commission on copytrade withdrawal failed',
        );
      }
    }

    return result;
  },

  async createSignal(leaderId: string, input: CopyTradeSignalInput) {
    const vault = await prisma.copyVault.findUnique({
      where: { leaderId },
      include: { leader: true },
    });
    if (!vault) throw new Error('Vault not found');
    if (vault.status !== 'ACTIVE') throw new Error('Vault is not active');

    if (input.source === 'WEB3') {
      if (!input.leaderAddress) {
        throw new Error('WEB3 signals require leaderAddress');
      }

      if (vault.leader.address !== input.leaderAddress) {
        throw new Error('Leader address mismatch');
      }
    }

    const pair = await prisma.pair.findUnique({
      where: { symbol: input.pairSymbol },
    });
    if (!pair) throw new Error('Pair not found');

    const latestPairTrade = await prisma.trade.findFirst({
      where: { pairId: pair.id },
      orderBy: { createdAt: 'desc' },
    });

    const requestedAmountIn = toNumber(input.amountIn);
    const requestedAmountOutMin = toNumber(input.amountOutMin);
    if (requestedAmountIn <= 0) {
      throw new Error('amountIn must be > 0');
    }
    if (requestedAmountOutMin <= 0) {
      throw new Error('amountOutMin must be > 0');
    }

    const route = ensurePairRoute(input.pairSymbol, input.route);
    const effectiveSlippageBps = Math.min(
      input.maxSlippageBps,
      vault.maxSlippageBps,
    );

    const closingSide = input.side === 'SELL' ? 'BUY' : 'SELL';
    const latestMatchingOpenTrade = await prisma.leaderTrade.findFirst({
      where: {
        leaderId,
        pairSymbol: input.pairSymbol,
        side: closingSide,
        status: 'OPEN',
      },
      orderBy: { openedAt: 'desc' },
    });
    const positionEffect = resolveCopytradePositionEffect(
      input.positionEffect,
      Boolean(latestMatchingOpenTrade),
    );
    const openTrade =
      positionEffect === 'CLOSE' ? latestMatchingOpenTrade : null;

    if (positionEffect === 'OPEN') {
      const latestMarketPrice = latestPairTrade
        ? decimalToNumber(latestPairTrade.price)
        : 0;
      const quoteNotional = estimateSignalQuoteNotional({
        side: input.side,
        amountIn: requestedAmountIn,
        amountOutMin: requestedAmountOutMin,
        latestMarketPrice,
      });
      const vaultEquity = decimalToNumber(vault.totalEquity);

      if (quoteNotional > vaultEquity + EPSILON) {
        throw new Error(
          `Signal notional ${quoteNotional.toFixed(
            6,
          )} exceeds vault equity ${vaultEquity.toFixed(6)}`,
        );
      }
    }

    const requestedSignalMode = resolveSignalMode(input.signalMode);
    let liveExecution: LiveSignalExecutionResult | null = null;
    let walletAssistedContinuation: WalletAssistedSignalContinuation | null =
      null;
    try {
      const signalExecution = await maybeExecuteVaultSignal({
        leaderId,
        vault: {
          id: vault.id,
          contractAddress: vault.contractAddress,
          maxSlippageBps: vault.maxSlippageBps,
        },
        input,
        amountIn: requestedAmountIn,
      });
      liveExecution = signalExecution.liveExecution;
      walletAssistedContinuation = signalExecution.walletAssistedContinuation;
      if (walletAssistedContinuation) {
        log.info(
          { leaderId, vaultId: vault.id, pairSymbol: input.pairSymbol },
          '[Copytrade] AUTO signal produced wallet-assisted continuation',
        );
      }
    } catch (err) {
      if (requestedSignalMode === 'AUTO') {
        log.warn(
          { err, leaderId, vaultId: vault.id, pairSymbol: input.pairSymbol },
          '[Copytrade] AUTO signal fell back to journaling after live execution failure',
        );
      } else {
        throw err;
      }
    }

    if (walletAssistedContinuation && !getWalletContinuationRepo(prisma)) {
      log.warn(
        { leaderId, vaultId: vault.id, pairSymbol: input.pairSymbol },
        '[Copytrade] Wallet continuation persistence unavailable; AUTO signal degraded to journaling fallback',
      );
      walletAssistedContinuation = null;
    }

    const signalModeResolved: CopytradeSignalModeResolved = liveExecution
      ? 'EXECUTE_VAULT'
      : 'JOURNAL';
    const isPendingWalletSignature =
      !liveExecution && Boolean(walletAssistedContinuation);

    let executionPrice = liveExecution?.executionPrice ?? 0;
    if (executionPrice <= 0) {
      executionPrice = input.executionPrice
        ? toNumber(input.executionPrice)
        : 0;
    }
    if (executionPrice <= 0) {
      executionPrice = latestPairTrade
        ? decimalToNumber(latestPairTrade.price)
        : requestedAmountIn / Math.max(requestedAmountOutMin, 1);
    }

    const effectiveAmountIn =
      liveExecution?.totalInputUsed ?? requestedAmountIn;
    const journalSlices =
      liveExecution || isPendingWalletSignature
        ? []
        : planTwapSlices(requestedAmountIn, vault.twapThreshold.toString()).map(
            (sliceAmountIn) => ({
              amountIn: sliceAmountIn,
              amountOut: deriveAmountOut({
                pairSymbol: input.pairSymbol,
                side: input.side,
                amountIn: sliceAmountIn,
                executionPrice,
              }),
              executionPrice,
            }),
          );
    const executionSlices = liveExecution?.slices ?? journalSlices;
    const totalAmountOut =
      liveExecution?.totalAmountOut ??
      deriveAmountOut({
        pairSymbol: input.pairSymbol,
        side: input.side,
        amountIn: requestedAmountIn,
        executionPrice,
      });

    const openTradeNotional = openTrade
      ? await resolveOpenTradeNotional(prisma as any, {
          leaderId,
          pairSymbol: input.pairSymbol,
          openingSide: openTrade.side,
          openedAt: openTrade.openedAt,
          fallbackAmountIn: effectiveAmountIn,
        })
      : 0;

    const realizedPnlPct = isPendingWalletSignature
      ? 0
      : openTrade
        ? calculateLeaderTradePnlPct({
            openingSide: openTrade.side,
            entryPrice: openTrade.entryPrice,
            exitPrice: executionPrice,
          })
        : 0;
    const pnlDelta = openTrade ? openTradeNotional * (realizedPnlPct / 100) : 0;

    try {
      return await prisma.$transaction(async (tx) => {
        const signal = await tx.copyTradeSignal.create({
          data: {
            leaderId,
            vaultId: vault.id,
            pairId: pair.id,
            pairSymbol: input.pairSymbol,
            side: input.side,
            source: input.source,
            strategyTag: input.strategyTag,
            amountIn: toDecimal(effectiveAmountIn),
            amountOutMin: toDecimal(requestedAmountOutMin),
            executionPrice: toDecimal(executionPrice),
            realizedPnlPct:
              openTrade && !isPendingWalletSignature
                ? toDecimal(realizedPnlPct)
                : undefined,
            route,
            maxSlippageBps: effectiveSlippageBps,
            status: isPendingWalletSignature
              ? ('PENDING_WALLET_SIGNATURE' as any)
              : liveExecution
                ? 'EXECUTED'
                : executionSlices.length > 1
                  ? 'TWAP_EXECUTED'
                  : 'EXECUTED',
          },
        });

        if (walletAssistedContinuation) {
          await persistWalletAssistedContinuation({
            tx,
            signalId: signal.id,
            leaderId,
            vaultId: vault.id,
            positionEffect,
            continuation: walletAssistedContinuation,
          });
        }

        const executions = [];
        for (let index = 0; index < executionSlices.length; index += 1) {
          const slice = executionSlices[index];
          const execution = await tx.copyTradeExecution.create({
            data: {
              vaultId: vault.id,
              signalId: signal.id,
              pairId: pair.id,
              pairSymbol: input.pairSymbol,
              side: input.side,
              sliceIndex: index + 1,
              totalSlices: executionSlices.length,
              amountIn: toDecimal(slice.amountIn),
              amountOut: toDecimal(slice.amountOut),
              executionPrice: toDecimal(slice.executionPrice),
              slippageBps: effectiveSlippageBps,
              realizedPnl:
                openTrade && effectiveAmountIn > 0
                  ? toDecimal(pnlDelta * (slice.amountIn / effectiveAmountIn))
                  : toDecimal(0),
              status: 'EXECUTED',
            },
          });
          executions.push(execution);
        }

        if (openTrade && !isPendingWalletSignature) {
          await tx.leaderTrade.update({
            where: { id: openTrade.id },
            data: {
              exitPrice: toDecimal(executionPrice),
              pnlPct: toDecimal(realizedPnlPct),
              status: 'CLOSED',
              closedAt: new Date(),
            },
          });
        } else if (!isPendingWalletSignature) {
          await tx.leaderTrade.create({
            data: {
              leaderId,
              pairId: pair.id,
              pairSymbol: input.pairSymbol,
              side: input.side,
              entryPrice: toDecimal(executionPrice),
              pnlPct: toDecimal(0),
              status: 'OPEN',
            },
          });
        }

        if (openTrade && !isPendingWalletSignature) {
          const updatedVault = await tx.copyVault.update({
            where: { id: vault.id },
            data: {
              totalEquity: { increment: toDecimal(pnlDelta) },
            },
          });

          const nextPnlHistory = [
            ...vault.leader.pnlHistory,
            realizedPnlPct,
          ].slice(-30);
          await tx.leader.update({
            where: { id: leaderId },
            data: {
              totalAum: updatedVault.totalEquity,
              pnlHistory: nextPnlHistory,
            },
          });
        }

        return {
          signalId: signal.id,
          pairSymbol: signal.pairSymbol,
          side: signal.side,
          positionEffect,
          signalModeResolved,
          amountIn: effectiveAmountIn,
          totalAmountOut,
          executionPrice,
          realizedPnlPct,
          executedVia: liveExecution?.executedVia ?? null,
          orderId: liveExecution?.orderId ?? null,
          isPendingWalletSignature,
          walletAssistedContinuation,
          slices: executions.map((execution) => ({
            id: execution.id,
            sliceIndex: execution.sliceIndex,
            totalSlices: execution.totalSlices,
            amountIn: decimalToNumber(execution.amountIn),
            amountOut: decimalToNumber(execution.amountOut),
            executionPrice: decimalToNumber(execution.executionPrice),
            realizedPnl: decimalToNumber(execution.realizedPnl),
          })),
        };
      });
    } catch (err) {
      if (liveExecution) {
        log.error(
          { err, leaderId, vaultId: vault.id, orderId: liveExecution.orderId },
          '[Copytrade] Signal journal failed after live vault execution',
        );
      }
      throw err;
    }
  },

  async confirmWalletSignalContinuation(
    leaderId: string,
    signalId: string,
    input: CopyTradeSignalWalletConfirmationInput,
  ) {
    const vault = await prisma.copyVault.findUnique({
      where: { leaderId },
      include: { leader: true },
    });
    if (!vault) throw new Error('Vault not found');
    if (vault.leader.address !== input.leaderAddress) {
      throw new Error('Leader address mismatch');
    }

    return prisma.$transaction(async (tx) => {
      const signal = await tx.copyTradeSignal.findUnique({
        where: { id: signalId },
      });
      if (
        !signal ||
        signal.leaderId !== leaderId ||
        signal.vaultId !== vault.id
      ) {
        throw new Error('Signal not found for leader vault');
      }

      const continuationRepo = getWalletContinuationRepo(tx);
      if (!continuationRepo) {
        throw new Error(
          'Wallet continuation persistence is unavailable. Run Prisma migration for copytrade continuations',
        );
      }

      const continuation = await continuationRepo.findUnique({
        where: { signalId },
      });
      if (!continuation)
        throw new Error('Wallet continuation not found for signal');
      if (
        continuation.status !== 'PENDING' &&
        continuation.status !== 'CONFIRMED'
      ) {
        throw new Error(
          `Wallet continuation is not confirmable (status: ${continuation.status})`,
        );
      }

      if (continuation.status === 'CONFIRMED') {
        return {
          signalId: signal.id,
          signalStatus: signal.status,
          continuationStatus: 'CONFIRMED',
          txHash: continuation.txHash,
          executedVia: 'ASYMMETRIC',
          alreadyConfirmed: true,
        };
      }

      const amountIn = decimalToNumber(signal.amountIn);
      let executionPrice = input.executionPrice
        ? toNumber(input.executionPrice)
        : decimalToNumber(signal.executionPrice);
      if (executionPrice <= 0) {
        executionPrice =
          amountIn / Math.max(decimalToNumber(signal.amountOutMin), 1);
      }

      let amountOut = input.amountOut
        ? toNumber(input.amountOut)
        : deriveAmountOut({
            pairSymbol: signal.pairSymbol,
            side: signal.side,
            amountIn,
            executionPrice,
          });
      if (amountOut <= 0) {
        amountOut = decimalToNumber(signal.amountOutMin);
      }
      const signalAmountOutMin = decimalToNumber(signal.amountOutMin);
      if (amountOut + EPSILON < signalAmountOutMin) {
        throw new Error(
          `Wallet-confirmed amountOut ${amountOut} is below signal amountOutMin ${signalAmountOutMin}`,
        );
      }

      const existingExecutions = await tx.copyTradeExecution.count({
        where: { signalId: signal.id },
      });
      if (existingExecutions === 0) {
        await tx.copyTradeExecution.create({
          data: {
            vaultId: vault.id,
            signalId: signal.id,
            pairId: signal.pairId,
            pairSymbol: signal.pairSymbol,
            side: signal.side,
            sliceIndex: 1,
            totalSlices: 1,
            amountIn: toDecimal(amountIn),
            amountOut: toDecimal(amountOut),
            executionPrice: toDecimal(executionPrice),
            slippageBps: signal.maxSlippageBps,
            realizedPnl: toDecimal(0),
            status: 'EXECUTED',
          },
        });
      }

      let realizedPnlPct = 0;
      if (continuation.positionEffect === 'OPEN') {
        await tx.leaderTrade.create({
          data: {
            leaderId,
            pairId: signal.pairId,
            pairSymbol: signal.pairSymbol,
            side: signal.side,
            entryPrice: toDecimal(executionPrice),
            pnlPct: toDecimal(0),
            status: 'OPEN',
          },
        });
      } else {
        const closingSide = signal.side === 'SELL' ? 'BUY' : 'SELL';
        const openTrade = await tx.leaderTrade.findFirst({
          where: {
            leaderId,
            pairSymbol: signal.pairSymbol,
            side: closingSide,
            status: 'OPEN',
          },
          orderBy: { openedAt: 'desc' },
        });
        if (!openTrade) {
          throw new Error('No matching open leader trade to close');
        }

        realizedPnlPct = calculateLeaderTradePnlPct({
          openingSide: openTrade.side,
          entryPrice: openTrade.entryPrice,
          exitPrice: executionPrice,
        });
        const openTradeNotional = await resolveOpenTradeNotional(tx as any, {
          leaderId,
          pairSymbol: signal.pairSymbol,
          openingSide: openTrade.side,
          openedAt: openTrade.openedAt,
          fallbackAmountIn: amountIn,
        });
        const pnlDelta = openTradeNotional * (realizedPnlPct / 100);

        await tx.leaderTrade.update({
          where: { id: openTrade.id },
          data: {
            exitPrice: toDecimal(executionPrice),
            pnlPct: toDecimal(realizedPnlPct),
            status: 'CLOSED',
            closedAt: new Date(),
          },
        });

        const updatedVault = await tx.copyVault.update({
          where: { id: vault.id },
          data: {
            totalEquity: { increment: toDecimal(pnlDelta) },
          },
        });
        const nextPnlHistory = [
          ...vault.leader.pnlHistory,
          realizedPnlPct,
        ].slice(-30);
        await tx.leader.update({
          where: { id: leaderId },
          data: {
            totalAum: updatedVault.totalEquity,
            pnlHistory: nextPnlHistory,
          },
        });
      }

      const updatedSignal = await tx.copyTradeSignal.update({
        where: { id: signal.id },
        data: {
          status: 'EXECUTED',
          executionPrice: toDecimal(executionPrice),
          realizedPnlPct:
            continuation.positionEffect === 'CLOSE'
              ? toDecimal(realizedPnlPct)
              : null,
        } as any,
      });

      const updatedContinuation = await continuationRepo.update({
        where: { signalId: signal.id },
        data: {
          status: 'CONFIRMED',
          txHash: input.txHash,
          confirmedAt: new Date(),
        },
      });

      return {
        signalId: updatedSignal.id,
        signalStatus: updatedSignal.status,
        continuationStatus: updatedContinuation.status,
        txHash: updatedContinuation.txHash,
        executedVia: 'ASYMMETRIC' as const,
        executionPrice,
        amountOut,
        realizedPnlPct:
          continuation.positionEffect === 'CLOSE' ? realizedPnlPct : 0,
        alreadyConfirmed: false,
      };
    });
  },

  async listPendingWalletContinuations(leaderId: string, limit = 50) {
    const vault = await prisma.copyVault.findUnique({ where: { leaderId } });
    if (!vault) throw new Error('Vault not found');

    const repo = getWalletContinuationRepo(prisma);
    if (!repo || !repo.findMany) {
      return {
        available: false,
        pending: [],
      };
    }

    const pendingRows = await repo.findMany({
      where: {
        leaderId,
        vaultId: vault.id,
        status: 'PENDING',
      },
      orderBy: { requestedAt: 'desc' },
      take: limit,
    });

    const signalIds = pendingRows.map((row) => row.signalId);
    const signalPairById =
      signalIds.length > 0
        ? new Map(
            (
              await prisma.copyTradeSignal.findMany({
                where: { id: { in: signalIds } },
                select: { id: true, pairSymbol: true },
              })
            ).map((signal) => [signal.id, signal.pairSymbol]),
          )
        : new Map<string, string>();

    return {
      available: true,
      pending: pendingRows.map((row) =>
        toWalletContinuationView(row, signalPairById.get(row.signalId)),
      ),
    };
  },

  async countPendingWalletContinuations() {
    const repo = getWalletContinuationRepo(prisma);
    if (!repo) {
      return {
        available: false,
        count: 0,
      };
    }

    if (repo.count) {
      const count = await repo.count({ where: { status: 'PENDING' } });
      return {
        available: true,
        count,
      };
    }

    if (!repo.findMany) {
      return {
        available: false,
        count: 0,
      };
    }

    const rows = await repo.findMany({
      where: { status: 'PENDING' },
    });

    return {
      available: true,
      count: rows.length,
    };
  },

  async expirePendingWalletContinuations(maxBatch = 500) {
    const repo = getWalletContinuationRepo(prisma);
    if (!repo || !repo.findMany) {
      return {
        available: false,
        expiredCount: 0,
        pendingAfter: 0,
      };
    }

    const ttlMs = config.copytrade.walletContinuationTtlMs;
    const cutoff = new Date(Date.now() - ttlMs);
    const now = new Date();

    const staleRows = await repo.findMany({
      where: {
        status: 'PENDING',
        requestedAt: { lt: cutoff },
      },
      take: maxBatch,
      orderBy: { requestedAt: 'asc' },
    });

    let expiredCount = 0;
    if (staleRows.length > 0) {
      if (repo.updateMany) {
        const updated = await repo.updateMany({
          where: {
            id: { in: staleRows.map((row) => row.id) },
            status: 'PENDING',
          },
          data: {
            status: 'EXPIRED',
            expiresAt: now,
          },
        });
        expiredCount = updated.count;
      } else {
        for (const row of staleRows) {
          await repo.update({
            where: { signalId: row.signalId },
            data: {
              status: 'EXPIRED',
              expiresAt: now,
            },
          });
          expiredCount += 1;
        }
      }
    }

    if (expiredCount > 0) {
      copytradeWalletContinuationsExpiredTotal.inc(expiredCount);
    }

    const pendingAfter = await this.countPendingWalletContinuations();
    return {
      available: true,
      expiredCount,
      pendingAfter: pendingAfter.count,
      cutoff,
    };
  },

  async getVaultExecutions(leaderId: string, limit = 50) {
    const vault = await prisma.copyVault.findUnique({ where: { leaderId } });
    if (!vault) throw new Error('Vault not found');

    const executions = await prisma.copyTradeExecution.findMany({
      where: { vaultId: vault.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        signal: true,
      },
    });

    return executions.map((execution) => ({
      id: execution.id,
      pairSymbol: execution.pairSymbol,
      side: execution.side,
      positionEffect:
        execution.signal.realizedPnlPct != null ? 'CLOSE' : 'OPEN',
      sliceIndex: execution.sliceIndex,
      totalSlices: execution.totalSlices,
      amountIn: decimalToNumber(execution.amountIn),
      amountOut: decimalToNumber(execution.amountOut),
      executionPrice: decimalToNumber(execution.executionPrice),
      realizedPnl: decimalToNumber(execution.realizedPnl),
      slippageBps: execution.slippageBps,
      status: execution.status,
      strategyTag: execution.signal.strategyTag,
      createdAt: execution.createdAt,
    }));
  },

  async getActivity(address?: string, limit = 50) {
    const [deposits, withdrawals, signals] = await Promise.all([
      prisma.copyVaultDeposit.findMany({
        where: address ? { followerAddress: address } : undefined,
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          vault: {
            include: { leader: true },
          },
        },
      }),
      prisma.copyVaultWithdrawal.findMany({
        where: address ? { followerAddress: address } : undefined,
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          vault: {
            include: { leader: true },
          },
        },
      }),
      prisma.copyTradeSignal.findMany({
        where: address
          ? {
              vault: {
                positions: {
                  some: { followerAddress: address },
                },
              },
            }
          : undefined,
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          leader: true,
          executions: true,
        },
      }),
    ]);

    const activity = [
      ...deposits.map((deposit) => ({
        type: 'DEPOSIT',
        createdAt: deposit.createdAt,
        leaderId: deposit.vault.leader.id,
        leaderName: deposit.vault.leader.name,
        followerAddress: deposit.followerAddress,
        amount: decimalToNumber(deposit.amount),
        token: deposit.token,
      })),
      ...withdrawals.map((withdrawal) => ({
        type: 'WITHDRAWAL',
        createdAt: withdrawal.createdAt,
        leaderId: withdrawal.vault.leader.id,
        leaderName: withdrawal.vault.leader.name,
        followerAddress: withdrawal.followerAddress,
        grossAmount: decimalToNumber(withdrawal.grossAmount),
        feeAmount: decimalToNumber(withdrawal.feeAmount),
        netAmount: decimalToNumber(withdrawal.netAmount),
        token: withdrawal.token,
      })),
      ...signals.map((signal) => ({
        type: 'SIGNAL',
        createdAt: signal.createdAt,
        leaderId: signal.leader.id,
        leaderName: signal.leader.name,
        pairSymbol: signal.pairSymbol,
        side: signal.side,
        positionEffect: signal.realizedPnlPct != null ? 'CLOSE' : 'OPEN',
        amountIn: decimalToNumber(signal.amountIn),
        executionPrice: decimalToNumber(signal.executionPrice),
        realizedPnlPct: decimalToNumber(signal.realizedPnlPct),
        slices: signal.executions.length,
      })),
    ];

    return activity
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  },
};
