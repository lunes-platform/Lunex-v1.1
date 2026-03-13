/**
 * Weekly reward distribution scheduler.
 * Runs every Monday at 00:00 UTC.
 *
 * Uses setInterval with hourly checks instead of node-cron
 * to avoid adding an external dependency.
 */
export declare const rewardScheduler: {
    start(): void;
    stop(): void;
    checkAndDistribute(): Promise<void>;
    /** Manual trigger for admin/testing. */
    forceDistribute(): Promise<{
        status: string;
        weekId: any;
        totalFees?: undefined;
        rewardPool?: undefined;
        leaderRewards?: undefined;
        traderRewards?: undefined;
        stakerRewards?: undefined;
        fundTxHash?: undefined;
        distributeTxHash?: undefined;
    } | {
        status: string;
        weekId: any;
        totalFees: number;
        rewardPool?: undefined;
        leaderRewards?: undefined;
        traderRewards?: undefined;
        stakerRewards?: undefined;
        fundTxHash?: undefined;
        distributeTxHash?: undefined;
    } | {
        status: string;
        weekId: any;
        totalFees: number;
        rewardPool: number;
        leaderRewards: number;
        traderRewards: number;
        stakerRewards: number;
        fundTxHash: string | null;
        distributeTxHash: string | null;
    } | null>;
};
//# sourceMappingURL=rewardScheduler.d.ts.map