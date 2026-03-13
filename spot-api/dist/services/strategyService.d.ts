import type { StrategyType, StrategyRiskLevel, StrategyStatus, Prisma } from '@prisma/client';
export interface CreateStrategyInput {
    agentId: string;
    name: string;
    description?: string;
    strategyType?: StrategyType;
    riskLevel?: StrategyRiskLevel;
    leaderId?: string;
    vaultAddress?: string;
    isPublic?: boolean;
}
export interface UpdateStrategyInput {
    name?: string;
    description?: string;
    strategyType?: StrategyType;
    riskLevel?: StrategyRiskLevel;
    status?: StrategyStatus;
    isPublic?: boolean;
    vaultAddress?: string;
}
export interface ListStrategiesInput {
    strategyType?: StrategyType;
    riskLevel?: StrategyRiskLevel;
    status?: StrategyStatus;
    isPublic?: boolean;
    agentId?: string;
    search?: string;
    sortBy?: 'roi30d' | 'followersCount' | 'totalVolume' | 'sharpeRatio' | 'createdAt';
    sortDir?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
}
export declare const strategyService: {
    createStrategy(input: CreateStrategyInput): Promise<{
        leader: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            name: string;
            address: string;
            roi30d: Prisma.Decimal;
            winRate: Prisma.Decimal;
            sharpe: Prisma.Decimal;
            username: string;
            bio: string;
            avatar: string;
            twitterUrl: string | null;
            telegramUrl: string | null;
            discordUrl: string | null;
            isAi: boolean;
            isVerified: boolean;
            memberSince: Date;
            performanceFeeBps: number;
            roi90d: Prisma.Decimal;
            totalAum: Prisma.Decimal;
            drawdown: Prisma.Decimal;
            followersCount: number;
            avgProfit: Prisma.Decimal;
            totalPerformanceFeesEarned: Prisma.Decimal;
            allowApiTrading: boolean;
            apiKeyHash: string | null;
            pnlHistory: number[];
            tags: string[];
        } | null;
        agent: {
            walletAddress: string;
            agentType: import(".prisma/client").$Enums.AgentType;
            framework: string | null;
        };
    } & {
        id: string;
        status: import(".prisma/client").$Enums.StrategyStatus;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        leaderId: string | null;
        roi30d: Prisma.Decimal;
        winRate: Prisma.Decimal;
        totalTrades: number;
        totalVolume: Prisma.Decimal;
        description: string | null;
        followersCount: number;
        agentId: string;
        sharpeRatio: Prisma.Decimal;
        vaultAddress: string | null;
        strategyType: import(".prisma/client").$Enums.StrategyType;
        riskLevel: import(".prisma/client").$Enums.StrategyRiskLevel;
        isPublic: boolean;
        roi7d: Prisma.Decimal;
        roi1d: Prisma.Decimal;
        maxDrawdown: Prisma.Decimal;
        vaultEquity: Prisma.Decimal;
        performanceSyncedAt: Date | null;
    }>;
    getStrategy(id: string): Promise<{
        leader: {
            id: string;
            name: string;
            username: string;
            avatar: string;
            isAi: boolean;
            isVerified: boolean;
        } | null;
        agent: {
            walletAddress: string;
            agentType: import(".prisma/client").$Enums.AgentType;
            framework: string | null;
            reputationScore: Prisma.Decimal;
        };
    } & {
        id: string;
        status: import(".prisma/client").$Enums.StrategyStatus;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        leaderId: string | null;
        roi30d: Prisma.Decimal;
        winRate: Prisma.Decimal;
        totalTrades: number;
        totalVolume: Prisma.Decimal;
        description: string | null;
        followersCount: number;
        agentId: string;
        sharpeRatio: Prisma.Decimal;
        vaultAddress: string | null;
        strategyType: import(".prisma/client").$Enums.StrategyType;
        riskLevel: import(".prisma/client").$Enums.StrategyRiskLevel;
        isPublic: boolean;
        roi7d: Prisma.Decimal;
        roi1d: Prisma.Decimal;
        maxDrawdown: Prisma.Decimal;
        vaultEquity: Prisma.Decimal;
        performanceSyncedAt: Date | null;
    }>;
    updateStrategy(id: string, agentId: string, input: UpdateStrategyInput): Promise<{
        id: string;
        status: import(".prisma/client").$Enums.StrategyStatus;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        leaderId: string | null;
        roi30d: Prisma.Decimal;
        winRate: Prisma.Decimal;
        totalTrades: number;
        totalVolume: Prisma.Decimal;
        description: string | null;
        followersCount: number;
        agentId: string;
        sharpeRatio: Prisma.Decimal;
        vaultAddress: string | null;
        strategyType: import(".prisma/client").$Enums.StrategyType;
        riskLevel: import(".prisma/client").$Enums.StrategyRiskLevel;
        isPublic: boolean;
        roi7d: Prisma.Decimal;
        roi1d: Prisma.Decimal;
        maxDrawdown: Prisma.Decimal;
        vaultEquity: Prisma.Decimal;
        performanceSyncedAt: Date | null;
    }>;
    listStrategies(input?: ListStrategiesInput): Promise<{
        strategies: ({
            leader: {
                id: string;
                name: string;
                username: string;
                avatar: string;
                isAi: boolean;
            } | null;
            agent: {
                walletAddress: string;
                agentType: import(".prisma/client").$Enums.AgentType;
                framework: string | null;
                reputationScore: Prisma.Decimal;
            };
        } & {
            id: string;
            status: import(".prisma/client").$Enums.StrategyStatus;
            createdAt: Date;
            updatedAt: Date;
            name: string;
            leaderId: string | null;
            roi30d: Prisma.Decimal;
            winRate: Prisma.Decimal;
            totalTrades: number;
            totalVolume: Prisma.Decimal;
            description: string | null;
            followersCount: number;
            agentId: string;
            sharpeRatio: Prisma.Decimal;
            vaultAddress: string | null;
            strategyType: import(".prisma/client").$Enums.StrategyType;
            riskLevel: import(".prisma/client").$Enums.StrategyRiskLevel;
            isPublic: boolean;
            roi7d: Prisma.Decimal;
            roi1d: Prisma.Decimal;
            maxDrawdown: Prisma.Decimal;
            vaultEquity: Prisma.Decimal;
            performanceSyncedAt: Date | null;
        })[];
        total: number;
        limit: number;
        offset: number;
    }>;
    followStrategy(strategyId: string, followerAddress: string, allocatedCapital?: number): Promise<{
        following: boolean;
        followersCount: number;
    }>;
    unfollowStrategy(strategyId: string, followerAddress: string): Promise<{
        following: boolean;
        followersCount: number;
    }>;
    getFollowers(strategyId: string, limit?: number, offset?: number): Promise<{
        followers: {
            id: string;
            followerAddress: string;
            allocatedCapital: Prisma.Decimal;
            followedAt: Date;
        }[];
        total: number;
    }>;
    getFollowedStrategies(followerAddress: string): Promise<({
        strategy: {
            leader: {
                name: string;
                username: string;
                avatar: string;
            } | null;
            agent: {
                walletAddress: string;
                agentType: import(".prisma/client").$Enums.AgentType;
                reputationScore: Prisma.Decimal;
            };
        } & {
            id: string;
            status: import(".prisma/client").$Enums.StrategyStatus;
            createdAt: Date;
            updatedAt: Date;
            name: string;
            leaderId: string | null;
            roi30d: Prisma.Decimal;
            winRate: Prisma.Decimal;
            totalTrades: number;
            totalVolume: Prisma.Decimal;
            description: string | null;
            followersCount: number;
            agentId: string;
            sharpeRatio: Prisma.Decimal;
            vaultAddress: string | null;
            strategyType: import(".prisma/client").$Enums.StrategyType;
            riskLevel: import(".prisma/client").$Enums.StrategyRiskLevel;
            isPublic: boolean;
            roi7d: Prisma.Decimal;
            roi1d: Prisma.Decimal;
            maxDrawdown: Prisma.Decimal;
            vaultEquity: Prisma.Decimal;
            performanceSyncedAt: Date | null;
        };
    } & {
        id: string;
        isActive: boolean;
        followerAddress: string;
        strategyId: string;
        allocatedCapital: Prisma.Decimal;
        followedAt: Date;
        unfollowedAt: Date | null;
    })[]>;
    getPerformanceHistory(strategyId: string, days?: number): Promise<{
        id: string;
        trades: number;
        date: Date;
        volume: Prisma.Decimal;
        drawdown: Prisma.Decimal;
        strategyId: string;
        roi: Prisma.Decimal;
        pnl: Prisma.Decimal;
        equity: Prisma.Decimal;
    }[]>;
    syncPerformanceFromLeader(strategyId: string): Promise<{
        strategy: {
            id: string;
            status: import(".prisma/client").$Enums.StrategyStatus;
            createdAt: Date;
            updatedAt: Date;
            name: string;
            leaderId: string | null;
            roi30d: Prisma.Decimal;
            winRate: Prisma.Decimal;
            totalTrades: number;
            totalVolume: Prisma.Decimal;
            description: string | null;
            followersCount: number;
            agentId: string;
            sharpeRatio: Prisma.Decimal;
            vaultAddress: string | null;
            strategyType: import(".prisma/client").$Enums.StrategyType;
            riskLevel: import(".prisma/client").$Enums.StrategyRiskLevel;
            isPublic: boolean;
            roi7d: Prisma.Decimal;
            roi1d: Prisma.Decimal;
            maxDrawdown: Prisma.Decimal;
            vaultEquity: Prisma.Decimal;
            performanceSyncedAt: Date | null;
        };
        reputationScore: number;
    } | null>;
    getMarketplace(input?: {
        strategyType?: StrategyType;
        riskLevel?: StrategyRiskLevel;
        search?: string;
        sortBy?: "roi30d" | "followersCount" | "totalVolume" | "sharpeRatio";
        limit?: number;
        offset?: number;
    }): Promise<{
        strategies: ({
            leader: {
                id: string;
                name: string;
                roi30d: Prisma.Decimal;
                username: string;
                avatar: string;
                isAi: boolean;
                isVerified: boolean;
                followersCount: number;
            } | null;
            agent: {
                walletAddress: string;
                agentType: import(".prisma/client").$Enums.AgentType;
                framework: string | null;
                reputationScore: Prisma.Decimal;
            };
        } & {
            id: string;
            status: import(".prisma/client").$Enums.StrategyStatus;
            createdAt: Date;
            updatedAt: Date;
            name: string;
            leaderId: string | null;
            roi30d: Prisma.Decimal;
            winRate: Prisma.Decimal;
            totalTrades: number;
            totalVolume: Prisma.Decimal;
            description: string | null;
            followersCount: number;
            agentId: string;
            sharpeRatio: Prisma.Decimal;
            vaultAddress: string | null;
            strategyType: import(".prisma/client").$Enums.StrategyType;
            riskLevel: import(".prisma/client").$Enums.StrategyRiskLevel;
            isPublic: boolean;
            roi7d: Prisma.Decimal;
            roi1d: Prisma.Decimal;
            maxDrawdown: Prisma.Decimal;
            vaultEquity: Prisma.Decimal;
            performanceSyncedAt: Date | null;
        })[];
        total: number;
        limit: number;
        offset: number;
    }>;
    syncAllLeaderStrategies(): Promise<{
        total: number;
        succeeded: number;
        failed: number;
    }>;
};
//# sourceMappingURL=strategyService.d.ts.map