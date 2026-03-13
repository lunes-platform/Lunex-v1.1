const API_BASE = process.env.REACT_APP_SPOT_API_URL || 'http://localhost:4000'

export type StrategyType = 'COPYTRADE' | 'MARKET_MAKER' | 'ARBITRAGE' | 'MOMENTUM' | 'HEDGE' | 'CUSTOM'
export type StrategyRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'AGGRESSIVE'
export type StrategyStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED'

export interface Strategy {
    id: string
    agentId: string
    leaderId?: string
    vaultAddress?: string
    name: string
    description?: string
    strategyType: StrategyType
    riskLevel: StrategyRiskLevel
    status: StrategyStatus
    isPublic: boolean
    roi30d: number
    roi7d: number
    roi1d: number
    sharpeRatio: number
    maxDrawdown: number
    winRate: number
    totalTrades: number
    followersCount: number
    totalVolume: number
    vaultEquity: number
    performanceSyncedAt?: string
    createdAt: string
    agent?: {
        walletAddress: string
        agentType: string
        framework?: string
        reputationScore: number
    }
    leader?: {
        id: string
        name: string
        username: string
        avatar?: string
        isAi: boolean
        isVerified: boolean
        roi30d?: number
        followersCount?: number
    }
}

export interface StrategyPerformancePoint {
    id: string
    date: string
    roi: number
    pnl: number
    volume: number
    trades: number
    equity: number
    drawdown: number
}

export interface MarketplaceParams {
    strategyType?: StrategyType
    riskLevel?: StrategyRiskLevel
    search?: string
    sortBy?: 'roi30d' | 'followersCount' | 'totalVolume' | 'sharpeRatio'
    limit?: number
    offset?: number
}

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options,
    })
    if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Request failed: ${res.status}`)
    }
    return res.json() as Promise<T>
}

function normalize(s: any): Strategy {
    return {
        ...s,
        roi30d:       Number(s.roi30d       ?? 0),
        roi7d:        Number(s.roi7d        ?? 0),
        roi1d:        Number(s.roi1d        ?? 0),
        sharpeRatio:  Number(s.sharpeRatio  ?? 0),
        maxDrawdown:  Number(s.maxDrawdown  ?? 0),
        winRate:      Number(s.winRate      ?? 0),
        totalVolume:  Number(s.totalVolume  ?? 0),
        vaultEquity:  Number(s.vaultEquity  ?? 0),
        followersCount: Number(s.followersCount ?? 0),
        totalTrades:  Number(s.totalTrades  ?? 0),
        agent: s.agent
            ? { ...s.agent, reputationScore: Number(s.agent.reputationScore ?? 0) }
            : undefined,
        leader: s.leader
            ? { ...s.leader, roi30d: Number(s.leader.roi30d ?? 0), followersCount: Number(s.leader.followersCount ?? 0) }
            : undefined,
    }
}

const strategyService = {
    async getMarketplace(params: MarketplaceParams = {}): Promise<{ strategies: Strategy[]; total: number }> {
        const q = new URLSearchParams()
        if (params.strategyType) q.set('strategyType', params.strategyType)
        if (params.riskLevel)    q.set('riskLevel',    params.riskLevel)
        if (params.search)       q.set('search',       params.search)
        if (params.sortBy)       q.set('sortBy',       params.sortBy)
        if (params.limit)        q.set('limit',        String(params.limit))
        if (params.offset)       q.set('offset',       String(params.offset))
        const qs = q.toString()
        const data = await apiRequest<{ strategies: any[]; total: number }>(
            `/api/v1/strategies/marketplace${qs ? `?${qs}` : ''}`,
        )
        return { strategies: data.strategies.map(normalize), total: data.total }
    },

    async listStrategies(params: {
        strategyType?: StrategyType
        riskLevel?: StrategyRiskLevel
        agentId?: string
        search?: string
        sortBy?: string
        limit?: number
        offset?: number
    } = {}, apiKey?: string): Promise<{ strategies: Strategy[]; total: number }> {
        const q = new URLSearchParams()
        if (params.strategyType) q.set('strategyType', params.strategyType)
        if (params.riskLevel)    q.set('riskLevel',    params.riskLevel)
        if (params.agentId)      q.set('agentId',      params.agentId)
        if (params.search)       q.set('search',       params.search)
        if (params.sortBy)       q.set('sortBy',       params.sortBy)
        if (params.limit)        q.set('limit',        String(params.limit))
        if (params.offset)       q.set('offset',       String(params.offset))
        const data = await apiRequest<{ strategies: any[]; total: number }>(
            `/api/v1/strategies?${q.toString()}`,
            apiKey ? { headers: { 'X-API-Key': apiKey } } : {},
        )
        return { strategies: data.strategies.map(normalize), total: data.total }
    },

    async getStrategy(id: string): Promise<Strategy> {
        const data = await apiRequest<{ strategy: any }>(`/api/v1/strategies/${id}`)
        return normalize(data.strategy)
    },

    async getPerformanceHistory(id: string, days = 30): Promise<StrategyPerformancePoint[]> {
        const data = await apiRequest<{ history: any[] }>(`/api/v1/strategies/${id}/performance?days=${days}`)
        return data.history.map((p) => ({
            ...p,
            roi:      Number(p.roi),
            pnl:      Number(p.pnl),
            volume:   Number(p.volume),
            equity:   Number(p.equity),
            drawdown: Number(p.drawdown),
        }))
    },

    async followStrategy(strategyId: string, followerAddress: string, allocatedCapital?: number) {
        return apiRequest<{ following: boolean; followersCount: number }>(
            `/api/v1/strategies/${strategyId}/follow`,
            {
                method: 'POST',
                body: JSON.stringify({ followerAddress, allocatedCapital }),
            },
        )
    },

    async unfollowStrategy(strategyId: string, followerAddress: string) {
        return apiRequest<{ following: boolean; followersCount: number }>(
            `/api/v1/strategies/${strategyId}/follow`,
            {
                method: 'DELETE',
                body: JSON.stringify({ followerAddress }),
            },
        )
    },

    async getFollowedStrategies(address: string): Promise<Strategy[]> {
        const data = await apiRequest<{ followed: Array<{ strategy: any }> }>(
            `/api/v1/strategies/followed/${address}`,
        )
        return data.followed.map((f) => normalize(f.strategy))
    },

    async createStrategy(
        params: {
            name: string
            description?: string
            strategyType: StrategyType
            riskLevel: StrategyRiskLevel
            vaultAddress?: string
            isPublic?: boolean
        },
        apiKey: string,
    ): Promise<Strategy> {
        const data = await apiRequest<{ strategy: any }>('/api/v1/strategies', {
            method: 'POST',
            headers: { 'X-API-Key': apiKey },
            body: JSON.stringify(params),
        })
        return normalize(data.strategy)
    },
}

export default strategyService
