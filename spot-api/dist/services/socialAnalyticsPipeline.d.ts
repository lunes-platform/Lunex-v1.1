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
            source?: undefined;
            latestBlock?: undefined;
            lastProcessedBlock?: undefined;
            recovered?: undefined;
        } | {
            enabled: boolean;
            processedBlocks: number;
            indexedEvents: number;
            prismaReady: boolean;
            source?: undefined;
            latestBlock?: undefined;
            lastProcessedBlock?: undefined;
            recovered?: undefined;
        } | {
            enabled: boolean;
            source: string;
            processedBlocks: number;
            indexedEvents: number;
            latestBlock: number;
            prismaReady: boolean;
            lastProcessedBlock?: undefined;
            recovered?: undefined;
        } | {
            enabled: boolean;
            source: string;
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
            source?: undefined;
            recovered?: undefined;
        } | {
            enabled: boolean;
            processedBlocks: number;
            indexedEvents: number;
            latestBlock: number;
            lastProcessedBlock: number;
            recovered: boolean;
            prismaReady?: undefined;
            source?: undefined;
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