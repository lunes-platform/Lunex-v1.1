"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.asymmetricService = void 0;
exports.isCoolingDown = isCoolingDown;
exports.isProfitableToRebalance = isProfitableToRebalance;
const library_1 = require("@prisma/client/runtime/library");
const db_1 = __importDefault(require("../db"));
// ─── Constants ──────────────────────────────────────────────────
const COOLDOWN_MS = 5 * 60 * 1000; // 5 min default cooldown
const GAS_COST_ESTIMATE_LUNES = 0.05; // Estimated gas per update_curve_parameters call
const GAS_MULTIPLIER_THRESHOLD = 5; // Rebalance only if value > 5x gas cost
const MAX_RETRIES = 3;
// ─── Helpers ────────────────────────────────────────────────────
function isCoolingDown(lastRebalancedAt, cooldownMs = COOLDOWN_MS) {
    if (!lastRebalancedAt)
        return false;
    return Date.now() - lastRebalancedAt.getTime() < cooldownMs;
}
function isProfitableToRebalance(pendingAmount, gasEstimateLunes = GAS_COST_ESTIMATE_LUNES) {
    return pendingAmount >= gasEstimateLunes * GAS_MULTIPLIER_THRESHOLD;
}
function formatStrategy(s) {
    return {
        id: s.id,
        userAddress: s.userAddress,
        pairAddress: s.pairAddress,
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
// ─── Service ────────────────────────────────────────────────────
exports.asymmetricService = {
    async createStrategy(input) {
        if (input.buyGamma < 1 || input.buyGamma > 5)
            throw new Error('buyGamma must be between 1 and 5');
        if (input.sellGamma < 1 || input.sellGamma > 5)
            throw new Error('sellGamma must be between 1 and 5');
        if (new library_1.Decimal(input.buyK).lte(0))
            throw new Error('buyK must be positive');
        const existing = await db_1.default.asymmetricStrategy.findFirst({
            where: { userAddress: input.userAddress, pairAddress: input.pairAddress, status: { not: 'SUSPENDED_ERROR' } },
        });
        if (existing)
            throw new Error('Active strategy already exists for this pair');
        const strategy = await db_1.default.asymmetricStrategy.create({
            data: {
                userAddress: input.userAddress,
                pairAddress: input.pairAddress,
                agentId: input.agentId ?? null,
                isAutoRebalance: input.isAutoRebalance ?? true,
                buyK: new library_1.Decimal(input.buyK),
                buyGamma: input.buyGamma,
                buyMaxCapacity: new library_1.Decimal(input.buyMaxCapacity),
                buyFeeTargetBps: input.buyFeeTargetBps ?? 30,
                sellGamma: input.sellGamma,
                sellMaxCapacity: new library_1.Decimal(input.sellMaxCapacity),
                sellFeeTargetBps: input.sellFeeTargetBps ?? 30,
                sellProfitTargetBps: input.sellProfitTargetBps ?? 500,
                leverageL: new library_1.Decimal(input.leverageL ?? '0'),
                allocationC: new library_1.Decimal(input.allocationC ?? 0.5),
            },
        });
        return formatStrategy(strategy);
    },
    async getStrategy(strategyId) {
        const strategy = await db_1.default.asymmetricStrategy.findUnique({
            where: { id: strategyId },
        });
        if (!strategy)
            throw new Error('Strategy not found');
        return formatStrategy(strategy);
    },
    async listUserStrategies(userAddress) {
        const strategies = await db_1.default.asymmetricStrategy.findMany({
            where: { userAddress },
            orderBy: { createdAt: 'desc' },
        });
        return strategies.map(formatStrategy);
    },
    async toggleAutoRebalance(strategyId, userAddress, enable) {
        const strategy = await db_1.default.asymmetricStrategy.findUnique({ where: { id: strategyId } });
        if (!strategy)
            throw new Error('Strategy not found');
        if (strategy.userAddress !== userAddress)
            throw new Error('Unauthorized');
        const updated = await db_1.default.asymmetricStrategy.update({
            where: { id: strategyId },
            data: { isAutoRebalance: enable },
        });
        return formatStrategy(updated);
    },
    async updateCurveParams(strategyId, userAddress, input) {
        const strategy = await db_1.default.asymmetricStrategy.findUnique({ where: { id: strategyId } });
        if (!strategy)
            throw new Error('Strategy not found');
        if (strategy.userAddress !== userAddress)
            throw new Error('Unauthorized');
        if (input.newGamma && (input.newGamma < 1 || input.newGamma > 5))
            throw new Error('gamma must be between 1 and 5');
        const data = {};
        if (input.isBuySide) {
            if (input.newGamma !== undefined)
                data.buyGamma = input.newGamma;
            if (input.newMaxCapacity !== undefined)
                data.buyMaxCapacity = new library_1.Decimal(input.newMaxCapacity);
            if (input.newFeeTargetBps !== undefined)
                data.buyFeeTargetBps = input.newFeeTargetBps;
        }
        else {
            if (input.newGamma !== undefined)
                data.sellGamma = input.newGamma;
            if (input.newMaxCapacity !== undefined)
                data.sellMaxCapacity = new library_1.Decimal(input.newMaxCapacity);
            if (input.newFeeTargetBps !== undefined)
                data.sellFeeTargetBps = input.newFeeTargetBps;
        }
        const updated = await db_1.default.asymmetricStrategy.update({
            where: { id: strategyId },
            data,
        });
        return formatStrategy(updated);
    },
    // Called by rebalancerService after successful rebalance
    async markRebalancedSuccess(strategyId) {
        await db_1.default.asymmetricStrategy.update({
            where: { id: strategyId },
            data: {
                status: 'ACTIVE',
                lastRebalancedAt: new Date(),
                pendingAmount: new library_1.Decimal(0),
                retryCount: 0,
                lastError: null,
            },
        });
    },
    // Called when event arrives but cooldown active or dust too small
    async accumulatePending(strategyId, amount) {
        await db_1.default.asymmetricStrategy.update({
            where: { id: strategyId },
            data: {
                pendingAmount: { increment: new library_1.Decimal(amount) },
                status: 'COOLING_DOWN',
            },
        });
    },
    // Called on retry failure — suspends after MAX_RETRIES
    async recordFailure(strategyId, error) {
        const strategy = await db_1.default.asymmetricStrategy.findUnique({ where: { id: strategyId } });
        if (!strategy)
            return false;
        const newRetryCount = strategy.retryCount + 1;
        const suspended = newRetryCount >= MAX_RETRIES;
        await db_1.default.asymmetricStrategy.update({
            where: { id: strategyId },
            data: {
                retryCount: newRetryCount,
                lastError: error,
                status: suspended ? 'SUSPENDED_ERROR' : strategy.status,
            },
        });
        return suspended;
    },
    async getRebalanceLogs(strategyId, limit = 50) {
        return db_1.default.asymmetricRebalanceLog.findMany({
            where: { strategyId },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
    },
    MAX_RETRIES,
    COOLDOWN_MS,
    isCoolingDown,
    isProfitableToRebalance,
};
//# sourceMappingURL=asymmetricService.js.map