import { Decimal } from '@prisma/client/runtime/library';
import type {
  AsymmetricCurveSide,
  AsymmetricStrategyStatus,
  Prisma,
} from '@prisma/client';
import prisma from '../db';
import { log } from '../utils/logger';

// ─── Constants ──────────────────────────────────────────────────

const COOLDOWN_MS = 5 * 60 * 1000; // 5 min default cooldown
const GAS_COST_ESTIMATE_LUNES = 0.05; // Estimated gas per update_curve_parameters call
const GAS_MULTIPLIER_THRESHOLD = 5; // Rebalance only if value > 5x gas cost
const MAX_RETRIES = 3;

// ─── Types ──────────────────────────────────────────────────────

export interface CreateStrategyInput {
  userAddress: string;
  pairAddress: string;
  agentId?: string;
  isAutoRebalance?: boolean;
  buyK: string;
  buyGamma: number;
  buyMaxCapacity: string;
  buyFeeTargetBps?: number;
  sellGamma: number;
  sellMaxCapacity: string;
  sellFeeTargetBps?: number;
  sellProfitTargetBps?: number;
  leverageL?: string;
  allocationC?: number;
}

export interface UpdateCurveInput {
  isBuySide: boolean;
  newGamma?: number;
  newMaxCapacity?: string;
  newFeeTargetBps?: number;
}

