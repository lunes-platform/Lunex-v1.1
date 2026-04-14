import { HttpClient } from '../http-client';

export type StrategyType =
  | 'COPYTRADE'
  | 'MARKET_MAKER'
  | 'ARBITRAGE'
  | 'MOMENTUM'
  | 'HEDGE'
  | 'CUSTOM';
export type StrategyRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'AGGRESSIVE';
export type StrategyStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED';

export interface Strategy {
  id: string;
  agentId: string;
  leaderId?: string;
  vaultAddress?: string;
  name: string;
  description?: string;
  strategyType: StrategyType;
  riskLevel: StrategyRiskLevel;
  status: StrategyStatus;
  isPublic: boolean;
  roi30d: number;
  roi7d: number;
  roi1d: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  totalTrades: number;
  followersCount: number;
  totalVolume: number;
  vaultEquity: number;
  performanceSyncedAt?: string;
  createdAt: string;
  agent?: {
    walletAddress: string;
    agentType: string;
    framework?: string;
    reputationScore: number;
  };
  leader?: {
    id: string;
    name: string;
    username: string;
    avatar?: string;
    isAi: boolean;
    isVerified: boolean;
  };
}

export interface StrategyPerformancePoint {
  id: string;
  date: string;
  roi: number;
  pnl: number;
  volume: number;
  trades: number;
  equity: number;
  drawdown: number;
}

export interface CreateStrategyInput {
  name: string;
  description?: string;
  strategyType: StrategyType;
  riskLevel: StrategyRiskLevel;
  vaultAddress?: string;
  isPublic?: boolean;
}

export interface UpdateStrategyInput {
  name?: string;
  description?: string;
  strategyType?: StrategyType;
  riskLevel?: StrategyRiskLevel;
  status?: StrategyStatus;
  vaultAddress?: string;
  isPublic?: boolean;
}

export class StrategyModule {
  constructor(private http: HttpClient) {}

  /** Public marketplace listing sorted by reputation/roi */
  async getMarketplace(params?: {
    strategyType?: StrategyType;
    riskLevel?: StrategyRiskLevel;
    search?: string;
    sortBy?: 'roi30d' | 'followersCount' | 'totalVolume' | 'sharpeRatio';
    limit?: number;
    offset?: number;
  }): Promise<{ strategies: Strategy[]; total: number }> {
    return this.http.get('/api/v1/strategies/marketplace', params);
  }

  /** List strategies with optional filters */
  async list(params?: {
    strategyType?: StrategyType;
    riskLevel?: StrategyRiskLevel;
    agentId?: string;
    search?: string;
    sortBy?:
      | 'roi30d'
      | 'followersCount'
      | 'totalVolume'
      | 'sharpeRatio'
      | 'createdAt';
    limit?: number;
    offset?: number;
  }): Promise<{ strategies: Strategy[]; total: number }> {
    return this.http.get('/api/v1/strategies', params);
  }

  /** Get a single strategy by ID */
  async get(strategyId: string): Promise<Strategy> {
    const response = await this.http.get<{ strategy: Strategy }>(
      `/api/v1/strategies/${strategyId}`,
    );
    return response.strategy;
  }

  /** Get performance history (requires no auth) */
  async getPerformance(
    strategyId: string,
    days = 30,
  ): Promise<StrategyPerformancePoint[]> {
    const response = await this.http.get<{
      history: StrategyPerformancePoint[];
    }>(`/api/v1/strategies/${strategyId}/performance`, { days });
    return response.history;
  }

  /** Create a new strategy — requires agent API key set on HttpClient */
  async create(input: CreateStrategyInput): Promise<Strategy> {
    const response = await this.http.post<{ strategy: Strategy }>(
      '/api/v1/strategies',
      input,
    );
    return response.strategy;
  }

  /** Update a strategy — requires agent API key */
  async update(
    strategyId: string,
    input: UpdateStrategyInput,
  ): Promise<Strategy> {
    const response = await this.http.patch<{ strategy: Strategy }>(
      `/api/v1/strategies/${strategyId}`,
      input,
    );
    return response.strategy;
  }

  /** Follow a strategy */
  async follow(
    strategyId: string,
    followerAddress: string,
    allocatedCapital?: number,
  ): Promise<{ following: boolean; followersCount: number }> {
    return this.http.post(`/api/v1/strategies/${strategyId}/follow`, {
      followerAddress,
      allocatedCapital,
    });
  }

  /** Unfollow a strategy */
  async unfollow(
    strategyId: string,
    followerAddress: string,
  ): Promise<{ following: boolean; followersCount: number }> {
    return this.http.delete(`/api/v1/strategies/${strategyId}/follow`, {
      followerAddress,
    });
  }

  /** Get strategies followed by a wallet */
  async getFollowed(walletAddress: string): Promise<Strategy[]> {
    const response = await this.http.get<{
      followed: Array<{ strategy: Strategy }>;
    }>(`/api/v1/strategies/followed/${walletAddress}`);
    return response.followed.map((f) => f.strategy);
  }

  /** Sync performance metrics from leader analytics — requires agent API key */
  async syncPerformance(
    strategyId: string,
  ): Promise<{ synced: boolean; performance?: StrategyPerformancePoint }> {
    return this.http.post(
      `/api/v1/strategies/${strategyId}/sync-performance`,
      {},
    );
  }
}
