import type { AsymmetricStrategyStatus, Prisma } from '@prisma/client';
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
export declare function isCoolingDown(lastRebalancedAt: Date | null, cooldownMs?: number): boolean;
export declare function isProfitableToRebalance(pendingAmount: number, gasEstimateLunes?: number): boolean;
export declare const asymmetricService: {
    createStrategy(input: CreateStrategyInput): Promise<StrategyStatusOutput>;
    getStrategy(strategyId: string): Promise<StrategyStatusOutput>;
    listUserStrategies(userAddress: string): Promise<StrategyStatusOutput[]>;
    toggleAutoRebalance(strategyId: string, userAddress: string, enable: boolean): Promise<StrategyStatusOutput>;
    updateCurveParams(strategyId: string, userAddress: string, input: UpdateCurveInput): Promise<StrategyStatusOutput>;
    markRebalancedSuccess(strategyId: string): Promise<void>;
    accumulatePending(strategyId: string, amount: number): Promise<void>;
    recordFailure(strategyId: string, error: string): Promise<boolean>;
    getRebalanceLogs(strategyId: string, limit?: number): Promise<{
        id: string;
        side: import(".prisma/client").$Enums.AsymmetricCurveSide;
        status: string;
        createdAt: Date;
        txHash: string | null;
        strategyId: string;
        trigger: string;
        acquiredAmount: Prisma.Decimal;
        newCapacity: Prisma.Decimal;
        gasConsumed: Prisma.Decimal | null;
    }[]>;
    MAX_RETRIES: number;
    COOLDOWN_MS: number;
    isCoolingDown: typeof isCoolingDown;
    isProfitableToRebalance: typeof isProfitableToRebalance;
};
//# sourceMappingURL=asymmetricService.d.ts.map