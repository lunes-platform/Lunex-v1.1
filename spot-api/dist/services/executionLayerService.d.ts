import { Prisma } from '@prisma/client';
import type { OrderSide, ExecutionStatus } from '@prisma/client';
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
    amount: string;
    price?: string;
    maxSlippageBps?: number;
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
export declare const executionLayerService: {
    validateTrade(request: TradeRequest): Promise<ValidationResult>;
    logExecution(input: LogExecutionInput): Promise<{
        price: Prisma.Decimal | null;
        id: string;
        side: import(".prisma/client").$Enums.OrderSide;
        status: import(".prisma/client").$Enums.ExecutionStatus;
        createdAt: Date;
        pairSymbol: string;
        source: string;
        slippageBps: number | null;
        agentId: string;
        strategyId: string | null;
        rejectionReason: string | null;
        orderId: string | null;
        orderType: string;
        requestedAmount: Prisma.Decimal;
        executedAmount: Prisma.Decimal | null;
        validationChecks: Prisma.JsonValue | null;
    }>;
    updateExecutionStatus(logId: string, update: {
        status: ExecutionStatus;
        orderId?: string;
        executedAmount?: string;
        executionPrice?: string;
        slippageBps?: number;
    }): Promise<{
        price: Prisma.Decimal | null;
        id: string;
        side: import(".prisma/client").$Enums.OrderSide;
        status: import(".prisma/client").$Enums.ExecutionStatus;
        createdAt: Date;
        pairSymbol: string;
        source: string;
        slippageBps: number | null;
        agentId: string;
        strategyId: string | null;
        rejectionReason: string | null;
        orderId: string | null;
        orderType: string;
        requestedAmount: Prisma.Decimal;
        executedAmount: Prisma.Decimal | null;
        validationChecks: Prisma.JsonValue | null;
    }>;
    getAgentExecutionHistory(agentId: string, opts?: {
        status?: ExecutionStatus;
        pairSymbol?: string;
        since?: Date;
        limit?: number;
        offset?: number;
    }): Promise<{
        entries: {
            price: Prisma.Decimal | null;
            id: string;
            side: import(".prisma/client").$Enums.OrderSide;
            status: import(".prisma/client").$Enums.ExecutionStatus;
            createdAt: Date;
            pairSymbol: string;
            source: string;
            slippageBps: number | null;
            agentId: string;
            strategyId: string | null;
            rejectionReason: string | null;
            orderId: string | null;
            orderType: string;
            requestedAmount: Prisma.Decimal;
            executedAmount: Prisma.Decimal | null;
            validationChecks: Prisma.JsonValue | null;
        }[];
        total: number;
    }>;
    getStrategyExecutionHistory(strategyId: string, opts?: {
        status?: ExecutionStatus;
        since?: Date;
        limit?: number;
        offset?: number;
    }): Promise<{
        entries: {
            price: Prisma.Decimal | null;
            id: string;
            side: import(".prisma/client").$Enums.OrderSide;
            status: import(".prisma/client").$Enums.ExecutionStatus;
            createdAt: Date;
            pairSymbol: string;
            source: string;
            slippageBps: number | null;
            agentId: string;
            strategyId: string | null;
            rejectionReason: string | null;
            orderId: string | null;
            orderType: string;
            requestedAmount: Prisma.Decimal;
            executedAmount: Prisma.Decimal | null;
            validationChecks: Prisma.JsonValue | null;
        }[];
        total: number;
    }>;
    getDailySummary(agentId: string, date?: Date): Promise<{
        date: string;
        totalAttempts: number;
        executed: number;
        rejected: number;
        failed: number;
        totalVolume: number;
        successRate: number;
    }>;
    validateAndLog(request: TradeRequest): Promise<{
        logId: string;
        validation: ValidationResult;
    }>;
};
//# sourceMappingURL=executionLayerService.d.ts.map