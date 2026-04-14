const API_BASE = process.env.REACT_APP_SPOT_API_URL || 'http://localhost:4000'

interface SignedAgentActionPayload {
  nonce: string
  timestamp: number
  signature: string
}

export interface AgentProfile {
  id: string
  walletAddress: string
  agentType: 'HUMAN' | 'AI_AGENT' | 'OPENCLAW_BOT' | 'ALGO_BOT'
  framework?: string
  strategyDescription?: string
  stakingTier: number
  totalTrades: number
  totalVolume: number
  roi: number
  sharpe: number
  maxDrawdown: number
  isActive: boolean
  lastActiveAt?: string
  createdAt: string
  leader?: {
    id: string
    name: string
    username: string
    avatar?: string
    followers: number
  }
}

export interface AgentApiKey {
  id: string
  label: string
  permissions: string[]
  expiresAt: string
  lastUsedAt?: string
  createdAt: string
}

export interface AsymmetricDelegationContext {
  relayerAddress: string
  authenticatedAgentId: string
  walletAddress: string
}

function normalizeAgentProfile(agent: any): AgentProfile {
  return {
    id: agent.id,
    walletAddress: agent.walletAddress,
    agentType: agent.agentType,
    framework: agent.framework || undefined,
    strategyDescription: agent.strategyDescription || undefined,
    stakingTier: agent.stakingTier ?? 0,
    totalTrades: agent.totalTrades ?? 0,
    totalVolume: agent.totalVolume ?? 0,
    roi: agent.roi ?? agent.roi30d ?? 0,
    sharpe: agent.sharpe ?? 0,
    maxDrawdown: agent.maxDrawdown ?? 0,
    isActive: agent.isActive ?? true,
    lastActiveAt: agent.lastActiveAt || undefined,
    createdAt: agent.createdAt,
    leader: agent.leader
      ? {
          id: agent.leader.id,
          name: agent.leader.name,
          username: agent.leader.username,
          avatar: agent.leader.avatar || undefined,
          followers: agent.leader.followers ?? agent.leader.followersCount ?? 0
        }
      : undefined
  }
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

async function apiRequestWithKey<T>(
  path: string,
  apiKey: string,
  options: RequestInit = {}
): Promise<T> {
  return await apiRequest<T>(path, {
    ...options,
    headers: { 'X-API-Key': apiKey, ...options.headers }
  })
}

const agentService = {
  async getAgents(params?: {
    agentType?: string
    sortBy?: string
    limit?: number
  }): Promise<AgentProfile[]> {
    const query = new URLSearchParams()
    if (params?.agentType) query.set('agentType', params.agentType)
    if (params?.sortBy) query.set('sortBy', params.sortBy)
    if (params?.limit) query.set('limit', String(params.limit))
    const qs = query.toString()
    const data = await apiRequest<{ agents: any[] }>(
      `/api/v1/agents${qs ? `?${qs}` : ''}`
    )
    return data.agents.map(normalizeAgentProfile)
  },

  async getAgent(id: string): Promise<AgentProfile> {
    const data = await apiRequest<{ agent: any }>(`/api/v1/agents/${id}`)
    return normalizeAgentProfile(data.agent)
  },

  async getAgentByWallet(
    wallet: string,
    auth: SignedAgentActionPayload
  ): Promise<AgentProfile | null> {
    try {
      const query = new URLSearchParams({
        nonce: auth.nonce,
        timestamp: String(auth.timestamp),
        signature: auth.signature
      })
      const data = await apiRequest<{ agent: any }>(
        `/api/v1/agents/by-wallet/${wallet}?${query.toString()}`
      )
      return normalizeAgentProfile(data.agent)
    } catch {
      return null
    }
  },

  async registerAgent(
    data: {
      walletAddress: string
      agentType: string
      framework?: string
      strategyDescription?: string
      linkLeaderId?: string
    } & SignedAgentActionPayload
  ): Promise<AgentProfile> {
    const response = await apiRequest<{ agent: any }>(
      '/api/v1/agents/register',
      {
        method: 'POST',
        body: JSON.stringify(data)
      }
    )
    return normalizeAgentProfile(response.agent)
  },

  async createBootstrapApiKey(
    data: {
      agentId: string
      walletAddress: string
      label?: string
      permissions: string[]
      expiresInDays?: number
    } & SignedAgentActionPayload
  ): Promise<{ key: string; id: string }> {
    return await apiRequest(`/api/v1/agents/${data.agentId}/api-keys`, {
      method: 'POST',
      body: JSON.stringify({
        walletAddress: data.walletAddress,
        label: data.label,
        permissions: data.permissions,
        expiresInDays: data.expiresInDays,
        nonce: data.nonce,
        timestamp: data.timestamp,
        signature: data.signature
      })
    })
  },

  async getApiKeys(agentId: string, apiKey: string): Promise<AgentApiKey[]> {
    const data = await apiRequestWithKey<{ keys: AgentApiKey[] }>(
      `/api/v1/agents/${agentId}/api-keys`,
      apiKey
    )
    return data.keys
  },

  async createApiKey(
    agentId: string,
    apiKey: string,
    label: string,
    permissions: Array<
      | 'TRADE_SPOT'
      | 'TRADE_MARGIN'
      | 'SOCIAL_POST'
      | 'COPYTRADE_SIGNAL'
      | 'READ_ONLY'
      | 'MANAGE_ASYMMETRIC'
    >
  ): Promise<{ key: string; id: string }> {
    return await apiRequestWithKey(
      `/api/v1/agents/${agentId}/api-keys`,
      apiKey,
      {
        method: 'POST',
        body: JSON.stringify({ label, permissions })
      }
    )
  },

  async revokeApiKey(
    agentId: string,
    keyId: string,
    apiKey: string
  ): Promise<void> {
    await apiRequestWithKey(
      `/api/v1/agents/${agentId}/api-keys/${keyId}`,
      apiKey,
      {
        method: 'DELETE'
      }
    )
  },

  async getPortfolio(apiKey: string) {
    return await apiRequestWithKey<{
      agentId: string
      balances: Array<{ token: string; available: number; locked: number }>
      openOrders: number
      recentTrades: Array<{
        id: string
        pairId: string
        side: string
        price: number
        amount: number
      }>
    }>('/api/v1/trade/portfolio', apiKey)
  },

  async getAsymmetricDelegationContext(
    apiKey: string
  ): Promise<AsymmetricDelegationContext> {
    return await apiRequestWithKey(
      '/api/v1/asymmetric/agent/delegation-context',
      apiKey
    )
  },

  async linkAsymmetricStrategy(
    apiKey: string,
    input: { strategyId: string; pairAddress: string }
  ): Promise<{ strategy: unknown }> {
    return await apiRequestWithKey(
      '/api/v1/asymmetric/agent/link-strategy',
      apiKey,
      {
        method: 'POST',
        body: JSON.stringify(input)
      }
    )
  }
}

export default agentService
