type MarginPriceMetadata = {
    source: 'LAST_TRADE' | 'BOOK_MID';
    observedAt: string;
    ageMs: number;
};
type MarginPriceMonitorState = {
    pairSymbol: string;
    status: 'HEALTHY' | 'UNHEALTHY';
    isOperationallyBlocked: boolean;
    totalSuccesses: number;
    totalFailures: number;
    consecutiveFailures: number;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    lastFailureReason: string | null;
    lastResolvedSource: 'LAST_TRADE' | 'BOOK_MID' | null;
    lastResolvedObservedAt: string | null;
    lastResolvedAgeMs: number | null;
    lastResolvedPrice: number | null;
};
type FormattedMarginPosition = {
    id: string;
    pairSymbol: string;
    side: string;
    status: string;
    collateralAmount: number;
    leverage: number;
    notional: number;
    quantity: number;
    entryPrice: number;
    markPrice: number;
    borrowedAmount: number;
    maintenanceMargin: number;
    liquidationPrice: number;
    unrealizedPnl: number;
    realizedPnl: number;
    equity: number;
    healthFactor: number | null;
    isLiquidatable: boolean;
    markPriceMeta?: MarginPriceMetadata;
    openedAt: Date;
    closedAt: Date | null;
    updatedAt: Date;
};
export declare const marginService: {
    getPriceHealth(pairSymbol?: string): {
        generatedAt: string;
        summary: {
            trackedPairs: number;
            healthyPairs: number;
            unhealthyPairs: number;
            hasActiveAlerts: boolean;
            blockedPairs: number;
            operationalBlockAfterFailures: number;
        };
        pairs: MarginPriceMonitorState[];
    };
    getPriceHealthSummary(): {
        trackedPairs: number;
        healthyPairs: number;
        unhealthyPairs: number;
        hasActiveAlerts: boolean;
        blockedPairs: number;
        operationalBlockAfterFailures: number;
    };
    getPriceHealthMetrics(): string;
    resetPriceHealthMonitor(pairSymbol?: string): {
        generatedAt: string;
        summary: {
            trackedPairs: number;
            healthyPairs: number;
            unhealthyPairs: number;
            hasActiveAlerts: boolean;
            blockedPairs: number;
            operationalBlockAfterFailures: number;
        };
        pairs: MarginPriceMonitorState[];
    };
    getOverview(address: string): Promise<{
        account: {
            id: string;
            address: string;
            collateralToken: string;
            collateralAvailable: number;
            collateralLocked: number;
            totalRealizedPnl: number;
            totalEquity: number;
            updatedAt: Date;
        };
        positions: FormattedMarginPosition[];
        risk: {
            openPositions: number;
            totalUnrealizedPnl: number;
            liquidatablePositions: number;
            markPriceHealth: {
                sources: ("LAST_TRADE" | "BOOK_MID" | undefined)[];
                latestObservedAt: string | null;
                maxAgeMs: number;
                hasStaleMarks: boolean;
            } | null;
        };
    }>;
    depositCollateral(input: {
        address: string;
        token?: string;
        amount: string;
        signature: string;
    }): Promise<{
        account: {
            id: string;
            address: string;
            collateralToken: string;
            collateralAvailable: number;
            collateralLocked: number;
            totalRealizedPnl: number;
            updatedAt: Date;
        };
    }>;
    withdrawCollateral(input: {
        address: string;
        token?: string;
        amount: string;
        signature: string;
    }): Promise<{
        account: {
            id: string;
            address: string;
            collateralToken: string;
            collateralAvailable: number;
            collateralLocked: number;
            totalRealizedPnl: number;
            updatedAt: Date;
        };
    }>;
    openPosition(input: {
        address: string;
        pairSymbol: string;
        side: "BUY" | "SELL";
        collateralAmount: string;
        leverage: string;
        signature: string;
    }): Promise<{
        position: FormattedMarginPosition;
        overview: {
            account: {
                id: string;
                address: string;
                collateralToken: string;
                collateralAvailable: number;
                collateralLocked: number;
                totalRealizedPnl: number;
                totalEquity: number;
                updatedAt: Date;
            };
            positions: FormattedMarginPosition[];
            risk: {
                openPositions: number;
                totalUnrealizedPnl: number;
                liquidatablePositions: number;
                markPriceHealth: {
                    sources: ("LAST_TRADE" | "BOOK_MID" | undefined)[];
                    latestObservedAt: string | null;
                    maxAgeMs: number;
                    hasStaleMarks: boolean;
                } | null;
            };
        };
    }>;
    closePosition(positionId: string, address: string): Promise<{
        account: {
            id: string;
            address: string;
            collateralToken: string;
            collateralAvailable: number;
            collateralLocked: number;
            totalRealizedPnl: number;
            totalEquity: number;
            updatedAt: Date;
        };
        positions: FormattedMarginPosition[];
        risk: {
            openPositions: number;
            totalUnrealizedPnl: number;
            liquidatablePositions: number;
            markPriceHealth: {
                sources: ("LAST_TRADE" | "BOOK_MID" | undefined)[];
                latestObservedAt: string | null;
                maxAgeMs: number;
                hasStaleMarks: boolean;
            } | null;
        };
    }>;
    liquidatePosition(positionId: string, liquidatorAddress: string): Promise<{
        account: {
            id: string;
            address: string;
            collateralToken: string;
            collateralAvailable: number;
            collateralLocked: number;
            totalRealizedPnl: number;
            totalEquity: number;
            updatedAt: Date;
        };
        positions: FormattedMarginPosition[];
        risk: {
            openPositions: number;
            totalUnrealizedPnl: number;
            liquidatablePositions: number;
            markPriceHealth: {
                sources: ("LAST_TRADE" | "BOOK_MID" | undefined)[];
                latestObservedAt: string | null;
                maxAgeMs: number;
                hasStaleMarks: boolean;
            } | null;
        };
    }>;
};
export {};
//# sourceMappingURL=marginService.d.ts.map