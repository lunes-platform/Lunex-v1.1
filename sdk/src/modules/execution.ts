import { HttpClient } from '../http-client';

export type ExecutionStatus = 'PENDING' | 'EXECUTED' | 'REJECTED' | 'FAILED';
export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT';

export interface RiskCheck {
    passed: boolean;
    value: number;
    limit: number;
    description: string;
}

export interface ExecutionLog {
    id: string;
    agentId: string;
    strategyId?: string;
    orderId?: string;
    pairSymbol: string;
    side: OrderSide;
    orderType: OrderType;
    requestedAmount: number;
    executedAmount?: number;
    price?: number;
    slippageBps?: number;
    status: ExecutionStatus;
    rejectionReason?: string;
    validationChecks?: Record<string, RiskCheck>;
    source: string;
    createdAt: string;
    updatedAt: string;
}

export interface ValidateTradeInput {
    pairSymbol: string;
    side: OrderSide;
    orderType: OrderType;
    amount: number | string;
    price?: number | string;
    maxSlippageBps?: number;
    strategyId?: string;
}

export interface ValidateTradeResult {
    allowed: boolean;
    rejectionReason?: string;
    checks: Record<string, RiskCheck>;
}

export interface DailySummary {
    date: string;
    totalAttempts: number;
    executed: number;
    rejected: number;
    failed: number;
    successRate: number;
    totalVolume: number;
    rejectionReasons: Record<string, number>;
}

export interface RiskParams {
    agentId: string;
    maxPositionSize: number;
    dailyTradeLimit: number;
    maxOpenOrders: number;
    globalSlippageLimitBps: number;
    tradesToday: number;
    openOrdersCount: number;
    strategy?: {
        id: string;
        name: string;
        riskLevel: string;
        slippageLimitBps: number;
        maxTradeSizePct: number;
        vaultEquity: number;
    };
}

export class ExecutionModule {
    constructor(private http: HttpClient) { }

    /**
     * Dry-run validate a trade against all risk controls without submitting.
     * Requires agent API key on HttpClient.
     */
    async validate(input: ValidateTradeInput): Promise<ValidateTradeResult> {
        return this.http.post('/api/v1/execution/validate', input);
    }

    /**
     * Validate and create an execution log entry atomically.
     * Requires agent API key.
     */
    async validateAndLog(input: ValidateTradeInput): Promise<{
        allowed: boolean;
        rejectionReason?: string;
        checks: Record<string, RiskCheck>;
        logId?: string;
    }> {
        return this.http.post('/api/v1/execution/validate-and-log', input);
    }

    /**
     * Get execution history for the authenticated agent.
     * Requires agent API key.
     */
    async getHistory(params?: {
        strategyId?: string;
        status?: ExecutionStatus;
        pairSymbol?: string;
        since?: string;
        limit?: number;
    }): Promise<{ logs: ExecutionLog[]; total: number }> {
        return this.http.get('/api/v1/execution/history', params);
    }

    /**
     * Get today's execution summary for the authenticated agent.
     * Requires agent API key.
     */
    async getDailySummary(date?: string): Promise<DailySummary> {
        const response = await this.http.get<{ summary: DailySummary }>(
            '/api/v1/execution/daily-summary',
            date ? { date } : undefined,
        );
        return response.summary;
    }

    /**
     * Get current risk parameters for the authenticated agent.
     * Requires agent API key.
     */
    async getRiskParams(strategyId?: string): Promise<RiskParams> {
        const response = await this.http.get<{ riskParams: RiskParams }>(
            '/api/v1/execution/risk-params',
            strategyId ? { strategyId } : undefined,
        );
        return response.riskParams;
    }

    /**
     * Update the status of an execution log entry.
     * Requires agent API key.
     */
    async updateStatus(logId: string, status: ExecutionStatus, executedAmount?: number): Promise<ExecutionLog> {
        const response = await this.http.patch<{ log: ExecutionLog }>(
            `/api/v1/execution/${logId}/status`,
            { status, executedAmount },
        );
        return response.log;
    }
}
