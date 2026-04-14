import prisma from '../db';
import { Prisma } from '@prisma/client';
import { log } from '../utils/logger';
import type { OrderSide, ExecutionStatus } from '@prisma/client';

// ─── Types ───────────────────────────────────────────────────────

export interface RiskCheck {
  passed: boolean;
  value: number;
  limit: number;
  description: string;
}

export interface ValidationResult {
  allowed: boolean;
  checks: Record<string, RiskCheck>;
  rejectionReason?: string;
}

export interface TradeRequest {
  agentId: string;
  strategyId?: string;
  pairSymbol: string;
  side: OrderSide;
  orderType: 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT';
  amount: string; // decimal string
  price?: string; // decimal string (optional for MARKET)
  maxSlippageBps?: number; // default 100 (1%)
  source?: string;
}

export interface LogExecutionInput extends TradeRequest {
  orderId?: string;
  executedAmount?: string;
  executionPrice?: string;
  slippageBps?: number;
  status: ExecutionStatus;
  rejectionReason?: string;
  validationChecks?: Record<string, RiskCheck>;
}

// ─── Constants ───────────────────────────────────────────────────

// Maximum slippage per strategy risk level
const RISK_SLIPPAGE_LIMITS: Record<string, number> = {
  LOW: 50, // 0.5%
  MEDIUM: 150, // 1.5%
  HIGH: 300, // 3.0%
  AGGRESSIVE: 500, // 5.0%
};

// Maximum single trade size as fraction of vault equity per risk level
const RISK_TRADE_SIZE_FRACTION: Record<string, number> = {
  LOW: 0.05, // 5% of vault equity
  MEDIUM: 0.1,
  HIGH: 0.2,
  AGGRESSIVE: 0.4,
};

// ─── Service ─────────────────────────────────────────────────────

