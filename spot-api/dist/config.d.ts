export declare const config: {
    port: number;
    wsPort: number;
    nodeEnv: string;
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
    };
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
    PRICE_PRECISION: bigint;
    FEE_DENOMINATOR: bigint;
};
//# sourceMappingURL=config.d.ts.map