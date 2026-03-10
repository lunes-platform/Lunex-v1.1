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
 *   const strategies = await client.listStrategies(walletAddress)
 *   const strategy = await client.createStrategy({ ... })
 *   await client.updateCurve(strategyId, walletAddress, { isBuySide: true, newGamma: 3 })
 *   await client.toggleAutoRebalance(strategyId, walletAddress, true)
 *   const status = await client.getStrategyStatus(strategyId)
 */

// ─── Types ────────────────────────────────────────────────────────

export interface CurveParameters {
    gamma: number
    maxCapacity: string
    feeTargetBps: number
    profitTargetBps: number
}

export interface StrategyStatus {
    id: string
    userAddress: string
    pairAddress: string
    status: 'ACTIVE' | 'COOLING_DOWN' | 'SUSPENDED_ERROR'
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
}

export interface CreateStrategyInput {
    userAddress: string
    pairAddress: string
    agentId?: string
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
}

export interface UpdateCurveInput {
    isBuySide: boolean
    newGamma?: number
    newMaxCapacity?: string
    newFeeTargetBps?: number
}

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

    private async request<T>(path: string, options?: RequestInit): Promise<T> {
        const url = `${this.baseUrl}${path}`
        const res = await fetch(url, {
            headers: {
                'Content-Type': 'application/json',
                ...options?.headers,
            },
            ...options,
        })

        if (!res.ok) {
            const body = await res.json().catch(() => ({}))
            throw new Error(body.error || `AsymmetricClient request failed: ${res.status}`)
        }

        return res.json()
    }

    // ─── Strategy CRUD ────────────────────────────────────────────

    async listStrategies(walletAddress: string): Promise<StrategyStatus[]> {
        return this.request(`/strategies?address=${encodeURIComponent(walletAddress)}`)
    }

    async createStrategy(input: CreateStrategyInput): Promise<StrategyStatus> {
        return this.request('/strategies', {
            method: 'POST',
            body: JSON.stringify(input),
        })
    }

    async getStrategyStatus(strategyId: string): Promise<StrategyStatus> {
        return this.request(`/strategies/${strategyId}`)
    }

    // ─── Curve Management ─────────────────────────────────────────

    async updateCurve(
        strategyId: string,
        walletAddress: string,
        input: UpdateCurveInput,
    ): Promise<StrategyStatus> {
        return this.request(`/strategies/${strategyId}/curve`, {
            method: 'PATCH',
            body: JSON.stringify({
                address: walletAddress,
                ...input,
            }),
        })
    }

    // ─── Auto-Rebalance ───────────────────────────────────────────

    async toggleAutoRebalance(
        strategyId: string,
        walletAddress: string,
        enable: boolean,
    ): Promise<StrategyStatus> {
        return this.request(`/strategies/${strategyId}/auto`, {
            method: 'PATCH',
            body: JSON.stringify({
                address: walletAddress,
                enable,
            }),
        })
    }

    // ─── Logs ─────────────────────────────────────────────────────

    async getRebalanceLogs(strategyId: string, limit = 50): Promise<RebalanceLog[]> {
        return this.request(`/strategies/${strategyId}/logs?limit=${limit}`)
    }
}

// ─── Default singleton (uses relative API path) ──────────────────

export const asymmetricClient = new AsymmetricClient()
