declare class SocialAnalyticsPipeline {
    private timer;
    private running;
    isEnabled(): boolean;
    runOnce(): Promise<{
        indexerResult: {
            enabled: boolean;
            processedBlocks: number;
            indexedEvents: number;
            prismaReady?: undefined;
            latestBlock?: undefined;
            lastProcessedBlock?: undefined;
            recovered?: undefined;
        } | {
            enabled: boolean;
            processedBlocks: number;
            indexedEvents: number;
            prismaReady: boolean;
            latestBlock?: undefined;
            lastProcessedBlock?: undefined;
            recovered?: undefined;
        } | {
            enabled: boolean;
            processedBlocks: number;
            indexedEvents: number;
            latestBlock: number;
            lastProcessedBlock: any;
            prismaReady?: undefined;
            recovered?: undefined;
        } | {
            enabled: boolean;
            processedBlocks: number;
            indexedEvents: number;
            latestBlock: number;
            lastProcessedBlock: number;
            recovered: boolean;
            prismaReady?: undefined;
        };
        analyticsResult: {
            updatedLeaders: number;
            prismaReady: boolean;
            latestBlock?: undefined;
        } | {
            updatedLeaders: number;
            latestBlock: any;
            prismaReady: boolean;
        };
    } | null>;
    start(): Promise<void>;
    stop(): void;
}
export declare const socialAnalyticsPipeline: SocialAnalyticsPipeline;
export {};
//# sourceMappingURL=socialAnalyticsPipeline.d.ts.map