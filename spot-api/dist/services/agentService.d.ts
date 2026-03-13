import type { AgentType, AgentApiKeyPermission, Prisma } from '@prisma/client';
interface StakingTier {
    minStake: number;
    dailyTradeLimit: number;
    maxPositionSize: number;
    maxOpenOrders: number;
}
export declare const agentService: {
    registerAgent(input: {
        walletAddress: string;
        agentType: AgentType;
        framework?: string;
        strategyDescription?: string;
        linkLeaderId?: string;
    }): Promise<{
        id: string;
        walletAddress: string;
        agentType: import(".prisma/client").$Enums.AgentType;
        framework: string | null;
        strategyDescription: string | null;
        isActive: boolean;
        isBanned: boolean;
        stakingTier: number;
        stakedAmount: number;
        tradingLimits: {
            dailyTradeLimit: number;
            maxPositionSize: number;
            maxOpenOrders: number;
        };
        totalTrades: number;
        totalVolume: number;
        lastActiveAt: string | null;
        createdAt: string;
        leader: {
            id: string;
            name: string;
            username: string;
            avatar: string;
            roi30d: number;
            followers: number;
        } | null;
    }>;
    createApiKey(agentId: string, input: {
        label?: string;
        permissions: AgentApiKeyPermission[];
        expiresInDays?: number;
    }): Promise<{
        id: string;
        key: string;
        prefix: string;
        label: string;
        permissions: import(".prisma/client").$Enums.AgentApiKeyPermission[];
        expiresAt: string;
    }>;
    revokeApiKey(agentId: string, keyId: string): Promise<void>;
    verifyApiKey(rawKey: string): Promise<{
        agent: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            isActive: boolean;
            leaderId: string | null;
            walletAddress: string;
            agentType: import(".prisma/client").$Enums.AgentType;
            framework: string | null;
            strategyDescription: string | null;
            isBanned: boolean;
            banReason: string | null;
            dailyTradeLimit: number;
            maxPositionSize: Prisma.Decimal;
            maxOpenOrders: number;
            stakedAmount: Prisma.Decimal;
            stakingTier: number;
            totalTrades: number;
            totalVolume: Prisma.Decimal;
            lastActiveAt: Date | null;
            reputationScore: Prisma.Decimal;
        };
        permissions: import(".prisma/client").$Enums.AgentApiKeyPermission[];
        keyId: string;
    } | null>;
    getAgentProfile(agentId: string): Promise<{
        id: string;
        walletAddress: string;
        agentType: import(".prisma/client").$Enums.AgentType;
        framework: string | null;
        strategyDescription: string | null;
        isActive: boolean;
        isBanned: boolean;
        stakingTier: number;
        stakedAmount: number;
        tradingLimits: {
            dailyTradeLimit: number;
            maxPositionSize: number;
            maxOpenOrders: number;
        };
        totalTrades: number;
        totalVolume: number;
        lastActiveAt: string | null;
        createdAt: string;
        leader: {
            id: string;
            name: string;
            username: string;
            avatar: string;
            roi30d: number;
            followers: number;
        } | null;
    }>;
    getAgentByWallet(walletAddress: string): Promise<{
        id: string;
        walletAddress: string;
        agentType: import(".prisma/client").$Enums.AgentType;
        framework: string | null;
        strategyDescription: string | null;
        isActive: boolean;
        isBanned: boolean;
        stakingTier: number;
        stakedAmount: number;
        tradingLimits: {
            dailyTradeLimit: number;
            maxPositionSize: number;
            maxOpenOrders: number;
        };
        totalTrades: number;
        totalVolume: number;
        lastActiveAt: string | null;
        createdAt: string;
        leader: {
            id: string;
            name: string;
            username: string;
            avatar: string;
            roi30d: number;
            followers: number;
        } | null;
    } | null>;
    listAgents(filters: {
        agentType?: AgentType;
        isActive?: boolean;
        sortBy?: "totalTrades" | "totalVolume" | "stakedAmount" | "createdAt";
        limit?: number;
        offset?: number;
    }): Promise<{
        agents: {
            id: string;
            walletAddress: string;
            agentType: import(".prisma/client").$Enums.AgentType;
            framework: string | null;
            strategyDescription: string | null;
            isActive: boolean;
            isBanned: boolean;
            stakingTier: number;
            stakedAmount: number;
            tradingLimits: {
                dailyTradeLimit: number;
                maxPositionSize: number;
                maxOpenOrders: number;
            };
            totalTrades: number;
            totalVolume: number;
            lastActiveAt: string | null;
            createdAt: string;
            leader: {
                id: string;
                name: string;
                username: string;
                avatar: string;
                roi30d: number;
                followers: number;
            } | null;
        }[];
        total: number;
    }>;
    recordStake(agentId: string, input: {
        amount: number;
        token?: string;
        txHash?: string;
    }): Promise<{
        stakeId: string;
        newStakedAmount: number;
        tier: number;
        limits: StakingTier;
    }>;
    slashAgent(agentId: string, reason: string): Promise<void>;
    getApiKeys(agentId: string): Promise<{
        id: string;
        label: string;
        prefix: string;
        permissions: import(".prisma/client").$Enums.AgentApiKeyPermission[];
        expiresAt: string;
        revokedAt: string | null;
        lastUsedAt: string | null;
        createdAt: string;
        isActive: boolean;
    }[]>;
    STAKING_TIERS: StakingTier[];
};
export {};
//# sourceMappingURL=agentService.d.ts.map