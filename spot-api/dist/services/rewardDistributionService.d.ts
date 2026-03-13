interface LeaderRanking {
    address: string;
    score: number;
    roi30d: number;
    aum: number;
    followers: number;
    name: string;
}
interface StakerWeight {
    address: string;
    staked: number;
    multiplier: number;
    weight: number;
}
interface TraderRanking {
    address: string;
    volume: number;
    tradeCount: number;
}
export declare const rewardDistributionService: {
    getCurrentWeekStart(): Date;
    getWeekEnd(weekStart: Date): Date;
    calculateWeeklyFees(weekStart: Date, weekEnd: Date): Promise<number>;
    ensureCurrentWeek(): Promise<any>;
    getRewardPool(): Promise<{
        weekId: any;
        weekStart: any;
        weekEnd: any;
        status: any;
        totalFeesCollected: number;
        rewardPool: number;
        leaderPool: number;
        traderPool: number;
        stakerPool: number;
        treasuryPool: number;
        lpPool: number;
        nextDistribution: Date;
        distributedAt: any;
        relayerBalance: number | null;
        payoutEnabled: boolean;
    }>;
    rankLeaders(): Promise<LeaderRanking[]>;
    getStakerWeights(): Promise<StakerWeight[]>;
    rankTopTraders(weekStart: Date, weekEnd: Date): Promise<TraderRanking[]>;
    runWeeklyDistribution(): Promise<{
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
    distributeLeaderRewards(pool: number, weekId: string): Promise<{
        address: string;
        amount: number;
        rank: number;
        txHash: string | null;
        status: string;
    }[]>;
    distributeTraderRewards(pool: number, weekId: string, weekStart: Date, weekEnd: Date): Promise<{
        address: string;
        amount: number;
        rank: number;
        txHash: string | null;
        status: string;
    }[]>;
    recordStakerDistribution(pool: number, weekId: string, fundTxHash: string | null): Promise<{
        address: string;
        amount: number;
        weight: number;
    }[]>;
    getPendingRewards(address: string): Promise<{
        total: any;
        leaderRewards: any;
        traderRewards: any;
        stakerRewards: any;
        entries: any;
    }>;
    /**
     * Claim rewards — marks DB records as claimed.
     *
     * For LEADER rewards: LUNES was already transferred via transferNative.
     * For STAKER rewards: user claims via on-chain staking contract claim_rewards()
     *   (handled by frontend sdk.claimRewards()).
     */
    claimRewards(address: string): Promise<{
        claimed: boolean;
        message: string;
        totalAmount?: undefined;
        rewardsClaimed?: undefined;
        claimedAt?: undefined;
    } | {
        claimed: boolean;
        totalAmount: any;
        rewardsClaimed: any;
        claimedAt: Date;
        message?: undefined;
    }>;
    getRewardHistory(address: string, limit?: number): Promise<any>;
    getDistributedWeeks(limit?: number): Promise<any>;
    retryFailedPayouts(limit?: number): Promise<{
        retried: number;
        total?: undefined;
    } | {
        retried: number;
        total: any;
    }>;
};
export {};
//# sourceMappingURL=rewardDistributionService.d.ts.map