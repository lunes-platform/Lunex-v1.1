export declare const config: {
    port: number;
    wsPort: number;
    nodeEnv: string;
    isProd: boolean;
    trustProxy: boolean;
    cors: {
        allowedOrigins: string[];
    };
    rateLimit: {
        windowMs: number;
        maxRequests: number;
        orderMax: number;
    };
    blockchain: {
        wsUrl: string;
        spotContractAddress: string;
        spotContractMetadataPath: string;
        relayerSeed: string;
        nativeTokenAddress: string;
        factoryContractAddress: string;
        factoryContractMetadataPath: string;
    };
    adminSecret: string;
    settlement: {
        retryIntervalMs: number;
    };
    socialAnalytics: {
        enabled: boolean;
        chainName: string;
        startBlock: number;
        backfillBlocks: number;
        pollIntervalMs: number;
        maxBlocksPerRun: number;
        trackedPallets: string[];
        trackedMethods: string[];
    };
    margin: {
        markPriceMaxAgeMs: number;
        maxBookSpreadBps: number;
        maxTradeToBookDeviationBps: number;
        operationalBlockAfterFailures: number;
    };
    subquery: {
        endpoint: string;
        enabled: boolean;
    };
    redis: {
        url: string;
        nonceTtlSeconds: number;
    };
    reconciliation: {
        enabled: boolean;
        intervalMs: number;
    };
    rewards: {
        enabled: boolean;
        rewardPoolPct: number;
        leaderPoolPct: number;
        traderPoolPct: number;
        stakerPoolPct: number;
        treasuryAddress: string;
        stakingContractAddress: string;
        stakingContractMetadataPath: string;
    };
    PRICE_PRECISION: bigint;
    FEE_DENOMINATOR: bigint;
};
//# sourceMappingURL=config.d.ts.map