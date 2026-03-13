import type { Request, Response, NextFunction } from 'express';
interface AnomalyFlag {
    agentId: string;
    type: 'WASH_TRADE' | 'CIRCULAR_TRADE' | 'SELF_REFERRAL' | 'VELOCITY_SPIKE' | 'PATTERN_REPETITION' | 'COORDINATED_WASH' | 'ORDERBOOK_SPOOFING';
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    description: string;
    timestamp: Date;
    metadata: Record<string, unknown>;
}
declare function checkRateLimit(agentId: string, tier: number): {
    allowed: boolean;
    retryAfterMs?: number;
};
declare function recordTradeForAnalysis(agentId: string, trade: {
    pairSymbol: string;
    side: string;
    amount: string;
}): void;
declare function recordCrossAgentTrade(agentId: string, trade: {
    pairSymbol: string;
    side: string;
    amount: string;
}): void;
export declare function recordLargeOrderPlaced(agentId: string, orderId: string, amount: number, recentAvgAmount: number): void;
export declare function recordOrderCancelled(agentId: string, orderId: string): AnomalyFlag | null;
declare function detectAnomalies(agentId: string, trade: {
    pairSymbol: string;
    side: string;
    amount: string;
}): AnomalyFlag[];
declare function accumulateAnomalyScore(agentId: string, flags: AnomalyFlag[]): number;
declare function checkKeyRotation(agentId: string, keyId: string): Promise<{
    needsRotation: boolean;
    daysUntilExpiry: number;
}>;
export declare function botRateLimiter(): (req: Request, res: Response, next: NextFunction) => void | Response<any, Record<string, any>>;
export declare function botAnomalyGuard(): (req: Request, res: Response, next: NextFunction) => Promise<void | Response<any, Record<string, any>>>;
export declare function keyRotationWarning(): (req: Request, res: Response, next: NextFunction) => Promise<void>;
export declare const botSandbox: {
    checkRateLimit: typeof checkRateLimit;
    detectAnomalies: typeof detectAnomalies;
    recordTradeForAnalysis: typeof recordTradeForAnalysis;
    recordCrossAgentTrade: typeof recordCrossAgentTrade;
    recordLargeOrderPlaced: typeof recordLargeOrderPlaced;
    recordOrderCancelled: typeof recordOrderCancelled;
    accumulateAnomalyScore: typeof accumulateAnomalyScore;
    checkKeyRotation: typeof checkKeyRotation;
    getAnomalyScore: (agentId: string) => number;
    resetAnomalyScore: (agentId: string) => boolean;
    resetSpoofingCount: (agentId: string) => boolean;
    RATE_LIMITS_PER_TIER: Record<number, {
        maxPerHour: number;
        maxPerMinute: number;
    }>;
    KEY_MAX_AGE_DAYS: number;
    MAX_ANOMALY_SCORE_BEFORE_SLASH: number;
    SPOOFING_CANCEL_COUNT_THRESHOLD: number;
    COORDINATED_WASH_WINDOW_MS: number;
};
export {};
//# sourceMappingURL=botSandbox.d.ts.map