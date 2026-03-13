"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.executionLayerService = void 0;
const db_1 = __importDefault(require("../db"));
const client_1 = require("@prisma/client");
const logger_1 = require("../utils/logger");
// ─── Constants ───────────────────────────────────────────────────
// Maximum slippage per strategy risk level
const RISK_SLIPPAGE_LIMITS = {
    LOW: 50, // 0.5%
    MEDIUM: 150, // 1.5%
    HIGH: 300, // 3.0%
    AGGRESSIVE: 500, // 5.0%
};
// Maximum single trade size as fraction of vault equity per risk level
const RISK_TRADE_SIZE_FRACTION = {
    LOW: 0.05, // 5% of vault equity
    MEDIUM: 0.10,
    HIGH: 0.20,
    AGGRESSIVE: 0.40,
};
// ─── Service ─────────────────────────────────────────────────────
exports.executionLayerService = {
    // ── Validate a trade request against all risk controls ─────────
    async validateTrade(request) {
        const { agentId, strategyId, amount, pairSymbol, maxSlippageBps = 100 } = request;
        const amountNum = parseFloat(amount);
        const checks = {};
        const rejections = [];
        // ── 1. Agent exists and is active ──────────────────────────
        const agent = await db_1.default.agent.findUnique({
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
                allowed: false, checks,
                rejectionReason: `Agent is banned: ${agent.banReason ?? 'no reason given'}`,
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
            rejections.push(`Amount ${amountNum} exceeds max position size ${maxPositionSize} (tier ${agent.stakingTier})`);
        }
        // ── 3. Daily trade count (from ExecutionLog) ───────────────
        const todayStart = new Date();
        todayStart.setUTCHours(0, 0, 0, 0);
        const dailyCount = await db_1.default.executionLog.count({
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
            rejections.push(`Daily trade limit reached (${dailyCount}/${agent.dailyTradeLimit})`);
        }
        // ── 4. Open orders count ───────────────────────────────────
        const openOrderCount = await db_1.default.order.count({
            where: { makerAddress: (await db_1.default.agent.findUnique({ where: { id: agentId }, select: { walletAddress: true } })).walletAddress, status: { in: ['OPEN', 'PARTIAL'] } },
        });
        checks.open_orders = {
            passed: openOrderCount < agent.maxOpenOrders,
            value: openOrderCount,
            limit: agent.maxOpenOrders,
            description: `Open order count vs tier limit`,
        };
        if (!checks.open_orders.passed) {
            rejections.push(`Max open orders reached (${openOrderCount}/${agent.maxOpenOrders})`);
        }
        // ── 5. Slippage limit ──────────────────────────────────────
        checks.slippage_limit = {
            passed: maxSlippageBps <= 500,
            value: maxSlippageBps,
            limit: 500,
            description: `Requested slippage vs global max (500 bps = 5%)`,
        };
        if (!checks.slippage_limit.passed) {
            rejections.push(`Slippage ${maxSlippageBps} bps exceeds global maximum 500 bps`);
        }
        // ── 6. Strategy-level risk controls (if linked) ────────────
        if (strategyId) {
            const strategy = await db_1.default.strategy.findUnique({
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
                    rejections.push(`Slippage ${maxSlippageBps} bps exceeds ${strategy.riskLevel} risk limit ${riskSlippageCap} bps`);
                }
                // Trade size vs vault equity
                const vaultEquity = parseFloat(strategy.vaultEquity.toString());
                if (vaultEquity > 0) {
                    const tradeFraction = amountNum / vaultEquity;
                    const maxFraction = RISK_TRADE_SIZE_FRACTION[strategy.riskLevel] ?? 0.10;
                    checks.strategy_trade_size = {
                        passed: tradeFraction <= maxFraction,
                        value: Math.round(tradeFraction * 10000) / 100, // as percentage
                        limit: maxFraction * 100,
                        description: `Trade size as % of vault equity vs risk level limit`,
                    };
                    if (!checks.strategy_trade_size.passed) {
                        rejections.push(`Trade size ${(tradeFraction * 100).toFixed(2)}% of vault equity exceeds ${strategy.riskLevel} limit ${(maxFraction * 100).toFixed(0)}%`);
                    }
                }
            }
        }
        const allowed = rejections.length === 0;
        return {
            allowed,
            checks,
            rejectionReason: rejections.length > 0 ? rejections.join('; ') : undefined,
        };
    },
    // ── Log an execution (before or after orderbook submission) ────
    async logExecution(input) {
        const log_entry = await db_1.default.executionLog.create({
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
                    ? input.validationChecks
                    : client_1.Prisma.DbNull,
                source: input.source ?? 'API',
            },
        });
        return log_entry;
    },
    // ── Update execution status after fill ─────────────────────────
    async updateExecutionStatus(logId, update) {
        return db_1.default.executionLog.update({
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
    async getAgentExecutionHistory(agentId, opts = {}) {
        const { status, pairSymbol, since, limit = 50, offset = 0 } = opts;
        const where = {
            agentId,
            ...(status && { status }),
            ...(pairSymbol && { pairSymbol }),
            ...(since && { createdAt: { gte: since } }),
        };
        const [entries, total] = await Promise.all([
            db_1.default.executionLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
            db_1.default.executionLog.count({ where }),
        ]);
        return { entries, total };
    },
    async getStrategyExecutionHistory(strategyId, opts = {}) {
        const { status, since, limit = 50, offset = 0 } = opts;
        const where = {
            strategyId,
            ...(status && { status }),
            ...(since && { createdAt: { gte: since } }),
        };
        const [entries, total] = await Promise.all([
            db_1.default.executionLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
            db_1.default.executionLog.count({ where }),
        ]);
        return { entries, total };
    },
    // ── Daily summary for an agent ─────────────────────────────────
    async getDailySummary(agentId, date) {
        const day = date ?? new Date();
        const start = new Date(day);
        start.setUTCHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setUTCDate(end.getUTCDate() + 1);
        const logs = await db_1.default.executionLog.findMany({
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
        const totalVolume = executed.reduce((sum, l) => sum + parseFloat(l.requestedAmount.toString()), 0);
        return {
            date: start.toISOString().split('T')[0],
            totalAttempts: logs.length,
            executed: executed.length,
            rejected: rejected.length,
            failed: failed.length,
            totalVolume: Math.round(totalVolume * 1e8) / 1e8,
            successRate: logs.length > 0 ? Math.round((executed.length / logs.length) * 10000) / 100 : 0,
        };
    },
    // ── Validate + log in one call (used by tradeApi middleware) ────
    async validateAndLog(request) {
        const validation = await exports.executionLayerService.validateTrade(request);
        const logEntry = await exports.executionLayerService.logExecution({
            ...request,
            status: validation.allowed ? 'PENDING' : 'REJECTED',
            rejectionReason: validation.rejectionReason,
            validationChecks: validation.checks,
        });
        if (!validation.allowed) {
            logger_1.log.warn({
                agentId: request.agentId,
                strategyId: request.strategyId,
                pairSymbol: request.pairSymbol,
                amount: request.amount,
                reason: validation.rejectionReason,
            }, '[ExecutionLayer] Trade rejected');
        }
        return { logId: logEntry.id, validation };
    },
};
//# sourceMappingURL=executionLayerService.js.map