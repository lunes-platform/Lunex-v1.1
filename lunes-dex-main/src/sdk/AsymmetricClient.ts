/**
 * @lunex/sdk — AsymmetricClient
 *
 * Unified SDK module for Asymmetric Liquidity V2.
 * Wraps the dispersed asymmetricContractService, useAsymmetricDeploy hook,
 * and backend REST API into a single, typed client interface.
 *
 * Usage:
 *   import { AsymmetricClient } from '../sdk/AsymmetricClient'
 *
 *   const client = new AsymmetricClient(apiBaseUrl)
 *   const strategies = await client.listStrategies(walletAddress, readAuth)
 *   const strategy = await client.createStrategy({ ... })
 *   await client.updateCurve(strategyId, walletAddress, { isBuySide: true, newGamma: 3 })
 *   await client.toggleAutoRebalance(strategyId, walletAddress, true)
 *   const status = await client.getStrategyStatus(strategyId, walletAddress, readAuth)
 */

import {
  handleReadAuthError,
  readAuthHeaders,
  type ReadAuth
} from '../services/sessionService'

// ─── Types ────────────────────────────────────────────────────────

export interface CurveParameters {
  gamma: number
  maxCapacity: string
  feeTargetBps: number
  profitTargetBps: number
  baseLiquidity?: string
}

export interface StrategyPersistedConfig {
  strategyId: string
  userAddress: string
  pairAddress: string
  agentId: string | null
  status: 'ACTIVE' | 'COOLING_DOWN' | 'SUSPENDED_ERROR' | 'PAUSED'
  isAutoRebalance: boolean
  pendingRebalanceAmount: string
  lastRebalancedAt: string | null
  retryCount: number
  lastError: string | null
  buyCurve: CurveParameters
  sellCurve: CurveParameters
  createdAt: string
  updatedAt: string
}

export interface LiveCurveState {
  k: number
  gamma: number
  maxCapacity: number
  feeBps: number
  currentVolume: number
}

export interface StrategyLiveState {
  available: boolean
  reason: string | null
  source: 'on-chain' | 'unavailable'
  checkedAt: string
  managerAddress: string | null
  relayerAddress: string | null
  delegatedToRelayer: boolean
  buyCurve: LiveCurveState | null
  sellCurve: LiveCurveState | null
}

export interface StrategyDelegationStatus {
  agentManaged: boolean
  agentId: string | null
  walletAddress: string
  requiredScope: 'MANAGE_ASYMMETRIC'
  managerAddress: string | null
  relayerAddress: string | null
  delegatedToRelayer: boolean
  checkedAt: string
}

export interface StrategyStatus {
  id: string
  userAddress: string
  pairAddress: string
  agentId: string | null
  status: 'ACTIVE' | 'COOLING_DOWN' | 'SUSPENDED_ERROR' | 'PAUSED'
  isAutoRebalance: boolean
  pendingRebalanceAmount: string
  lastRebalancedAt: string | null
  buyCurve: CurveParameters
  sellCurve: CurveParameters
  retryCount: number
  lastError: string | null
  agentManaged: boolean
  createdAt: string
  updatedAt: string
  persistedConfig?: StrategyPersistedConfig
  liveState?: StrategyLiveState
  delegation?: StrategyDelegationStatus
}

export interface CreateStrategyInput {
  userAddress: string
  pairAddress: string
  isAutoRebalance?: boolean
  buyK: string
  buyGamma: number
  buyMaxCapacity: string
  buyFeeTargetBps?: number
  sellGamma: number
  sellMaxCapacity: string
  sellFeeTargetBps?: number
  sellProfitTargetBps?: number
  leverageL?: string
  allocationC?: number
  nonce: string
  timestamp: number
  signature: string
}

export interface UpdateCurveInput {
  userAddress: string
  isBuySide: boolean
  newGamma?: number
  newMaxCapacity?: string
  newFeeTargetBps?: number
  nonce: string
  timestamp: number
  signature: string
}

export interface ToggleAutoRebalanceInput {
  userAddress: string
  enable: boolean
  nonce: string
  timestamp: number
  signature: string
}

// Private reads take a `ReadAuth`: a read-session token (`{ sessionToken }`,
// preferred — no wallet prompt) or a legacy per-request signature. Both travel
// in headers (`readAuthHeaders`), never in the query string.

export interface RebalanceLog {
  id: string
  strategyId: string
  side: string
  trigger: string
  acquiredAmount: string
  newCapacity: string
  txHash?: string
  status: string
  lastError?: string
  createdAt: string
}

// ─── Client ───────────────────────────────────────────────────────

export class AsymmetricClient {
  private baseUrl: string

  constructor(apiBaseUrl: string = '/api/v1/asymmetric') {
    this.baseUrl = apiBaseUrl.replace(/\/$/, '')
  }

  private normalizeStrategyStatus(status: StrategyStatus): StrategyStatus {
    return {
      ...status,
      persistedConfig: status.persistedConfig || undefined,
      liveState: status.liveState || undefined,
      delegation: status.delegation || undefined
    }
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers as Record<string, string> | undefined)
      }
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw handleReadAuthError(
        body.error || `AsymmetricClient request failed: ${res.status}`
      )
    }

    return res.json()
  }

  // ─── Strategy CRUD ────────────────────────────────────────────

  async listStrategies(
    walletAddress: string,
    auth: ReadAuth
  ): Promise<StrategyStatus[]> {
    const query = new URLSearchParams({
      address: walletAddress
    })
    const response = await this.request<StrategyStatus[]>(
      `/strategies?${query.toString()}`,
      { headers: readAuthHeaders(auth) }
    )
    return response.map(entry => this.normalizeStrategyStatus(entry))
  }

  async createStrategy(input: CreateStrategyInput): Promise<StrategyStatus> {
    const response = await this.request<StrategyStatus>('/strategies', {
      method: 'POST',
      body: JSON.stringify(input)
    })
    return this.normalizeStrategyStatus(response)
  }

  async getStrategyStatus(
    strategyId: string,
    userAddress: string,
    auth: ReadAuth
  ): Promise<StrategyStatus> {
    const query = new URLSearchParams({
      userAddress
    })
    const response = await this.request<StrategyStatus>(
      `/strategies/${strategyId}?${query.toString()}`,
      { headers: readAuthHeaders(auth) }
    )
    return this.normalizeStrategyStatus(response)
  }

  // ─── Curve Management ─────────────────────────────────────────

  async updateCurve(
    strategyId: string,
    input: UpdateCurveInput
  ): Promise<StrategyStatus> {
    const response = await this.request<StrategyStatus>(
      `/strategies/${strategyId}/curve`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          ...input
        })
      }
    )
    return this.normalizeStrategyStatus(response)
  }

  // ─── Auto-Rebalance ───────────────────────────────────────────

  async toggleAutoRebalance(
    strategyId: string,
    input: ToggleAutoRebalanceInput
  ): Promise<StrategyStatus> {
    const response = await this.request<StrategyStatus>(
      `/strategies/${strategyId}/auto`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          ...input
        })
      }
    )
    return this.normalizeStrategyStatus(response)
  }

  // ─── Logs ─────────────────────────────────────────────────────

  async getRebalanceLogs(
    strategyId: string,
    userAddress: string,
    auth: ReadAuth,
    limit = 50
  ): Promise<RebalanceLog[]> {
    const query = new URLSearchParams({
      userAddress,
      limit: String(limit)
    })
    return this.request(`/strategies/${strategyId}/logs?${query.toString()}`, {
      headers: readAuthHeaders(auth)
    })
  }
}
