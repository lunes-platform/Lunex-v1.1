import { Decimal } from '@prisma/client/runtime/library'
import type { AsymmetricStrategyStatus, Prisma } from '@prisma/client'
import prisma from '../db'

// ─── Constants ──────────────────────────────────────────────────

const COOLDOWN_MS = 5 * 60 * 1000           // 5 min default cooldown
const GAS_COST_ESTIMATE_LUNES = 0.05        // Estimated gas per update_curve_parameters call
const GAS_MULTIPLIER_THRESHOLD = 5          // Rebalance only if value > 5x gas cost
const MAX_RETRIES = 3

// ─── Types ──────────────────────────────────────────────────────

export interface CreateStrategyInput {
    userAddress: string
    pairAddress: string
    agentId?: string
    isAutoRebalance?: boolean
    buyK: string
    buyGamma: number
    buyMaxCapacity: string
    buyFeeTargetBps?: number
    sellGamma: number
    sellMaxCapacity: string
    sellFeeTargetBps?: number
    sellProfitTargetBps?: number
    leverageL?: string
    allocationC?: number
}

export interface UpdateCurveInput {
    isBuySide: boolean
    newGamma?: number
    newMaxCapacity?: string
    newFeeTargetBps?: number
}

export interface StrategyStatusOutput {
    id: string
    userAddress: string
    pairAddress: string
    status: AsymmetricStrategyStatus
    isAutoRebalance: boolean
    pendingRebalanceAmount: string
    lastRebalancedAt: Date | null
    buyCurve: {
        gamma: number
        maxCapacity: string
        feeTargetBps: number
        baseLiquidity: string
    }
    sellCurve: {
        gamma: number
        maxCapacity: string
        feeTargetBps: number
        profitTargetBps: number
    }
    retryCount: number
    lastError: string | null
    agentManaged: boolean
    createdAt: Date
    updatedAt: Date
}

// ─── Helpers ────────────────────────────────────────────────────

export function isCoolingDown(lastRebalancedAt: Date | null, cooldownMs = COOLDOWN_MS): boolean {
    if (!lastRebalancedAt) return false
    return Date.now() - lastRebalancedAt.getTime() < cooldownMs
}

export function isProfitableToRebalance(pendingAmount: number, gasEstimateLunes = GAS_COST_ESTIMATE_LUNES): boolean {
    return pendingAmount >= gasEstimateLunes * GAS_MULTIPLIER_THRESHOLD
}

function formatStrategy(s: any): StrategyStatusOutput {
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
    }
}

// ─── Service ────────────────────────────────────────────────────

export const asymmetricService = {
    async createStrategy(input: CreateStrategyInput): Promise<StrategyStatusOutput> {
        if (input.buyGamma < 1 || input.buyGamma > 5) throw new Error('buyGamma must be between 1 and 5')
        if (input.sellGamma < 1 || input.sellGamma > 5) throw new Error('sellGamma must be between 1 and 5')
        if (new Decimal(input.buyK).lte(0)) throw new Error('buyK must be positive')

        const existing = await prisma.asymmetricStrategy.findFirst({
            where: { userAddress: input.userAddress, pairAddress: input.pairAddress, status: { not: 'SUSPENDED_ERROR' } },
        })
        if (existing) throw new Error('Active strategy already exists for this pair')

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
        })

        return formatStrategy(strategy)
    },

    async getStrategy(strategyId: string): Promise<StrategyStatusOutput> {
        const strategy = await prisma.asymmetricStrategy.findUnique({
            where: { id: strategyId },
        })
        if (!strategy) throw new Error('Strategy not found')
        return formatStrategy(strategy)
    },

    async listUserStrategies(userAddress: string): Promise<StrategyStatusOutput[]> {
        const strategies = await prisma.asymmetricStrategy.findMany({
            where: { userAddress },
            orderBy: { createdAt: 'desc' },
        })
        return strategies.map(formatStrategy)
    },

    async toggleAutoRebalance(strategyId: string, userAddress: string, enable: boolean): Promise<StrategyStatusOutput> {
        const strategy = await prisma.asymmetricStrategy.findUnique({ where: { id: strategyId } })
        if (!strategy) throw new Error('Strategy not found')
        if (strategy.userAddress !== userAddress) throw new Error('Unauthorized')

        const updated = await prisma.asymmetricStrategy.update({
            where: { id: strategyId },
            data: { isAutoRebalance: enable },
        })
        return formatStrategy(updated)
    },

    async updateCurveParams(
        strategyId: string,
        userAddress: string,
        input: UpdateCurveInput,
    ): Promise<StrategyStatusOutput> {
        const strategy = await prisma.asymmetricStrategy.findUnique({ where: { id: strategyId } })
        if (!strategy) throw new Error('Strategy not found')
        if (strategy.userAddress !== userAddress) throw new Error('Unauthorized')
        if (input.newGamma && (input.newGamma < 1 || input.newGamma > 5)) throw new Error('gamma must be between 1 and 5')

        const data: Prisma.AsymmetricStrategyUpdateInput = {}

        if (input.isBuySide) {
            if (input.newGamma !== undefined) data.buyGamma = input.newGamma
            if (input.newMaxCapacity !== undefined) data.buyMaxCapacity = new Decimal(input.newMaxCapacity)
            if (input.newFeeTargetBps !== undefined) data.buyFeeTargetBps = input.newFeeTargetBps
        } else {
            if (input.newGamma !== undefined) data.sellGamma = input.newGamma
            if (input.newMaxCapacity !== undefined) data.sellMaxCapacity = new Decimal(input.newMaxCapacity)
            if (input.newFeeTargetBps !== undefined) data.sellFeeTargetBps = input.newFeeTargetBps
        }

        const updated = await prisma.asymmetricStrategy.update({
            where: { id: strategyId },
            data,
        })

        return formatStrategy(updated)
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
        })
    },

    // Called when event arrives but cooldown active or dust too small
    async accumulatePending(strategyId: string, amount: number): Promise<void> {
        await prisma.asymmetricStrategy.update({
            where: { id: strategyId },
            data: {
                pendingAmount: { increment: new Decimal(amount) },
                status: 'COOLING_DOWN',
            },
        })
    },

    // Called on retry failure — suspends after MAX_RETRIES
    async recordFailure(strategyId: string, error: string): Promise<boolean> {
        const strategy = await prisma.asymmetricStrategy.findUnique({ where: { id: strategyId } })
        if (!strategy) return false

        const newRetryCount = strategy.retryCount + 1
        const suspended = newRetryCount >= MAX_RETRIES

        await prisma.asymmetricStrategy.update({
            where: { id: strategyId },
            data: {
                retryCount: newRetryCount,
                lastError: error,
                status: suspended ? 'SUSPENDED_ERROR' : strategy.status,
            },
        })

        return suspended
    },

    async getRebalanceLogs(strategyId: string, limit = 50) {
        return prisma.asymmetricRebalanceLog.findMany({
            where: { strategyId },
            orderBy: { createdAt: 'desc' },
            take: limit,
        })
    },

    MAX_RETRIES,
    COOLDOWN_MS,
    isCoolingDown,
    isProfitableToRebalance,
}