export const executionLayerService = {
  // ── Validate a trade request against all risk controls ─────────

  async validateTrade(request: TradeRequest): Promise<ValidationResult> {
    const { agentId, strategyId, amount, maxSlippageBps = 100 } = request;
    const amountNum = parseFloat(amount);
    const checks: Record<string, RiskCheck> = {};
    const rejections: string[] = [];

    // ── 1. Agent exists and is active ──────────────────────────
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: {
        isActive: true,
        isBanned: true,
        banReason: true,
        dailyTradeLimit: true,
        maxPositionSize: true,
        maxOpenOrders: true,
        stakingTier: true,
      },
    });

    if (!agent)
      return { allowed: false, checks, rejectionReason: 'Agent not found' };
    if (!agent.isActive)
      return { allowed: false, checks, rejectionReason: 'Agent is inactive' };
    if (agent.isBanned)
      return {
        allowed: false,
        checks,
        rejectionReason: `Agent is banned: ${
          agent.banReason ?? 'no reason given'
        }`,
      };

    // ── 2. Max position size (staking tier) ────────────────────
    const maxPositionSize = parseFloat(agent.maxPositionSize.toString());
    checks.max_position_size = {
      passed: amountNum <= maxPositionSize,
      value: amountNum,
      limit: maxPositionSize,
      description: `Trade amount vs staking tier max position size`,
    };
    if (!checks.max_position_size.passed) {
      rejections.push(
        `Amount ${amountNum} exceeds max position size ${maxPositionSize} (tier ${agent.stakingTier})`,
      );
    }

    // ── 3. Daily trade count (from ExecutionLog) ───────────────
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const dailyCount = await prisma.executionLog.count({
      where: {
        agentId,
        status: { in: ['PENDING', 'EXECUTED'] },
        createdAt: { gte: todayStart },
      },
    });

    checks.daily_trade_count = {
      passed: dailyCount < agent.dailyTradeLimit,
      value: dailyCount,
      limit: agent.dailyTradeLimit,
      description: `Daily trade count vs tier limit`,
    };
    if (!checks.daily_trade_count.passed) {
      rejections.push(
        `Daily trade limit reached (${dailyCount}/${agent.dailyTradeLimit})`,
      );
    }

    // ── 4. Open orders count ───────────────────────────────────
    const openOrderCount = await prisma.order.count({
      where: {
        makerAddress: (await prisma.agent.findUnique({
          where: { id: agentId },
          select: { walletAddress: true },
        }))!.walletAddress,
        status: { in: ['OPEN', 'PARTIAL'] },
      },
    });

    checks.open_orders = {
      passed: openOrderCount < agent.maxOpenOrders,
      value: openOrderCount,
      limit: agent.maxOpenOrders,
      description: `Open order count vs tier limit`,
    };
    if (!checks.open_orders.passed) {
      rejections.push(
        `Max open orders reached (${openOrderCount}/${agent.maxOpenOrders})`,
      );
    }

    // ── 5. Slippage limit ──────────────────────────────────────
    checks.slippage_limit = {
      passed: maxSlippageBps <= 500,
      value: maxSlippageBps,
      limit: 500,
      description: `Requested slippage vs global max (500 bps = 5%)`,
    };
    if (!checks.slippage_limit.passed) {
      rejections.push(
        `Slippage ${maxSlippageBps} bps exceeds global maximum 500 bps`,
      );
    }

    // ── 6. Strategy-level risk controls (if linked) ────────────
    if (strategyId) {
      const strategy = await prisma.strategy.findUnique({
        where: { id: strategyId },
        select: {
          status: true,
          riskLevel: true,
          vaultEquity: true,
          agentId: true,
        },
      });

      if (strategy) {
        // Strategy must be active
        checks.strategy_active = {
          passed: strategy.status === 'ACTIVE',
          value: strategy.status === 'ACTIVE' ? 1 : 0,
          limit: 1,
          description: `Strategy is active`,
        };
        if (!checks.strategy_active.passed) {
          rejections.push(`Strategy is ${strategy.status}, not ACTIVE`);
        }

        // Strategy agent ownership
        checks.strategy_ownership = {
          passed: strategy.agentId === agentId,
          value: 1,
          limit: 1,
          description: `Agent owns the strategy`,
        };
        if (!checks.strategy_ownership.passed) {
          rejections.push(`Agent does not own the specified strategy`);
        }

        // Strategy risk-level slippage cap
        const riskSlippageCap = RISK_SLIPPAGE_LIMITS[strategy.riskLevel] ?? 300;
        checks.strategy_slippage = {
          passed: maxSlippageBps <= riskSlippageCap,
          value: maxSlippageBps,
          limit: riskSlippageCap,
          description: `Slippage vs strategy risk level (${strategy.riskLevel}) cap`,
        };
        if (!checks.strategy_slippage.passed) {
          rejections.push(
            `Slippage ${maxSlippageBps} bps exceeds ${strategy.riskLevel} risk limit ${riskSlippageCap} bps`,
          );
        }

        // Trade size vs vault equity
        const vaultEquity = parseFloat(strategy.vaultEquity.toString());
        if (vaultEquity > 0) {
          const tradeFraction = amountNum / vaultEquity;
          const maxFraction =
            RISK_TRADE_SIZE_FRACTION[strategy.riskLevel] ?? 0.1;

          checks.strategy_trade_size = {
            passed: tradeFraction <= maxFraction,
            value: Math.round(tradeFraction * 10000) / 100, // as percentage
            limit: maxFraction * 100,
            description: `Trade size as % of vault equity vs risk level limit`,
          };
          if (!checks.strategy_trade_size.passed) {
            rejections.push(
              `Trade size ${(tradeFraction * 100).toFixed(
                2,
              )}% of vault equity exceeds ${strategy.riskLevel} limit ${(
                maxFraction * 100
              ).toFixed(0)}%`,
            );
          }
        }
      }
    }

    const allowed = rejections.length === 0;
    return {
      allowed,
      checks,
      rejectionReason:
        rejections.length > 0 ? rejections.join('; ') : undefined,
    };
  },

  // ── Log an execution (before or after orderbook submission) ────

  async logExecution(input: LogExecutionInput) {
    const log_entry = await prisma.executionLog.create({
      data: {
        agentId: input.agentId,
        strategyId: input.strategyId ?? null,
        orderId: input.orderId ?? null,
        pairSymbol: input.pairSymbol,
        side: input.side,
        orderType: input.orderType,
        requestedAmount: input.amount,
        executedAmount: input.executedAmount ?? null,
        price: input.price ?? null,
        slippageBps: input.slippageBps ?? null,
        status: input.status,
        rejectionReason: input.rejectionReason ?? null,
        validationChecks: input.validationChecks
          ? (input.validationChecks as unknown as Prisma.InputJsonValue)
          : Prisma.DbNull,
        source: input.source ?? 'API',
      },
    });

    return log_entry;
  },

  // ── Update execution status after fill ─────────────────────────

  async updateExecutionStatus(
    logId: string,
    update: {
      status: ExecutionStatus;
      orderId?: string;
      executedAmount?: string;
      executionPrice?: string;
      slippageBps?: number;
    },
  ) {
    return prisma.executionLog.update({
      where: { id: logId },
      data: {
        status: update.status,
        orderId: update.orderId ?? undefined,
        executedAmount: update.executedAmount ?? undefined,
        price: update.executionPrice ?? undefined,
        slippageBps: update.slippageBps ?? undefined,
      },
    });
  },

  // ── Execution history queries ──────────────────────────────────

  async getAgentExecutionHistory(
    agentId: string,
    opts: {
      status?: ExecutionStatus;
      pairSymbol?: string;
      since?: Date;
      limit?: number;
      offset?: number;
    } = {},
  ) {
    const { status, pairSymbol, since, limit = 50, offset = 0 } = opts;

    const where: Prisma.ExecutionLogWhereInput = {
      agentId,
      ...(status && { status }),
      ...(pairSymbol && { pairSymbol }),
      ...(since && { createdAt: { gte: since } }),
    };

    const [entries, total] = await Promise.all([
      prisma.executionLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.executionLog.count({ where }),
    ]);

    return { entries, total };
  },

  async getStrategyExecutionHistory(
    agentId: string,
    strategyId: string,
    opts: {
      status?: ExecutionStatus;
      since?: Date;
      limit?: number;
      offset?: number;
    } = {},
  ) {
    const { status, since, limit = 50, offset = 0 } = opts;

    const where: Prisma.ExecutionLogWhereInput = {
      agentId,
      strategyId,
      ...(status && { status }),
      ...(since && { createdAt: { gte: since } }),
    };

    const [entries, total] = await Promise.all([
      prisma.executionLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.executionLog.count({ where }),
    ]);

    return { entries, total };
  },

  // ── Daily summary for an agent ─────────────────────────────────

  async getDailySummary(agentId: string, date?: Date) {
    const day = date ?? new Date();
    const start = new Date(day);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);

    const logs = await prisma.executionLog.findMany({
      where: { agentId, createdAt: { gte: start, lt: end } },
      select: {
        status: true,
        requestedAmount: true,
        pairSymbol: true,
        side: true,
      },
    });

    const executed = logs.filter((l) => l.status === 'EXECUTED');
    const rejected = logs.filter((l) => l.status === 'REJECTED');
    const failed = logs.filter((l) => l.status === 'FAILED');

    const totalVolume = executed.reduce(
      (sum, l) => sum + parseFloat(l.requestedAmount.toString()),
      0,
    );

    return {
      date: start.toISOString().split('T')[0],
      totalAttempts: logs.length,
      executed: executed.length,
      rejected: rejected.length,
      failed: failed.length,
      totalVolume: Math.round(totalVolume * 1e8) / 1e8,
      successRate:
        logs.length > 0
          ? Math.round((executed.length / logs.length) * 10000) / 100
          : 0,
    };
  },

  // ── Validate + log in one call (used by tradeApi middleware) ────

  async validateAndLog(request: TradeRequest): Promise<{
    logId: string;
    validation: ValidationResult;
  }> {
    const validation = await executionLayerService.validateTrade(request);

    const logEntry = await executionLayerService.logExecution({
      ...request,
      status: validation.allowed ? 'PENDING' : 'REJECTED',
      rejectionReason: validation.rejectionReason,
      validationChecks: validation.checks,
    });

    if (!validation.allowed) {
      log.warn(
        {
          agentId: request.agentId,
          strategyId: request.strategyId,
          pairSymbol: request.pairSymbol,
          amount: request.amount,
          reason: validation.rejectionReason,
        },
        '[ExecutionLayer] Trade rejected',
      );
    }

    return { logId: logEntry.id, validation };
  },
};
