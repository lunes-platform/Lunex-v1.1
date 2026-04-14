import { HttpClient } from '../http-client';
import {
  buildWalletActionSignMessage,
  createWalletActionMetadata,
} from '../spot-utils';

type SignedWalletAction = {
  nonce: string;
  timestamp: number;
  signature: string;
};

type SignedReadAuth = {
  nonce?: string;
  timestamp?: number;
  signature?: string;
  signMessage?: (message: string) => Promise<string>;
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
  constructor(private http: HttpClient) {}

  private async resolveSignedRead(input: {
    action: string;
    address: string;
    auth?: SignedReadAuth;
  }): Promise<{ nonce: string; timestamp: number; signature: string }> {
    const metadata = createWalletActionMetadata();
    const nonce = input.auth?.nonce ?? metadata.nonce;
    const timestamp = input.auth?.timestamp ?? metadata.timestamp;

    if (input.auth?.signature) {
      if (!input.auth.nonce || !input.auth.timestamp) {
        throw new Error(
          'signed read requires nonce and timestamp when signature is provided',
        );
      }
      return { nonce, timestamp, signature: input.auth.signature };
    }

    if (!input.auth?.signMessage) {
      throw new Error(
        'signed read requires auth.signMessage or explicit nonce/timestamp/signature',
      );
    }

    const message = buildWalletActionSignMessage({
      action: input.action,
      address: input.address,
      nonce,
      timestamp,
    });
    const signature = await input.auth.signMessage(message);
    return { nonce, timestamp, signature };
  }

  // ─── Registration ───────────────────────────────────────────

  async register(
    input: {
      walletAddress: string;
      agentType: 'HUMAN' | 'AI_AGENT' | 'OPENCLAW_BOT' | 'ALGO_BOT';
      framework?: string;
      strategyDescription?: string;
      linkLeaderId?: string;
    } & SignedWalletAction,
  ): Promise<{ agent: AgentProfile }> {
    return this.http.post('/api/v1/agents/register', input);
  }

  async getProfile(agentId: string): Promise<{ agent: AgentProfile }> {
    return this.http.get(`/api/v1/agents/${agentId}`);
  }

  async getByWallet(
    walletAddress: string,
    auth?: SignedReadAuth,
  ): Promise<{ agent: AgentProfile }> {
    const signed = await this.resolveSignedRead({
      action: 'agents.by-wallet',
      address: walletAddress,
      auth,
    });

    return this.http.get(`/api/v1/agents/by-wallet/${walletAddress}`, {
      nonce: signed.nonce,
      timestamp: signed.timestamp,
      signature: signed.signature,
    });
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
    if (filters?.isActive !== undefined)
      params.set('isActive', String(filters.isActive));
    if (filters?.sortBy) params.set('sortBy', filters.sortBy);
    if (filters?.limit) params.set('limit', String(filters.limit));
    if (filters?.offset) params.set('offset', String(filters.offset));
    const qs = params.toString();
    return this.http.get(`/api/v1/agents${qs ? '?' + qs : ''}`);
  }

  // ─── API Keys ───────────────────────────────────────────────

  async createApiKey(
    agentId: string,
    input: {
      label?: string;
      permissions: (
        | 'TRADE_SPOT'
        | 'TRADE_MARGIN'
        | 'SOCIAL_POST'
        | 'COPYTRADE_SIGNAL'
        | 'READ_ONLY'
        | 'MANAGE_ASYMMETRIC'
      )[];
      expiresInDays?: number;
    },
  ): Promise<AgentApiKeyResult> {
    return this.http.post(`/api/v1/agents/${agentId}/api-keys`, input);
  }

  async createBootstrapApiKey(
    agentId: string,
    input: {
      walletAddress: string;
      label?: string;
      permissions: (
        | 'TRADE_SPOT'
        | 'TRADE_MARGIN'
        | 'SOCIAL_POST'
        | 'COPYTRADE_SIGNAL'
        | 'READ_ONLY'
        | 'MANAGE_ASYMMETRIC'
      )[];
      expiresInDays?: number;
    } & SignedWalletAction,
  ): Promise<AgentApiKeyResult> {
    return this.http.post(`/api/v1/agents/${agentId}/api-keys`, input, {
      omitAuth: true,
    });
  }

  async revokeApiKey(
    agentId: string,
    keyId: string,
  ): Promise<{ revoked: boolean }> {
    return this.http.delete(`/api/v1/agents/${agentId}/api-keys/${keyId}`);
  }

  async listApiKeys(agentId: string): Promise<{ keys: AgentApiKeyInfo[] }> {
    return this.http.get(`/api/v1/agents/${agentId}/api-keys`);
  }

  // ─── Staking ────────────────────────────────────────────────

  async getStakingTiers(): Promise<{ tiers: AgentStakingTier[] }> {
    return this.http.get('/api/v1/agents/config/staking-tiers');
  }

  async recordStake(
    agentId: string,
    input: { amount: number; token?: string; txHash?: string },
  ): Promise<StakeResult> {
    return this.http.post(`/api/v1/agents/${agentId}/stake`, input);
  }

  // ─── Authenticated Trading ──────────────────────────────────
  // These methods require setApiKey() to be called first on the SDK

  async swap(input: {
    pairSymbol: string;
    side: 'BUY' | 'SELL';
    amount: string;
    maxSlippageBps?: number;
  }): Promise<TradeResult> {
    return this.http.post('/api/v1/trade/swap', input);
  }

  async limitOrder(input: {
    pairSymbol: string;
    side: 'BUY' | 'SELL';
    price: string;
    amount: string;
    timeInForce?: 'GTC' | 'IOC' | 'FOK';
    stopPrice?: string;
  }): Promise<TradeResult> {
    return this.http.post('/api/v1/trade/limit', input);
  }

  async cancelOrder(orderId: string): Promise<any> {
    return this.http.delete(`/api/v1/trade/orders/${orderId}`);
  }

  async getOrders(
    status?: string,
  ): Promise<{ orders: any[]; agentId: string }> {
    const qs = status ? `?status=${status}` : '';
    return this.http.get(`/api/v1/trade/orders${qs}`);
  }

  async getPortfolio(): Promise<PortfolioResult> {
    return this.http.get('/api/v1/trade/portfolio');
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
    return this.http.get(`/api/v1/agents/${agentId}/permissions`);
  }
}
