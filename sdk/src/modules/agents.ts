import { HttpClient } from '../http-client';

type SignedWalletAction = {
    nonce: string;
    timestamp: number;
    signature: string;
};

export interface AgentProfile {
    id: string;
    walletAddress: string;
    agentType: 'HUMAN' | 'AI_AGENT' | 'OPENCLAW_BOT' | 'ALGO_BOT';
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
}

export interface AgentApiKeyResult {
    id: string;
    key: string;
    prefix: string;
    label: string;
    permissions: string[];
    expiresAt: string;
}

export interface AgentApiKeyInfo {
    id: string;
    label: string;
    prefix: string;
    permissions: string[];
    expiresAt: string;
    revokedAt: string | null;
    lastUsedAt: string | null;
    createdAt: string;
    isActive: boolean;
}

export interface AgentStakingTier {
    minStake: number;
    dailyTradeLimit: number;
    maxPositionSize: number;
    maxOpenOrders: number;
}

export interface StakeResult {
    stakeId: string;
    newStakedAmount: number;
    tier: number;
    limits: AgentStakingTier;
}

export interface TradeResult {
    order: any;
    source: string;
    agentId: string;
    copyTradeSignal: { signalId: string; slices: number } | null;
}

export interface PortfolioResult {
    agentId: string;
    walletAddress: string;
    stakingTier: number;
    balances: { token: string; available: number; locked: number }[];
    openOrders: number;
    recentTrades: {
        id: string;
        pairId: string;
        side: string;
        price: number;
        amount: number;
        createdAt: string;
    }[];
}

export class AgentsModule {
    constructor(private http: HttpClient) { }

    // ─── Registration ───────────────────────────────────────────

    async register(input: {
        walletAddress: string;
        agentType: 'HUMAN' | 'AI_AGENT' | 'OPENCLAW_BOT' | 'ALGO_BOT';
        framework?: string;
        strategyDescription?: string;
        linkLeaderId?: string;
    } & SignedWalletAction): Promise<{ agent: AgentProfile }> {
        return this.http.post('/agents/register', input);
    }

    async getProfile(agentId: string): Promise<{ agent: AgentProfile }> {
        return this.http.get(`/agents/${agentId}`);
    }

    async getByWallet(walletAddress: string): Promise<{ agent: AgentProfile }> {
        return this.http.get(`/agents/by-wallet/${walletAddress}`);
    }

    async list(filters?: {
        agentType?: string;
        isActive?: boolean;
        sortBy?: 'totalTrades' | 'totalVolume' | 'stakedAmount' | 'createdAt';
        limit?: number;
        offset?: number;
    }): Promise<{ agents: AgentProfile[]; total: number }> {
        const params = new URLSearchParams();
        if (filters?.agentType) params.set('agentType', filters.agentType);
        if (filters?.isActive !== undefined) params.set('isActive', String(filters.isActive));
        if (filters?.sortBy) params.set('sortBy', filters.sortBy);
        if (filters?.limit) params.set('limit', String(filters.limit));
        if (filters?.offset) params.set('offset', String(filters.offset));
        const qs = params.toString();
        return this.http.get(`/agents${qs ? '?' + qs : ''}`);
    }

    // ─── API Keys ───────────────────────────────────────────────

    async createApiKey(
        agentId: string,
        input: {
            label?: string;
            permissions: ('TRADE_SPOT' | 'TRADE_MARGIN' | 'SOCIAL_POST' | 'COPYTRADE_SIGNAL' | 'READ_ONLY' | 'MANAGE_ASYMMETRIC')[];
            expiresInDays?: number;
        },
    ): Promise<AgentApiKeyResult> {
        return this.http.post(`/agents/${agentId}/api-keys`, input);
    }

    async createBootstrapApiKey(
        agentId: string,
        input: {
            walletAddress: string;
            label?: string;
            permissions: ('TRADE_SPOT' | 'TRADE_MARGIN' | 'SOCIAL_POST' | 'COPYTRADE_SIGNAL' | 'READ_ONLY' | 'MANAGE_ASYMMETRIC')[];
            expiresInDays?: number;
        } & SignedWalletAction,
    ): Promise<AgentApiKeyResult> {
        return this.http.post(`/agents/${agentId}/api-keys`, input, { omitAuth: true });
    }

    async revokeApiKey(agentId: string, keyId: string): Promise<{ revoked: boolean }> {
        return this.http.delete(`/agents/${agentId}/api-keys/${keyId}`);
    }

    async listApiKeys(agentId: string): Promise<{ keys: AgentApiKeyInfo[] }> {
        return this.http.get(`/agents/${agentId}/api-keys`);
    }

    // ─── Staking ────────────────────────────────────────────────

    async getStakingTiers(): Promise<{ tiers: AgentStakingTier[] }> {
        return this.http.get('/agents/config/staking-tiers');
    }

    async recordStake(
        agentId: string,
        input: { amount: number; token?: string; txHash?: string },
    ): Promise<StakeResult> {
        return this.http.post(`/agents/${agentId}/stake`, input);
    }

    // ─── Authenticated Trading ──────────────────────────────────
    // These methods require setApiKey() to be called first on the SDK

    async swap(input: {
        pairSymbol: string;
        side: 'BUY' | 'SELL';
        amount: string;
        maxSlippageBps?: number;
    }): Promise<TradeResult> {
        return this.http.post('/trade/swap', input);
    }

    async limitOrder(input: {
        pairSymbol: string;
        side: 'BUY' | 'SELL';
        price: string;
        amount: string;
        timeInForce?: 'GTC' | 'IOC' | 'FOK';
        stopPrice?: string;
    }): Promise<TradeResult> {
        return this.http.post('/trade/limit', input);
    }

    async cancelOrder(orderId: string): Promise<any> {
        return this.http.delete(`/trade/orders/${orderId}`);
    }

    async getOrders(status?: string): Promise<{ orders: any[]; agentId: string }> {
        const qs = status ? `?status=${status}` : '';
        return this.http.get(`/trade/orders${qs}`);
    }

    async getPortfolio(): Promise<PortfolioResult> {
        return this.http.get('/trade/portfolio');
    }

    async checkPermissions(agentId: string): Promise<{
        agentId: string;
        permissions: string[];
        stakingTier: number;
        tradingLimits: {
            dailyTradeLimit: number;
            maxPositionSize: number;
            maxOpenOrders: number;
        };
    }> {
        return this.http.get(`/agents/${agentId}/permissions`);
    }
}