export interface StrategyStatusOutput {
  id: string;
  userAddress: string;
  pairAddress: string;
  agentId: string | null;
  status: AsymmetricStrategyStatus;
  isAutoRebalance: boolean;
  pendingRebalanceAmount: string;
  lastRebalancedAt: Date | null;
  buyCurve: {
    gamma: number;
    maxCapacity: string;
    feeTargetBps: number;
    baseLiquidity: string;
  };
  sellCurve: {
    gamma: number;
    maxCapacity: string;
    feeTargetBps: number;
    profitTargetBps: number;
  };
  retryCount: number;
  lastError: string | null;
  agentManaged: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface StrategyPersistedConfigOutput {
  strategyId: string;
  userAddress: string;
  pairAddress: string;
  agentId: string | null;
  status: AsymmetricStrategyStatus;
  isAutoRebalance: boolean;
  pendingRebalanceAmount: string;
  lastRebalancedAt: Date | null;
  retryCount: number;
  lastError: string | null;
  buyCurve: StrategyStatusOutput['buyCurve'];
  sellCurve: StrategyStatusOutput['sellCurve'];
  createdAt: Date;
  updatedAt: Date;
}

export interface StrategyLiveCurveStateOutput {
  k: number;
  gamma: number;
  maxCapacity: number;
  feeBps: number;
  currentVolume: number;
}

export interface StrategyLiveStateOutput {
  available: boolean;
  reason: string | null;
  source: 'on-chain' | 'unavailable';
  checkedAt: string;
  managerAddress: string | null;
  relayerAddress: string | null;
  delegatedToRelayer: boolean;
  buyCurve: StrategyLiveCurveStateOutput | null;
  sellCurve: StrategyLiveCurveStateOutput | null;
}

export interface StrategyDelegationOutput {
  agentManaged: boolean;
  agentId: string | null;
  walletAddress: string;
  requiredScope: 'MANAGE_ASYMMETRIC';
  managerAddress: string | null;
  relayerAddress: string | null;
  delegatedToRelayer: boolean;
  checkedAt: string;
}

export interface StrategyCanonicalStatusOutput extends StrategyStatusOutput {
  persistedConfig: StrategyPersistedConfigOutput;
  liveState: StrategyLiveStateOutput;
  delegation: StrategyDelegationOutput;
}

export interface StrategyRebalanceLogOutput {
  id: string;
  strategyId: string;
  side: AsymmetricCurveSide;
  trigger: string;
  acquiredAmount: string;
  newCapacity: string;
  txHash: string | null;
  gasConsumed: string | null;
  status: string;
  createdAt: Date;
}

// ─── Helpers ────────────────────────────────────────────────────

export function isCoolingDown(
  lastRebalancedAt: Date | null,
  cooldownMs = COOLDOWN_MS,
): boolean {
  if (!lastRebalancedAt) return false;
  return Date.now() - lastRebalancedAt.getTime() < cooldownMs;
}

export function isProfitableToRebalance(
  pendingAmount: number,
  gasEstimateLunes = GAS_COST_ESTIMATE_LUNES,
): boolean {
  return pendingAmount >= gasEstimateLunes * GAS_MULTIPLIER_THRESHOLD;
}

function formatStrategy(s: any): StrategyStatusOutput {
  return {
    id: s.id,
    userAddress: s.userAddress,
    pairAddress: s.pairAddress,
    agentId: s.agentId ?? null,
    status: s.status,
    isAutoRebalance: s.isAutoRebalance,
    pendingRebalanceAmount: s.pendingAmount.toString(),
    lastRebalancedAt: s.lastRebalancedAt,
    buyCurve: {
      gamma: s.buyGamma,
      maxCapacity: s.buyMaxCapacity.toString(),
      feeTargetBps: s.buyFeeTargetBps,
      baseLiquidity: s.buyK.toString(),
    },
    sellCurve: {
      gamma: s.sellGamma,
      maxCapacity: s.sellMaxCapacity.toString(),
      feeTargetBps: s.sellFeeTargetBps,
      profitTargetBps: s.sellProfitTargetBps,
    },
    retryCount: s.retryCount,
    lastError: s.lastError,
    agentManaged: Boolean(s.agentId),
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

function normalizeAuditTrigger(trigger: string) {
  const normalized = trigger.trim().toUpperCase();
  if (normalized === 'MANUAL') return 'MANUAL';
  if (normalized === 'AI_AGENT') return 'AI_AGENT';
  if (normalized === 'AUTO_REBALANCER') return 'AUTO_REBALANCER';
  return normalized || 'MANUAL';
}

function normalizeAuditStatus(status: string) {
  const normalized = status.trim().toUpperCase();
  if (normalized.includes('FAIL')) return 'FAILED';
  if (normalized.includes('SKIP')) return 'SKIPPED';
  return 'SUCCESS';
}

function formatRebalanceLog(logEntry: any): StrategyRebalanceLogOutput {
  return {
    id: logEntry.id,
    strategyId: logEntry.strategyId,
    side: logEntry.side,
    trigger: normalizeAuditTrigger(String(logEntry.trigger ?? '')),
    acquiredAmount: logEntry.acquiredAmount.toString(),
    newCapacity: logEntry.newCapacity.toString(),
    txHash: logEntry.txHash ?? null,
    gasConsumed: logEntry.gasConsumed?.toString() ?? null,
    status: normalizeAuditStatus(String(logEntry.status ?? 'SUCCESS')),
    createdAt: logEntry.createdAt,
  };
}

async function getRequiredStrategy(strategyId: string) {
  const strategy = await prisma.asymmetricStrategy.findUnique({
    where: { id: strategyId },
  });
  if (!strategy) throw new Error('Strategy not found');
  return strategy;
}

async function applyCurveParamsUpdate(
  strategyId: string,
  input: UpdateCurveInput,
): Promise<StrategyStatusOutput> {
  if (input.newGamma && (input.newGamma < 1 || input.newGamma > 5))
    throw new Error('gamma must be between 1 and 5');

  const data: Prisma.AsymmetricStrategyUpdateInput = {};

  if (input.isBuySide) {
    if (input.newGamma !== undefined) data.buyGamma = input.newGamma;
    if (input.newMaxCapacity !== undefined)
      data.buyMaxCapacity = new Decimal(input.newMaxCapacity);
    if (input.newFeeTargetBps !== undefined)
      data.buyFeeTargetBps = input.newFeeTargetBps;
  } else {
    if (input.newGamma !== undefined) data.sellGamma = input.newGamma;
    if (input.newMaxCapacity !== undefined)
      data.sellMaxCapacity = new Decimal(input.newMaxCapacity);
    if (input.newFeeTargetBps !== undefined)
      data.sellFeeTargetBps = input.newFeeTargetBps;
  }

  const updated = await prisma.asymmetricStrategy.update({
    where: { id: strategyId },
    data,
  });

  return formatStrategy(updated);
}

async function safeRecordAuditLog(input: {
  strategyId: string;
  side: AsymmetricCurveSide;
  trigger: 'MANUAL' | 'AI_AGENT' | 'AUTO_REBALANCER';
  acquiredAmount?: string | number;
  newCapacity: string | number;
  txHash?: string | null;
  status?: string;
}) {
  try {
    await prisma.asymmetricRebalanceLog.create({
      data: {
        strategyId: input.strategyId,
        side: input.side,
        trigger: input.trigger,
        acquiredAmount: new Decimal(input.acquiredAmount ?? 0),
        newCapacity: new Decimal(input.newCapacity),
        txHash: input.txHash ?? null,
        status: input.status ?? 'SUCCESS',
      },
    });
  } catch (err) {
    log.warn(
      {
        err,
        strategyId: input.strategyId,
        trigger: input.trigger,
      },
      '[Asymmetric] Audit log persistence failed',
    );
  }
}

// ─── Service ────────────────────────────────────────────────────

export const asymmetricService = {
  async createStrategy(
    input: CreateStrategyInput,
  ): Promise<StrategyStatusOutput> {
    if (input.buyGamma < 1 || input.buyGamma > 5)
      throw new Error('buyGamma must be between 1 and 5');
    if (input.sellGamma < 1 || input.sellGamma > 5)
      throw new Error('sellGamma must be between 1 and 5');
    if (new Decimal(input.buyK).lte(0))
      throw new Error('buyK must be positive');

    const existing = await prisma.asymmetricStrategy.findFirst({
      where: {
        userAddress: input.userAddress,
        pairAddress: input.pairAddress,
        status: { not: 'SUSPENDED_ERROR' },
      },
    });
    if (existing)
      throw new Error('Active strategy already exists for this pair');

    const strategy = await prisma.asymmetricStrategy.create({
      data: {
        userAddress: input.userAddress,
        pairAddress: input.pairAddress,
        agentId: input.agentId ?? null,
        isAutoRebalance: input.isAutoRebalance ?? true,
        buyK: new Decimal(input.buyK),
        buyGamma: input.buyGamma,
        buyMaxCapacity: new Decimal(input.buyMaxCapacity),
        buyFeeTargetBps: input.buyFeeTargetBps ?? 30,
        sellGamma: input.sellGamma,
        sellMaxCapacity: new Decimal(input.sellMaxCapacity),
        sellFeeTargetBps: input.sellFeeTargetBps ?? 30,
        sellProfitTargetBps: input.sellProfitTargetBps ?? 500,
        leverageL: new Decimal(input.leverageL ?? '0'),
        allocationC: new Decimal(input.allocationC ?? 0.5),
      },
    });

    return formatStrategy(strategy);
  },

  async getStrategy(strategyId: string): Promise<StrategyStatusOutput> {
    const strategy = await getRequiredStrategy(strategyId);
    return formatStrategy(strategy);
  },

  async getStrategyForUser(strategyId: string, userAddress: string) {
    const strategy = await getRequiredStrategy(strategyId);
    if (strategy.userAddress !== userAddress) throw new Error('Unauthorized');
    return strategy;
  },

  async getStrategyForAgent(
    strategyId: string,
    agentId: string,
    walletAddress: string,
  ) {
    const strategy = await getRequiredStrategy(strategyId);
    if (strategy.userAddress !== walletAddress) throw new Error('Unauthorized');
    if (strategy.agentId !== agentId)
      throw new Error('Strategy is not linked to the authenticated agent');
    return strategy;
  },

  async linkStrategyToAgent(
    strategyId: string,
    agentId: string,
    walletAddress: string,
    pairAddress?: string,
  ) {
    const strategy = await getRequiredStrategy(strategyId);
    if (strategy.userAddress !== walletAddress) throw new Error('Unauthorized');
    if (strategy.agentId && strategy.agentId !== agentId) {
      throw new Error('Strategy already linked to another agent');
    }
    if (pairAddress && strategy.pairAddress !== pairAddress) {
      throw new Error('Pair address does not match the registered strategy');
    }

    const updated = await prisma.asymmetricStrategy.update({
      where: { id: strategyId },
      data: { agentId },
    });

    const output = formatStrategy(updated);
    await safeRecordAuditLog({
      strategyId,
      side: 'SELL',
      trigger: 'AI_AGENT',
      acquiredAmount: 0,
      newCapacity: output.sellCurve.maxCapacity,
      status: 'SUCCESS',
    });

    return output;
  },

  async listUserStrategies(
    userAddress: string,
  ): Promise<StrategyStatusOutput[]> {
    const strategies = await prisma.asymmetricStrategy.findMany({
      where: { userAddress },
      orderBy: { createdAt: 'desc' },
    });
    return strategies.map(formatStrategy);
  },

  async toggleAutoRebalance(
    strategyId: string,
    userAddress: string,
    enable: boolean,
  ): Promise<StrategyStatusOutput> {
    await this.getStrategyForUser(strategyId, userAddress);

    const updated = await prisma.asymmetricStrategy.update({
      where: { id: strategyId },
      data: { isAutoRebalance: enable },
    });
    const output = formatStrategy(updated);
    await safeRecordAuditLog({
      strategyId,
      side: 'SELL',
      trigger: 'MANUAL',
      acquiredAmount: 0,
      newCapacity: output.sellCurve.maxCapacity,
      status: 'SUCCESS',
    });

    return output;
  },

  async updateCurveParams(
    strategyId: string,
    userAddress: string,
    input: UpdateCurveInput,
  ): Promise<StrategyStatusOutput> {
    await this.getStrategyForUser(strategyId, userAddress);
    const updated = await applyCurveParamsUpdate(strategyId, input);
    await safeRecordAuditLog({
      strategyId,
      side: input.isBuySide ? 'BUY' : 'SELL',
      trigger: 'MANUAL',
      acquiredAmount: 0,
      newCapacity: input.isBuySide
        ? updated.buyCurve.maxCapacity
        : updated.sellCurve.maxCapacity,
      status: 'SUCCESS',
    });

    return updated;
  },

  async applyCurveParams(
    strategyId: string,
    input: UpdateCurveInput,
  ): Promise<StrategyStatusOutput> {
    await getRequiredStrategy(strategyId);
    return applyCurveParamsUpdate(strategyId, input);
  },

  // Called by rebalancerService after successful rebalance
  async markRebalancedSuccess(strategyId: string): Promise<void> {
    await prisma.asymmetricStrategy.update({
      where: { id: strategyId },
      data: {
        status: 'ACTIVE',
        lastRebalancedAt: new Date(),
        pendingAmount: new Decimal(0),
        retryCount: 0,
        lastError: null,
      },
    });
  },

  // Called when event arrives but cooldown active or dust too small
  async accumulatePending(strategyId: string, amount: number): Promise<void> {
    await prisma.asymmetricStrategy.update({
      where: { id: strategyId },
      data: {
        pendingAmount: { increment: new Decimal(amount) },
        status: 'COOLING_DOWN',
      },
    });
  },

  // Called on retry failure — suspends after MAX_RETRIES
  async recordFailure(strategyId: string, error: string): Promise<boolean> {
    const strategy = await prisma.asymmetricStrategy.findUnique({
      where: { id: strategyId },
    });
    if (!strategy) return false;

    const newRetryCount = strategy.retryCount + 1;
    const suspended = newRetryCount >= MAX_RETRIES;

    await prisma.asymmetricStrategy.update({
      where: { id: strategyId },
      data: {
        retryCount: newRetryCount,
        lastError: error,
        status: suspended ? 'SUSPENDED_ERROR' : strategy.status,
      },
    });

    return suspended;
  },

  async getRebalanceLogs(strategyId: string, limit = 50) {
    const logs = await prisma.asymmetricRebalanceLog.findMany({
      where: { strategyId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return logs.map(formatRebalanceLog);
  },

  buildCanonicalStatus(
    strategy: StrategyStatusOutput,
    input: {
      liveState: StrategyLiveStateOutput;
      checkedAt: string;
    },
  ): StrategyCanonicalStatusOutput {
    const persistedConfig: StrategyPersistedConfigOutput = {
      strategyId: strategy.id,
      userAddress: strategy.userAddress,
      pairAddress: strategy.pairAddress,
      agentId: strategy.agentId,
      status: strategy.status,
      isAutoRebalance: strategy.isAutoRebalance,
      pendingRebalanceAmount: strategy.pendingRebalanceAmount,
      lastRebalancedAt: strategy.lastRebalancedAt,
      retryCount: strategy.retryCount,
      lastError: strategy.lastError,
      buyCurve: strategy.buyCurve,
      sellCurve: strategy.sellCurve,
      createdAt: strategy.createdAt,
      updatedAt: strategy.updatedAt,
    };

    const delegation: StrategyDelegationOutput = {
      agentManaged: strategy.agentManaged,
      agentId: strategy.agentId,
      walletAddress: strategy.userAddress,
      requiredScope: 'MANAGE_ASYMMETRIC',
      managerAddress: input.liveState.managerAddress,
      relayerAddress: input.liveState.relayerAddress,
      delegatedToRelayer: input.liveState.delegatedToRelayer,
      checkedAt: input.checkedAt,
    };

    return {
      ...strategy,
      persistedConfig,
      liveState: input.liveState,
      delegation,
    };
  },

  MAX_RETRIES,
  COOLDOWN_MS,
  isCoolingDown,
  isProfitableToRebalance,
};
