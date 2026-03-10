declare class SocialAnalyticsService {
    recomputeLeaderSnapshots(): Promise<{
        updatedLeaders: number;
        prismaReady: boolean;
        latestBlock?: undefined;
    } | {
        updatedLeaders: number;
        latestBlock: any;
        prismaReady: boolean;
    }>;
    getPipelineStatus(): Promise<{
        prismaReady: boolean;
        indexedEvents: any;
        snapshots: any;
        latestIndexedEvent: any;
        enabled: boolean;
        chain: string;
        cursor: any;
        ready: boolean;
    }>;
}
export declare const socialAnalyticsService: SocialAnalyticsService;
export {};
//# sourceMappingURL=socialAnalyticsService.d.ts.map