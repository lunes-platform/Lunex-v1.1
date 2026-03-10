import type { AgentType, AgentApiKeyPermission } from '@prisma/client';
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
        id: any;
        walletAddress: any;
        agentType: any;
        framework: any;
        strategyDescription: any;
        isActive: any;
        isBanned: any;
        stakingTier: number;
        stakedAmount: number;
        tradingLimits: {
            dailyTradeLimit: number;
            maxPositionSize: number;
            maxOpenOrders: number;
        };
        totalTrades: any;
        totalVolume: number;
        lastActiveAt: any;
        createdAt: any;
        leader: {
            id: any;
            name: any;
            username: any;
            avatar: any;
            roi30d: number;
            followers: any;
        } | null;
    }>;
    createApiKey(agentId: string, input: {
        label?: string;
        permissions: AgentApiKeyPermission[];
        expiresInDays?: number;
    }): Promise<{
        id: any;
        key: string;
        prefix: string;
        label: any;
        permissions: any;
        expiresAt: any;
    }>;
    revokeApiKey(agentId: string, keyId: string): Promise<void>;
    verifyApiKey(rawKey: string): Promise<{
        agent: any;
        permissions: any;
        keyId: any;
    } | null>;
    getAgentProfile(agentId: string): Promise<{
        id: any;
        walletAddress: any;
        agentType: any;
        framework: any;
        strategyDescription: any;
        isActive: any;
        isBanned: any;
        stakingTier: number;
        stakedAmount: number;
        tradingLimits: {
            dailyTradeLimit: number;
            maxPositionSize: number;
            maxOpenOrders: number;
        };
        totalTrades: any;
        totalVolume: number;
        lastActiveAt: any;
        createdAt: any;
        leader: {
            id: any;
            name: any;
            username: any;
            avatar: any;
            roi30d: number;
            followers: any;
        } | null;
    }>;
    getAgentByWallet(walletAddress: string): Promise<{
        id: any;
        walletAddress: any;
        agentType: any;
        framework: any;
        strategyDescription: any;
        isActive: any;
        isBanned: any;
        stakingTier: number;
        stakedAmount: number;
        tradingLimits: {
            dailyTradeLimit: number;
            maxPositionSize: number;
            maxOpenOrders: number;
        };
        totalTrades: any;
        totalVolume: number;
        lastActiveAt: any;
        createdAt: any;
        leader: {
            id: any;
            name: any;
            username: any;
            avatar: any;
            roi30d: number;
            followers: any;
        } | null;
    } | null>;
    listAgents(filters: {
        agentType?: AgentType;
        isActive?: boolean;
        sortBy?: "totalTrades" | "totalVolume" | "stakedAmount" | "createdAt";
        limit?: number;
        offset?: number;
    }): Promise<{
        agents: any;
        total: any;
    }>;
    recordStake(agentId: string, input: {
        amount: number;
        token?: string;
        txHash?: string;
    }): Promise<{
        stakeId: any;
        newStakedAmount: number;
        tier: number;
        limits: StakingTier;
    }>;
    slashAgent(agentId: string, reason: string): Promise<void>;
    getApiKeys(agentId: string): Promise<any>;
    STAKING_TIERS: StakingTier[];
};
export {};
//# sourceMappingURL=agentService.d.ts.map